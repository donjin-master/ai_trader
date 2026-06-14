"""Position monitor — detects position closes and triggers the reflection loop."""

from datetime import datetime, timezone
from typing import Any

from loguru import logger
from sqlalchemy import select

from backend.db.database import AsyncSessionLocal
from backend.db.models import Trade
from backend.deps import delta_client
from backend.execution.safety import safety_manager
from backend.notifications import telegram


class PositionMonitor:
    """Runs every 60 seconds. Detects position state changes and triggers Loop 2."""

    def __init__(self) -> None:
        # product_symbol -> {"position": dict, "first_seen": datetime}
        self._known_positions: dict[str, dict[str, Any]] = {}

    async def check_positions(self) -> None:
        try:
            current = await delta_client.get_positions()
        except Exception as exc:
            logger.warning("Position monitor: failed to fetch positions: {}", exc)
            return

        current_by_symbol = {p.get("product_symbol"): p for p in current}
        now = datetime.now(timezone.utc)

        # New positions appearing
        for symbol, position in current_by_symbol.items():
            if symbol not in self._known_positions:
                logger.info("Position monitor: new position detected on {}", symbol)
                self._known_positions[symbol] = {"position": position, "first_seen": now}
            else:
                self._known_positions[symbol]["position"] = position

        # Positions that were open and are now closed
        for symbol in list(self._known_positions.keys()):
            if symbol in current_by_symbol:
                continue
            known = self._known_positions.pop(symbol)
            await self._handle_closed_position(symbol, known, now)

    async def _handle_closed_position(
        self, symbol: str, known: dict[str, Any], now: datetime
    ) -> None:
        position = known["position"]
        entry_price = float(position.get("entry_price") or 0)
        size = int(position.get("size") or 0)
        direction = "long" if size > 0 else "short"
        duration_mins = int((now - known["first_seen"]).total_seconds() / 60)

        # Approximate exit at current mark price
        exit_price = entry_price
        try:
            ticker = await delta_client.get_ticker(symbol)
            exit_price = float(ticker.get("close") or entry_price)
        except Exception as exc:
            logger.warning("Could not fetch exit price for {}: {}", symbol, exc)

        pnl_pct = 0.0
        if entry_price:
            raw = (exit_price - entry_price) / entry_price * 100
            pnl_pct = round(raw if direction == "long" else -raw, 2)

        logger.info(
            "Position CLOSED: {} {} pnl={:.2f}% duration={}min",
            symbol, direction, pnl_pct, duration_mins,
        )

        trade_id: str | None = None
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(Trade)
                    .where(Trade.instrument == symbol, Trade.status == "open")
                    .order_by(Trade.created_at.desc())
                    .limit(1)
                )
                trade = result.scalar_one_or_none()
                if trade is not None:
                    trade.exit_price = exit_price
                    trade.pnl_pct = pnl_pct
                    trade.duration_mins = duration_mins
                    trade.status = "closed"
                    trade.exit_trigger = "tp/sl"
                    await session.commit()
                    trade_id = str(trade.id)
        except Exception:
            logger.exception("Failed to update closed trade record for {}", symbol)

        await safety_manager.update_daily_pnl(pnl_pct)

        pnl_emoji = "🟢" if pnl_pct >= 0 else "🔴"
        await telegram.send_message(
            f"📊 <b>POSITION CLOSED</b>\n"
            f"{symbol} | {direction} | {pnl_emoji} {pnl_pct:.2f}%\n"
            f"Duration: {duration_mins}min"
        )

        if trade_id:
            from backend.ai.loops import run_reflection_loop

            try:
                await run_reflection_loop(trade_id)
            except Exception:
                logger.exception("Reflection loop failed for trade {}", trade_id)


position_monitor = PositionMonitor()
