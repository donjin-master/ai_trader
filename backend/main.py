"""FastAPI application entry point for the AI Trader."""

import asyncio
import base64
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

from fastapi import BackgroundTasks, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from sqlalchemy import delete, select, text

from backend.ai.loops import run_decision_loop, run_reflection_loop
from backend.config import settings
from backend.db.database import AsyncSessionLocal, create_tables
from backend.db.models import AgentLesson, ChartDrawing, ImportJob, PatternOutcome, Trade, UserTrade
from backend.delta.client import DeltaAPIError
from backend.deps import delta_client, snapshot_builder, to_delta_symbol
from backend.execution.executor import executor
from backend.execution.safety import safety_manager
from backend.notifications import telegram
from backend.scheduler import next_decision_in_seconds, start_scheduler, stop_scheduler

VALID_MODES = ("ADVISORY", "SEMI_AUTO", "FULL_AUTO")


def _trade_to_dict(trade: Trade, full: bool = False) -> dict:
    data = {
        "id": str(trade.id),
        "timestamp": trade.timestamp.isoformat() if trade.timestamp else None,
        "instrument": trade.instrument,
        "action": trade.direction,
        "direction": trade.direction,
        "entry_price": float(trade.entry_price) if trade.entry_price is not None else None,
        "exit_price": float(trade.exit_price) if trade.exit_price is not None else None,
        "size_pct": float(trade.size_pct) if trade.size_pct is not None else None,
        "pnl_pct": float(trade.pnl_pct) if trade.pnl_pct is not None else None,
        "duration_mins": trade.duration_mins,
        "confidence": trade.confidence,
        "status": trade.status,
        "exit_trigger": trade.exit_trigger,
        "reasoning": trade.entry_reasoning,
        "bull_case": trade.bull_case,
        "bear_case": trade.bear_case,
        "key_signals": trade.key_signals,
        "boardroom_confidence": trade.boardroom_confidence,
        "actual_outcome": trade.actual_outcome,
        "created_at": trade.created_at.isoformat() if trade.created_at else None,
        "reflection": trade.reflection,
        "counterfactuals": trade.counterfactuals,
        "setup_score": float(trade.setup_score) if trade.setup_score is not None else None,
        "setup_grade": trade.setup_grade,
        "vision_used": bool(trade.vision_used),
        "has_chart": trade.chart_at_entry_b64 is not None,
        "boardroom_votes": trade.boardroom_votes,
        "position_params": trade.position_params,
    }
    if full:
        data["decision_json"] = trade.decision_json
        data["market_snapshot"] = trade.market_snapshot
        data["smc_analysis"] = trade.smc_analysis
    else:
        smc = trade.smc_analysis or {}
        data["smc_summary"] = {
            "structures": {
                tf: {"trend": s.get("trend")}
                for tf, s in (smc.get("structures") or {}).items()
            },
            "premium_discount": (smc.get("premium_discount") or {}).get("zone"),
            "confluences_found": (smc.get("raw_score_pre_boardroom") or {}).get("confluences_found", []),
            "missing": (smc.get("raw_score_pre_boardroom") or {}).get("missing", []),
        } if smc else None
    return data


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("AI Trader starting...")
    try:
        await create_tables()
    except Exception:
        logger.error("DB init failed — API will run but persistence is unavailable")
    await safety_manager.load_state()
    from backend.execution.position_manager import position_manager

    await position_manager.load_state()
    await telegram.start_bot()
    start_scheduler()
    await telegram.notify_startup()
    logger.info(
        "AI Trader ready (environment={}, mode={})",
        settings.environment, safety_manager.execution_mode,
    )
    yield
    stop_scheduler()
    await telegram.stop_bot()
    await delta_client.close()
    logger.info("AI Trader shut down")


app = FastAPI(title="AI Trader", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "environment": settings.environment,
        "mode": safety_manager.execution_mode,
    }


@app.get("/api/snapshot/{instrument}")
async def get_snapshot(instrument: str) -> dict:
    try:
        return await snapshot_builder.build_snapshot(to_delta_symbol(instrument))
    except Exception as exc:
        logger.exception("Snapshot failed for {}", instrument)
        raise HTTPException(status_code=502, detail=f"Snapshot failed: {exc}")


@app.get("/api/positions")
async def get_positions() -> list[dict]:
    try:
        return await delta_client.get_positions()
    except DeltaAPIError as exc:
        logger.error("Positions fetch failed: {}", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/balance")
async def get_balance() -> Any:
    try:
        return await delta_client.get_wallet_balance()
    except DeltaAPIError as exc:
        logger.error("Balance fetch failed: {}", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/kill")
async def kill_switch() -> dict:
    await safety_manager.activate_kill_switch("manual")
    return {"kill_switch": True}


@app.post("/api/resume")
async def resume() -> dict:
    await safety_manager.deactivate_kill_switch()
    return {"kill_switch": False}


@app.get("/api/status")
async def status() -> dict:
    from backend.execution.risk_profile import risk_manager

    open_positions_count = 0
    try:
        open_positions_count = len(await delta_client.get_positions())
    except Exception as exc:
        logger.warning("Could not fetch positions for status: {}", exc)

    profile: dict = {}
    daily_stats: dict = {}
    try:
        profile = await risk_manager.get_profile()
        daily_stats = await risk_manager.get_daily_stats()
    except Exception as exc:
        logger.warning("Could not fetch risk profile for status: {}", exc)

    daily_budget_inr = (
        profile.get("total_capital", 0) * profile.get("daily_budget_pct", 0) / 100
        if profile else 0
    )
    daily_pnl_inr = (
        daily_stats.get("pnl_pct", 0) / 100 * profile.get("total_capital", 0)
        if profile else 0
    )
    return {
        "mode": profile.get("mode", safety_manager.execution_mode),
        "kill_switch": safety_manager.kill_switch_active,
        "daily_pnl": safety_manager.daily_pnl_pct,
        "open_positions_count": open_positions_count,
        "next_decision_in_seconds": next_decision_in_seconds(),
        "risk": {
            "trades_today": daily_stats.get("trade_count", 0),
            "max_trades_per_day": profile.get("max_trades_per_day"),
            "daily_budget_inr": round(daily_budget_inr, 2),
            "daily_budget_used_inr": round(abs(min(0.0, daily_pnl_inr)), 2),
            "max_concurrent_trades": profile.get("max_concurrent_trades"),
            "consecutive_losses": daily_stats.get("consecutive_losses", 0),
            "consecutive_loss_limit": profile.get("consecutive_loss_limit"),
            "min_setup_score": profile.get("min_setup_score"),
            "total_capital": profile.get("total_capital"),
        },
    }


# ---------------------------------------------------------------------------
# Decisions, lessons, trades
# ---------------------------------------------------------------------------

@app.get("/api/decisions")
async def get_decisions(limit: int = 20) -> list[dict]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Trade).order_by(Trade.created_at.desc()).limit(limit)
        )
        return [_trade_to_dict(t) for t in result.scalars().all()]


@app.get("/api/decisions/{decision_id}")
async def get_decision(decision_id: str) -> dict:
    async with AsyncSessionLocal() as session:
        trade = await session.get(Trade, decision_id)
        if trade is None:
            raise HTTPException(status_code=404, detail="decision not found")
        return _trade_to_dict(trade, full=True)


@app.get("/api/lessons")
async def get_lessons() -> list[dict]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AgentLesson).order_by(AgentLesson.created_at.desc())
        )
        return [
            {
                "id": str(l.id),
                "lesson_text": l.lesson_text,
                "watch_for": l.watch_for,
                "pattern_type": l.pattern_type,
                "confidence_score": l.confidence_score,
                "quality_score": l.quality_score,
                "source_trade_id": str(l.source_trade_id) if l.source_trade_id else None,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            }
            for l in result.scalars().all()
        ]


@app.put("/api/lessons/{lesson_id}/quality")
async def update_lesson_quality(lesson_id: str, payload: dict) -> dict:
    quality_score = payload.get("quality_score")
    if quality_score is None:
        raise HTTPException(status_code=400, detail="Missing quality_score")
    try:
        quality_score = int(quality_score)
    except ValueError:
        raise HTTPException(status_code=400, detail="quality_score must be an integer")
    if not (1 <= quality_score <= 5):
        raise HTTPException(status_code=400, detail="quality_score must be between 1 and 5")

    try:
        lesson_uuid = uuid.UUID(lesson_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid lesson_id format")

    async with AsyncSessionLocal() as session:
        lesson = await session.get(AgentLesson, lesson_uuid)
        if lesson is None:
            raise HTTPException(status_code=404, detail="Lesson not found")
        lesson.quality_score = quality_score
        await session.commit()

    return {"status": "success", "quality_score": quality_score}


@app.get("/api/trades")
async def get_trades(limit: int = 50, offset: int = 0) -> list[dict]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Trade)
            .order_by(Trade.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return [_trade_to_dict(t) for t in result.scalars().all()]


# ---------------------------------------------------------------------------
# Mode, approvals, manual actions
# ---------------------------------------------------------------------------

async def _apply_mode(mode: str) -> dict:
    from backend.execution.risk_profile import risk_manager
    from backend.execution.risk_profile import VALID_MODES as PROFILE_MODES

    mode = mode.upper()
    if mode == "FULL_AUTO":  # legacy alias from Day 2/3
        mode = "AUTONOMOUS"
    if mode not in PROFILE_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {PROFILE_MODES}")
    await risk_manager.update_profile({"mode": mode})
    await safety_manager.set_execution_mode(mode)
    return {"mode": mode}


@app.post("/api/mode/{mode}")
async def set_mode_path(mode: str) -> dict:
    return await _apply_mode(mode)


@app.post("/api/mode")
async def set_mode_body(payload: dict) -> dict:
    if "mode" not in payload:
        raise HTTPException(status_code=400, detail="body must include {'mode': ...}")
    return await _apply_mode(str(payload["mode"]))


# ---------------------------------------------------------------------------
# Risk profile (control panel)
# ---------------------------------------------------------------------------

@app.get("/api/risk-profile")
async def get_risk_profile() -> dict:
    from backend.execution.risk_profile import risk_manager

    return await risk_manager.get_profile()


@app.put("/api/risk-profile")
async def update_risk_profile(updates: dict) -> dict:
    from backend.execution.risk_profile import risk_manager

    try:
        return await risk_manager.update_profile(updates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/risk-profile/reset")
async def reset_risk_profile() -> dict:
    from backend.execution.risk_profile import risk_manager

    return await risk_manager.reset_profile()


# ---------------------------------------------------------------------------
# Candles + charts (UPGRADE_UI_CHART_RR + UPGRADE_VISION_CHART_MEMORY)
# ---------------------------------------------------------------------------

TIMEFRAME_RESOLUTIONS = {
    "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
    "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720",
    "1D": "1440", "1W": "10080",
}


@app.get("/api/candles/{instrument}/{timeframe}")
async def get_candles_endpoint(
    instrument: str,
    timeframe: str,
    limit: int = 100,
    before: int | None = None,
) -> list[dict]:
    resolution = TIMEFRAME_RESOLUTIONS.get(timeframe)
    if resolution is None:
        raise HTTPException(status_code=400, detail=f"timeframe must be one of {list(TIMEFRAME_RESOLUTIONS)}")
    try:
        candles = await delta_client.get_candles(
            to_delta_symbol(instrument), resolution, limit, end=before
        )
        return candles  # already {time, open, high, low, close, volume} oldest-first
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.websocket("/ws/candles/{instrument}")
async def candle_websocket(websocket: WebSocket, instrument: str) -> None:
    """Pushes candle updates to the dashboard (backend polls Delta every 5s)."""
    await websocket.accept()
    symbol = to_delta_symbol(instrument)
    timeframe = websocket.query_params.get("timeframe", "15m")
    resolution = TIMEFRAME_RESOLUTIONS.get(timeframe, "15")
    last_candle: dict | None = None
    try:
        while True:
            try:
                candles = await delta_client.get_candles(symbol, resolution, 2)
                if candles:
                    candle = candles[-1]
                    if last_candle is None or candle["time"] != last_candle["time"]:
                        await websocket.send_json({"type": "new_candle", "candle": candle})
                    elif candle != last_candle:
                        await websocket.send_json({"type": "update_candle", "candle": candle})
                    last_candle = candle
            except WebSocketDisconnect:
                raise
            except Exception as exc:
                logger.warning("Candle WS poll error: {}", exc)
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        logger.info("Candle WS client disconnected ({})", symbol)
    except Exception as exc:
        logger.warning("Candle WS closed: {}", exc)


@app.get("/api/decisions/{decision_id}/chart")
async def get_decision_chart(decision_id: str) -> Response:
    """The chart image stored when this decision was made — 'what the AI saw'."""
    async with AsyncSessionLocal() as session:
        trade = await session.get(Trade, decision_id)
        if trade is None or not trade.chart_at_entry_b64:
            raise HTTPException(status_code=404, detail="No chart stored for this decision")
        image_bytes = base64.b64decode(trade.chart_at_entry_b64)
    return Response(
        content=image_bytes,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/api/chart/live/{instrument}/{timeframe}")
async def get_live_chart(instrument: str, timeframe: str) -> Response:
    """Generates a fresh annotated chart right now (AI View mode)."""
    from backend.execution.position_manager import position_manager
    from backend.perception.chart_generator import chart_generator
    from backend.perception.smc import smc_analyser

    resolution = TIMEFRAME_RESOLUTIONS.get(timeframe)
    if resolution is None:
        raise HTTPException(status_code=400, detail=f"timeframe must be one of {list(TIMEFRAME_RESOLUTIONS)}")
    symbol = to_delta_symbol(instrument)
    try:
        candles = await delta_client.get_candles(symbol, resolution, 80)
        snapshot = await snapshot_builder.build_snapshot(symbol)
        smc = await smc_analyser.analyse(symbol, delta_client, snapshot)
        open_state = next(
            (s for s in position_manager.snapshot_states() if s["instrument"] == symbol),
            None,
        )
        chart = await chart_generator.generate_decision_chart(
            symbol, timeframe, candles, smc, open_state, None,
        )
        return Response(content=chart["image_bytes"], media_type="image/png")
    except Exception as exc:
        logger.exception("Live chart generation failed for {}", instrument)
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/key-levels/{instrument}")
async def get_key_levels(instrument: str) -> dict:
    from backend.perception.key_levels import key_levels_engine

    try:
        snapshot = await snapshot_builder.build_snapshot(to_delta_symbol(instrument))
        return await key_levels_engine.compute(instrument, snapshot.get("price") or 0)
    except Exception as exc:
        logger.exception("Key level computation failed for {}", instrument)
        raise HTTPException(status_code=502, detail=str(exc))


def _drawing_to_dict(row: ChartDrawing) -> dict:
    return {
        "id": str(row.id),
        "instrument": row.instrument,
        "timeframe": row.timeframe,
        "drawing_type": row.drawing_type,
        "points": row.points,
        "style": row.style,
        "locked": row.locked,
        "label": row.label,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@app.get("/api/drawings/{instrument}/{timeframe}")
async def get_drawings(instrument: str, timeframe: str) -> list[dict]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(ChartDrawing)
            .where(ChartDrawing.instrument == instrument, ChartDrawing.timeframe == timeframe)
            .order_by(ChartDrawing.created_at.asc())
        )
        return [_drawing_to_dict(d) for d in result.scalars().all()]


@app.post("/api/drawings/{instrument}/{timeframe}")
async def save_drawing(instrument: str, timeframe: str, drawing: dict) -> dict:
    async with AsyncSessionLocal() as session:
        row = ChartDrawing(
            instrument=instrument,
            timeframe=timeframe,
            drawing_type=drawing.get("drawing_type") or drawing.get("type") or "unknown",
            points=drawing.get("points") or [],
            style=drawing.get("style") or {},
            locked=bool(drawing.get("locked", False)),
            label=drawing.get("label"),
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return _drawing_to_dict(row)


@app.put("/api/drawings/{drawing_id}")
async def update_drawing(drawing_id: str, updates: dict) -> dict:
    async with AsyncSessionLocal() as session:
        row = await session.get(ChartDrawing, drawing_id)
        if row is None:
            raise HTTPException(status_code=404, detail="drawing not found")
        for field in ("points", "style", "locked", "label"):
            if field in updates:
                setattr(row, field, updates[field])
        row.updated_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(row)
        return _drawing_to_dict(row)


@app.delete("/api/drawings/{drawing_id}")
async def delete_drawing(drawing_id: str) -> dict:
    async with AsyncSessionLocal() as session:
        row = await session.get(ChartDrawing, drawing_id)
        if row is None:
            raise HTTPException(status_code=404, detail="drawing not found")
        await session.delete(row)
        await session.commit()
        return {"deleted": True}


@app.delete("/api/drawings/{instrument}/{timeframe}/all")
async def clear_drawings(instrument: str, timeframe: str) -> dict:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            delete(ChartDrawing)
            .where(ChartDrawing.instrument == instrument, ChartDrawing.timeframe == timeframe)
        )
        await session.commit()
        return {"deleted": result.rowcount or 0}


@app.get("/api/watching")
async def get_watching() -> dict:
    """Co-pilot checklist: latest verdict, why-not reasons, and what the AI awaits."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Trade).order_by(Trade.created_at.desc()).limit(1)
        )
        trade = result.scalar_one_or_none()
    if trade is None:
        return {"verdict": None, "why_not": [], "watching": []}

    smc = trade.smc_analysis or {}
    structures = smc.get("structures") or {}
    liquidity = (smc.get("liquidity") or {}).get("1h", {})
    pre = smc.get("raw_score_pre_boardroom") or {}
    decision_json = trade.decision_json or {}

    bias_4h = (structures.get("4h") or {}).get("trend")
    trend_1h = (structures.get("1h") or {}).get("trend")
    trend_15m = (structures.get("15m") or {}).get("trend")
    sweep = (liquidity.get("recent_sweep") or {}).get("occurred", False)

    watching = [
        {"condition": f"4H bias: {bias_4h or '—'}", "met": bias_4h in ("BULLISH", "BEARISH")},
        {"condition": f"1H confirms ({trend_1h or '—'})", "met": bias_4h is not None and trend_1h == bias_4h},
        {"condition": f"15M aligns ({trend_15m or '—'})", "met": bias_4h is not None and trend_15m == bias_4h},
        {"condition": "Liquidity sweep complete", "met": bool(sweep)},
        {"condition": f"Setup score ≥ threshold ({float(trade.setup_score) if trade.setup_score is not None else '—'})",
         "met": False},
    ]
    try:
        from backend.execution.risk_profile import risk_manager

        profile = await risk_manager.get_profile()
        if trade.setup_score is not None:
            watching[-1]["met"] = float(trade.setup_score) >= profile["min_setup_score"]
    except Exception:
        pass

    why_not: list[str] = []
    skip = decision_json.get("skip_reason") or decision_json.get("rejection_reason")
    if skip:
        why_not.append(skip)
    for miss in (pre.get("missing") or [])[:3]:
        why_not.append(miss)

    return {
        "verdict": (trade.direction or "hold").upper(),
        "confidence": trade.confidence,
        "setup_score": float(trade.setup_score) if trade.setup_score is not None else None,
        "setup_grade": trade.setup_grade,
        "decided_at": trade.created_at.isoformat() if trade.created_at else None,
        "vision_used": bool(trade.vision_used),
        "why_not": why_not[:4],
        "watching": watching,
        "expected_direction": bias_4h if bias_4h in ("BULLISH", "BEARISH") else None,
    }


# ---------------------------------------------------------------------------
# V1.2 — state machine, options, Trading DNA, Scenario Lab
# ---------------------------------------------------------------------------

@app.get("/api/state-machine")
async def get_state_machine() -> dict:
    from backend.execution.order_state_manager import order_state_manager

    return order_state_manager.snapshot()


@app.get("/api/options/iv/{instrument}")
async def get_iv(instrument: str) -> dict:
    from backend.perception.iv_analyser import iv_analyser

    try:
        return await iv_analyser.get_iv_snapshot(to_delta_symbol(instrument))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/options/select")
async def select_options_strategy(payload: dict) -> dict:
    from backend.ai.options_strategy_selector import options_selector
    from backend.execution.risk_profile import risk_manager
    from backend.perception.iv_analyser import iv_analyser

    profile = await risk_manager.get_profile()
    instrument = to_delta_symbol(payload.get("instrument", "BTCUSD"))
    iv = await iv_analyser.get_iv_snapshot(instrument)
    return await options_selector.select_strategy(
        direction=payload.get("direction", "neutral"),
        conviction=int(payload.get("conviction", 5)),
        iv_snapshot=iv,
        days_to_expiry=profile["preferred_dte_min"],
        max_loss_pct=profile["max_options_loss_pct"],
        instrument=instrument,
        total_capital=profile["total_capital"],
        dte_min=int(payload.get("dte_min", profile["preferred_dte_min"])),
        dte_max=int(payload.get("dte_max", profile["preferred_dte_max"])),
    )


@app.post("/api/dna/import")
async def dna_import(background_tasks: BackgroundTasks) -> dict:
    job_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as session:
        session.add(ImportJob(id=job_id, status="queued", progress=0, trades_imported=0))
        await session.commit()
    background_tasks.add_task(_run_dna_import_job, job_id)
    return {"job_id": job_id, "status": "started"}


@app.get("/api/dna/import/status/{job_id}")
async def dna_import_status(job_id: str) -> dict:
    async with AsyncSessionLocal() as session:
        row = await session.get(ImportJob, job_id)
        if row is None:
            raise HTTPException(status_code=404, detail="import job not found")
        return {
            "job_id": row.id,
            "status": row.status,
            "progress": row.progress,
            "trades_imported": row.trades_imported,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        }


async def _set_import_status(job_id: str, status: str, progress: int, imported: int) -> None:
    async with AsyncSessionLocal() as session:
        row = await session.get(ImportJob, job_id)
        if row is None:
            return
        row.status = status
        row.progress = progress
        row.trades_imported = imported
        if status in ("complete", "failed"):
            row.completed_at = datetime.now(timezone.utc)
        await session.commit()


async def _run_dna_import_job(job_id: str) -> None:
    from backend.perception.key_levels import key_levels_engine

    imported = 0
    try:
        await _set_import_status(job_id, "running", 5, imported)
        page = 1
        while True:
            orders = await delta_client.get_trade_history(limit=100, page=page, state="closed")
            if isinstance(orders, dict):
                orders = orders.get("orders") or orders.get("result") or []
            if not orders:
                break

            async with AsyncSessionLocal() as session:
                for order in orders:
                    if float(order.get("size") or 0) == 0:
                        continue
                    created = int(order.get("created_at") or order.get("created_at_ts") or datetime.now().timestamp())
                    closed = int(order.get("closed_at") or order.get("updated_at") or created)
                    entry_time = datetime.fromtimestamp(created, timezone.utc)
                    exit_time = datetime.fromtimestamp(closed, timezone.utc)
                    delta_order_id = str(order.get("id"))
                    existing = await session.execute(
                        select(UserTrade).where(UserTrade.delta_order_id == delta_order_id).limit(1)
                    )
                    if existing.scalar_one_or_none():
                        continue
                    pnl_pct = float(order.get("pnl_percent") or order.get("pnl_pct") or 0)
                    trade = UserTrade(
                        delta_order_id=delta_order_id,
                        instrument=order.get("product_symbol", "BTCUSD_PERP"),
                        direction="long" if order.get("side") == "buy" else "short",
                        entry_price=float(order.get("avg_fill_price") or order.get("limit_price") or 0),
                        exit_price=float(order.get("close_price") or order.get("avg_fill_price") or 0),
                        size=float(order.get("size") or 0),
                        pnl_inr=float(order.get("pnl") or 0),
                        pnl_pct=pnl_pct,
                        entry_time=entry_time,
                        exit_time=exit_time,
                        duration_mins=max(0, int((closed - created) / 60)),
                        order_type=order.get("order_type"),
                        fees_inr=float(order.get("commission") or 0),
                        day_of_week=entry_time.weekday(),
                        hour_of_entry=entry_time.astimezone().hour,
                    )
                    session.add(trade)
                    outcome = "win" if pnl_pct > 0.1 else "loss" if pnl_pct < -0.1 else "breakeven"
                    session.add(PatternOutcome(
                        instrument=trade.instrument or "",
                        direction=trade.direction or "long",
                        pattern_type="manual_trade",
                        session=key_levels_engine.get_current_session(trade.hour_of_entry or 0),
                        outcome=outcome,
                        rr_achieved=abs(pnl_pct) / max(abs(pnl_pct) * 0.33, 0.01),
                        pnl_pct=pnl_pct,
                        entry_time=entry_time,
                    ))
                    imported += 1
                await session.commit()

            page += 1
            await _set_import_status(job_id, "running", min(page * 5, 95), imported)
            await asyncio.sleep(0.5)

        await _set_import_status(job_id, "complete", 100, imported)
    except Exception:
        logger.exception("DNA import job failed")
        await _set_import_status(job_id, "failed", 100, imported)


@app.post("/api/dna/analyse")
async def dna_analyse() -> dict:
    from backend.dna.engine import analyse_trading_dna

    try:
        return await analyse_trading_dna()
    except Exception as exc:
        logger.exception("DNA analysis failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/dna/report")
async def dna_report() -> dict:
    from backend.dna.engine import latest_dna_report

    report = await latest_dna_report()
    if report is None:
        raise HTTPException(status_code=404, detail="no DNA report yet — import + analyse first")
    return report


@app.post("/api/lab/backtest-rule")
async def lab_backtest_rule(payload: dict) -> dict:
    from backend.lab.engine import backtest_rule

    rule = payload.get("rule")
    if not rule:
        raise HTTPException(status_code=400, detail="body must include 'rule'")
    try:
        return await backtest_rule(rule, payload.get("date_from"), payload.get("date_to"))
    except Exception as exc:
        logger.exception("Rule backtest failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/lab/replay-market")
async def lab_replay_market(payload: dict) -> dict:
    from backend.lab.engine import replay_market

    try:
        return await replay_market(
            to_delta_symbol(payload.get("instrument", "BTCUSD")),
            payload["date_from"],
            payload["date_to"],
            float(payload.get("min_setup_score", 7.0)),
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"missing field: {exc}")
    except Exception as exc:
        logger.exception("Market replay failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/lab/simulate-strategy")
async def lab_simulate_strategy(payload: dict) -> dict:
    from backend.lab.engine import simulate_strategy

    try:
        return await simulate_strategy(
            payload.get("config", {}),
            payload["date_from"],
            payload["date_to"],
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"missing field: {exc}")
    except Exception as exc:
        logger.exception("Strategy simulation failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/replay/analyse")
async def replay_analyse(body: dict) -> dict:
    from backend.perception.smc import smc_analyser

    candles = body.get("candles") or []
    if not candles:
        raise HTTPException(status_code=400, detail="body must include candles")
    try:
        return smc_analyser.analyse_from_candles(candles, body.get("instrument", "REPLAY"))
    except Exception as exc:
        logger.exception("Replay analysis failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/backtest/smc")
async def run_smc_backtest(config: dict) -> dict:
    from backend.backtest.smc_backtester import SMCBacktester

    try:
        backtester = SMCBacktester()
        return await backtester.run(
            instrument=config["instrument"],
            timeframe=config.get("timeframe", "15m"),
            date_from=config["date_from"],
            date_to=config["date_to"],
            min_setup_score=float(config.get("min_setup_score", 7.0)),
            min_rr=float(config.get("min_rr", 3.0)),
            risk_per_trade_pct=float(config.get("risk_per_trade_pct", 1.0)),
            starting_capital=float(config.get("starting_capital", 50000)),
            train_end=config.get("train_end"),
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"missing field: {exc}")
    except Exception as exc:
        logger.exception("SMC backtest failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/patterns/stats")
async def get_pattern_stats() -> list[dict]:
    async with AsyncSessionLocal() as session:
        rows = await session.execute(
            text(
                """
                SELECT pattern_type, instrument, session,
                       COUNT(*) AS sample_size,
                       ROUND(AVG(CASE WHEN outcome='win' THEN 1.0 ELSE 0.0 END) * 100, 1) AS win_rate_pct,
                       ROUND(AVG(rr_achieved), 2) AS avg_rr,
                       ROUND(
                         COALESCE(AVG(rr_achieved), 0) *
                         AVG(CASE WHEN outcome='win' THEN 1.0 ELSE 0.0 END) -
                         (1 - AVG(CASE WHEN outcome='win' THEN 1.0 ELSE 0.0 END)),
                         3
                       ) AS expectancy
                FROM pattern_outcomes
                GROUP BY pattern_type, instrument, session
                HAVING COUNT(*) >= 10
                ORDER BY expectancy DESC
                """
            )
        )
        return [dict(r._mapping) for r in rows.all()]


@app.get("/api/calibration")
async def get_calibration() -> dict:
    async with AsyncSessionLocal() as session:
        rows = await session.execute(
            text(
                """
                SELECT boardroom_confidence AS confidence,
                       COUNT(*) AS total_trades,
                       SUM(CASE WHEN actual_outcome='win' THEN 1 ELSE 0 END) AS wins,
                       ROUND(
                         SUM(CASE WHEN actual_outcome='win' THEN 1.0 ELSE 0.0 END) /
                         COUNT(*) * 100, 1
                       ) AS win_rate_pct
                FROM trades
                WHERE actual_outcome IS NOT NULL
                  AND boardroom_confidence IS NOT NULL
                GROUP BY boardroom_confidence
                ORDER BY boardroom_confidence
                """
            )
        )
        data = [dict(r._mapping) for r in rows.all()]
    high_conf = [r for r in data if (r["confidence"] or 0) >= 8 and r["total_trades"] >= 3]
    calibrated = None
    if high_conf:
        calibrated = sum(float(r["win_rate_pct"] or 0) for r in high_conf) / len(high_conf) >= 55
    return {"rows": data, "calibrated": calibrated, "min_trades": 10}


@app.get("/api/managed-positions")
async def get_managed_positions() -> list[dict]:
    """Current PositionManager state for the dashboard's staged-exit card."""
    from backend.execution.position_manager import position_manager

    return position_manager.snapshot_states()


@app.get("/api/smc/{instrument}")
async def get_smc_analysis(instrument: str) -> dict:
    """Run SMC analysis on demand (testing + dashboard)."""
    from backend.perception.smc import smc_analyser

    try:
        snapshot = await snapshot_builder.build_snapshot(to_delta_symbol(instrument))
        analysis = await smc_analyser.analyse(to_delta_symbol(instrument), delta_client, snapshot)
        return {k: v for k, v in analysis.items() if not k.startswith("_")}
    except Exception as exc:
        logger.exception("SMC analysis failed for {}", instrument)
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/approve/{decision_id}")
async def approve(decision_id: str) -> dict:
    result = await telegram.approve_decision(decision_id)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "approval failed"))
    return result


@app.post("/api/close/{instrument}")
async def close_position(instrument: str) -> dict:
    try:
        return await executor.close_position(instrument, "manual close via API")
    except Exception as exc:
        logger.exception("Manual close failed for {}", instrument)
        raise HTTPException(status_code=502, detail=str(exc))


# ---------------------------------------------------------------------------
# Manual triggers for testing
# ---------------------------------------------------------------------------

@app.post("/api/run-decision")
async def trigger_decision(instrument: str = "BTCUSD_PERP") -> dict:
    """Manually trigger Loop 1 (testing)."""
    return await run_decision_loop(instrument)


@app.post("/api/run-reflection/{trade_id}")
async def trigger_reflection(trade_id: str) -> dict:
    """Manually trigger Loop 2 on a trade (testing)."""
    result = await run_reflection_loop(trade_id)
    if result is None:
        raise HTTPException(status_code=404, detail="trade not found")
    return result


@app.post("/api/test-approval")
async def test_approval() -> dict:
    """Send a dummy SEMI_AUTO approval request to Telegram (temporary Day 3 test)."""
    if settings.environment != "testnet":
        raise HTTPException(status_code=403, detail="test approvals only allowed on testnet")
    snapshot = await snapshot_builder.build_snapshot("BTCUSD")
    portfolio = {
        "positions": await delta_client.get_positions(),
        "balance": await delta_client.get_wallet_balance(),
    }
    decision = {
        "action": "long",
        "instrument": "BTCUSD_PERP",
        "size_pct": 1.5,
        "entry_type": "market",
        "price_offset_pct": 0,
        "stop_loss_offset_pct": 1.0,
        "take_profit_offset_pct": 2.0,
        "confidence": 7,
        "reasoning": "TEST approval flow — tap Approve to place a small testnet order, or Reject.",
        "bull_case": "This is a test of the SEMI_AUTO approval flow.",
        "bear_case": "This is a test of the SEMI_AUTO approval flow.",
        "key_signals": ["approval flow test"],
    }
    from backend.ai.loops import _store_decision

    trade_id = await _store_decision("BTCUSD_PERP", snapshot, decision, "pending_approval")
    if trade_id is None:
        raise HTTPException(status_code=500, detail="could not store test decision")
    await telegram.send_approval_request(trade_id, decision, snapshot, portfolio)
    return {"sent": True, "decision_id": trade_id}


@app.post("/api/test-order")
async def test_order(
    instrument: str = "BTCUSD",
    side: str = "buy",
    size: int = 1,
    order_type: str = "market",
) -> dict:
    """Place a small manual test order on testnet (temporary Day 3 endpoint)."""
    if settings.environment != "testnet":
        raise HTTPException(status_code=403, detail="test orders only allowed on testnet")
    try:
        return await delta_client.place_order(
            instrument=instrument,
            side=side,
            size=size,
            order_type=order_type,
            limit_price=None,
            stop_loss=None,
            take_profit=None,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
