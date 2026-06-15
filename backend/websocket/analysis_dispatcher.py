"""Analysis dispatcher — bridges MarketEvent to run_decision_loop."""

from datetime import datetime

from loguru import logger

from backend.websocket.stream_processor import MarketEvent


class AnalysisDispatcher:
    """
    Final stage of the event pipeline.
    Converts MarketEvent into a decision loop call with trigger context injected.
    """

    _EVENT_EXPLANATIONS: dict[str, str] = {
        "OB_ENTRY": "Price has entered an Order Block zone identified in the last SMC analysis",
        "FVG_ENTRY": "Price has entered a Fair Value Gap identified in the last SMC analysis",
        "PDH_CROSS": "Price has crossed the Previous Day High — a major liquidity level",
        "PDL_CROSS": "Price has crossed the Previous Day Low — a major liquidity level",
        "PDC_CROSS": "Price has crossed the Previous Day Close — a key reference level",
        "PWH_CROSS": "Price has crossed the Previous Week High — significant weekly level",
        "PWL_CROSS": "Price has crossed the Previous Week Low — significant weekly level",
        "WEEKLY_OPEN": "Price has crossed the Weekly Open — directional bias reference",
        "DAILY_OPEN": "Price has crossed the Daily Open — intraday directional reference",
        "ROUND_CROSS": "Price has crossed a major round number — psychological level",
        "FUNDING_CROSS": "Funding rate has crossed a meaningful threshold — positioning is shifting",
        "VOLUME_SPIKE": "Unusual volume detected — large participant activity",
        "OI_SPIKE": "Open Interest has changed significantly — positions opening or closing",
        "SIGNIFICANT_CANDLE": "A candle with large body has closed — momentum signal",
        "SWING_POINT": "A potential swing high or low has formed on the 15M chart",
    }

    def __init__(self) -> None:
        self.dispatch_count = 0
        self.last_dispatch: dict[str, datetime] = {}

    async def dispatch(self, event: MarketEvent) -> None:
        from backend.ai.loops import run_decision_loop

        self.dispatch_count += 1
        self.last_dispatch[event.instrument] = datetime.utcnow()

        trigger_context = self._build_trigger_context(event)

        logger.info("DISPATCHING analysis #{} for {} — trigger: {}",
                    self.dispatch_count, event.instrument, event.type)
        try:
            await run_decision_loop(
                instrument=event.instrument,
                trigger_event=event,
                trigger_context=trigger_context,
            )
        except Exception:
            logger.exception("Decision loop failed for event-triggered dispatch")

    async def dispatch_safety_scan(self, instrument: str) -> None:
        from backend.ai.loops import run_decision_loop

        logger.info("SAFETY SCAN for {} (no trigger event)", instrument)
        try:
            await run_decision_loop(
                instrument=instrument,
                trigger_event=None,
                trigger_context="",
            )
        except Exception:
            logger.exception("Safety scan failed for {}", instrument)

    def _build_trigger_context(self, event: MarketEvent | None) -> str:
        if event is None:
            return ""
        explanation = self._EVENT_EXPLANATIONS.get(
            event.type, f"A market event of type {event.type} was detected"
        )
        level_str = f"${event.level:,.2f}" if event.level else "N/A"
        return (
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "ANALYSIS TRIGGERED BY MARKET EVENT (not scheduled scan)\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"Instrument:    {event.instrument}\n"
            f"Event Type:    {event.type}\n"
            f"Trigger Price: ${event.price:,.2f}\n"
            f"Trigger Time:  {event.timestamp.strftime('%H:%M:%S')} UTC\n"
            f"Level:         {level_str}\n\n"
            f"What happened: {explanation}\n"
            f"Details:       {event.message}\n\n"
            "IMPORTANT: This analysis was triggered because something meaningful\n"
            "just occurred in the market — not because a timer fired.\n"
            "Weight your analysis accordingly. This may be a setup forming RIGHT NOW.\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        )

    def get_stats(self) -> dict:
        return {
            "total_dispatches": self.dispatch_count,
            "last_dispatch_per_instrument": {
                inst: ts.isoformat() for inst, ts in self.last_dispatch.items()
            },
        }


analysis_dispatcher = AnalysisDispatcher()
