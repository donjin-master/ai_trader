"""APScheduler job definitions — event-driven primary, safety-net secondary."""

from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from loguru import logger

from backend.execution.position_manager import position_manager
from backend.execution.safety import safety_manager

scheduler = AsyncIOScheduler(timezone="UTC")

# Set by main.py after WebSocket setup so jobs can reference these singletons
_event_router = None
_analysis_dispatcher = None
_stream_processor = None


def init_scheduler_deps(event_router, analysis_dispatcher, stream_processor) -> None:
    global _event_router, _analysis_dispatcher, _stream_processor
    _event_router = event_router
    _analysis_dispatcher = analysis_dispatcher
    _stream_processor = stream_processor


async def _safety_net_scan() -> None:
    """
    Fires every 30 minutes.
    Skips an instrument if the event system already triggered analysis
    within the last 25 minutes — prevents redundant boardroom calls
    while covering dead-market periods.
    """
    if _event_router is None or _analysis_dispatcher is None:
        return

    from backend.execution.risk_profile import risk_manager
    profile = await risk_manager.get_profile()
    instruments = profile.get("active_instruments") or ["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP"]
    instruments = [i for i in instruments if "XAUUSD" not in i]
    threshold_minutes = 25

    for instrument in instruments:
        last_dispatch = _event_router.last_dispatch_time.get(instrument)
        if last_dispatch:
            mins_since = (datetime.utcnow() - last_dispatch).total_seconds() / 60
            if mins_since < threshold_minutes:
                logger.debug("Safety net SKIPPING {} — event analysis ran {:.1f}min ago",
                             instrument, mins_since)
                continue
        logger.info("Safety net FIRING for {} (no event analysis in {}+min)",
                    instrument, threshold_minutes)
        await _analysis_dispatcher.dispatch_safety_scan(instrument)


async def _safe_position_monitor() -> None:
    try:
        await position_manager.check_and_manage()
    except Exception:
        logger.exception("Position manager crashed")


async def _safe_pending_orders() -> None:
    from backend.execution.order_state_manager import order_state_manager
    try:
        await order_state_manager.check_pending_orders()
    except Exception:
        logger.exception("Pending order check crashed")


async def _safe_snapshot_storage() -> None:
    from backend.ai.loops import store_market_snapshot
    try:
        for instrument in ["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP"]:
            await store_market_snapshot(instrument)
    except Exception:
        logger.exception("Snapshot storage crashed")


async def _safe_counterfactual() -> None:
    from backend.ai.loops import run_counterfactual_loop
    try:
        await run_counterfactual_loop()
    except Exception:
        logger.exception("Counterfactual loop crashed")


async def _refresh_key_levels() -> None:
    from backend.perception.key_levels import key_levels_engine
    if _stream_processor is None:
        return
    for instrument in ["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP"]:
        try:
            levels = await key_levels_engine.compute(instrument, 0)
            _stream_processor.update_key_levels(instrument, levels)
            logger.info("Key levels refreshed for {}", instrument)
        except Exception:
            logger.exception("Key levels refresh failed for {}", instrument)


async def _safe_daily_reset() -> None:
    try:
        await safety_manager.reset_daily_stats()
    except Exception:
        logger.exception("Daily reset crashed")


async def _weekly_calibration() -> None:
    try:
        from backend.ai.calibration import run_calibration_report
        from backend.notifications.telegram import telegram_bot

        report = await run_calibration_report()

        if not report.get("sufficient_data"):
            logger.info("Calibration: insufficient data ({} trades)", report.get("total_trades", 0))
            return

        summary = (
            f"📊 <b>WEEKLY CALIBRATION REPORT</b>\n"
            f"Total trades analysed: {report['total_trades']}\n\n"
        )

        for row in report.get("calibration_data", []):
            conf = row["boardroom_confidence"]
            wr = row["win_rate_pct"]
            n = row["total"]
            bar = "🟢" if wr >= 60 else "🟡" if wr >= 50 else "🔴"
            summary += f"Confidence {conf}/10: {bar} {wr:.0f}% win rate (n={n})\n"

        if not report.get("calibrated") and report.get("high_conf_win_rate") is not None:
            summary += f"\n⚠️ <b>MISCALIBRATION DETECTED</b>\n{report.get('recommendation', '')}"
        else:
            summary += f"\n✅ Confidence scores are well-calibrated (High-confidence WR: {report.get('high_conf_win_rate', 0.0):.0f}%)."

        await telegram_bot.send(summary)
    except Exception:
        logger.exception("Weekly calibration report failed")


async def _weekly_meta_synthesis() -> None:
    try:
        from backend.ai.meta_lessons import run_meta_synthesis
        await run_meta_synthesis()
    except Exception:
        logger.exception("Meta-lesson synthesis failed")


def start_scheduler() -> None:
    # Safety net — primary event driver handles the real work
    scheduler.add_job(
        _safety_net_scan,
        IntervalTrigger(minutes=30),
        id="safety_net_scan",
        name="Safety Net Market Scan",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=60,
    )
    # Position + pending order monitoring (unchanged from V1.3)
    scheduler.add_job(
        _safe_position_monitor,
        IntervalTrigger(seconds=60),
        id="position_manager",
        name="Active position manager",
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        _safe_pending_orders,
        IntervalTrigger(seconds=60),
        id="pending_orders",
        name="Pending order state machine",
        max_instances=1,
        coalesce=True,
    )
    # Every 5 minutes — Loop 3 needs price history
    scheduler.add_job(
        _safe_snapshot_storage,
        IntervalTrigger(minutes=5),
        id="snapshot_storage",
        name="Market snapshot storage",
    )
    # 2am IST = 20:30 UTC
    scheduler.add_job(
        _safe_counterfactual,
        CronTrigger(hour=20, minute=30),
        id="nightly_counterfactual",
        name="Nightly counterfactual loop",
    )
    # Midnight IST = 18:30 UTC
    scheduler.add_job(
        _refresh_key_levels,
        CronTrigger(hour=18, minute=30),
        id="key_levels_refresh",
        name="Daily Key Levels Refresh",
    )
    scheduler.add_job(
        _safe_daily_reset,
        CronTrigger(hour=18, minute=31),
        id="daily_reset",
        name="Daily stats reset",
    )
    # 9am IST Monday = 03:30 UTC Monday
    scheduler.add_job(
        _weekly_calibration,
        CronTrigger(day_of_week="mon", hour=3, minute=30),
        id="weekly_calibration",
        name="Weekly Confidence Calibration Report",
    )
    # 11pm IST Sunday = 17:30 UTC Sunday
    scheduler.add_job(
        _weekly_meta_synthesis,
        CronTrigger(day_of_week="sun", hour=17, minute=30),
        id="weekly_meta_synthesis",
        name="Weekly Meta-Lesson Synthesis",
    )
    scheduler.start()
    logger.info("Scheduler started: safety-net 30min, monitors 60s, snapshots 5min")


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def next_safety_net_in_seconds() -> int | None:
    job = scheduler.get_job("safety_net_scan")
    if job is None or job.next_run_time is None:
        return None
    return max(0, int((job.next_run_time - datetime.now(timezone.utc)).total_seconds()))


# Alias used by main.py — V1.4 renamed to safety-net terminology
next_decision_in_seconds = next_safety_net_in_seconds
