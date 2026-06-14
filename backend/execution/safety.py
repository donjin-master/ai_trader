"""Safety manager — single source of truth for all safety state."""

from datetime import datetime, timezone

from loguru import logger
from sqlalchemy import select

from backend.config import settings
from backend.db.database import AsyncSessionLocal
from backend.db.models import SystemState
from backend.deps import delta_client, to_delta_symbol
from backend.notifications import telegram


class SafetyManager:
    """Holds kill switch, execution mode, and daily P&L state.

    State lives in memory for speed and is persisted to the system_state
    singleton row so it survives restarts.
    """

    BLACKOUT_EVENTS = [
        # Format: ("HH:MM", "UTC", "event_name") — approximate recurring events
        ("12:30", "UTC", "US_CPI_monthly"),
        ("18:00", "UTC", "US_FOMC"),
    ]
    BLACKOUT_WINDOW_MINUTES = 30

    def __init__(self) -> None:
        self.kill_switch_active: bool = False
        self.execution_mode: str = settings.execution_mode
        self.daily_pnl_pct: float = 0.0
        self.daily_loss_limit_pct: float = settings.daily_loss_limit_pct

    async def load_state(self) -> None:
        """Load persisted state from DB on startup; create the row if missing."""
        try:
            async with AsyncSessionLocal() as session:
                row = await session.get(SystemState, 1)
                if row is None:
                    row = SystemState(
                        id=1,
                        kill_switch_active=False,
                        execution_mode=settings.execution_mode,
                        daily_pnl_pct=0,
                        last_reset_at=datetime.now(timezone.utc),
                    )
                    session.add(row)
                    await session.commit()
                else:
                    self.kill_switch_active = bool(row.kill_switch_active)
                    self.execution_mode = row.execution_mode or settings.execution_mode
                    self.daily_pnl_pct = float(row.daily_pnl_pct or 0)
            logger.info(
                "Safety state loaded: kill_switch={} mode={} daily_pnl={}%",
                self.kill_switch_active, self.execution_mode, self.daily_pnl_pct,
            )
        except Exception:
            logger.exception("Failed to load safety state — using defaults")

    async def _persist(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                row = await session.get(SystemState, 1)
                if row is None:
                    row = SystemState(id=1)
                    session.add(row)
                row.kill_switch_active = self.kill_switch_active
                row.execution_mode = self.execution_mode
                row.daily_pnl_pct = self.daily_pnl_pct
                row.updated_at = datetime.now(timezone.utc)
                await session.commit()
        except Exception:
            logger.exception("Failed to persist safety state")

    async def activate_kill_switch(self, reason: str) -> None:
        logger.warning("KILL SWITCH activating: {}", reason)
        self.kill_switch_active = True
        try:
            result = await delta_client.cancel_all_orders()
            logger.info("Kill switch cancelled orders: {}", result)
        except Exception as exc:
            logger.error("Kill switch order cancellation failed: {}", exc)
        await self._persist()
        await telegram.send_message(
            f"🔴 <b>KILL SWITCH: {reason}</b>\nAll orders cancelled."
        )

    async def deactivate_kill_switch(self) -> None:
        """Reset kill switch. Requires manual action."""
        logger.warning("Kill switch deactivated (manual)")
        self.kill_switch_active = False
        await self._persist()
        await telegram.send_message("🟢 Kill switch deactivated. Trading resumed.")

    async def set_execution_mode(self, mode: str) -> None:
        self.execution_mode = mode
        await self._persist()
        logger.info("Execution mode set to {}", mode)

    def _in_blackout_window(self, now: datetime) -> str | None:
        for time_str, _tz, event_name in self.BLACKOUT_EVENTS:
            hour, minute = (int(x) for x in time_str.split(":"))
            event_time = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            delta_mins = abs((now - event_time).total_seconds()) / 60
            if delta_mins <= self.BLACKOUT_WINDOW_MINUTES:
                return event_name
        return None

    async def check_pre_trade(self, instrument: str, portfolio: dict) -> tuple[bool, str]:
        """Run all pre-LLM checks. Returns (can_trade, reason_if_not)."""
        if self.kill_switch_active:
            return False, "kill switch is active"

        if self.daily_pnl_pct <= -self.daily_loss_limit_pct:
            return False, (
                f"daily loss limit hit: {self.daily_pnl_pct:.2f}% <= "
                f"-{self.daily_loss_limit_pct}%"
            )

        positions = portfolio.get("positions", [])
        if len(positions) >= settings.max_open_positions:
            return False, f"max open positions reached ({len(positions)}/{settings.max_open_positions})"

        symbol = to_delta_symbol(instrument)
        if any(p.get("product_symbol") == symbol for p in positions):
            return False, f"position already open on {symbol}"

        event = self._in_blackout_window(datetime.now(timezone.utc))
        if event:
            return False, f"in blackout window for event {event}"

        return True, ""

    async def update_daily_pnl(self, trade_pnl_pct: float) -> None:
        """Add trade P&L to daily running total. Auto-trips to ADVISORY at limit."""
        self.daily_pnl_pct += trade_pnl_pct
        await self._persist()
        logger.info("Daily P&L updated: {:.2f}%", self.daily_pnl_pct)
        if self.daily_pnl_pct <= -self.daily_loss_limit_pct and self.execution_mode != "ADVISORY":
            logger.warning("Daily loss limit breached — switching to ADVISORY mode")
            await self.set_execution_mode("ADVISORY")
            await telegram.send_message(
                f"⚠️ <b>Daily loss limit hit</b> ({self.daily_pnl_pct:.2f}%).\n"
                f"System switched to ADVISORY mode."
            )

    async def reset_daily_stats(self) -> None:
        """Called at midnight IST by scheduler."""
        logger.info("Daily stats reset (was {:.2f}%)", self.daily_pnl_pct)
        self.daily_pnl_pct = 0.0
        try:
            async with AsyncSessionLocal() as session:
                row = await session.get(SystemState, 1)
                if row is not None:
                    row.daily_pnl_pct = 0
                    row.last_reset_at = datetime.now(timezone.utc)
                    await session.commit()
        except Exception:
            logger.exception("Failed to persist daily reset")


safety_manager = SafetyManager()
