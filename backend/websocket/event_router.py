"""Event router — applies 5 gates before dispatching market events to analysis."""

import asyncio
import os
from collections import defaultdict
from datetime import datetime
from typing import TYPE_CHECKING

from loguru import logger

from backend.websocket.stream_processor import EventTier, MarketEvent

if TYPE_CHECKING:
    from backend.websocket.analysis_dispatcher import AnalysisDispatcher


class EventRouter:
    """
    Receives MarketEvent objects from stream processor.
    Applies five gates in order — first failure stops processing.

    Gates:
    1. Tier   — IGNORE tier events are dropped immediately
    2. Cooldown — same event type per instrument has minimum gap
    3. State  — instrument must be in WATCHING state
    4. Hours  — respect trading hours and blackout windows
    5. Circuit — max N boardroom calls per hour
    """

    COOLDOWN_CONFIG: dict[str, int] = {
        "OB_ENTRY": int(os.getenv("COOLDOWN_OB_ENTRY", "300")),
        "FVG_ENTRY": int(os.getenv("COOLDOWN_OB_ENTRY", "300")),
        "PDH_CROSS": int(os.getenv("COOLDOWN_KEY_LEVEL", "600")),
        "PDL_CROSS": int(os.getenv("COOLDOWN_KEY_LEVEL", "600")),
        "PDC_CROSS": int(os.getenv("COOLDOWN_KEY_LEVEL", "600")),
        "PWH_CROSS": int(os.getenv("COOLDOWN_KEY_LEVEL", "600")),
        "PWL_CROSS": int(os.getenv("COOLDOWN_KEY_LEVEL", "600")),
        "WEEKLY_OPEN": int(os.getenv("COOLDOWN_KEY_LEVEL", "600")),
        "DAILY_OPEN": int(os.getenv("COOLDOWN_KEY_LEVEL", "600")),
        "ROUND_CROSS": int(os.getenv("COOLDOWN_KEY_LEVEL", "600")),
        "FUNDING_CROSS": int(os.getenv("COOLDOWN_FUNDING", "1800")),
        "VOLUME_SPIKE": int(os.getenv("COOLDOWN_VOLUME_SPIKE", "180")),
        "OI_SPIKE": 300,
        "SIGNIFICANT_CANDLE": int(os.getenv("COOLDOWN_CANDLE", "300")),
        "SWING_POINT": 600,
    }

    MAX_CALLS_PER_HOUR = int(os.getenv("MAX_BOARDROOM_CALLS_PER_HOUR", "8"))
    DELAYED_DISPATCH_SECONDS = 120

    def __init__(self, dispatcher: "AnalysisDispatcher") -> None:
        self.dispatcher = dispatcher
        self._cooldowns: dict[str, datetime] = {}
        self._hourly_calls: int = 0
        self._hour_window_start: datetime = datetime.utcnow()
        self.last_dispatch_time: dict[str, datetime] = {}
        self._stats: dict[str, int] = defaultdict(int)

    async def emit(self, event: MarketEvent) -> None:
        # Gate 1: tier
        if event.tier == EventTier.IGNORE:
            self._stats["tier3_rejected"] += 1
            return

        # Gate 2: cooldown
        cooldown_key = f"{event.instrument}:{event.type}"
        cooldown_secs = self.COOLDOWN_CONFIG.get(event.type, 300)
        last_fired = self._cooldowns.get(cooldown_key)
        if last_fired:
            elapsed = (datetime.utcnow() - last_fired).total_seconds()
            remaining = cooldown_secs - elapsed
            if remaining > 0:
                logger.debug("GATE2 REJECT (cooldown {:.0f}s remaining): {}", remaining, event)
                self._stats["cooldown_rejected"] += 1
                return

        # Gate 3: state machine
        try:
            from backend.execution.order_state_manager import order_state_manager, InstrumentState
            state = await order_state_manager.get_state(event.instrument)
            if state != InstrumentState.WATCHING:
                logger.debug("GATE3 REJECT (state={}): {}", state.value, event)
                self._stats["state_rejected"] += 1
                return
        except Exception:
            logger.exception("State gate check failed — allowing through")

        # Gate 4: trading hours
        try:
            from backend.execution.risk_profile import risk_manager
            if not await risk_manager.is_trading_hours():
                logger.debug("GATE4 REJECT (outside trading hours): {}", event)
                self._stats["hours_rejected"] += 1
                return
        except Exception:
            logger.exception("Trading hours check failed — allowing through")

        # Gate 5: circuit breaker
        self._reset_hourly_counter_if_needed()
        if self._hourly_calls >= self.MAX_CALLS_PER_HOUR:
            logger.warning("GATE5 REJECT (circuit {}/{}): {}", self._hourly_calls, self.MAX_CALLS_PER_HOUR, event)
            self._stats["circuit_rejected"] += 1
            return

        # All gates passed
        self._cooldowns[cooldown_key] = datetime.utcnow()
        self._hourly_calls += 1
        self._stats["dispatched"] += 1

        logger.info("EVENT ACCEPTED [{}/{}]: {} on {} @ ${:,.2f} | {}",
                    self._hourly_calls, self.MAX_CALLS_PER_HOUR,
                    event.type, event.instrument, event.price, event.message)

        if event.tier == EventTier.IMMEDIATE:
            await self._dispatch_now(event)
        elif event.tier == EventTier.DELAYED:
            asyncio.create_task(self._dispatch_delayed(event))

    async def _dispatch_now(self, event: MarketEvent) -> None:
        self.last_dispatch_time[event.instrument] = datetime.utcnow()
        try:
            await self.dispatcher.dispatch(event)
        except Exception:
            logger.exception("Dispatch failed for {}", event)

    async def _dispatch_delayed(self, event: MarketEvent) -> None:
        logger.info("DELAYED: {} — waiting {}s for confirmation", event, self.DELAYED_DISPATCH_SECONDS)
        await asyncio.sleep(self.DELAYED_DISPATCH_SECONDS)

        try:
            from backend.execution.order_state_manager import order_state_manager, InstrumentState
            state = await order_state_manager.get_state(event.instrument)
            if state != InstrumentState.WATCHING:
                logger.info("DELAYED CANCELLED: state changed to {} during wait: {}", state.value, event)
                return
        except Exception:
            pass

        if self._hourly_calls >= self.MAX_CALLS_PER_HOUR:
            logger.warning("DELAYED CANCELLED: circuit breaker hit during wait: {}", event)
            return

        logger.info("DELAYED DISPATCHING after confirmation: {}", event)
        self.last_dispatch_time[event.instrument] = datetime.utcnow()
        try:
            await self.dispatcher.dispatch(event)
        except Exception:
            logger.exception("Delayed dispatch failed for {}", event)

    def _reset_hourly_counter_if_needed(self) -> None:
        now = datetime.utcnow()
        if (now - self._hour_window_start).total_seconds() >= 3600:
            logger.info("Hourly counter reset: had {} calls in last hour", self._hourly_calls)
            self._hourly_calls = 0
            self._hour_window_start = now

    def get_stats(self) -> dict:
        return {
            "hourly_calls": self._hourly_calls,
            "max_per_hour": self.MAX_CALLS_PER_HOUR,
            "hour_window_remaining_seconds": max(
                0, 3600 - (datetime.utcnow() - self._hour_window_start).total_seconds()
            ),
            "rejection_stats": dict(self._stats),
            "last_dispatch_per_instrument": {
                inst: ts.isoformat() for inst, ts in self.last_dispatch_time.items()
            },
        }
