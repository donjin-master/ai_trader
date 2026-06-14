"""APScheduler job definitions."""

from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from loguru import logger

from backend.ai.loops import (
    run_counterfactual_loop,
    run_decision_loop,
    run_multi_instrument_decision_loop,
    store_market_snapshot,
)
from backend.config import settings
from backend.execution.position_manager import position_manager
from backend.execution.safety import safety_manager

scheduler = AsyncIOScheduler(timezone="UTC")


def next_decision_in_seconds() -> int | None:
    job = scheduler.get_job("decision_loop")
    if job is None or job.next_run_time is None:
        return None
    return max(0, int((job.next_run_time - datetime.now(timezone.utc)).total_seconds()))


async def _safe_decision_loop() -> None:
    try:
        await run_multi_instrument_decision_loop()
        await _reschedule_decision_loop()
    except Exception:
        logger.exception("Decision loop crashed")


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
    try:
        await store_market_snapshot("BTCUSD")
    except Exception:
        logger.exception("Snapshot storage crashed")


async def _safe_counterfactual() -> None:
    try:
        await run_counterfactual_loop()
    except Exception:
        logger.exception("Counterfactual loop crashed")


async def _safe_daily_reset() -> None:
    try:
        await safety_manager.reset_daily_stats()
    except Exception:
        logger.exception("Daily reset crashed")


def start_scheduler() -> None:
    scheduler.add_job(
        _safe_decision_loop,
        IntervalTrigger(minutes=get_scan_interval_minutes()),
        id="decision_loop",
        name="AI decision loop",
    )
    scheduler.add_job(
        _safe_position_monitor,
        IntervalTrigger(seconds=60),
        id="position_manager",
        name="Active position manager",
    )
    scheduler.add_job(
        _safe_pending_orders,
        IntervalTrigger(seconds=60),
        id="pending_orders",
        name="Pending order state machine",
    )
    scheduler.add_job(
        _safe_snapshot_storage,
        IntervalTrigger(minutes=5),
        id="snapshot_storage",
        name="Market snapshot storage",
    )
    scheduler.add_job(
        _safe_counterfactual,
        CronTrigger(hour=20, minute=30),  # 2am IST
        id="nightly_counterfactual",
        name="Nightly counterfactual loop",
    )
    scheduler.add_job(
        _safe_daily_reset,
        CronTrigger(hour=18, minute=30),  # midnight IST
        id="daily_reset",
        name="Daily stats reset",
    )
    scheduler.start()
    logger.info(
        "Scheduler started: decision every {}min, monitor 60s, snapshots 5min",
        get_scan_interval_minutes(),
    )


def get_scan_interval_minutes() -> int:
    hour_ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).hour
    if 0 <= hour_ist < 9:
        return 30
    if 9 <= hour_ist < 13:
        return 15
    if 13 <= hour_ist < 23:
        return 15
    return 60


async def _get_scan_interval_minutes_async() -> int:
    from backend.execution.risk_profile import risk_manager

    hour_ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).hour
    try:
        profile = await risk_manager.get_profile()
        if 0 <= hour_ist < 9:
            return int(profile.get("scan_interval_asia_mins", 30))
        if 9 <= hour_ist < 13:
            return int(profile.get("scan_interval_london_mins", 15))
        if 13 <= hour_ist < 23:
            return int(profile.get("scan_interval_us_mins", 15))
        return int(profile.get("scan_interval_overnight_mins", 60))
    except Exception:
        logger.exception("Could not read scan interval from risk profile")
        return get_scan_interval_minutes()


async def _reschedule_decision_loop() -> None:
    job = scheduler.get_job("decision_loop")
    if job is None:
        return
    interval = await _get_scan_interval_minutes_async()
    job.reschedule(IntervalTrigger(minutes=interval))
    logger.info("Next decision interval set to {} minutes", interval)


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
