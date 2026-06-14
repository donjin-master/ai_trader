"""Active AI position manager — ride winners, cut losers fast.

Replaces the passive PositionMonitor. Runs every 60 seconds.

The rules (UPGRADE_POSITION_MANAGEMENT.md):
1. The initial SL is sacred — it never moves against the position.
2. SL hit → market out immediately, no deliberation.
3. Minimum 1:3 R:R enforced at registration.
4. SL → breakeven at 1:1.
5. Partial exit (default 40%) at TP1, remainder rides.
6. Trail on swing structure (or ATR), only ever tightens.
7. Exit on 1H structure break, not on fear.
8. Hold through retracements while structure is intact.
"""

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

import pandas as pd
from loguru import logger
from sqlalchemy import delete, select

from backend.db.database import AsyncSessionLocal
from backend.db.models import ManagedPosition, Trade
from backend.deps import delta_client
from backend.execution.safety import safety_manager
from backend.notifications import telegram

HARD_MIN_RR = 3.0


@dataclass
class PositionState:
    instrument: str
    direction: str               # "long" | "short"
    entry_price: float
    initial_sl: float            # NEVER changes
    current_sl: float            # moves in our favour only
    tp1: float                   # partial exit target
    tp2: float                   # minimum 1:3 target
    tp3: float | None            # next liquidity level (optional)
    initial_size_contracts: int
    current_size_contracts: int
    tp1_hit: bool
    breakeven_set: bool
    trail_active: bool
    trail_sl: float | None
    last_swing_low: float | None
    last_swing_high: float | None
    entry_timestamp: str         # ISO
    trade_id: str | None
    initial_risk_pct: float
    initial_rr_ratio: float
    trail_history: list = field(default_factory=list)
    hold_checks: int = 0


class PositionManager:
    """Monitors every open position every 60s and acts on strict priorities."""

    def __init__(self) -> None:
        self._managed_positions: dict[str, PositionState] = {}

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def load_state(self) -> None:
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(ManagedPosition))
                for row in result.scalars().all():
                    self._managed_positions[row.instrument] = PositionState(**row.state)
            if self._managed_positions:
                logger.info(
                    "Position manager restored state for: {}",
                    list(self._managed_positions.keys()),
                )
        except Exception:
            logger.exception("Failed to load managed position state")

    async def _save_position_state(self, state: PositionState) -> None:
        try:
            async with AsyncSessionLocal() as session:
                row = await session.get(ManagedPosition, state.instrument)
                if row is None:
                    row = ManagedPosition(instrument=state.instrument, state=asdict(state))
                    session.add(row)
                else:
                    row.state = asdict(state)
                    row.updated_at = datetime.now(timezone.utc)
                await session.commit()
        except Exception:
            logger.exception("Failed to persist position state for {}", state.instrument)

    _update_position_state = _save_position_state

    async def _drop_state(self, instrument: str) -> None:
        self._managed_positions.pop(instrument, None)
        try:
            async with AsyncSessionLocal() as session:
                await session.execute(
                    delete(ManagedPosition).where(ManagedPosition.instrument == instrument)
                )
                await session.commit()
        except Exception:
            logger.exception("Failed to delete position state for {}", instrument)

    def snapshot_states(self) -> list[dict]:
        """For the dashboard: all managed positions as dicts."""
        return [asdict(s) for s in self._managed_positions.values()]

    # ------------------------------------------------------------------
    # Registration (called by executor after a fill)
    # ------------------------------------------------------------------

    async def register_new_position(
        self,
        trade_id: str | None,
        instrument: str,
        direction: str,
        entry_price: float,
        initial_sl: float,
        tp1: float,
        tp2: float,
        tp3: float | None,
        contracts: int,
        risk_pct: float,
    ) -> PositionState:
        sl_distance = abs(entry_price - initial_sl)
        tp2_distance = abs(tp2 - entry_price)
        rr_ratio = tp2_distance / sl_distance if sl_distance > 0 else 0

        if rr_ratio < HARD_MIN_RR:
            raise ValueError(
                f"R:R ratio {rr_ratio:.2f} is below minimum 1:{HARD_MIN_RR:.0f}. "
                f"Trade rejected. Adjust TP2 or SL."
            )

        state = PositionState(
            instrument=instrument,
            direction=direction,
            entry_price=entry_price,
            initial_sl=initial_sl,
            current_sl=initial_sl,
            tp1=tp1,
            tp2=tp2,
            tp3=tp3,
            initial_size_contracts=contracts,
            current_size_contracts=contracts,
            tp1_hit=False,
            breakeven_set=False,
            trail_active=False,
            trail_sl=initial_sl,
            last_swing_low=None,
            last_swing_high=None,
            entry_timestamp=datetime.now(timezone.utc).isoformat(),
            trade_id=trade_id,
            initial_risk_pct=risk_pct,
            initial_rr_ratio=round(rr_ratio, 2),
            trail_history=[{"sl": initial_sl, "reason": "initial", "at": datetime.now(timezone.utc).isoformat()}],
        )
        self._managed_positions[instrument] = state
        await self._save_position_state(state)
        logger.info(
            "Position registered: {} {} | SL: {} | TP1: {} | TP2: {} | R:R: 1:{:.1f}",
            instrument, direction.upper(), initial_sl, tp1, tp2, rr_ratio,
        )
        await telegram.send_message(
            f"📈 {direction.upper()} {instrument} {entry_price} | "
            f"SL: {initial_sl} | Target: {tp2} (1:{rr_ratio:.1f}R) | Riding..."
        )
        return state

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def check_and_manage(self) -> None:
        try:
            live_positions = await delta_client.get_positions()
        except Exception as exc:
            logger.warning("Position manager: failed to fetch positions: {}", exc)
            return

        live_by_symbol = {p.get("product_symbol"): p for p in live_positions}

        # Positions that vanished from the exchange (SL/TP filled or manual close)
        for instrument in list(self._managed_positions.keys()):
            if instrument not in live_by_symbol:
                await self._handle_external_close(self._managed_positions[instrument])

        for symbol, position in live_by_symbol.items():
            state = self._managed_positions.get(symbol)
            if state is None:
                logger.warning("Position {} has no managed state — monitoring only", symbol)
                continue
            mark = position.get("mark_price") or position.get("entry_price")
            try:
                current_price = float(mark)
            except (TypeError, ValueError):
                continue
            try:
                await self._assess_position(state, current_price, position)
            except Exception:
                logger.exception("Assessment failed for {}", symbol)

    # ------------------------------------------------------------------
    # Core decision logic (strict priority order)
    # ------------------------------------------------------------------

    async def _assess_position(
        self, state: PositionState, current_price: float, live_data: dict
    ) -> None:
        from backend.execution.executor import executor

        # ── PRIORITY 1: SL HIT? Market out. No deliberation. ──────────────
        sl_hit = (
            (state.direction == "long" and current_price <= state.current_sl)
            or (state.direction == "short" and current_price >= state.current_sl)
        )
        if sl_hit:
            logger.warning("SL HIT on {} at {}", state.instrument, current_price)
            await executor.close_position(state.instrument, "stop_loss_hit")
            pnl = self._current_pnl(state, current_price)
            label = "🔴 STOP LOSS HIT" if pnl < 0 else "🟡 TRAIL/BE STOP HIT"
            await telegram.send_message(
                f"{label}\n"
                f"{state.instrument} | {state.direction.upper()}\n"
                f"Entry: {state.entry_price} → Exit: {current_price}\n"
                f"P&L on remainder: {pnl:+.2f}%\n"
                f"Trade managed correctly. Next opportunity."
            )
            await self._finalize(state, current_price, "stop_loss")
            return

        # ── PRIORITY 2: 1H STRUCTURE BREAK? (only after TP1 locked profit) ──
        if state.tp1_hit:
            structure_broken = await self._check_structure_break(state)
            if structure_broken:
                logger.info("1H structure break on {} — closing remainder", state.instrument)
                await executor.close_position(state.instrument, "structure_break")
                await telegram.send_message(
                    f"📐 STRUCTURE BREAK EXIT\n"
                    f"{state.instrument} | Remainder closed at {current_price}\n"
                    f"1H structure invalidated position thesis.\n"
                    f"Locked partial profits from TP1. Clean exit."
                )
                await self._finalize(state, current_price, "structure_break")
                return

        # ── PRIORITY 3: EXPLICIT R:R CAP HIT? (max_rr_cap, default None) ────
        # R:R philosophy (UPGRADE_UI_CHART_RR): min R:R is an ENTRY gate only.
        # There is NO ceiling by default — once the trail is active, no price
        # target forces a close. The only exits are: trail hit, 1H structure
        # break, manual close, or an explicit user-set max_rr_cap.
        profile = await self._profile()
        max_rr_cap = profile.get("max_rr_cap")
        if max_rr_cap is not None:
            current_rr = self._calculate_rr(state, current_price)
            in_profit = self._current_pnl(state, current_price) > 0
            if in_profit and current_rr >= float(max_rr_cap):
                await executor.close_position(state.instrument, "max_rr_cap")
                await telegram.send_message(
                    f"🎯 R:R CAP HIT — FULL EXIT\n"
                    f"{state.instrument} | {state.direction.upper()}\n"
                    f"Entry: {state.entry_price} → Exit: {current_price}\n"
                    f"R:R achieved: 1:{current_rr:.1f} (your cap: 1:{float(max_rr_cap):.0f}) 🔥"
                )
                await self._finalize(state, current_price, "max_rr_cap")
                return

        # ── PRIORITY 4: TP2/TP3 HIT before trail is running? ───────────────
        # If the trail never activated (price ran straight through targets
        # without ever hitting TP1's partial-exit logic in time), take profit
        # at the planned target. Once trail_active, these never force a close.
        if not state.trail_active:
            tp3_hit = state.tp3 is not None and (
                (state.direction == "long" and current_price >= state.tp3)
                or (state.direction == "short" and current_price <= state.tp3)
            )
            tp2_hit = (
                (state.direction == "long" and current_price >= state.tp2)
                or (state.direction == "short" and current_price <= state.tp2)
            )
            if tp3_hit or tp2_hit:
                trigger = "tp3_hit" if tp3_hit else "tp2_hit"
                await executor.close_position(state.instrument, trigger)
                await telegram.send_message(
                    f"✅ {'TARGET 3' if tp3_hit else 'TARGET 2'} HIT — FULL EXIT\n"
                    f"{state.instrument} | Entry: {state.entry_price}\n"
                    f"Full exit at {current_price}\n"
                    f"R:R: 1:{self._calculate_rr(state, current_price):.1f}"
                )
                await self._finalize(state, current_price, trigger)
                return

        # ── PRIORITY 5: TP1 HIT? Partial exit + breakeven + trail on. ──────
        tp1_hit = not state.tp1_hit and (
            (state.direction == "long" and current_price >= state.tp1)
            or (state.direction == "short" and current_price <= state.tp1)
        )
        if tp1_hit:
            profile = await self._profile()
            exit_fraction = profile.get("tp1_exit_pct", 40) / 100
            contracts_to_close = max(1, int(state.current_size_contracts * exit_fraction))
            # Never close the whole position at TP1 unless it's a single contract
            if contracts_to_close >= state.current_size_contracts and state.current_size_contracts > 1:
                contracts_to_close = state.current_size_contracts - 1

            await executor.partial_close(state.instrument, contracts_to_close, "tp1_partial_exit")

            state.current_sl = state.entry_price
            state.breakeven_set = True
            state.tp1_hit = True
            state.trail_active = True
            state.trail_sl = state.entry_price
            state.current_size_contracts -= contracts_to_close
            state.trail_history.append({
                "sl": state.entry_price, "reason": "breakeven_at_tp1",
                "at": datetime.now(timezone.utc).isoformat(),
            })

            try:
                # POST /v2/orders/bracket replaces ALL bracket orders — this both
                # moves SL to breakeven and removes the exchange-side TP, so the
                # remainder has no ceiling (trail governs the exit from here).
                await delta_client.update_stop_loss(state.instrument, state.entry_price)
            except Exception as exc:
                logger.warning("Exchange SL update failed (manager still enforces): {}", exc)

            await telegram.send_message(
                f"⚡ TP1 HIT — PARTIAL EXIT\n"
                f"{state.instrument} | {int(exit_fraction*100)}% closed at {current_price}\n"
                f"SL moved to breakeven: {state.entry_price}\n"
                f"Remaining {state.current_size_contracts} contracts riding FREE\n"
                f"Trail activated. Watching for 1:{state.initial_rr_ratio:.0f}+ 🚀"
            )
            await self._save_position_state(state)
            return

        # ── PRIORITY 6: TRAIL THE STOP ─────────────────────────────────────
        if state.trail_active:
            await self._update_trail(state, current_price)

        # ── PRIORITY 7: HOLD ───────────────────────────────────────────────
        state.hold_checks += 1
        if state.hold_checks % 5 == 0:
            logger.info(
                "HOLDING {} | Entry: {} | Current: {} | P&L: {:+.2f}% | Trail: {}",
                state.instrument, state.entry_price, current_price,
                self._current_pnl(state, current_price), state.trail_sl,
            )
            await self._save_position_state(state)

    # ------------------------------------------------------------------
    # Trailing
    # ------------------------------------------------------------------

    async def _profile(self) -> dict:
        from backend.execution.risk_profile import risk_manager

        try:
            return await risk_manager.get_profile()
        except Exception:
            logger.exception("Could not load risk profile — using defaults")
            return {}

    async def _update_trail(self, state: PositionState, current_price: float) -> None:
        profile = await self._profile()
        method = profile.get("trail_method", "STRUCTURE")
        atr_mult = profile.get("atr_trail_multiplier", 2.0)

        if state.direction == "long":
            new_trail = await self._calculate_long_trail(state, current_price, method, atr_mult)
            if state.trail_sl is not None and new_trail > state.trail_sl:
                old_trail = state.trail_sl
                state.trail_sl = new_trail
                state.current_sl = new_trail
                state.trail_history.append({
                    "sl": round(new_trail, 1), "reason": f"trail_{method.lower()}",
                    "at": datetime.now(timezone.utc).isoformat(),
                })
                try:
                    await delta_client.update_stop_loss(state.instrument, new_trail)
                except Exception as exc:
                    logger.warning("Exchange trail update failed: {}", exc)
                logger.info(
                    "TRAIL UPDATED {}: {:.0f} → {:.0f} (+{:.0f})",
                    state.instrument, old_trail, new_trail, new_trail - old_trail,
                )
                await telegram.send_message(
                    f"📐 Trail moved: {round(old_trail, 1)} → {round(new_trail, 1)} | "
                    f"{'New swing low formed' if method == 'STRUCTURE' else 'ATR trail'}"
                )
                await self._save_position_state(state)

        elif state.direction == "short":
            new_trail = await self._calculate_short_trail(state, current_price, method, atr_mult)
            if state.trail_sl is not None and new_trail < state.trail_sl:
                old_trail = state.trail_sl
                state.trail_sl = new_trail
                state.current_sl = new_trail
                state.trail_history.append({
                    "sl": round(new_trail, 1), "reason": f"trail_{method.lower()}",
                    "at": datetime.now(timezone.utc).isoformat(),
                })
                try:
                    await delta_client.update_stop_loss(state.instrument, new_trail)
                except Exception as exc:
                    logger.warning("Exchange trail update failed: {}", exc)
                logger.info("TRAIL UPDATED {}: {:.0f} → {:.0f}", state.instrument, old_trail, new_trail)
                await telegram.send_message(
                    f"📐 Trail moved: {round(old_trail, 1)} → {round(new_trail, 1)} | "
                    f"{'New swing high formed' if method == 'STRUCTURE' else 'ATR trail'}"
                )
                await self._save_position_state(state)

    @staticmethod
    def _df_with_atr(candles: list[dict]) -> pd.DataFrame:
        df = pd.DataFrame(candles)
        for col in ("open", "high", "low", "close"):
            df[col] = pd.to_numeric(df[col], errors="coerce")
        prev_close = df["close"].shift(1)
        tr = pd.concat(
            [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
            axis=1,
        ).max(axis=1)
        df["atr"] = tr.rolling(14).mean()
        return df

    async def _calculate_long_trail(
        self, state: PositionState, current_price: float, method: str, atr_mult: float
    ) -> float:
        assert state.trail_sl is not None
        candles = await delta_client.get_candles(state.instrument, "15", 30)
        if not candles:
            return state.trail_sl
        df = self._df_with_atr(candles)
        atr = float(df["atr"].iloc[-1]) if pd.notna(df["atr"].iloc[-1]) else current_price * 0.003

        if method == "ATR":
            candidate = current_price - atr * atr_mult
            return max(candidate, state.trail_sl)

        # STRUCTURE: last confirmed swing lows (5-candle pivot)
        swing_lows = [
            float(df["low"].iloc[i])
            for i in range(2, len(df) - 2)
            if df["low"].iloc[i] == df["low"].iloc[i - 2 : i + 3].min()
        ]
        valid = [sl for sl in swing_lows if sl - atr * 0.5 > state.trail_sl]
        if not valid:
            return state.trail_sl
        state.last_swing_low = max(valid)
        return max(max(valid) - atr * 0.5, state.trail_sl)

    async def _calculate_short_trail(
        self, state: PositionState, current_price: float, method: str, atr_mult: float
    ) -> float:
        assert state.trail_sl is not None
        candles = await delta_client.get_candles(state.instrument, "15", 30)
        if not candles:
            return state.trail_sl
        df = self._df_with_atr(candles)
        atr = float(df["atr"].iloc[-1]) if pd.notna(df["atr"].iloc[-1]) else current_price * 0.003

        if method == "ATR":
            candidate = current_price + atr * atr_mult
            return min(candidate, state.trail_sl)

        swing_highs = [
            float(df["high"].iloc[i])
            for i in range(2, len(df) - 2)
            if df["high"].iloc[i] == df["high"].iloc[i - 2 : i + 3].max()
        ]
        valid = [sh for sh in swing_highs if sh + atr * 0.5 < state.trail_sl]
        if not valid:
            return state.trail_sl
        state.last_swing_high = min(valid)
        return min(min(valid) + atr * 0.5, state.trail_sl)

    # ------------------------------------------------------------------
    # Structure break (mechanical + AI second opinion)
    # ------------------------------------------------------------------

    async def _check_structure_break(self, state: PositionState) -> bool:
        from backend.perception.smc import smc_analyser

        candles_1h = await delta_client.get_candles(state.instrument, "60", 50)
        if not candles_1h:
            return False
        df = smc_analyser._prepare_df(candles_1h)
        structure = smc_analyser.detect_market_structure(df)

        mechanical_break = False
        if state.direction == "long" and structure["swing_lows"]:
            last_swing_low = structure["swing_lows"][-1]["price"]
            mechanical_break = float(df["close"].iloc[-1]) < last_swing_low
        elif state.direction == "short" and structure["swing_highs"]:
            last_swing_high = structure["swing_highs"][-1]["price"]
            mechanical_break = float(df["close"].iloc[-1]) > last_swing_high

        if not mechanical_break:
            return False

        # AI second opinion — close only when Python AND the AI agree
        profile = await self._profile()
        if not profile.get("allow_position_assessment", True):
            return True
        try:
            assessment = await self._ai_assessment(state, structure)
            recommendation = assessment.get("recommendation", "HOLD")
            logger.info(
                "AI position assessment for {}: {} ({})",
                state.instrument, recommendation, assessment.get("reasoning", ""),
            )
            return recommendation == "CLOSE_IMMEDIATELY"
        except Exception:
            logger.exception("AI assessment failed — trusting mechanical break")
            return True

    async def _ai_assessment(self, state: PositionState, structure_1h: dict) -> dict:
        from backend.ai import prompts
        from backend.ai.agents import _call_anthropic, _strip_json_fences
        from backend.deps import snapshot_builder
        from backend.perception.smc import smc_analyser

        candles_15m = await delta_client.get_candles(state.instrument, "15", 50)
        structure_15m = smc_analyser.detect_market_structure(
            smc_analyser._prepare_df(candles_15m)
        )
        snapshot = await snapshot_builder.build_snapshot(state.instrument)
        system = prompts.POSITION_ASSESSMENT.format(
            position_state=json.dumps(asdict(state), indent=2, default=str),
            current_snapshot=json.dumps(snapshot, indent=2, default=str),
            structure_15m=json.dumps(structure_15m, indent=2, default=str),
            structure_1h=json.dumps(structure_1h, indent=2, default=str),
        )
        raw = await _call_anthropic(
            "claude-sonnet-4-6", system, "Assess this open position now."
        )
        return json.loads(_strip_json_fences(raw))

    # ------------------------------------------------------------------
    # Finalize / external close handling
    # ------------------------------------------------------------------

    def _current_pnl(self, state: PositionState, current_price: float) -> float:
        raw = (current_price - state.entry_price) / state.entry_price * 100
        return round(raw if state.direction == "long" else -raw, 2)

    def _calculate_rr(self, state: PositionState, exit_price: float) -> float:
        risk = abs(state.entry_price - state.initial_sl)
        reward = abs(exit_price - state.entry_price)
        return round(reward / risk, 2) if risk > 0 else 0.0

    def _management_summary(self, state: PositionState, exit_price: float, trigger: str) -> dict:
        return {
            "trigger": trigger,
            "exit_price": exit_price,
            "tp1_hit": state.tp1_hit,
            "breakeven_set": state.breakeven_set,
            "initial_rr_planned": state.initial_rr_ratio,
            "rr_achieved_on_exit": self._calculate_rr(state, exit_price),
            "trail_updates": max(0, len(state.trail_history) - 1),
            "trail_history": state.trail_history[-12:],
            "initial_size_contracts": state.initial_size_contracts,
            "final_size_contracts": state.current_size_contracts,
        }

    async def _finalize(self, state: PositionState, exit_price: float, trigger: str) -> None:
        """Update trade record, daily P&L, drop state, and run Loop 2."""
        pnl_pct = self._current_pnl(state, exit_price)
        entry_ts = datetime.fromisoformat(state.entry_timestamp)
        duration_mins = int((datetime.now(timezone.utc) - entry_ts).total_seconds() / 60)

        trade_id = state.trade_id
        try:
            async with AsyncSessionLocal() as session:
                trade = None
                if trade_id:
                    trade = await session.get(Trade, trade_id)
                if trade is None:
                    result = await session.execute(
                        select(Trade)
                        .where(Trade.instrument == state.instrument, Trade.status == "open")
                        .order_by(Trade.created_at.desc())
                        .limit(1)
                    )
                    trade = result.scalar_one_or_none()
                if trade is not None:
                    trade.exit_price = exit_price
                    trade.pnl_pct = pnl_pct
                    trade.duration_mins = duration_mins
                    trade.status = "closed"
                    trade.exit_trigger = trigger
                    params = dict(trade.position_params or {})
                    params["management"] = self._management_summary(state, exit_price, trigger)
                    trade.position_params = params
                    await session.commit()
                    trade_id = str(trade.id)
        except Exception:
            logger.exception("Failed to update closed trade for {}", state.instrument)

        await safety_manager.update_daily_pnl(pnl_pct)
        await self._drop_state(state.instrument)

        from backend.execution.order_state_manager import order_state_manager

        await order_state_manager.on_position_closed(state.instrument)
        if trade_id:
            from backend.ai.loops import run_reflection_loop

            try:
                await run_reflection_loop(trade_id)
            except Exception:
                logger.exception("Reflection loop failed for trade {}", trade_id)
        await order_state_manager.on_reflection_complete(state.instrument)

    async def _handle_external_close(self, state: PositionState) -> None:
        """Position vanished from the exchange (bracket SL/TP filled or manual close)."""
        exit_price = state.entry_price
        try:
            ticker = await delta_client.get_ticker(state.instrument)
            exit_price = float(ticker.get("close") or state.entry_price)
        except Exception as exc:
            logger.warning("Could not fetch exit price for {}: {}", state.instrument, exc)

        pnl = self._current_pnl(state, exit_price)
        pnl_emoji = "🟢" if pnl >= 0 else "🔴"
        logger.info(
            "Position CLOSED externally: {} {} pnl={:+.2f}%",
            state.instrument, state.direction, pnl,
        )
        await telegram.send_message(
            f"📊 POSITION CLOSED (exchange-side)\n"
            f"{state.instrument} | {state.direction} | {pnl_emoji} {pnl:+.2f}%"
        )
        await self._finalize(state, exit_price, "tp/sl")


position_manager = PositionManager()
