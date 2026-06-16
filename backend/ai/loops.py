"""The three AI loops: live decision, post-trade reflection, nightly counterfactual."""

import asyncio
import json
from datetime import datetime, time, timezone
from typing import Any

from loguru import logger
from sqlalchemy import select, text

_chop_counters: dict[str, int] = {}

from backend.ai import agents
from backend.ai import prompts
from backend.ai.validator import TradeDecisionValidator
from backend.db.database import AsyncSessionLocal
from backend.db.embeddings import generate_embedding, vector_literal
from backend.db.models import AgentLesson, MarketSnapshot as SnapshotRow, PatternOutcome, Trade
from backend.db.queries import get_relevant_lessons
from backend.deps import delta_client, snapshot_builder, to_delta_symbol
from backend.execution.safety import safety_manager
from backend.notifications import telegram

validator = TradeDecisionValidator()


async def _fetch_portfolio_state() -> dict:
    positions: list[dict] = []
    balance: Any = []
    try:
        positions = await delta_client.get_positions()
    except Exception as exc:
        logger.warning("Could not fetch positions: {}", exc)
    try:
        balance = await delta_client.get_wallet_balance()
    except Exception as exc:
        logger.warning("Could not fetch balance: {}", exc)
    return {
        "positions": positions,
        "balance": balance,
        "daily_pnl_pct": safety_manager.daily_pnl_pct,
        "execution_mode": safety_manager.execution_mode,
    }


async def _fetch_recent_lessons(limit: int = 10) -> list[dict]:
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(AgentLesson).order_by(AgentLesson.created_at.desc()).limit(limit)
            )
            return [
                {
                    "lesson": l.lesson_text,
                    "watch_for": l.watch_for,
                    "pattern_type": l.pattern_type,
                    "confidence_score": l.confidence_score,
                }
                for l in result.scalars().all()
            ]
    except Exception:
        logger.exception("Failed to fetch lessons")
        return []


async def _fetch_counterfactual_insights(limit: int = 3) -> list[str]:
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Trade.counterfactuals)
                .where(Trade.counterfactuals.is_not(None))
                .order_by(Trade.created_at.desc())
                .limit(limit)
            )
            insights = []
            for (cf,) in result.all():
                if isinstance(cf, dict) and cf.get("key_insight"):
                    insights.append(cf["key_insight"])
            return insights
    except Exception:
        logger.exception("Failed to fetch counterfactual insights")
        return []


def _smc_for_storage(smc_analysis: dict | None) -> dict | None:
    """Strip non-serialisable internals before persisting SMC analysis."""
    if not smc_analysis:
        return None
    return {k: v for k, v in smc_analysis.items() if not k.startswith("_")}


async def _store_decision(
    instrument: str,
    snapshot: dict,
    decision: dict,
    status: str,
    smc_analysis: dict | None = None,
    setup_score: dict | None = None,
    position_params: dict | None = None,
    skip_reason: str | None = None,
    chart_15m: dict | None = None,
    chart_1h: dict | None = None,
    trigger_event_type: str = "scheduled_scan",
    scenario_simulation: dict | None = None,
) -> str | None:
    """Persist a decision (even HOLD, even ADVISORY/skipped) to the trades table."""
    try:
        decision_to_store = dict(decision)
        boardroom = decision_to_store.pop("boardroom", None)
        if skip_reason:
            decision_to_store["skip_reason"] = skip_reason
        async with AsyncSessionLocal() as session:
            trade = Trade(
                chart_15m_path=(chart_15m or {}).get("image_path"),
                chart_1h_path=(chart_1h or {}).get("image_path"),
                chart_at_entry_b64=(chart_15m or {}).get("image_base64"),
                vision_used=bool(decision.get("vision_used")),
                timestamp=datetime.now(timezone.utc),
                instrument=to_delta_symbol(instrument),
                direction=decision.get("action"),
                size_pct=decision.get("size_pct"),
                entry_reasoning=decision.get("reasoning") or decision.get("chair_reasoning"),
                market_snapshot=snapshot,
                bull_case=decision.get("bull_case"),
                bear_case=decision.get("bear_case"),
                confidence=decision.get("confidence"),
                boardroom_confidence=decision.get("confidence"),
                status=status,
                key_signals=decision.get("key_signals"),
                decision_json=decision_to_store,
                boardroom_votes=boardroom,
                smc_analysis=_smc_for_storage(smc_analysis),
                setup_score=(setup_score or {}).get("score"),
                setup_grade=(setup_score or {}).get("grade"),
                position_params=position_params,
                trigger_event_type=trigger_event_type,
                scenario_simulation=scenario_simulation,
            )
            session.add(trade)
            await session.commit()
            await session.refresh(trade)
            logger.info("Decision logged to DB: {}", trade.id)
            return str(trade.id)

    except Exception:
        logger.exception("Failed to store decision")
        return None


# ---------------------------------------------------------------------------
# LOOP 1 — Live decision (called every 15 min by scheduler)
# ---------------------------------------------------------------------------

async def run_decision_loop(
    instrument: str = "BTCUSD_PERP",
    trigger_event=None,        # MarketEvent | None — None means safety-net/scheduled
    trigger_context: str = "", # Pre-built context string from AnalysisDispatcher
) -> dict:
    """Full cycle: pre-checks → SMC → boardroom → score → risk gate → size → route."""
    from backend.execution.risk_profile import risk_manager
    from backend.ai.context_builder import context_builder
    from backend.perception.key_levels import key_levels_engine
    from backend.perception.smc import smc_analyser

    from backend.execution.order_state_manager import order_state_manager

    symbol = to_delta_symbol(instrument)
    trigger_type = trigger_event.type if trigger_event else "scheduled_scan"

    # 0. State machine gate — boardroom only runs in WATCHING state
    if not await order_state_manager.can_run_boardroom(instrument):
        state = await order_state_manager.get_state(instrument)
        logger.info("Skipping boardroom for {} — state: {}", instrument, state.value)
        return {"skipped": True, "reason": f"state is {state.value}"}

    logger.info("Decision loop started for {} (trigger: {})", instrument, trigger_type)

    # 1. Risk profile + pre-checks
    profile = await risk_manager.get_profile()
    mode = profile["mode"]
    portfolio = await _fetch_portfolio_state()
    daily_stats = await risk_manager.get_daily_stats()

    can_proceed, reason = await safety_manager.check_pre_trade(instrument, portfolio)
    if not can_proceed:
        logger.info("Decision loop skipped: {}", reason)
        return {"skipped": True, "reason": reason}

    # 2. Perception: base snapshot + full SMC multi-timeframe analysis
    # 2. Perception: base snapshot + full SMC multi-timeframe analysis using cache
    from backend.cache import get_cache
    cache = get_cache(symbol, delta_client)

    snapshot = await snapshot_builder.build_snapshot(symbol, cache)
    try:
        smc_analysis = await smc_analyser.analyse(symbol, cache, snapshot, profile)
    except Exception:
        logger.exception("SMC analysis failed — falling back to basic snapshot")
        smc_analysis = None

    # Strategy deploy gate: skip patterns the user hasn't enabled (empty list = no restriction)
    pattern_type = smc_analyser.classify_pattern_type(smc_analysis) if smc_analysis else "general_smc"
    enabled_patterns = profile.get("enabled_patterns") or []
    if enabled_patterns and pattern_type not in enabled_patterns:
        skip_reason = f"pattern '{pattern_type}' not enabled"
        logger.info("Decision loop skipped for {}: {}", instrument, skip_reason)
        await _store_decision(
            status="logged_only",
            instrument=instrument,
            decision={"action": "skip", "reasoning": skip_reason, "confidence": 0, "boardroom": []},
            snapshot=snapshot,
            smc_analysis=smc_analysis,
            trigger_event_type="scheduled_scan" if trigger_event is None else "event_driven",
        )
        return {"skipped": True, "reason": skip_reason}

    if smc_analysis:
        import os
        pre_score = smc_analysis.get("raw_score_pre_boardroom", {}).get("score", 0)
        min_score = float(os.getenv("MIN_SMC_PRE_SCORE", "3.0"))
        if pre_score < min_score:
            _chop_counters[instrument] = _chop_counters.get(instrument, 0) + 1
            skip_reason = f"SMC pre-score too low ({pre_score} < {min_score})"
            
            if _chop_counters[instrument] >= 6:
                logger.info("Chop counter hit 6 for {}. Checking market regime...", instrument)
                _chop_counters[instrument] = 0
                
                from backend.ai import agents
                from backend.perception.iv_analyser import iv_analyser
                
                iv_snapshot = await iv_analyser.get_iv_snapshot(instrument)
                regime_decision = await agents.run_market_regime_agent(instrument, snapshot, iv_snapshot)
                
                if regime_decision.get("action") == "route_options":
                    logger.info("Regime Agent routed to Options Council for {}", instrument)
                    from backend.ai.options_strategy_selector import options_selector
                    
                    opt_res = await options_selector.select_strategy(
                        direction=regime_decision.get("direction", "neutral"),
                        conviction=regime_decision.get("conviction", 5),
                        iv_snapshot=iv_snapshot,
                        days_to_expiry=14,
                        max_loss_pct=1.0,
                        instrument=instrument
                    )
                    return {"skipped": False, "options_play": opt_res, "reason": "Routed by Regime Agent"}
                elif regime_decision.get("action") == "route_boardroom":
                    logger.info("Regime Agent forced Boardroom run for {}", instrument)
                    forced_boardroom = True
                else:
                    return {"skipped": True, "reason": "Regime Agent says wait"}
            else:
                logger.info("Decision loop aborted for {}: {}", instrument, skip_reason)
                await _store_decision(
                    status="logged_only",
                    instrument=instrument,
                    decision={"action": "skip", "reasoning": skip_reason, "confidence": 0, "boardroom": []},
                    snapshot=snapshot,
                    smc_analysis=smc_analysis,
                    setup_score={"score": pre_score, "grade": "F"},
                    trigger_event_type="scheduled_scan" if trigger_event is None else "event_driven"
                )
                return {"skipped": True, "reason": skip_reason}
        else:
            _chop_counters[instrument] = 0
            forced_boardroom = False
    else:
        forced_boardroom = False

    # 3. Context
    key_levels = await key_levels_engine.compute(instrument, snapshot.get("price") or 0, cache)
    context_summary = (
        f"{instrument} {(smc_analysis or {}).get('raw_score_pre_boardroom', {})} "
        f"funding {snapshot.get('funding_rate', 0)} "
        f"{key_levels.get('macro_bias', '')} session {key_levels.get('current_session', '')}"
    )
    lessons = await get_relevant_lessons(context_summary, limit=5, min_quality=3)
    insights = await _fetch_counterfactual_insights(3)

    # 3b. Charts — always generated for visual memory; sent to Chair per vision_mode
    from backend.execution.position_manager import position_manager
    from backend.perception.chart_generator import chart_generator

    open_state = next(
        (s for s in position_manager.snapshot_states() if s["instrument"] == symbol),
        None,
    )
    chart_15m: dict | None = None
    chart_1h: dict | None = None
    try:
        candles_15m = await cache.get("candles_15m")
        candles_1h = await cache.get("candles_1h")
        chart_15m = await chart_generator.generate_decision_chart(
            symbol, "15m", candles_15m, smc_analysis, open_state, None,
        )
        chart_1h = await chart_generator.generate_decision_chart(
            symbol, "1h", candles_1h, smc_analysis, open_state, None,
        )

    except Exception:
        logger.exception("Chart generation failed — continuing text-only")

    vision_mode = profile.get("vision_mode", "CHAIR_ONLY")
    send_charts = vision_mode in ("CHAIR_ONLY", "ALL_MEMBERS") and chart_15m is not None

    # 3c. Options context (AREA 2) — appended to boardroom context when enabled
    iv_snapshot: dict | None = None
    if profile.get("options_enabled"):
        try:
            from backend.perception.iv_analyser import iv_analyser

            iv_snapshot = await iv_analyser.get_iv_snapshot(symbol)
        except Exception:
            logger.exception("IV snapshot failed — boardroom continues without options context")

    # 3d. Skills — load only skills relevant to current regime/instrument
    skills_context = ""
    try:
        from backend.skills import skill_loader
        regime = (smc_analysis or {}).get("regime", "RANGING")
        consecutive_losses = daily_stats.get("consecutive_losses", 0)
        position_size_inr = (portfolio or {}).get("available_margin", 0) * profile.get("risk_per_trade_pct", 1.0) / 100
        iv_percentile = iv_snapshot.get("iv_percentile", 50) if iv_snapshot else 50
        relevant_skills = skill_loader.get_relevant_skills(
            regime=regime,
            instrument=instrument,
            consecutive_losses=consecutive_losses,
            position_size_inr=position_size_inr,
            iv_percentile=iv_percentile,
        )
        skills_context = skill_loader.format_for_prompt(relevant_skills)
    except Exception:
        logger.exception("Skills loading failed — continuing without skills context")

    # 3e. Pre-decision scenario simulation
    import os
    simulation_enabled = os.getenv("SCENARIO_SIMULATION_ENABLED", "true").lower() == "true"
    simulation_context = ""
    simulation_result = None

    if simulation_enabled and smc_analysis:
        suggested_sl = smc_analysis.get("suggested_sl")
        suggested_tp = smc_analysis.get("suggested_tp")
        suggested_entry = smc_analysis.get("suggested_entry")
        if suggested_sl and suggested_tp and suggested_entry:
            proposed_direction = "long" if suggested_tp > suggested_entry else "short"
            from backend.simulation.scenario_simulator import ScenarioSimulator
            try:
                simulator = ScenarioSimulator()
                simulation_result = await simulator.simulate(
                    instrument=instrument,
                    direction=proposed_direction,
                    entry_price=await cache.price(),
                    suggested_sl=suggested_sl,
                    suggested_tp=suggested_tp,
                    smc_context=smc_analysis["context_text"][:1500],
                    key_levels=key_levels
                )
                simulation_context = simulator.format_for_boardroom(simulation_result)
            except Exception:
                logger.exception("Scenario simulation failed")

    # 4. Boardroom (full context; Chair also sees charts when vision is on)
    if smc_analysis:
        market_context = await context_builder.build(
            instrument=instrument,
            smc_analysis=smc_analysis,
            key_levels=key_levels,
            portfolio_state=portfolio,
            daily_stats=daily_stats,
            recent_lessons=lessons,
            counterfactual_insights=insights,
            profile=profile,
        )
    else:
        market_context = key_levels.get("text") or snapshot

    if simulation_context and isinstance(market_context, str):
        market_context = f"{simulation_context}\n\n{market_context}"

    if skills_context and isinstance(market_context, str):
        market_context = f"{skills_context}\n\n{market_context}"


    # AREA 5: Trading DNA overlay — the trader's real historical patterns
    try:
        from backend.dna.engine import latest_dna_overlay

        dna_overlay = await latest_dna_overlay()
        if dna_overlay and isinstance(market_context, str):
            market_context += (
                f"\n\n=== TRADER HISTORICAL PATTERNS (Trading DNA) ===\n{dna_overlay}"
            )
    except Exception:
        logger.exception("DNA overlay fetch failed")

    if iv_snapshot and iv_snapshot.get("available") and isinstance(market_context, str):
        market_context += (
            f"\n\n=== OPTIONS CONTEXT ===\n"
            f"IV Percentile: {iv_snapshot.get('iv_percentile')} ({iv_snapshot.get('iv_regime')})\n"
            f"ATM IV: {iv_snapshot.get('atm_iv')}%\n"
            f"Expected move: ±{iv_snapshot.get('expected_move_pct')}%\n"
            f"Best option type: {iv_snapshot.get('best_strategy_type')}\n"
            f"ATM straddle cost: {iv_snapshot.get('straddle_cost')}\n"
            f"When making the trade decision, also set instrument_preference "
            f"(perp | options | either) and state why the IV regime supports it."
        )
    # Prepend trigger context so boardroom knows WHY it's running (event vs safety-net)
    if trigger_context and isinstance(market_context, str):
        market_context = f"{trigger_context}\n\n{market_context}"

    if not forced_boardroom and smc_analysis:
        logger.info("Using mathematical SMC decision for {} (Bypassing Boardroom LLM)", instrument)
        score = smc_analysis.get("raw_score_pre_boardroom", {}).get("score", 0)
        action_val = smc_analysis.get("raw_score_pre_boardroom", {}).get("bias", "hold")
        
        decision = {
            "action": action_val,
            "confidence": int(score),
            "reasoning": f"Mathematical SMC Setup. Score: {score}/10. (Boardroom LLM bypassed to save API costs)",
            "boardroom": [],
            "size": smc_analysis.get("recommended_size", 0.5),
            "stop_loss": smc_analysis.get("stop_loss", 0),
            "take_profit_1": smc_analysis.get("take_profit_1", 0)
        }
    else:
        logger.info("Running LLM Boardroom for {}", instrument)
        decision = await agents.run_boardroom(
            instrument=instrument,
            market_snapshot=market_context,
            portfolio_state=portfolio,
            recent_lessons=lessons,
            counterfactual_insights=insights,
            chart_15m_b64=chart_15m["image_base64"] if send_charts else None,
            chart_1h_b64=chart_1h["image_base64"] if (send_charts and chart_1h) else None,
        )
    decision.setdefault("instrument", instrument)
    action = decision.get("action", "hold")

    # AREA 2: if the Chair prefers options, attach the selected strategy (logged,
    # not executed — options execution UI is scoped to V1.3)
    if (
        iv_snapshot and iv_snapshot.get("available")
        and action in ("long", "short")
        and decision.get("instrument_preference") == "options"
    ):
        try:
            from backend.ai.options_strategy_selector import options_selector

            strategy = await options_selector.select_strategy(
                direction=action,
                conviction=decision.get("confidence", 5),
                iv_snapshot=iv_snapshot,
                days_to_expiry=profile.get("preferred_dte_min", 7),
                max_loss_pct=profile.get("max_options_loss_pct", 1.0),
                instrument=symbol,
                total_capital=profile.get("total_capital", 50000),
                dte_min=profile.get("preferred_dte_min", 7),
                dte_max=profile.get("preferred_dte_max", 21),
            )
            decision["options_strategy"] = strategy
            if strategy.get("available"):
                await telegram.send_message(
                    f"🎛 <b>Options strategy suggested</b> ({symbol} {action.upper()})\n"
                    f"{strategy['strategy']} | DTE {strategy['dte']} | "
                    f"max loss ₹{strategy['max_loss_inr']}\n"
                    f"{strategy['reasoning'][:200]}"
                )
        except Exception:
            logger.exception("Options strategy selection failed")

    # Chair can answer entry_mode=wait: setup forming but no valid entry zone yet
    if decision.get("entry_mode") == "wait" and action in ("long", "short"):
        logger.info("Chair chose WAIT for {} — no order, back to WATCHING next cycle", instrument)
        trade_id = await _store_decision(
            instrument, snapshot, decision, "logged_only",
            smc_analysis=smc_analysis, chart_15m=chart_15m, chart_1h=chart_1h,
            skip_reason="entry_mode=wait (no valid entry zone yet)",
            trigger_event_type=trigger_type,
            scenario_simulation=simulation_result,
        )
        await telegram.send_message(
            f"⏳ <b>Boardroom: WAIT</b> ({instrument} {action.upper()} forming)\n"
            f"{str(decision.get('reasoning'))[:200]}"
        )
        return {"decision": decision, "trade_id": trade_id, "executed": False, "wait": True}

    # 4b. Regenerate the 15M chart WITH the decision overlaid — the visual memory
    if chart_15m is not None and action in ("long", "short"):
        try:
            chart_15m = await chart_generator.generate_decision_chart(
                symbol, "15m", candles_15m, smc_analysis, open_state, decision,
            )
        except Exception:
            logger.exception("Final chart regeneration failed — keeping pre-decision chart")

    # 5. Score the full setup (SMC confluences + boardroom conviction bonus)
    setup_score = None
    if smc_analysis:
        setup_score = smc_analyser.score_setup(
            structure_4h=smc_analysis["structures"]["4h"],
            structure_1h=smc_analysis["structures"]["1h"],
            structure_15m=smc_analysis["structures"]["15m"],
            obs_15m=smc_analysis["order_blocks"]["15m"],
            fvgs_15m=smc_analysis["fvgs"]["15m"],
            liquidity=smc_analysis["liquidity"]["1h"],
            pd_zone=smc_analysis["premium_discount"],
            inducement=smc_analysis["inducement"],
            boardroom_conviction=decision.get("confidence", 5),
            df_15m=smc_analysis.get("_df_15m"),
        )
        logger.info("Setup score: {}/10 ({})", setup_score["score"], setup_score["grade"])

    # 6. Hard validator (instrument, bounds, duplicates) — never skipped
    is_valid, rejection = validator.validate(decision, portfolio)
    if action == "hold" or not is_valid:
        status = "logged_only" if action == "hold" else "rejected"
        if not is_valid:
            decision["rejection_reason"] = rejection
        trade_id = await _store_decision(
            instrument, snapshot, decision, status,
            smc_analysis=smc_analysis, setup_score=setup_score,
            chart_15m=chart_15m, chart_1h=chart_1h,
            trigger_event_type=trigger_type,
            scenario_simulation=simulation_result,
        )
        await telegram.send_decision_summary(
            instrument=instrument,
            decision=decision,
            setup_score=setup_score,
            chart_bytes=chart_15m,
            rejection=rejection if not is_valid else None,
        )
        return {"decision": decision, "trade_id": trade_id, "executed": False}

    # 7. Master risk-profile gate
    can_trade, rejection_reason, adjusted = await risk_manager.validate_setup(
        smc_analysis=smc_analysis or {},
        boardroom_decision=decision,
        portfolio_state=portfolio,
        daily_stats=daily_stats,
        weekly_stats=await risk_manager.get_weekly_stats(),
        setup_score=setup_score,
        kill_switch_active=safety_manager.kill_switch_active,
        daily_pnl_pct=safety_manager.daily_pnl_pct,
    )

    if not can_trade:
        # ADVISORY mode → rich alert; anything else → skipped with reason
        if mode == "ADVISORY":
            trade_id = await _store_decision(
                instrument, snapshot, decision, "logged_only",
                smc_analysis=smc_analysis, setup_score=setup_score,
                chart_15m=chart_15m, chart_1h=chart_1h,
                trigger_event_type=trigger_type,
                scenario_simulation=simulation_result,
            )
            await telegram.send_smc_alert(instrument, decision, setup_score, None)
            return {"decision": decision, "trade_id": trade_id, "executed": False}
        logger.info("No trade: {}", rejection_reason)
        trade_id = await _store_decision(
            instrument, snapshot, decision, "skipped",
            smc_analysis=smc_analysis, setup_score=setup_score,
            skip_reason=rejection_reason,
            chart_15m=chart_15m, chart_1h=chart_1h,
            trigger_event_type=trigger_type,
            scenario_simulation=simulation_result,
        )
        await telegram.send_message(
            f"⏭️ <b>Trade skipped</b> ({instrument} {action.upper()})\n"
            f"Reason: {rejection_reason}\n"
            f"Setup: {(setup_score or {}).get('score', '—')}/10"
        )
        return {"decision": decision, "trade_id": trade_id, "executed": False,
                "skipped": True, "reason": rejection_reason}

    # 8. Position sizing from the risk profile (overrides boardroom's size)
    price = snapshot.get("price") or 0
    sl_offset = float(decision.get("stop_loss_offset_pct") or 1.0)
    sl_price = price * (1 - sl_offset / 100) if action == "long" else price * (1 + sl_offset / 100)
    available_margin = 0.0
    balances = portfolio.get("balance") or []
    for asset in balances if isinstance(balances, list) else []:
        if asset.get("asset_symbol") in ("USD", "USDT"):
            available_margin = float(asset.get("available_balance") or 0)
            break

    edge_factor = (
        await risk_manager.get_pattern_edge(trigger_type)
        if profile["sizing_mode"] == "EDGE"
        else None
    )
    position_params = await risk_manager.calculate_position_size(
        risk_per_trade_pct=profile["risk_per_trade_pct"],
        entry_price=price,
        stop_loss_price=sl_price,
        available_margin=available_margin,
        setup_score=(setup_score or {}).get("score", 5),
        sizing_mode=profile["sizing_mode"],
        win_rate_history=daily_stats.get("historical_win_rate"),
        max_position_size_pct=profile["max_position_size_pct"],
        total_capital=profile["total_capital"],
        edge_factor=edge_factor,
        pattern_type=pattern_type,
        session=key_levels.get("current_session", "us_london"),
        instrument=instrument,
    )

    decision["size_pct"] = position_params["position_size_pct"]

    # 9. Route by mode
    if mode == "SEMI_AUTO":
        trade_id = await _store_decision(
            instrument, snapshot, decision, "pending_approval",
            smc_analysis=smc_analysis, setup_score=setup_score,
            position_params=position_params,
            chart_15m=chart_15m, chart_1h=chart_1h,
            trigger_event_type=trigger_type,
            scenario_simulation=simulation_result,
        )
        if trade_id:
            await telegram.send_approval_request(
                trade_id, decision, snapshot, portfolio,
                timeout_mins=profile["approval_timeout_mins"],
                setup_score=setup_score,
            )
        return {"decision": decision, "trade_id": trade_id, "executed": False, "pending": True}

    # AUTONOMOUS / SCHEDULED (scheduled windows already enforced by the gate)
    from backend.execution.executor import executor

    trade_id = await _store_decision(
        instrument, snapshot, decision, "executed",
        smc_analysis=smc_analysis, setup_score=setup_score,
        position_params=position_params,
        chart_15m=chart_15m, chart_1h=chart_1h,
        trigger_event_type=trigger_type,
        scenario_simulation=simulation_result,
    )
    result = await executor.execute_decision(decision, snapshot, portfolio, trade_id)
    await telegram.send_message(
        f"🤖 <b>AUTONOMOUS TRADE</b> {'✅' if result.get('success') else '❌'}\n"
        f"{instrument} {action.upper()} | Size: {decision['size_pct']}% | "
        f"Setup: {(setup_score or {}).get('score')}/10 {(setup_score or {}).get('grade', '')}\n"
        f"{position_params['calculation_detail']}"
    )
    return {"decision": decision, "trade_id": trade_id, "executed": result.get("success", False)}


# ---------------------------------------------------------------------------
# LOOP 2 — Post-trade reflection (called when a position closes)
# ---------------------------------------------------------------------------

async def run_reflection_loop(trade_id: str) -> dict | None:
    """Reflect on a closed trade, store the lesson, notify."""
    logger.info("Reflection loop started for trade {}", trade_id)
    async with AsyncSessionLocal() as session:
        trade = await session.get(Trade, trade_id)
        if trade is None:
            logger.error("Reflection loop: trade {} not found", trade_id)
            return None
        trade_dict = {
            "instrument": trade.instrument,
            "direction": trade.direction,
            "entry_price": trade.entry_price,
            "exit_price": trade.exit_price,
            "size_pct": trade.size_pct,
            "pnl_pct": trade.pnl_pct,
            "duration_mins": trade.duration_mins,
            "entry_reasoning": trade.entry_reasoning,
            "bull_case": trade.bull_case,
            "bear_case": trade.bear_case,
            "confidence": trade.confidence,
            "exit_trigger": trade.exit_trigger,
        }
        window_start = trade.timestamp or trade.created_at

        snap_result = await session.execute(
            select(SnapshotRow)
            .where(
                SnapshotRow.instrument == trade.instrument,
                SnapshotRow.timestamp >= window_start,
            )
            .order_by(SnapshotRow.timestamp.asc())
            .limit(120)
        )
        window = [
            {
                "timestamp": s.timestamp.isoformat() if s.timestamp else None,
                "price": float(s.price) if s.price is not None else None,
                "funding_rate": float(s.funding_rate) if s.funding_rate is not None else None,
            }
            for s in snap_result.scalars().all()
        ]

    reflection = await agents.run_reflection_agent(trade_dict, {"snapshots": window})

    lesson_id: str | None = None
    async with AsyncSessionLocal() as session:
        trade = await session.get(Trade, trade_id)
        if trade is not None:
            trade.reflection = reflection
            pnl = float(trade.pnl_pct or 0)
            trade.actual_outcome = "win" if pnl > 0.1 else "loss" if pnl < -0.1 else "breakeven"
            lesson = AgentLesson(
                lesson_text=reflection.get("lesson"),
                watch_for=reflection.get("watch_for"),
                pattern_type="reflection",
                confidence_score=reflection.get("execution_quality"),
                quality_score=3,
                source_trade_id=trade.id,
            )
            session.add(lesson)
            await session.commit()
            await session.refresh(lesson)
            lesson_id = str(lesson.id)

    if lesson_id:
        await _score_and_embed_lesson(lesson_id, reflection)
    await _populate_pattern_outcome(trade_id)

    outcome = "WIN" if (trade_dict.get("pnl_pct") or 0) >= 0 else "LOSS"
    await telegram.send_message(
        f"📝 <b>Trade reflected: {outcome}</b>\n"
        f"Lesson: {reflection.get('lesson')}"
    )
    logger.info("Reflection stored for trade {}", trade_id)
    return reflection


async def _score_and_embed_lesson(lesson_id: str, reflection: dict) -> None:
    lesson_text = reflection.get("lesson") or ""
    watch_for = reflection.get("watch_for") or ""
    score = 3
    try:
        raw = await agents._call_anthropic(
            "claude-haiku-4-5-20251001",
            prompts.LESSON_QUALITY_CHECK.format(lesson_text=lesson_text, watch_for=watch_for),
            "Rate this lesson.",
        )
        quality = json.loads(agents._strip_json_fences(raw))
        score = int(quality.get("score", 3))
    except Exception:
        logger.exception("Lesson quality check failed; defaulting to score 3")

    embedding = await generate_embedding(f"{lesson_text} {watch_for}")
    async with AsyncSessionLocal() as session:
        lesson = await session.get(AgentLesson, lesson_id)
        if lesson is None:
            return
        lesson.quality_score = score
        if embedding:
            try:
                await session.execute(
                    text("UPDATE agent_lessons SET embedding = CAST(:embedding AS vector) WHERE id = :id"),
                    {"embedding": vector_literal(embedding), "id": lesson_id},
                )
            except Exception:
                logger.warning("Vector embedding update failed; storing embedding JSON fallback")
                lesson.embedding = embedding
        await session.commit()
    if score <= 2:
        logger.warning("Low quality lesson stored (score {}): {}", score, lesson_text[:100])


async def _populate_pattern_outcome(trade_id: str) -> None:
    from backend.perception.key_levels import key_levels_engine
    from backend.perception.smc import smc_analyser

    async with AsyncSessionLocal() as session:
        trade = await session.get(Trade, trade_id)
        if trade is None:
            return
        existing = await session.execute(
            select(PatternOutcome).where(PatternOutcome.trade_id == trade.id).limit(1)
        )
        if existing.scalar_one_or_none() is not None:
            return
        pnl = float(trade.pnl_pct or 0)
        outcome = "win" if pnl > 0.1 else "loss" if pnl < -0.1 else "breakeven"
        hour = (trade.timestamp or trade.created_at).astimezone().hour
        session_name = key_levels_engine.get_current_session(hour)
        pattern_type = smc_analyser.classify_pattern_type(trade.smc_analysis or {})
        rr = None
        management = (trade.position_params or {}).get("management") if trade.position_params else None
        if isinstance(management, dict):
            rr = management.get("rr_achieved_on_exit")
        row = PatternOutcome(
            trade_id=trade.id,
            instrument=trade.instrument or "",
            direction=trade.direction or "hold",
            pattern_type=pattern_type,
            session=session_name,
            setup_score=trade.setup_score,
            boardroom_confidence=trade.boardroom_confidence or trade.confidence,
            outcome=outcome,
            rr_achieved=rr,
            pnl_pct=trade.pnl_pct,
            entry_time=trade.timestamp,
            exit_time=datetime.now(timezone.utc),
        )
        session.add(row)
        await session.commit()


INSTRUMENTS = ["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP"]

PRE_SCAN_PROMPT = """
You are a quick setup quality assessor.
Given this market data, score the setup quality 0-10.
0 = No setup forming at all
5 = Something is forming but not ready
7 = Potential setup, needs confirmation
9 = Strong setup, high confidence opportunity

Market data: {market_snapshot}

Respond ONLY as JSON: {{"score": int, "reason": str}}
Score must be a number 0-10. Be strict - most cycles should score below 6.
"""


async def run_pre_scan(instrument: str) -> dict:
    try:
        snapshot = await snapshot_builder.build_snapshot(to_delta_symbol(instrument))
        brief = {
            "price": snapshot.get("price"),
            "funding_rate": snapshot.get("funding_rate"),
            "24h_change": snapshot.get("change_24h_pct"),
            "market_regime": snapshot.get("market_regime"),
        }
        raw = await agents._call_anthropic(
            "claude-haiku-4-5-20251001",
            PRE_SCAN_PROMPT.format(market_snapshot=json.dumps(brief, default=str)),
            "Score this setup quality.",
        )
        result = json.loads(agents._strip_json_fences(raw))
        return {"instrument": instrument, "score": int(result.get("score", 0)), "reason": result.get("reason", "")}
    except Exception as exc:
        logger.warning("Pre-scan failed for {}: {}", instrument, exc)
        return {"instrument": instrument, "score": 0, "reason": f"pre-scan failed: {exc}"}


async def run_multi_instrument_decision_loop() -> dict:
    from backend.execution.order_state_manager import order_state_manager
    from backend.execution.risk_profile import risk_manager

    portfolio = await delta_client.get_positions()
    open_count = len([p for p in portfolio if p.get("size", 0) != 0])
    profile = await risk_manager.get_profile()
    max_concurrent = profile.get("max_concurrent_trades", 3)
    active_instruments = profile.get("active_instruments") or ["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP"]
    active_instruments = [i for i in active_instruments if "XAUUSD" not in i]

    pre_scans = list(await asyncio.gather(*(run_pre_scan(inst) for inst in active_instruments)))
    pre_scans.sort(key=lambda x: x["score"], reverse=True)
    qualifying = [p for p in pre_scans if p["score"] >= 6]
    logger.info("Pre-scan results: {}", [(p["instrument"], p["score"]) for p in pre_scans])

    if open_count >= max_concurrent:
        if qualifying:
            await _update_watching_instrument(qualifying[0])
        return {"pre_scans": pre_scans, "qualifying": qualifying, "at_capacity": True}

    decisions = []
    for scan in qualifying:
        instrument = scan["instrument"]
        if not await order_state_manager.can_run_boardroom(instrument):
            logger.info("Skipping {} - not in WATCHING state", instrument)
            continue
        decisions.append(await run_decision_loop(instrument))
        portfolio = await delta_client.get_positions()
        open_count = len([p for p in portfolio if p.get("size", 0) != 0])
        if open_count >= max_concurrent:
            break
    return {"pre_scans": pre_scans, "qualifying": qualifying, "decisions": decisions}


async def _update_watching_instrument(scan: dict) -> None:
    logger.info(
        "At max positions. Watching: {} (score {})",
        scan.get("instrument"), scan.get("score"),
    )


# ---------------------------------------------------------------------------
# LOOP 3 — Nightly counterfactual (runs at 2am IST = 20:30 UTC)
# ---------------------------------------------------------------------------

async def run_counterfactual_loop() -> dict:
    """Counterfactual analysis on all trades closed today without one yet."""
    logger.info("Counterfactual loop started")
    today_start = datetime.combine(
        datetime.now(timezone.utc).date(), time.min, tzinfo=timezone.utc
    )

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Trade).where(
                Trade.status == "closed",
                Trade.counterfactuals.is_(None),
                Trade.created_at >= today_start,
            )
        )
        trades = result.scalars().all()
        trade_payloads = []
        for t in trades:
            window_start = t.timestamp or t.created_at
            snap_result = await session.execute(
                select(SnapshotRow)
                .where(
                    SnapshotRow.instrument == t.instrument,
                    SnapshotRow.timestamp >= window_start,
                )
                .order_by(SnapshotRow.timestamp.asc())
                .limit(240)
            )
            history = [
                {
                    "timestamp": s.timestamp.isoformat() if s.timestamp else None,
                    "price": float(s.price) if s.price is not None else None,
                }
                for s in snap_result.scalars().all()
            ]
            trade_payloads.append((str(t.id), {
                "instrument": t.instrument,
                "direction": t.direction,
                "entry_price": float(t.entry_price) if t.entry_price else None,
                "exit_price": float(t.exit_price) if t.exit_price else None,
                "size_pct": float(t.size_pct) if t.size_pct else None,
                "pnl_pct": float(t.pnl_pct) if t.pnl_pct else None,
                "duration_mins": t.duration_mins,
                "entry_reasoning": t.entry_reasoning,
            }, history))

    analyzed = 0
    best_insight = ""
    best_pnl = float("-inf")
    for trade_id, trade_dict, history in trade_payloads:
        try:
            cf = await agents.run_counterfactual_agent(trade_dict, history)
            async with AsyncSessionLocal() as session:
                trade = await session.get(Trade, trade_id)
                if trade is not None:
                    trade.counterfactuals = cf
                    await session.commit()
            analyzed += 1
            for scenario in cf.get("scenarios", []):
                pnl = scenario.get("simulated_pnl_pct") or 0
                if scenario.get("outcome_better") and pnl > best_pnl:
                    best_pnl = pnl
                    best_insight = cf.get("key_insight", "")
            await agents.pause_between_agents()
        except Exception:
            logger.exception("Counterfactual failed for trade {}", trade_id)

    summary = (
        f"🔄 Nightly analysis complete: {analyzed} trades analyzed."
        + (f"\nBest missed opportunity: {best_insight}" if best_insight else "")
    )
    await telegram.send_message(summary)
    logger.info("Counterfactual loop done: {} trades", analyzed)
    return {"analyzed": analyzed, "best_insight": best_insight}


# ---------------------------------------------------------------------------
# Snapshot storage (every 5 min, feeds Loop 3 price history)
# ---------------------------------------------------------------------------

async def store_market_snapshot(instrument: str = "BTCUSD") -> None:
    try:
        snap = await snapshot_builder.build_snapshot(instrument)
        # Capture ATM IV so the IV percentile rank builds over time (AREA 2)
        iv_value = None
        try:
            from backend.perception.iv_analyser import iv_analyser

            iv_snap = await iv_analyser.get_iv_snapshot(instrument)
            if iv_snap.get("available"):
                iv_value = iv_snap.get("atm_iv")
        except Exception:
            logger.debug("IV capture skipped for snapshot")
        async with AsyncSessionLocal() as session:
            row = SnapshotRow(
                timestamp=datetime.now(timezone.utc),
                instrument=instrument,
                price=snap.get("price"),
                funding_rate=snap.get("funding_rate"),
                iv=iv_value,
                open_interest=snap.get("open_interest"),
                fear_greed_index=snap.get("fear_greed_index"),
                btc_dominance=snap.get("btc_dominance"),
                raw_data=snap,
            )
            session.add(row)
            await session.commit()
        logger.info("Market snapshot stored for {} (iv={})", instrument, iv_value)
    except Exception:
        logger.exception("Failed to store market snapshot")
