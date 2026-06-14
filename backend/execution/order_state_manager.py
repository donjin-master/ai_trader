"""Order state machine — WATCHING → PENDING → OPEN → REFLECTING → WATCHING.

Prevents the boardroom re-running (and burning tokens) while an order is
pending or a position is live, and cancels stale/invalidated limit orders.
"""

from datetime import datetime, timezone
from enum import Enum

from loguru import logger

from backend.deps import delta_client, to_delta_symbol
from backend.notifications import telegram


class InstrumentState(Enum):
    WATCHING = "watching"      # No order, no position — run boardroom
    PENDING = "pending"        # Limit order placed, not filled — monitor only
    OPEN = "open"              # Position live — position manager takes over
    REFLECTING = "reflecting"  # Just closed — Loop 2 running, then → WATCHING


class OrderStateManager:
    def __init__(self) -> None:
        self._instrument_states: dict[str, InstrumentState] = {}
        self._pending_orders: dict[str, dict] = {}
        # instrument → {order_id, entry_price, sl, placed_at, candles_since, ...}

    async def get_state(self, instrument: str) -> InstrumentState:
        symbol = to_delta_symbol(instrument)
        return self._instrument_states.get(symbol, InstrumentState.WATCHING)

    async def can_run_boardroom(self, instrument: str) -> bool:
        """True only in WATCHING. Cheap in-memory check — no API call."""
        return await self.get_state(instrument) == InstrumentState.WATCHING

    def snapshot(self) -> dict:
        return {
            "states": {k: v.value for k, v in self._instrument_states.items()},
            "pending_orders": {
                k: {kk: str(vv) for kk, vv in v.items()}
                for k, v in self._pending_orders.items()
            },
        }

    # ------------------------------------------------------------------
    # Transitions
    # ------------------------------------------------------------------

    async def on_order_placed(self, instrument: str, order: dict) -> None:
        """Called by executor when a limit order is placed (not yet filled)."""
        symbol = to_delta_symbol(instrument)
        self._instrument_states[symbol] = InstrumentState.PENDING
        self._pending_orders[symbol] = {
            **order,
            "placed_at": datetime.now(timezone.utc).isoformat(),
            "candles_since": 0,
        }
        logger.info("State {} → PENDING (limit order {})", symbol, order.get("order_id"))

    async def on_position_opened(self, instrument: str) -> None:
        symbol = to_delta_symbol(instrument)
        self._instrument_states[symbol] = InstrumentState.OPEN
        self._pending_orders.pop(symbol, None)
        logger.info("State {} → OPEN", symbol)

    async def on_position_closed(self, instrument: str) -> None:
        symbol = to_delta_symbol(instrument)
        self._instrument_states[symbol] = InstrumentState.REFLECTING
        logger.info("State {} → REFLECTING", symbol)

    async def on_reflection_complete(self, instrument: str) -> None:
        symbol = to_delta_symbol(instrument)
        self._instrument_states[symbol] = InstrumentState.WATCHING
        logger.info("{} back to WATCHING after reflection", symbol)

    async def cancel_pending(self, instrument: str, reason: str) -> None:
        """Cancel a pending limit order and return to WATCHING."""
        symbol = to_delta_symbol(instrument)
        pending = self._pending_orders.pop(symbol, None)
        if pending and pending.get("order_id"):
            try:
                await delta_client.cancel_order(
                    str(pending["order_id"]), pending.get("product_id")
                )
            except Exception as exc:
                logger.warning("Cancel of pending order failed ({}): {}", symbol, exc)
        self._instrument_states[symbol] = InstrumentState.WATCHING
        logger.info("State {} → WATCHING ({})", symbol, reason)
        await telegram.send_message(
            f"🚫 <b>Pending order cancelled</b>\n{symbol}\nReason: {reason}"
        )

    # ------------------------------------------------------------------
    # 60-second pending check
    # ------------------------------------------------------------------

    async def check_pending_orders(self) -> None:
        """For each PENDING instrument: fill detection, validity, staleness."""
        if not self._pending_orders:
            return
        from backend.execution.risk_profile import risk_manager

        try:
            profile = await risk_manager.get_profile()
        except Exception:
            profile = {}
        stale_limit = int(profile.get("stale_order_candles", 3))
        candle_minutes = 15  # decision timeframe

        try:
            positions = await delta_client.get_positions()
            open_symbols = {p.get("product_symbol") for p in positions}
            open_orders_resp = await delta_client._request("GET", "/v2/orders", auth=True)
            open_order_ids = {str(o.get("id")) for o in open_orders_resp.get("result", [])}
        except Exception as exc:
            logger.warning("Pending check: API error: {}", exc)
            return

        for symbol in list(self._pending_orders.keys()):
            pending = self._pending_orders[symbol]
            placed_at = datetime.fromisoformat(pending["placed_at"])
            elapsed_min = (datetime.now(timezone.utc) - placed_at).total_seconds() / 60
            pending["candles_since"] = int(elapsed_min // candle_minutes)

            # 1. Filled? → OPEN (register with position manager for trail/exits)
            if symbol in open_symbols:
                logger.info("Pending order FILLED on {} — transitioning to OPEN", symbol)
                position = next(
                    (p for p in positions if p.get("product_symbol") == symbol), {}
                )
                try:
                    from backend.execution.position_manager import position_manager

                    entry = float(position.get("entry_price") or pending.get("entry_price") or 0)
                    sl = float(pending.get("sl") or 0)
                    if entry and sl:
                        await position_manager.register_new_position(
                            trade_id=pending.get("trade_id"),
                            instrument=symbol,
                            direction=pending.get("direction", "long"),
                            entry_price=entry,
                            initial_sl=sl,
                            tp1=float(pending.get("tp1") or entry),
                            tp2=float(pending.get("tp2") or entry),
                            tp3=None,
                            contracts=abs(int(position.get("size") or 1)),
                            risk_pct=round(abs(entry - sl) / entry * 100, 2),
                        )
                except Exception:
                    logger.exception("Failed to register filled pending order {}", symbol)
                await self.on_position_opened(symbol)
                continue

            # 2. Order vanished without a position (cancelled externally) → WATCHING
            if str(pending.get("order_id")) not in open_order_ids:
                logger.info("Pending order gone on {} (external cancel) — WATCHING", symbol)
                self._pending_orders.pop(symbol, None)
                self._instrument_states[symbol] = InstrumentState.WATCHING
                continue

            # 3. Stale? (default: 3 candles on the 15M chart = 45 min)
            if pending["candles_since"] >= stale_limit:
                await self.cancel_pending(
                    symbol,
                    f"stale after {pending['candles_since']} candles (limit {stale_limit})",
                )
                continue

            # 4. Setup validity (cheap structural check, no LLM needed)
            try:
                if not await self._setup_still_valid(symbol, pending):
                    await self.cancel_pending(symbol, "setup invalidated (structure shift)")
            except Exception as exc:
                logger.warning("Validity check failed for {}: {}", symbol, exc)

    async def _setup_still_valid(self, symbol: str, pending: dict) -> bool:
        """Mechanical validity: 15M structure must not have flipped against the order."""
        from backend.perception.smc import smc_analyser

        direction = pending.get("direction")
        candles = await delta_client.get_candles(symbol, "15", 60)
        if not candles or direction not in ("long", "short"):
            return True
        structure = smc_analyser.detect_market_structure(smc_analyser._prepare_df(candles))
        choch = structure.get("last_choch")
        against = "BEARISH" if direction == "long" else "BULLISH"
        if choch and choch["type"] == against and choch["candles_ago"] <= 3:
            return False
        return True


order_state_manager = OrderStateManager()
