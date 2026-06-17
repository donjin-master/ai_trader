"""FastAPI application entry point for the AI Trader."""

import asyncio
import base64
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.ai.loops import run_decision_loop, run_reflection_loop
from backend.config import settings
from backend.db.database import AsyncSessionLocal, create_tables, get_db, get_db_no_commit, get_pool_status
from backend.db.models import AgentLesson, ChartDrawing, ImportJob, PatternOutcome, Trade, UserTrade
from backend.delta.client import DeltaAPIError
from backend.deps import delta_client, snapshot_builder, to_delta_symbol
from backend.execution.executor import executor
from backend.execution.safety import safety_manager
from backend.notifications import telegram
from backend.scheduler import next_decision_in_seconds, start_scheduler, stop_scheduler, init_scheduler_deps

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
    # Fields always included (used by journal tabs)
    smc = trade.smc_analysis or {}
    decision_json = trade.decision_json or {}
    data["trigger_event_type"] = trade.trigger_event_type
    data["scenario_simulation"] = trade.scenario_simulation
    data["options_strategy"] = decision_json.get("options_strategy")
    data["regime"] = smc.get("regime")
    data["notes"] = trade.notes

    if full:
        data["decision_json"] = decision_json
        data["market_snapshot"] = trade.market_snapshot
        data["smc_analysis"] = smc
    else:
        data["smc_summary"] = {
            "structures": {
                tf: {"trend": s.get("trend")}
                for tf, s in (smc.get("structures") or {}).items()
            },
            "premium_discount": (smc.get("premium_discount") or {}).get("zone"),
            "regime": smc.get("regime"),
            "confluences_found": (smc.get("raw_score_pre_boardroom") or {}).get("confluences_found", []),
            "missing": (smc.get("raw_score_pre_boardroom") or {}).get("missing", []),
        } if smc else None
    return data


async def _ensure_v14_indexes() -> None:
    """Create V1.4 performance indexes if they don't already exist."""
    index_sql = """
    CREATE INDEX IF NOT EXISTS idx_trades_timestamp_desc ON trades(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_trades_instrument_open ON trades(instrument, exit_price) WHERE exit_price IS NULL;
    CREATE INDEX IF NOT EXISTS idx_trades_counterfactuals ON trades(timestamp DESC) WHERE counterfactuals IS NULL AND exit_price IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_trades_confidence ON trades(boardroom_confidence, actual_outcome) WHERE boardroom_confidence IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_lessons_quality_created ON agent_lessons(quality_score DESC, created_at DESC) WHERE quality_score >= 3;
    CREATE INDEX IF NOT EXISTS idx_snapshots_instrument_time ON market_snapshots(instrument, timestamp DESC);
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS trigger_event_type varchar DEFAULT 'scheduled_scan';
    ALTER TABLE trades ADD COLUMN IF NOT EXISTS scenario_simulation jsonb;
    CREATE TABLE IF NOT EXISTS trade_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      trade_id uuid,
      instrument varchar, direction varchar,
      entry_price numeric, exit_price numeric, size_contracts integer,
      notional_inr numeric, gross_pnl_inr numeric, total_fees_inr numeric,
      net_pnl_inr numeric, net_pnl_pct numeric,
      entry_fee_inr numeric, entry_gst_inr numeric,
      exit_fee_inr numeric, exit_gst_inr numeric,
      fee_drag_pct numeric, recorded_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS meta_lessons (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      pattern_text text NOT NULL, supporting_evidence text,
      confidence_score numeric DEFAULT 8.0, original_confidence numeric,
      trade_count_basis integer, active bool DEFAULT true,
      synthesis_period_start timestamptz, synthesis_period_end timestamptz,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_meta_lessons_active ON meta_lessons(active, confidence_score DESC);
    """
    try:
        async with AsyncSessionLocal() as db:
            for stmt in [s.strip() for s in index_sql.split(";") if s.strip()]:
                await db.execute(text(stmt))
            await db.commit()
        logger.info("V1.4 DB indexes and schema verified")
    except Exception as exc:
        logger.warning("V1.4 index migration skipped: {}", exc)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("AI Trader starting...")
    try:
        await create_tables()
        await _ensure_v14_indexes()
    except Exception:
        logger.error("DB init failed — API will run but persistence is unavailable")
    await safety_manager.load_state()
    from backend.execution.position_manager import position_manager

    await position_manager.load_state()
    await telegram.start_bot()


    # V1.4 — event-driven WebSocket pipeline
    _stream_task = None
    try:
        from backend.websocket.stream_processor import MarketStreamProcessor
        from backend.websocket.event_router import EventRouter as _EventRouter
        from backend.websocket.analysis_dispatcher import analysis_dispatcher as _dispatcher
        from backend.cache import _registry

        from backend.execution.risk_profile import risk_manager
        profile = await risk_manager.get_profile()
        active_instruments = profile.get("active_instruments") or ["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP"]

        _event_router = _EventRouter(dispatcher=_dispatcher)
        _stream_processor = MarketStreamProcessor(
            instruments=active_instruments,
            event_router=_event_router,
            cache_registry=_registry,
        )
        init_scheduler_deps(
            event_router=_event_router,
            analysis_dispatcher=_dispatcher,
            stream_processor=_stream_processor,
        )
        _stream_task = asyncio.create_task(_stream_processor.start())
        app.state.stream_processor = _stream_processor
        app.state.event_router = _event_router
        logger.info("V1.4 event-driven WebSocket pipeline started")
    except Exception:
        logger.warning("WebSocket pipeline failed to start — safety-net scheduler active only")
        app.state.stream_processor = None
        app.state.event_router = None

    start_scheduler()
    await telegram.notify_startup()

    logger.info(
        "AI Trader ready (environment={}, mode={})",
        settings.environment, safety_manager.execution_mode,
    )
    yield
    stop_scheduler()
    if _stream_task and not _stream_task.done():
        _stream_task.cancel()
    await telegram.stop_bot()
    await delta_client.close()
    logger.info("AI Trader shut down")


import os
from fastapi import Header

async def verify_api_key(x_api_secret: str = Header(None)):
    expected_secret = os.getenv("FRONTEND_API_SECRET")
    if expected_secret and x_api_secret != expected_secret:
        raise HTTPException(status_code=401, detail="Invalid API Secret Key")

app = FastAPI(title="AI Trader", lifespan=lifespan, dependencies=[Depends(verify_api_key)])

def _build_allowed_origins() -> list[str]:
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    # Support multiple comma-separated URLs in FRONTEND_URL env var
    frontend_urls = os.getenv("FRONTEND_URL", "")
    for url in frontend_urls.split(","):
        url = url.strip()
        if url:
            origins.append(url)
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_build_allowed_origins(),
    allow_origin_regex=r"https://.*\.vercel\.app",  # allow all Vercel preview deployments
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


@app.get("/health/pool")
async def pool_health() -> dict:
    return await get_pool_status()


@app.get("/health/live")

async def health_live() -> dict:
    """Liveness probe — is the process alive and responding?"""
    return {"status": "alive", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/health/ready")
async def health_ready():
    from fastapi.responses import JSONResponse

    checks: dict = {}
    all_ready = True

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"
        all_ready = False

    try:
        ticker = await delta_client.get_ticker(to_delta_symbol("BTCUSD_PERP"))
        checks["delta_api"] = "ok" if ticker else "no_data"
        if not ticker:
            all_ready = False
    except Exception as exc:
        checks["delta_api"] = f"error: {exc}"
        all_ready = False

    kill_active = safety_manager.kill_switch_active
    checks["kill_switch"] = "triggered" if kill_active else "armed"

    return JSONResponse(
        status_code=200 if all_ready else 503,
        content={
            "status": "ready" if all_ready else "not_ready",
            "checks": checks,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


@app.get("/health/websocket")
async def health_websocket() -> dict:
    """WebSocket stream processor health — connection state and event counts."""
    sp = getattr(app.state, "stream_processor", None)
    if sp is None:
        return {"status": "not_started", "reason": "pipeline failed to initialise"}
    return {
        "status": "connected" if sp.is_connected else "disconnected",
        "reconnect_count": getattr(sp, "_reconnect_count", 0),
        "instruments": getattr(sp, "instruments", []),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/health/events")
async def health_events() -> dict:
    """Event router stats — dispatch counts, cooldowns, circuit-breaker state."""
    er = getattr(app.state, "event_router", None)
    if er is None:
        return {"status": "not_started"}
    return er.get_stats()


@app.get("/health/cache")
async def health_cache() -> dict:
    """Per-instrument market data cache TTL stats."""
    try:
        from backend.cache import _registry
        return {
            instrument: cache.get_stats()
            for instrument, cache in _registry.items()
        }
    except Exception as exc:
        return {"error": str(exc)}


@app.get("/api/skills/status")
async def skills_status() -> dict:
    """Which skill files are loaded and their loading conditions."""
    try:
        from backend.skills import skill_loader
        return skill_loader.get_status()
    except Exception as exc:
        return {"error": str(exc)}


@app.get("/api/live-state")
async def get_live_state():
    """Single endpoint for everything the live trading page needs."""
    async for db in get_db_no_commit():
        try:
            snapshot = await snapshot_builder.build_snapshot(to_delta_symbol("BTCUSD_PERP"))
            positions = await delta_client.get_positions()
            
            result = await db.execute(
                select(Trade).order_by(Trade.created_at.desc()).limit(20)
            )
            trades = list(result.scalars().all())
            decisions = [_trade_to_dict(t) for t in trades]
            
            # Build status in the same shape as /api/status so the frontend gets
            # the right field names (mode, kill_switch, daily_pnl, risk{}, etc.)
            from backend.execution.risk_profile import risk_manager as _rm
            _profile: dict = {}
            _daily_stats: dict = {}
            try:
                _profile = await _rm.get_profile()
                _daily_stats = await _rm.get_daily_stats()
            except Exception:
                pass
            _budget_inr = (
                _profile.get("total_capital", 0) * _profile.get("daily_budget_pct", 0) / 100
                if _profile else 0
            )
            _pnl_inr = (
                _daily_stats.get("pnl_pct", 0) / 100 * _profile.get("total_capital", 0)
                if _profile else 0
            )
            status = {
                "mode": _profile.get("mode", safety_manager.execution_mode),
                "kill_switch": safety_manager.kill_switch_active,
                "daily_pnl": safety_manager.daily_pnl_pct,
                "open_positions_count": len(positions),
                "next_decision_in_seconds": next_decision_in_seconds(),
                "risk": {
                    "trades_today": _daily_stats.get("trade_count", 0),
                    "max_trades_per_day": _profile.get("max_trades_per_day"),
                    "daily_budget_inr": round(_budget_inr, 2),
                    "daily_budget_used_inr": round(abs(min(0.0, _pnl_inr)), 2),
                    "max_concurrent_trades": _profile.get("max_concurrent_trades"),
                    "consecutive_losses": _daily_stats.get("consecutive_losses", 0),
                    "consecutive_loss_limit": _profile.get("consecutive_loss_limit"),
                    "min_setup_score": _profile.get("min_setup_score"),
                    "total_capital": _profile.get("total_capital"),
                },
            }

            from backend.execution.position_manager import position_manager
            managed = position_manager.snapshot_states()
            
            last_trade = trades[0] if trades else None
            if last_trade is None:
                watching = {"verdict": None, "why_not": [], "watching": []}
            else:
                smc = last_trade.smc_analysis or {}
                structures = smc.get("structures") or {}
                liquidity = (smc.get("liquidity") or {}).get("1h", {})
                pre = smc.get("raw_score_pre_boardroom") or {}
                decision_json = last_trade.decision_json or {}

                bias_4h = (structures.get("4h") or {}).get("trend")
                trend_1h = (structures.get("1h") or {}).get("trend")
                trend_15m = (structures.get("15m") or {}).get("trend")
                sweep = (liquidity.get("recent_sweep") or {}).get("occurred", False)

                watching_list = [
                    {"condition": f"4H bias: {bias_4h or '—'}", "met": bias_4h in ("BULLISH", "BEARISH")},
                    {"condition": f"1H confirms ({trend_1h or '—'})", "met": bias_4h is not None and trend_1h == bias_4h},
                    {"condition": f"15M aligns ({trend_15m or '—'})", "met": bias_4h is not None and trend_15m == bias_4h},
                    {"condition": "Liquidity sweep complete", "met": bool(sweep)},
                    {"condition": f"Setup score ≥ threshold ({float(last_trade.setup_score) if last_trade.setup_score is not None else '—'})",
                     "met": False},
                ]
                try:
                    from backend.execution.risk_profile import risk_manager
                    profile = await risk_manager.get_profile()
                    if last_trade.setup_score is not None:
                        watching_list[-1]["met"] = float(last_trade.setup_score) >= profile["min_setup_score"]
                except Exception:
                    pass

                why_not = []
                skip = decision_json.get("skip_reason") or decision_json.get("rejection_reason")
                if skip:
                    why_not.append(skip)
                for miss in (pre.get("missing") or [])[:3]:
                    why_not.append(miss)

                watching = {
                    "verdict": (last_trade.direction or "hold").upper(),
                    "confidence": last_trade.confidence,
                    "setup_score": float(last_trade.setup_score) if last_trade.setup_score is not None else None,
                    "setup_grade": last_trade.setup_grade,
                    "decided_at": last_trade.created_at.isoformat() if last_trade.created_at else None,
                    "vision_used": bool(last_trade.vision_used),
                    "why_not": why_not[:4],
                    "watching": watching_list,
                    "expected_direction": bias_4h if bias_4h in ("BULLISH", "BEARISH") else None,
                }
            
            return {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "price": snapshot.get("price", 0),
                "change_24h_pct": snapshot.get("24h_change_pct", 0),
                "positions": positions,
                "decisions": decisions,
                "managed": managed,
                "watching": watching,
                "system": status,
            }
        except Exception as exc:
            logger.exception("live-state failed")
            raise HTTPException(status_code=500, detail=str(exc))


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


@app.put("/api/trades/{trade_id}/notes")
async def update_trade_notes(trade_id: str, payload: dict) -> dict:
    try:
        trade_uuid = uuid.UUID(trade_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid trade_id format")

    async with AsyncSessionLocal() as session:
        trade = await session.get(Trade, trade_uuid)
        if trade is None:
            raise HTTPException(status_code=404, detail="trade not found")
        trade.notes = payload.get("notes")
        await session.commit()
        return {"id": trade_id, "notes": trade.notes}


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


def _available_margin_from_balance(balance: Any) -> float:
    """Best-effort extraction across Delta wallet response shapes."""
    summary = _wallet_summary_from_balance(balance)
    return float(summary.get("available_margin") or 0.0)


def _wallet_summary_from_balance(balance: Any) -> dict:
    """Normalize Delta wallet response shapes for UI and sizing."""
    selected: dict | None = None
    if isinstance(balance, list):
        candidates = [
            row for row in balance
            if str(row.get("asset_symbol") or row.get("asset") or "").upper() in {"INR", "USD", "USDT"}
        ] or balance
        selected = candidates[0] if candidates else None
    if isinstance(balance, dict):
        result = balance.get("result")
        if result is not None:
            return _wallet_summary_from_balance(result)
        selected = balance

    if not selected:
        return {
            "asset": None,
            "available_margin": 0.0,
            "available_balance": 0.0,
            "total_balance": 0.0,
            "raw": balance,
        }

    def number(*keys: str) -> float:
        for key in keys:
            value = selected.get(key)
            if value is not None:
                return float(value)
        return 0.0

    available_margin = number("available_margin", "available_balance", "balance")
    available_balance = number("available_balance", "available_margin", "balance")
    total_balance = number("balance", "total_balance", "available_balance", "available_margin")
    asset = selected.get("asset_symbol") or selected.get("asset") or selected.get("currency")
    return {
        "asset": asset,
        "available_margin": available_margin,
        "available_balance": available_balance,
        "total_balance": total_balance,
        "raw": balance,
    }


def _manual_size_contracts(
    *,
    size_mode: str,
    size_value: float,
    available_margin: float,
    use_price: float,
    risk: float,
    contract_value: float,
) -> tuple[int, float, str]:
    """Convert a manual sizing choice into Delta's integer contract size."""
    if size_value <= 0:
        raise HTTPException(status_code=400, detail="size_value must be positive")

    risk_per_contract = risk * contract_value
    if size_mode == "risk_percent":
        risk_amount = available_margin * size_value / 100
        contracts = int(risk_amount / risk_per_contract) if risk_per_contract > 0 else 0
        return max(1, contracts), risk_amount, "available margin risk percent"

    if size_mode == "usd_notional":
        contracts = int(size_value / (use_price * contract_value)) if use_price * contract_value > 0 else 0
        return max(1, contracts), max(1, contracts) * risk_per_contract, "USD notional"

    if size_mode == "base_lots":
        contracts = int(size_value / contract_value) if contract_value > 0 else 0
        return max(1, contracts), max(1, contracts) * risk_per_contract, "base lots"

    if size_mode == "contracts":
        contracts = int(size_value)
        if contracts < 1:
            raise HTTPException(status_code=400, detail="contracts must be at least 1")
        return contracts, contracts * risk_per_contract, "contracts"

    raise HTTPException(
        status_code=400,
        detail="size_mode must be risk_percent, usd_notional, base_lots, or contracts",
    )


@app.get("/api/account/summary")
async def account_summary() -> dict:
    try:
        balance = await delta_client.get_wallet_balance()
        positions = await delta_client.get_positions()
        summary = _wallet_summary_from_balance(balance)
        return {
            **summary,
            "open_positions_count": len(positions),
        }
    except DeltaAPIError as exc:
        logger.error("Account summary failed: {}", exc)
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/instruments/{instrument}/details")
async def instrument_details(instrument: str) -> dict:
    try:
        symbol = to_delta_symbol(instrument)
        product = await delta_client.get_product(symbol)
        product_id = product.get("id") or product.get("product_id")
        contract_value = float(product.get("contract_value") or 1)
        settling_asset = product.get("settling_asset") or {}
        quoting_asset = product.get("quoting_asset") or {}
        leverage = None
        order_margin = None
        if product_id:
            try:
                leverage_data = await delta_client.get_order_leverage(int(product_id))
                leverage_raw = leverage_data.get("leverage")
                leverage = int(float(leverage_raw)) if leverage_raw is not None else None
                order_margin_raw = leverage_data.get("order_margin")
                order_margin = float(order_margin_raw) if order_margin_raw is not None else None
            except DeltaAPIError as exc:
                logger.warning("Order leverage unavailable for {}: {}", symbol, exc)
        return {
            "instrument": symbol,
            "product_id": product_id,
            "contract_value": contract_value,
            "contract_unit_label": symbol.replace("USD", "") if symbol.endswith("USD") else "base",
            "settling_asset": settling_asset.get("symbol"),
            "quoting_asset": quoting_asset.get("symbol"),
            "tick_size": float(product.get("tick_size") or 0),
            "current_leverage": leverage,
            "order_margin": order_margin,
        }
    except DeltaAPIError as exc:
        logger.error("Instrument details failed for {}: {}", instrument, exc)
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/instruments/{instrument}/leverage")
async def update_instrument_leverage(instrument: str, body: dict) -> dict:
    try:
        leverage = int(float(body.get("leverage")))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="leverage must be a number")

    if leverage < 1 or leverage > 100:
        raise HTTPException(status_code=400, detail="leverage must be between 1x and 100x")

    try:
        symbol = to_delta_symbol(instrument)
        product = await delta_client.get_product(symbol)
        product_id = product.get("id") or product.get("product_id")
        if not product_id:
            raise HTTPException(status_code=502, detail="product id unavailable")
        result = await delta_client.set_order_leverage(int(product_id), leverage)
        return {
            "instrument": symbol,
            "product_id": int(product_id),
            "leverage": int(float(result.get("leverage", leverage))),
            "order_margin": float(result["order_margin"]) if result.get("order_margin") is not None else None,
        }
    except DeltaAPIError as exc:
        logger.error("Instrument leverage update failed for {}: {}", instrument, exc)
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/trades/manual")
async def place_manual_trade(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """Place a user-entered trade and hand position management to the AI."""
    if settings.environment != "testnet" and body.get("skip_confirm"):
        return JSONResponse(
            status_code=400,
            content={"error": "Manual trades require explicit confirmation on production"},
        )

    try:
        instrument = to_delta_symbol(str(body["instrument"]))
        direction = str(body["direction"]).lower()
        entry_type = str(body.get("entry_type", "market")).lower()
        entry_price = body.get("entry_price")
        entry_price = float(entry_price) if entry_price is not None else None
        sl = float(body["stop_loss"])
        tp1 = float(body["tp1"])
        tp2 = float(body["tp2"])
        tp3_raw = body.get("tp3")
        tp3 = float(tp3_raw) if tp3_raw not in (None, "") else None
        size_mode = str(body.get("size_mode") or "risk_percent").lower()
        size_value = float(body.get("size_value", body.get("size_pct", 1.0)))
        size_pct_raw = body.get("size_pct")
        size_pct = (
            float(size_pct_raw)
            if size_pct_raw not in (None, "")
            else size_value if size_mode == "risk_percent" else 0
        )
        leverage_raw = body.get("leverage")
        leverage = int(float(leverage_raw)) if leverage_raw not in (None, "") else None
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid manual trade payload: {exc}")

    if direction not in {"long", "short"}:
        raise HTTPException(status_code=400, detail="direction must be long or short")
    if entry_type not in {"market", "limit"}:
        raise HTTPException(status_code=400, detail="entry_type must be market or limit")
    if entry_type == "limit" and (entry_price is None or entry_price <= 0):
        raise HTTPException(status_code=400, detail="entry_price is required for limit orders")
    if size_value <= 0:
        raise HTTPException(status_code=400, detail="size_value must be positive")
    if leverage is not None and (leverage < 1 or leverage > 100):
        raise HTTPException(status_code=400, detail="leverage must be between 1x and 100x")

    ticker = await delta_client.get_ticker(instrument)
    current_price = float(ticker.get("mark_price") or ticker.get("close") or ticker.get("spot_price") or 0)
    use_price = entry_price or current_price
    if use_price <= 0:
        raise HTTPException(status_code=502, detail="could not determine current price")

    if direction == "long" and sl >= use_price:
        raise HTTPException(status_code=400, detail="long stop_loss must be below entry")
    if direction == "short" and sl <= use_price:
        raise HTTPException(status_code=400, detail="short stop_loss must be above entry")
    if direction == "long" and tp2 <= use_price:
        raise HTTPException(status_code=400, detail="long tp2 must be above entry")
    if direction == "short" and tp2 >= use_price:
        raise HTTPException(status_code=400, detail="short tp2 must be below entry")

    risk = abs(use_price - sl)
    reward = abs(tp2 - use_price)
    rr = reward / risk if risk > 0 else 0
    if rr < 3.0:
        return JSONResponse(
            status_code=400,
            content={
                "error": f"R:R too low: 1:{rr:.2f}. Minimum is 1:3.0.",
                "rr": rr,
                "tip": "Adjust your TP2 or tighten your stop loss.",
            },
        )

    positions = await delta_client.get_positions()
    can_trade, reason = await safety_manager.check_pre_trade(instrument, {"positions": positions})
    if not can_trade:
        raise HTTPException(status_code=400, detail=reason)

    balance = await delta_client.get_wallet_balance()
    available_margin = _available_margin_from_balance(balance)
    if available_margin <= 0:
        raise HTTPException(status_code=502, detail="available margin is zero or unavailable")

    product = await delta_client.get_product(instrument)
    product_id = product.get("id") or product.get("product_id")
    contract_value = float(product.get("contract_value") or 1)
    if leverage is not None:
        if not product_id:
            raise HTTPException(status_code=502, detail="product id unavailable for leverage update")
        await delta_client.set_order_leverage(int(product_id), leverage)
    elif product_id:
        try:
            leverage_data = await delta_client.get_order_leverage(int(product_id))
            leverage_raw = leverage_data.get("leverage")
            leverage = int(float(leverage_raw)) if leverage_raw is not None else None
        except DeltaAPIError as exc:
            logger.warning("Using unknown leverage for manual trade preview: {}", exc)

    risk_distance_pct = risk / use_price * 100
    contracts, risk_amount, size_source = _manual_size_contracts(
        size_mode=size_mode,
        size_value=size_value,
        available_margin=available_margin,
        use_price=use_price,
        risk=risk,
        contract_value=contract_value,
    )
    base_size = contracts * contract_value
    notional_usd = base_size * use_price
    estimated_margin = notional_usd / leverage if leverage else None
    if estimated_margin is not None and estimated_margin > available_margin:
        raise HTTPException(
            status_code=400,
            detail=(
                f"estimated margin ${estimated_margin:,.2f} exceeds available "
                f"{available_margin:,.2f} at {leverage}x leverage"
            ),
        )

    logger.info(
        "MANUAL TRADE: {} {} | Entry: {} | SL: {} | TP2: {} | R:R: 1:{:.1f} | "
        "Contracts: {} | Notional: ${:.2f} | Leverage: {}x | Size mode: {}",
        direction.upper(), instrument, use_price, sl, tp2, rr, contracts, notional_usd, leverage, size_mode,
    )

    try:
        order = await delta_client.place_order(
            instrument=instrument,
            side="buy" if direction == "long" else "sell",
            size=contracts,
            order_type=entry_type,
            limit_price=entry_price if entry_type == "limit" else None,
            stop_loss=sl,
            take_profit=tp2,
        )
    except Exception as exc:
        logger.exception("Manual trade placement failed")
        return JSONResponse(
            status_code=500,
            content={"error": f"Order placement failed: {exc}"},
        )

    order_id = str(order.get("id") or "")
    if not order_id:
        return JSONResponse(
            status_code=500,
            content={"error": "Order placed but no ID returned"},
        )

    from backend.execution.order_state_manager import order_state_manager
    from backend.execution.position_manager import position_manager

    trade_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    trade = Trade(
        id=trade_id,
        timestamp=now,
        instrument=instrument,
        direction=direction,
        entry_price=use_price,
        size_pct=size_pct,
        entry_reasoning="MANUAL ENTRY - User identified setup, AI managing position",
        confidence=10,
        boardroom_confidence=10,
        status="open" if entry_type == "market" else "pending",
        trigger_event_type="manual_entry",
        key_signals=["manual_entry"],
        decision_json={
            "action": direction,
            "instrument": instrument,
            "entry_type": entry_type,
            "manual": True,
            "order_id": order_id,
        },
        boardroom_votes={"manual": True, "note": "User entry, AI position management"},
        position_params={
            "position_size_pct": size_pct,
            "risk_amount_inr": round(risk_amount, 2),
            "risk_distance_pct": round(risk_distance_pct, 4),
            "contracts": contracts,
            "contract_value": contract_value,
            "base_size": round(base_size, 8),
            "notional_usd": round(notional_usd, 2),
            "estimated_margin": round(estimated_margin, 2) if estimated_margin is not None else None,
            "leverage": leverage,
            "size_mode": size_mode,
            "size_value": size_value,
            "size_source": size_source,
            "management": {
                "initial_rr_planned": round(rr, 2),
                "tp1": tp1,
                "tp2": tp2,
                "tp3": tp3,
            },
        },
    )
    db.add(trade)
    await db.flush()

    state_payload = {
        "order_id": order_id,
        "trade_id": str(trade_id),
        "direction": direction,
        "entry_price": use_price,
        "sl": sl,
        "tp1": tp1,
        "tp2": tp2,
        "tp3": tp3,
        "product_id": order.get("product_id"),
        "placed_at": now.isoformat(),
    }
    if entry_type == "limit":
        await order_state_manager.on_order_placed(instrument, state_payload)
    else:
        await position_manager.register_new_position(
            trade_id=str(trade_id),
            instrument=instrument,
            direction=direction,
            entry_price=use_price,
            initial_sl=sl,
            tp1=tp1,
            tp2=tp2,
            tp3=tp3,
            contracts=contracts,
            risk_pct=risk_distance_pct,
        )
        await order_state_manager.on_position_opened(instrument)

    margin_line = f"Est. margin: ${estimated_margin:,.2f}\n" if estimated_margin is not None else ""
    leverage_line = f"Leverage: {leverage}x\n" if leverage else "Leverage: exchange default\n"
    await telegram.send_message(
        f"📍 <b>MANUAL TRADE PLACED</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>{instrument}</b> · {direction.upper()}\n\n"
        f"Entry: ${use_price:,.2f}\n"
        f"SL:    ${sl:,.2f}\n"
        f"TP1:   ${tp1:,.2f}\n"
        f"TP2:   ${tp2:,.2f}\n"
        f"R:R:   1:{rr:.1f}\n"
        f"Size:  {contracts} contracts ({base_size:g} base)\n"
        f"Notional: ${notional_usd:,.2f}\n"
        f"{leverage_line}"
        f"{margin_line}\n"
        f"🤖 AI now managing this position."
    )

    logger.info("Manual trade registered. AI handoff complete. Trade ID: {}", trade_id)
    return {
        "success": True,
        "trade_id": str(trade_id),
        "order_id": order_id,
        "contracts": contracts,
        "contract_value": contract_value,
        "base_size": round(base_size, 8),
        "notional_usd": round(notional_usd, 2),
        "risk_amount": round(risk_amount, 2),
        "estimated_margin": round(estimated_margin, 2) if estimated_margin is not None else None,
        "leverage": leverage,
        "size_mode": size_mode,
        "size_value": size_value,
        "rr": round(rr, 2),
        "message": "Trade placed. AI is now managing this position.",
    }


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


@app.get("/api/boardroom/performance")
async def boardroom_performance(days: int = 7) -> dict:
    """
    Boardroom model performance stats over last N days.
    Correlates member votes with trade outcomes.
    """
    from datetime import timedelta
    since = datetime.now(timezone.utc) - timedelta(days=days)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Trade)
            .where(
                Trade.timestamp >= since,
                Trade.boardroom_votes.is_not(None),
                Trade.status == "closed"
            )
        )
        trades = list(result.scalars().all())
    
    member_stats = {}
    for trade in trades:
        outcome = trade.actual_outcome
        if not outcome and trade.pnl_pct is not None:
            outcome = "win" if float(trade.pnl_pct) > 0 else "loss"
            
        if not outcome:
            continue
            
        votes_data = trade.boardroom_votes or {}
        votes = votes_data.get("votes", [])
        deliberations = votes_data.get("deliberations", [])
        
        final_votes_dict = {d["member"]: d for d in deliberations}
        initial_votes_dict = {v["member"]: v for v in votes}
        
        all_members = set(initial_votes_dict.keys()) | set(final_votes_dict.keys())
        for m_name in all_members:
            if m_name not in member_stats:
                member_stats[m_name] = {
                    "name": m_name,
                    "total_votes": 0,
                    "vote_distribution": {"LONG": 0, "SHORT": 0, "HOLD": 0},
                    "agreements": 0,
                    "disagreements": 0,
                    "convictions": [],
                    "response_times": [],
                    "fallbacks": 0,
                    "changes": 0
                }
                
            stats = member_stats[m_name]
            stats["total_votes"] += 1
            
            init_v = initial_votes_dict.get(m_name, {})
            delib_v = final_votes_dict.get(m_name, {})
            
            final_vote = delib_v.get("final_vote") or init_v.get("vote") or "HOLD"
            initial_vote = init_v.get("vote") or "HOLD"
            conviction = delib_v.get("final_conviction") or init_v.get("conviction") or 5
            response_time = init_v.get("response_time_ms") or 0
            fallback = init_v.get("fallback_used", False)
            
            if final_vote in stats["vote_distribution"]:
                stats["vote_distribution"][final_vote] += 1
            else:
                stats["vote_distribution"]["HOLD"] += 1
                
            stats["convictions"].append(conviction)
            if response_time > 0:
                stats["response_times"].append(response_time)
            if fallback:
                stats["fallbacks"] += 1
            if initial_vote != final_vote:
                stats["changes"] += 1
                
            t_dir = (trade.direction or "").upper()
            is_aligned_with_trade = (final_vote == t_dir)
            
            if outcome == "win":
                if is_aligned_with_trade:
                    stats["agreements"] += 1
                else:
                    stats["disagreements"] += 1
            elif outcome == "loss":
                if is_aligned_with_trade:
                    stats["disagreements"] += 1
                else:
                    stats["agreements"] += 1
                    
    formatted_members = []
    for name, stats in member_stats.items():
        total = stats["total_votes"]
        agreements = stats["agreements"]
        agreement_pct = round((agreements / total * 100), 2) if total > 0 else 0.0
        avg_conv = round(sum(stats["convictions"]) / len(stats["convictions"]), 2) if stats["convictions"] else 0.0
        avg_rt = round(sum(stats["response_times"]) / len(stats["response_times"]), 2) if stats["response_times"] else 0.0
        fallback_rate = round((stats["fallbacks"] / total * 100), 2) if total > 0 else 0.0
        change_rate = round((stats["changes"] / total * 100), 2) if total > 0 else 0.0
        
        formatted_members.append({
            "name": name,
            "total_votes": total,
            "vote_distribution": stats["vote_distribution"],
            "agreed_with_outcome_pct": agreement_pct,
            "avg_conviction": avg_conv,
            "avg_response_time_ms": avg_rt,
            "fallback_rate_pct": fallback_rate,
            "change_rate_pct": change_rate
        })
        
    return {
        "days": days,
        "total_trades_analyzed": len(trades),
        "members": formatted_members
    }


@app.get("/api/options/positions")
async def get_options_positions() -> list:
    """
    Returns all open options positions with Greeks and management status.
    Fetches from Delta Exchange options positions endpoint.
    """
    positions = await delta_client.get_positions()
    options_positions = [p for p in positions if "C" in p.get("product_symbol", "")
                         or "P" in p.get("product_symbol", "")]

    enriched = []
    for pos in options_positions:
        symbol = pos["product_symbol"]
        parts = symbol.split("-")
        strike = float(parts[2]) if len(parts) >= 3 else 0
        option_type = parts[3] if len(parts) >= 4 else "C"
        expiry = parts[1] if len(parts) >= 2 else ""

        if expiry:
            try:
                from datetime import datetime
                expiry_dt = datetime.strptime(expiry, "%d%b%Y") if len(expiry) > 5 else datetime.strptime(expiry + "2026", "%d%b%Y")
                dte = (expiry_dt - datetime.utcnow()).days
            except Exception:
                dte = 0
        else:
            dte = 0

        enriched.append({
            "symbol": symbol,
            "underlying": parts[0] if parts else "BTC",
            "strike": strike,
            "strike_price": strike,
            "option_type": "CALL" if option_type == "C" else "PUT",
            "expiry": expiry,
            "dte": dte,
            "size": float(pos.get("size", 0)),
            "entry_price": float(pos.get("entry_price", 0)),
            "mark_price": float(pos.get("mark_price", 0)),
            "unrealized_pnl": float(pos.get("unrealized_pnl", 0)),
            "unrealized_pnl_pct": float(pos.get("unrealized_pnl_pct", 0)) if pos.get("unrealized_pnl_pct") is not None else (float(pos.get("unrealized_pnl", 0)) / float(pos.get("entry_price", 1)) * 100 if float(pos.get("entry_price", 0)) > 0 else 0.0),
            "management_alert": dte <= 21,
        })

    return enriched


@app.get("/api/options/condors")
async def get_iron_condors() -> list:
    """
    Groups options positions into iron condor structures.
    Calculates combined P&L, max profit, breakeven points.
    """
    return []


@app.get("/api/dna/calendar")
async def dna_calendar(days: int = 90) -> list:
    """Daily P&L calendar data for heatmap."""
    async with AsyncSessionLocal() as db:
        results = await db.execute(text(f"""
            SELECT
                DATE(entry_time AT TIME ZONE 'Asia/Kolkata') as trade_date,
                COUNT(*) as trade_count,
                SUM(pnl_inr) as total_pnl_inr,
                AVG(pnl_pct) as avg_pnl_pct,
                COALESCE(SUM(CASE WHEN pnl_pct > 0.1 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0.0) as win_rate
            FROM user_trades
            WHERE entry_time >= NOW() - INTERVAL '{days} days'
            GROUP BY DATE(entry_time AT TIME ZONE 'Asia/Kolkata')
            ORDER BY trade_date
        """))
        return [dict(r) for r in results.mappings()]


@app.get("/api/dna/by-hour")
async def dna_by_hour() -> list:
    """Win rate and trade count by hour of day (IST)."""
    async with AsyncSessionLocal() as db:
        results = await db.execute(text("""
            SELECT
                hour_of_entry,
                COUNT(*) as trade_count,
                COALESCE(SUM(CASE WHEN pnl_pct > 0.1 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0.0) as win_rate,
                AVG(pnl_pct) as avg_pnl_pct,
                AVG(ABS(pnl_pct)) FILTER (WHERE pnl_pct > 0) as avg_win_pct,
                AVG(ABS(pnl_pct)) FILTER (WHERE pnl_pct < 0) as avg_loss_pct
            FROM user_trades
            WHERE pnl_pct IS NOT NULL
            GROUP BY hour_of_entry
            ORDER BY hour_of_entry
        """))
        return [dict(r) for r in results.mappings()]


@app.get("/api/dna/by-instrument")
async def dna_by_instrument() -> list:
    """Performance stats per instrument."""
    async with AsyncSessionLocal() as db:
        results = await db.execute(text("""
            SELECT
                instrument,
                COUNT(*) as total_trades,
                COALESCE(SUM(CASE WHEN pnl_pct > 0.1 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0.0) as win_rate,
                AVG(pnl_pct) as avg_pnl_pct,
                SUM(pnl_inr) as total_pnl_inr,
                AVG(duration_mins) as avg_duration_mins,
                AVG(ABS(pnl_pct)) FILTER (WHERE pnl_pct > 0) as avg_winner_pct,
                AVG(ABS(pnl_pct)) FILTER (WHERE pnl_pct < -0.1) as avg_loser_pct
            FROM user_trades
            GROUP BY instrument
            ORDER BY total_trades DESC
        """))
        return [dict(r) for r in results.mappings()]


@app.get("/api/dna/hold-times")
async def dna_hold_times() -> dict:
    """Winner vs loser hold time distribution."""
    async with AsyncSessionLocal() as db:
        winners = await db.execute(text("""
            SELECT duration_mins FROM user_trades
            WHERE pnl_pct > 0.1 AND duration_mins IS NOT NULL
            ORDER BY duration_mins
        """))
        losers = await db.execute(text("""
            SELECT duration_mins FROM user_trades
            WHERE pnl_pct < -0.1 AND duration_mins IS NOT NULL
            ORDER BY duration_mins
        """))
        winner_times = [r[0] for r in winners.fetchall()]
        loser_times  = [r[0] for r in losers.fetchall()]
        
        avg_winner = sum(winner_times)/len(winner_times) if winner_times else 0
        avg_loser = sum(loser_times)/len(loser_times) if loser_times else 0
        
        return {
            "winners": {
                "times": winner_times,
                "avg": avg_winner,
                "median": sorted(winner_times)[len(winner_times)//2] if winner_times else 0,
                "count": len(winner_times)
            },
            "losers": {
                "times": loser_times,
                "avg": avg_loser,
                "median": sorted(loser_times)[len(loser_times)//2] if loser_times else 0,
                "count": len(loser_times)
            },
            "loss_aversion_ratio": (
                avg_loser / avg_winner if avg_winner > 0 else 0
            )
        }


@app.post("/api/dna/generate-insights")
async def generate_dna_insights() -> list:
    """
    Run AI analysis on trading history to generate insights.
    Uses Sonnet — moderate cost, run manually not automatically.
    """
    from backend.ai.dna_analyser import DNAAnalyser
    analyser = DNAAnalyser()
    insights = await analyser.generate_insights()
    return insights


@app.post("/api/lab/backtest-rule")
async def lab_backtest_rule(payload: dict) -> dict:
    rule_key = payload.get("rule")
    custom_rule = payload.get("rule")
    
    if not rule_key:
        raise HTTPException(status_code=400, detail="body must include 'rule'")

    PREDEFINED_RULES = {
        "no_morning": {
            "name": "No trades before 11:30am IST",
            "filter": "hour_of_entry >= 11"
        },
        "max_2_per_day": {
            "name": "Maximum 2 trades per day",
            "filter": "id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY DATE(exit_time) ORDER BY exit_time) as rn FROM user_trades) t WHERE rn <= 2)"
        },
        "no_mondays": {
            "name": "No Monday trades",
            "filter": "day_of_week != 0"
        },
        "no_weekend": {
            "name": "No weekend trades",
            "filter": "day_of_week NOT IN (5, 6)"
        },
        "longs_only": {
            "name": "Long trades only",
            "filter": "direction = 'long'"
        },
        "shorts_only": {
            "name": "Short trades only",
            "filter": "direction = 'short'"
        },
        "cooldown_2h": {
            "name": "2-hour cool-down after loss",
            "filter": "id NOT IN (SELECT t1.id FROM user_trades t1 JOIN user_trades t2 ON t2.exit_time < t1.exit_time AND t2.pnl_pct < -0.1 AND t1.exit_time - t2.exit_time < INTERVAL '2 hours')"
        }
    }
    
    sql_filter = "1=1"
    rule_name = "Custom Rule"
    interpreted = False
    
    if rule_key in PREDEFINED_RULES:
        sql_filter = PREDEFINED_RULES[rule_key]["filter"]
        rule_name = PREDEFINED_RULES[rule_key]["name"]
    else:
        from backend.ai.lab_interpreter import interpret_rule
        sql_filter = await interpret_rule(custom_rule)
        rule_name = custom_rule
        interpreted = True
        
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(UserTrade)
            .where(UserTrade.exit_time.is_not(None), UserTrade.pnl_pct.is_not(None))
            .order_by(UserTrade.exit_time.asc())
        )
        all_trades = list(res.scalars().all())
        
        if not all_trades:
            return {"error": "no trades in database"}
            
        try:
            matching_res = await db.execute(
                text(f"SELECT id FROM user_trades WHERE pnl_pct IS NOT NULL AND ({sql_filter})")
            )
            matching_ids = {r[0] for r in matching_res.fetchall()}
        except Exception as e:
            logger.error("SQL filter execution failed: {}", e)
            return {"error": f"Invalid SQL filter: {e}"}
            
        original_curve = []
        rule_curve = []
        dates = []
        
        orig_pnl = 0.0
        rule_pnl = 0.0
        orig_trades = 0
        rule_trades = 0
        orig_wins = 0
        rule_wins = 0
        
        for t in all_trades:
            pnl = float(t.pnl_inr or 0.0)
            pnl_p = float(t.pnl_pct or 0.0)
            is_win = pnl_p > 0.1
            
            orig_trades += 1
            orig_pnl += pnl
            if is_win:
                orig_wins += 1
                
            kept = t.id in matching_ids
            if kept:
                rule_trades += 1
                rule_pnl += pnl
                if is_win:
                    rule_wins += 1
                    
            original_curve.append(round(orig_pnl, 2))
            rule_curve.append(round(rule_pnl, 2))
            
            t_date = t.exit_time.strftime("%d %b") if t.exit_time else ""
            dates.append(t_date)
            
        orig_win_rate = round(orig_wins / orig_trades * 100, 1) if orig_trades > 0 else 0.0
        rule_win_rate = round(rule_wins / rule_trades * 100, 1) if rule_trades > 0 else 0.0
        
        original_stats = {
            "trades": orig_trades,
            "pnl_inr": round(orig_pnl, 2),
            "win_rate": orig_win_rate
        }
        
        with_rule_stats = {
            "trades": rule_trades,
            "pnl_inr": round(rule_pnl, 2),
            "win_rate": rule_win_rate
        }
        
        return {
            "rule": rule_name,
            "rule_spec": {"sql_filter": sql_filter},
            "interpreted_by_ai": interpreted,
            "original": original_stats,
            "with_rule": with_rule_stats,
            "trades_removed": orig_trades - rule_trades,
            "removed_pnl_inr": round(orig_pnl - rule_pnl, 2),
            "win_rate_change": round(rule_win_rate - orig_win_rate, 1),
            "pnl_improvement_inr": round(rule_pnl - orig_pnl, 2),
            "curve": {"dates": dates, "original": original_curve, "with_rule": rule_curve},
            "disclaimer": "Results based on historical trades only. Past performance does not guarantee future results."
        }


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


@app.post("/api/lab/monte-carlo")
async def lab_monte_carlo(payload: dict) -> dict:
    from backend.lab.engine import monte_carlo_simulation

    try:
        return await monte_carlo_simulation(
            date_from=payload.get("date_from"),
            date_to=payload.get("date_to"),
            simulations=int(payload.get("simulations", 1000)),
            starting_capital=payload.get("starting_capital"),
            ruin_threshold_pct=float(payload.get("ruin_threshold_pct", 50.0)),
        )
    except Exception as exc:
        logger.exception("Monte Carlo simulation failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/lab/stress-test")
async def lab_stress_test(config: dict) -> dict:
    from backend.lab.stress import run_stress_test

    try:
        return await run_stress_test(
            instrument=config["instrument"],
            timeframe=config.get("timeframe", "15m"),
            date_from=config["date_from"],
            date_to=config["date_to"],
            min_setup_score=float(config.get("min_setup_score", 7.0)),
            min_rr=float(config.get("min_rr", 3.0)),
            risk_per_trade_pct=float(config.get("risk_per_trade_pct", 1.0)),
            starting_capital=float(config.get("starting_capital", 50000)),
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"missing field: {exc}")
    except Exception as exc:
        logger.exception("Stress test failed")
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


# The full set of SMC pattern types the boardroom can be tagged with —
# mirrors backend.perception.smc.SMCAnalyser.classify_pattern_type()'s return values.
KNOWN_PATTERN_TYPES = [
    "ob_fvg_sweep_confluence", "ob_fvg_confluence", "liquidity_sweep_choch",
    "ob_after_sweep", "fvg_after_sweep", "choch_entry", "bos_continuation",
    "inducement_setup", "general_smc",
]


@app.get("/api/patterns/stats")
async def get_pattern_stats() -> list[dict]:
    """Per-pattern-type performance + strategy deploy state for the Autonomous page."""
    from backend.execution.risk_profile import risk_manager

    async with AsyncSessionLocal() as session:
        rows = await session.execute(
            text(
                """
                SELECT pattern_type,
                       COUNT(*) AS total_trades,
                       ROUND(AVG(CASE WHEN outcome='win' THEN 1.0 ELSE 0.0 END) * 100, 1) AS win_rate,
                       COALESCE(ROUND(AVG(pnl_pct), 2), 0) AS avg_pnl_pct,
                       ROUND(AVG(boardroom_confidence), 1) AS avg_confidence
                FROM pattern_outcomes
                GROUP BY pattern_type
                ORDER BY total_trades DESC
                """
            )
        )
        traded = [dict(r._mapping) for r in rows.all()]

    profile = await risk_manager.get_profile()
    enabled_patterns = profile.get("enabled_patterns") or []
    seen = {r["pattern_type"] for r in traded}
    for r in traded:
        r["enabled"] = r["pattern_type"] in enabled_patterns if enabled_patterns else True
        r["untraded"] = False
    untraded = [
        {
            "pattern_type": p,
            "total_trades": 0,
            "win_rate": 0.0,
            "avg_pnl_pct": 0.0,
            "avg_confidence": None,
            "enabled": p in enabled_patterns if enabled_patterns else True,
            "untraded": True,
        }
        for p in KNOWN_PATTERN_TYPES
        if p not in seen
    ]
    return traded + untraded


@app.post("/api/patterns/{pattern_type}/toggle")
async def toggle_pattern(pattern_type: str, body: dict) -> dict:
    """Deploy/undeploy an SMC pattern type — enforced as an allow-list in the decision loop."""
    from backend.execution.risk_profile import risk_manager

    if pattern_type not in KNOWN_PATTERN_TYPES:
        raise HTTPException(status_code=400, detail=f"unknown pattern_type: {pattern_type}")
    enabled = bool(body.get("enabled"))
    profile = await risk_manager.get_profile()
    current = set(profile.get("enabled_patterns") or [])
    if enabled:
        current.add(pattern_type)
    else:
        current.discard(pattern_type)
    # If every known pattern ends up enabled, store [] (no-restriction) for simplicity/back-compat.
    new_list = [] if current == set(KNOWN_PATTERN_TYPES) else sorted(current)
    updated = await risk_manager.update_profile({"enabled_patterns": new_list})
    return {"pattern_type": pattern_type, "enabled": enabled, "enabled_patterns": updated["enabled_patterns"]}


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
    try:
        result = await run_decision_loop(instrument)
        return result or {"skipped": True, "reason": "no result returned"}
    except Exception as exc:
        logger.exception("run-decision failed for {}", instrument)
        raise HTTPException(status_code=500, detail=str(exc))


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


@app.post("/api/test-telegram")
async def test_telegram_notification() -> dict:
    """Send a real SMC chart + signal notification to Telegram for testing."""
    if settings.environment != "testnet":
        raise HTTPException(status_code=403, detail="test notifications only on testnet")

    from backend.perception.chart_generator import chart_generator
    from backend.perception.smc import smc_analyser
    from backend.notifications.telegram import telegram_bot

    instrument = "BTCUSD"

    # Fetch live data
    candles = await delta_client.get_candles(instrument, "15", count=80)
    snapshot = await snapshot_builder.build_snapshot(instrument)
    smc_result = smc_analyser.analyse_from_candles(candles or [], instrument)

    # Build a realistic mock decision for display
    price = float((snapshot or {}).get("price") or 0)
    decision = {
        "action": "long",
        "instrument": "BTCUSD_PERP",
        "confidence": 7,
        "reasoning": "Test SMC notification — order blocks and liquidity levels visible on chart.",
        "key_signals": ["bullish OB hold", "BSL sweep", "FVG fill"],
        "vote_tally": "2-1 LONG",
    }
    setup_score = {"score": 7.2, "grade": "B+"}

    # Generate notification chart WITH smc_analysis now wired in
    chart_bytes = await chart_generator.generate_notification_chart(
        instrument=instrument,
        candles=candles or [],
        smc_analysis=smc_result,
        entry_price=price,
        sl_price=price * 0.992 if price else None,
        tp_prices=[price * 1.016, price * 1.032] if price else None,
    )

    # Build text with SMC context
    smc = smc_result or {}
    obs = (smc.get("order_blocks", {}) or {}).get("15m", [])
    liq = (smc.get("liquidity", {}) or {}).get("1h", {})
    fvgs = (smc.get("fvgs", {}) or {}).get("15m", [])

    active_obs = [ob for ob in obs if not ob.get("mitigated")]
    active_fvgs = [f for f in fvgs if not f.get("filled")]
    bsl = liq.get("buy_side_liquidity", [])
    ssl = liq.get("sell_side_liquidity", [])

    smc_text = ""
    if active_obs:
        ob = active_obs[0]
        smc_text += f"\n📦 OB ({ob['type'][:4]}): ${ob['low']:,.0f}–${ob['high']:,.0f}"
    if bsl:
        smc_text += f"\n💧 BSL: ${bsl[0]['price']:,.0f}"
    if ssl:
        smc_text += f"\n💧 SSL: ${ssl[0]['price']:,.0f}"
    if active_fvgs:
        fvg = active_fvgs[0]
        smc_text += f"\n📐 FVG ({fvg['type'][:4]}): ${fvg['bottom']:,.0f}–${fvg['top']:,.0f}"

    text = (
        f"🔍 <b>SMC TEST SIGNAL — {instrument}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"Direction: <b>LONG</b> · Conf: 7/10\n"
        f"Boardroom: {decision['vote_tally']}\n"
        f"Setup: {setup_score['score']}/10 {setup_score['grade']}\n"
        f"\n<b>SMC Levels on chart:</b>{smc_text if smc_text else ' none detected'}\n"
        f"\nSignals: {', '.join(decision['key_signals'])}"
    )

    sent = await telegram_bot.send(text=text, chart_bytes=chart_bytes)
    return {
        "sent": sent,
        "smc_levels": {
            "order_blocks": len(active_obs),
            "fvgs": len(active_fvgs),
            "bsl": len(bsl),
            "ssl": len(ssl),
        },
        "chart_size_kb": round(len(chart_bytes) / 1024, 1) if chart_bytes else 0,
    }


@app.post("/api/test/emit-event")
async def test_emit_event(body: dict):
    """Manually emit a market event for test scenario s15. Testnet only."""
    if settings.environment != "testnet":
        return JSONResponse(status_code=403, content={"error": "Only on testnet"})

    from backend.websocket.stream_processor import MarketEvent, EventTier
    from backend.websocket.event_router import event_router

    event = MarketEvent(
        type=body["type"],
        instrument=body["instrument"],
        price=float(body["price"]),
        tier=EventTier.IMMEDIATE,
        message=body.get("message", "Manual test event")
    )
    await event_router.emit(event)
    return {"emitted": True, "event": body}
