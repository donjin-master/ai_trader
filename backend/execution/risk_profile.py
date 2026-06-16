"""Risk profile manager — the user's risk control panel, enforced in code.

The profile is configured once (via /api/risk-profile or the dashboard
settings page) and the bot operates inside those rules autonomously.
"""

from datetime import datetime, time as dtime, timedelta, timezone
from typing import Any

from loguru import logger
from sqlalchemy import select

from backend.db.database import AsyncSessionLocal
from backend.db.models import RiskProfile, Trade

IST = timezone(timedelta(hours=5, minutes=30))

VALID_MODES = ("ADVISORY", "SEMI_AUTO", "AUTONOMOUS", "SCHEDULED")
VALID_SIZING = ("FIXED", "DYNAMIC", "KELLY", "EDGE")

# Field validation: name -> (min, max) or tuple of allowed values
_NUMERIC_BOUNDS: dict[str, tuple[float, float]] = {
    "total_capital": (100, 100_000_000),
    "daily_budget_pct": (0.5, 100),
    "weekly_budget_pct": (1, 100),
    "risk_per_trade_pct": (0.1, 3.0),
    "max_position_size_pct": (0.5, 5.0),
    "max_trades_per_day": (1, 50),
    "max_trades_per_week": (1, 200),
    "max_concurrent_trades": (1, 10),
    "min_setup_score": (1, 10),
    "daily_loss_limit_pct": (0.5, 20),
    "consecutive_loss_limit": (1, 20),
    "min_rr_ratio": (0.5, 10),
    "require_confluence": (0, 9),
    "min_boardroom_votes": (1, 3),
    "min_avg_conviction": (1, 10),
    "approval_timeout_mins": (1, 120),
    "atr_trail_multiplier": (1.0, 3.0),
    "tp1_exit_pct": (20, 60),
    "breakeven_at_rr": (0, 3.0),
    "tp1_rr_trigger": (0.5, 3.0),
    "stale_order_candles": (1, 20),
    "max_options_loss_pct": (0.1, 3.0),
    "preferred_dte_min": (0, 60),
    "preferred_dte_max": (1, 90),
    "iv_regime_threshold_low": (5, 50),
    "iv_regime_threshold_high": (50, 95),
    "scan_interval_asia_mins": (5, 180),
    "scan_interval_london_mins": (5, 180),
    "scan_interval_us_mins": (5, 180),
    "scan_interval_overnight_mins": (5, 240),
}

VALID_ENTRY_MODES = ("limit_preferred", "market_allowed", "limit_only")

VALID_TRAIL_METHODS = ("STRUCTURE", "ATR")
VALID_VISION_MODES = ("OFF", "CHAIR_ONLY", "ALL_MEMBERS")

_PROFILE_FIELDS = set(_NUMERIC_BOUNDS) | {
    "sizing_mode", "trade_start_time", "trade_end_time", "blackout_windows",
    "avoid_weekends", "allow_chair_override", "mode",
    "trail_method", "allow_position_assessment",
    "max_rr_cap", "vision_mode",
    "preferred_entry_mode", "options_enabled", "active_instruments",
    "enabled_patterns",
}


class RiskProfileManager:
    """Loads, validates, and enforces the risk profile."""

    async def get_profile(self) -> dict:
        async with AsyncSessionLocal() as session:
            row = await session.get(RiskProfile, 1)
            if row is None:
                row = RiskProfile(id=1)
                session.add(row)
                await session.commit()
                await session.refresh(row)
            return self._row_to_dict(row)

    def _row_to_dict(self, row: RiskProfile) -> dict:
        return {
            "total_capital": float(row.total_capital),
            "daily_budget_pct": float(row.daily_budget_pct),
            "weekly_budget_pct": float(row.weekly_budget_pct),
            "risk_per_trade_pct": float(row.risk_per_trade_pct),
            "sizing_mode": row.sizing_mode,
            "max_position_size_pct": float(row.max_position_size_pct),
            "max_trades_per_day": row.max_trades_per_day,
            "max_trades_per_week": row.max_trades_per_week,
            "max_concurrent_trades": row.max_concurrent_trades,
            "min_setup_score": float(row.min_setup_score),
            "trade_start_time": str(row.trade_start_time),
            "trade_end_time": str(row.trade_end_time),
            "blackout_windows": row.blackout_windows or [],
            "avoid_weekends": bool(row.avoid_weekends),
            "daily_loss_limit_pct": float(row.daily_loss_limit_pct),
            "consecutive_loss_limit": row.consecutive_loss_limit,
            "min_rr_ratio": float(row.min_rr_ratio),
            "require_confluence": row.require_confluence,
            "min_boardroom_votes": row.min_boardroom_votes,
            "min_avg_conviction": float(row.min_avg_conviction),
            "allow_chair_override": bool(row.allow_chair_override),
            "mode": row.mode,
            "approval_timeout_mins": row.approval_timeout_mins,
            "trail_method": row.trail_method,
            "atr_trail_multiplier": float(row.atr_trail_multiplier),
            "tp1_exit_pct": float(row.tp1_exit_pct),
            "breakeven_at_rr": float(row.breakeven_at_rr),
            "tp1_rr_trigger": float(row.tp1_rr_trigger),
            "allow_position_assessment": bool(row.allow_position_assessment),
            "max_rr_cap": float(row.max_rr_cap) if row.max_rr_cap is not None else None,
            "vision_mode": row.vision_mode,
            "stale_order_candles": row.stale_order_candles,
            "preferred_entry_mode": row.preferred_entry_mode,
            "options_enabled": bool(row.options_enabled),
            "max_options_loss_pct": float(row.max_options_loss_pct),
            "preferred_dte_min": row.preferred_dte_min,
            "preferred_dte_max": row.preferred_dte_max,
            "iv_regime_threshold_low": row.iv_regime_threshold_low,
            "iv_regime_threshold_high": row.iv_regime_threshold_high,
            "scan_interval_asia_mins": row.scan_interval_asia_mins,
            "scan_interval_london_mins": row.scan_interval_london_mins,
            "scan_interval_us_mins": row.scan_interval_us_mins,
            "scan_interval_overnight_mins": row.scan_interval_overnight_mins,
            "active_instruments": row.active_instruments or ["BTCUSD_PERP", "ETHUSD_PERP", "SOLUSD_PERP"],
            "enabled_patterns": row.enabled_patterns or [],
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    async def update_profile(self, updates: dict) -> dict:
        clean: dict[str, Any] = {}
        for key, value in updates.items():
            if key not in _PROFILE_FIELDS:
                continue
            if key == "max_rr_cap":
                # NULL = no ceiling (recommended); numeric caps must be >= min R:R sane range
                if value is not None:
                    value = float(value)
                    if not (2.0 <= value <= 50.0):
                        raise ValueError(f"max_rr_cap={value} outside allowed range [2, 50] (or null)")
                clean[key] = value
                continue
            if key == "vision_mode":
                if value not in VALID_VISION_MODES:
                    raise ValueError(f"vision_mode must be one of {VALID_VISION_MODES}")
                clean[key] = value
                continue
            if key in _NUMERIC_BOUNDS:
                lo, hi = _NUMERIC_BOUNDS[key]
                value = float(value)
                if not (lo <= value <= hi):
                    raise ValueError(f"{key}={value} outside allowed range [{lo}, {hi}]")
                if key in ("max_trades_per_day", "max_trades_per_week",
                           "max_concurrent_trades", "consecutive_loss_limit",
                           "min_boardroom_votes", "require_confluence",
                           "approval_timeout_mins", "scan_interval_asia_mins",
                           "scan_interval_london_mins", "scan_interval_us_mins",
                           "scan_interval_overnight_mins"):
                    value = int(value)
            elif key == "sizing_mode":
                if value not in VALID_SIZING:
                    raise ValueError(f"sizing_mode must be one of {VALID_SIZING}")
            elif key == "mode":
                if value not in VALID_MODES:
                    raise ValueError(f"mode must be one of {VALID_MODES}")
            elif key in ("trade_start_time", "trade_end_time"):
                dtime.fromisoformat(str(value))  # validates HH:MM
                value = str(value)
            elif key == "blackout_windows":
                if not isinstance(value, list):
                    raise ValueError("blackout_windows must be a list of 'HH:MM-HH:MM' strings")
            elif key == "trail_method":
                if value not in VALID_TRAIL_METHODS:
                    raise ValueError(f"trail_method must be one of {VALID_TRAIL_METHODS}")
            elif key == "preferred_entry_mode":
                if value not in VALID_ENTRY_MODES:
                    raise ValueError(f"preferred_entry_mode must be one of {VALID_ENTRY_MODES}")
            elif key in ("avoid_weekends", "allow_chair_override",
                         "allow_position_assessment", "options_enabled"):
                value = bool(value)
            elif key == "active_instruments":
                if not isinstance(value, list):
                    raise ValueError("active_instruments must be a list of strings")
            elif key == "enabled_patterns":
                if not isinstance(value, list):
                    raise ValueError("enabled_patterns must be a list of strings")
            clean[key] = value

        async with AsyncSessionLocal() as session:
            row = await session.get(RiskProfile, 1)
            if row is None:
                row = RiskProfile(id=1)
                session.add(row)
            for key, value in clean.items():
                setattr(row, key, value)
            row.updated_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(row)
            logger.info("Risk profile updated: {}", list(clean.keys()))
            return self._row_to_dict(row)

    async def reset_profile(self) -> dict:
        async with AsyncSessionLocal() as session:
            row = await session.get(RiskProfile, 1)
            if row is not None:
                await session.delete(row)
                await session.commit()
        logger.info("Risk profile reset to defaults")
        return await self.get_profile()

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    async def get_daily_stats(self) -> dict:
        now_ist = datetime.now(IST)
        day_start = now_ist.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        return await self._stats_since(day_start)

    async def get_weekly_stats(self) -> dict:
        now_ist = datetime.now(IST)
        monday = (now_ist - timedelta(days=now_ist.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        ).astimezone(timezone.utc)
        return await self._stats_since(monday)

    async def _stats_since(self, since_utc: datetime) -> dict:
        executed_statuses = ("executed", "open", "closed")
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Trade)
                .where(Trade.created_at >= since_utc, Trade.status.in_(executed_statuses))
                .order_by(Trade.created_at.desc())
            )
            trades = list(result.scalars().all())

            all_closed = await session.execute(
                select(Trade)
                .where(Trade.status == "closed", Trade.pnl_pct.is_not(None))
                .order_by(Trade.created_at.desc())
                .limit(50)
            )
            closed_trades = list(all_closed.scalars().all())

        pnl = sum(float(t.pnl_pct or 0) for t in trades if t.status == "closed")

        consecutive_losses = 0
        for t in closed_trades:
            if float(t.pnl_pct or 0) < 0:
                consecutive_losses += 1
            else:
                break

        wins = sum(1 for t in closed_trades if float(t.pnl_pct or 0) >= 0)
        win_rate = wins / len(closed_trades) if closed_trades else None

        return {
            "trade_count": len(trades),
            "pnl_pct": round(pnl, 3),
            "consecutive_losses": consecutive_losses,
            "historical_win_rate": round(win_rate, 3) if win_rate is not None else None,
            "closed_sample_size": len(closed_trades),
        }

    # ------------------------------------------------------------------
    # Master gate
    # ------------------------------------------------------------------

    def _in_trading_hours(self, profile: dict, now_ist: datetime) -> tuple[bool, str]:
        start = dtime.fromisoformat(profile["trade_start_time"][:5])
        end = dtime.fromisoformat(profile["trade_end_time"][:5])
        now_t = now_ist.time()
        if not (start <= now_t <= end):
            return False, (
                f"outside trading hours ({profile['trade_start_time']}–{profile['trade_end_time']} IST)"
            )
        for window in profile.get("blackout_windows") or []:
            try:
                w_start_s, w_end_s = window.split("-")
                w_start = dtime.fromisoformat(w_start_s.strip())
                w_end = dtime.fromisoformat(w_end_s.strip())
            except ValueError:
                continue
            in_window = (w_start <= now_t <= w_end) if w_start <= w_end else (
                now_t >= w_start or now_t <= w_end
            )
            if in_window:
                return False, f"inside blackout window {window}"
        return True, ""

    async def is_trading_hours(self) -> bool:
        """Check if current time is within trading hours and not on weekend or blackout window."""
        profile = await self.get_profile()
        now_ist = datetime.now(IST)
        ok, _ = self._in_trading_hours(profile, now_ist)
        if not ok:
            return False
        if profile.get("avoid_weekends") and now_ist.weekday() >= 5:
            return False
        return True

    async def validate_setup(
        self,
        smc_analysis: dict,
        boardroom_decision: dict,
        portfolio_state: dict,
        daily_stats: dict,
        weekly_stats: dict,
        setup_score: dict | None = None,
        kill_switch_active: bool = False,
        daily_pnl_pct: float = 0.0,
    ) -> tuple[bool, str, dict]:
        """Master gate: every profile rule checked in order, fail fast.

        Returns (can_trade, rejection_reason, adjusted_params).
        """
        profile = await self.get_profile()
        mode = profile["mode"]
        adjusted: dict[str, Any] = {"mode": mode, "profile": profile}

        # 1. ADVISORY short-circuits — decision is logged/alerted only
        if mode == "ADVISORY":
            return False, "mode is ADVISORY (alert only)", adjusted

        # 2. Kill switch
        if kill_switch_active:
            return False, "kill switch is active", adjusted

        now_ist = datetime.now(IST)

        # 3-5. Hours / weekend / blackout
        ok, reason = self._in_trading_hours(profile, now_ist)
        if not ok:
            return False, reason, adjusted
        if profile["avoid_weekends"] and now_ist.weekday() >= 5:
            return False, "weekend trading disabled (avoid_weekends)", adjusted

        # 6. Daily budget (₹ at risk)
        daily_budget_inr = profile["total_capital"] * profile["daily_budget_pct"] / 100
        daily_pnl_inr = daily_stats["pnl_pct"] / 100 * profile["total_capital"]
        if daily_pnl_inr <= -daily_budget_inr:
            return False, (
                f"daily budget exhausted (₹{abs(daily_pnl_inr):.0f} ≥ ₹{daily_budget_inr:.0f})"
            ), adjusted

        # 7. Weekly budget
        weekly_budget_inr = profile["total_capital"] * profile["weekly_budget_pct"] / 100
        weekly_pnl_inr = weekly_stats["pnl_pct"] / 100 * profile["total_capital"]
        if weekly_pnl_inr <= -weekly_budget_inr:
            return False, "weekly budget exhausted — paused until Monday", adjusted

        # 8. Daily loss limit (%)
        if daily_pnl_pct <= -profile["daily_loss_limit_pct"]:
            return False, (
                f"daily loss limit hit ({daily_pnl_pct:.2f}% ≤ -{profile['daily_loss_limit_pct']}%)"
            ), adjusted

        # 9. Consecutive losses
        if daily_stats["consecutive_losses"] >= profile["consecutive_loss_limit"]:
            return False, (
                f"{daily_stats['consecutive_losses']} consecutive losses ≥ limit "
                f"{profile['consecutive_loss_limit']}"
            ), adjusted

        # 10-11. Trade counts
        if daily_stats["trade_count"] >= profile["max_trades_per_day"]:
            return False, f"max trades per day reached ({daily_stats['trade_count']})", adjusted
        if weekly_stats["trade_count"] >= profile["max_trades_per_week"]:
            return False, f"max trades per week reached ({weekly_stats['trade_count']})", adjusted

        # 12. Concurrent positions
        open_positions = portfolio_state.get("positions", [])
        if len(open_positions) >= profile["max_concurrent_trades"]:
            return False, f"max concurrent trades reached ({len(open_positions)})", adjusted

        # 13. Setup score
        score = (setup_score or {}).get("score", 0)
        if score < profile["min_setup_score"]:
            return False, (
                f"setup score {score} below minimum {profile['min_setup_score']}"
            ), adjusted

        # 14-15. Boardroom votes and conviction
        boardroom = boardroom_decision.get("boardroom", {})
        action = boardroom_decision.get("action")
        wanted = {"long": ("LONG", "STRONG_LONG"), "short": ("SHORT", "STRONG_SHORT")}.get(action, ())
        deliberations = boardroom.get("deliberations", [])
        votes_for = sum(1 for d in deliberations if d.get("final_vote") in wanted)
        active_members = len(boardroom.get("active_members", [])) or len(deliberations) or 1
        required_votes = min(profile["min_boardroom_votes"], active_members)
        if votes_for < required_votes:
            if not (profile["allow_chair_override"] and boardroom_decision.get("overriding_majority")):
                return False, (
                    f"only {votes_for} votes for {action}, need {required_votes}"
                ), adjusted
        convictions = [d.get("final_conviction", 0) for d in deliberations] or [0]
        avg_conviction = sum(convictions) / len(convictions)
        if avg_conviction < profile["min_avg_conviction"]:
            return False, (
                f"avg conviction {avg_conviction:.1f} below minimum {profile['min_avg_conviction']}"
            ), adjusted

        # 16. R:R ratio
        sl = float(boardroom_decision.get("stop_loss_offset_pct") or 0)
        tp = float(boardroom_decision.get("take_profit_offset_pct") or 0)
        rr = tp / sl if sl > 0 else 0
        if rr < profile["min_rr_ratio"]:
            return False, f"R:R {rr:.2f} below minimum {profile['min_rr_ratio']}", adjusted

        # 17. Confluences
        confluences = len((setup_score or {}).get("confluences_found", []))
        if confluences < profile["require_confluence"]:
            return False, (
                f"only {confluences} confluences, need {profile['require_confluence']}"
            ), adjusted

        # All gates passed — compute SL price for sizing
        price = None
        for tf_key in ("price",):
            price = smc_analysis.get(tf_key) if isinstance(smc_analysis, dict) else None
        adjusted["rr_ratio"] = round(rr, 2)
        adjusted["votes_for"] = votes_for
        adjusted["avg_conviction"] = round(avg_conviction, 1)
        return True, "", adjusted

    # ------------------------------------------------------------------
    # Position sizing
    # ------------------------------------------------------------------

    async def calculate_position_size(
        self,
        risk_per_trade_pct: float,
        entry_price: float,
        stop_loss_price: float,
        available_margin: float,
        setup_score: float,
        sizing_mode: str,
        win_rate_history: float | None = None,
        max_position_size_pct: float = 3.0,
        avg_rr_ratio: float = 1.5,
        total_capital: float | None = None,
        edge_factor: float | None = None,
        pattern_type: str = "general_smc",
        session: str = "us_london",
        instrument: str = "BTCUSD_PERP",
    ) -> dict:
        """
        Calculate position size based on sizing_mode.

        FIXED:  Same risk every trade. Simplest and most reliable.
        DYNAMIC: Scale with setup score.
        EDGE:   Scale with measured historical edge per pattern type.
                Only use after 30+ trades of history, fallback to FIXED.
        KELLY:  Fractional Kelly Criterion based on overall win rate.
                Only use after 50+ trades.
        """
        risk_distance = abs(entry_price - stop_loss_price)
        risk_distance_pct = risk_distance / entry_price * 100 if entry_price else 0.5
        if risk_distance_pct <= 0:
            risk_distance_pct = 0.5  # defensive fallback

        base_size = risk_per_trade_pct / risk_distance_pct
        capital = total_capital or available_margin
        multiplier = 1.0
        mode_used = sizing_mode
        rationale = ""

        if sizing_mode == "FIXED":
            position_size_pct = base_size
            multiplier = 1.0
            rationale = f"FIXED mode: {risk_per_trade_pct}% risk target"

        elif sizing_mode == "DYNAMIC":
            if setup_score >= 8.5:
                multiplier = 1.5
            elif setup_score >= 7.5:
                multiplier = 1.25
            elif setup_score >= 6.5:
                multiplier = 1.0
            elif setup_score >= 6.0:
                multiplier = 0.75
            else:
                multiplier = 0.5

            position_size_pct = base_size * multiplier
            rationale = f"DYNAMIC mode: score {setup_score:.1f} → {multiplier}x multiplier"

        elif sizing_mode == "EDGE":
            if edge_factor is not None:
                # Use passed edge_factor (win rate) to set multiplier for testing/override
                if edge_factor > 0.65:
                    multiplier = 1.5
                elif edge_factor > 0.55:
                    multiplier = 1.25
                elif edge_factor > 0.45:
                    multiplier = 1.0
                elif edge_factor > 0.35:
                    multiplier = 0.75
                else:
                    multiplier = 0.5
                position_size_pct = base_size * multiplier
                rationale = f"EDGE mode (using edge_factor={edge_factor:.3f}) → {multiplier}x multiplier"
            else:
                # Scale with measured historical edge per pattern
                edge_data = await self._get_pattern_edge_stats(pattern_type, session, instrument)

                if edge_data is None or edge_data["sample_size"] < 30:
                    # Insufficient history — fall back to FIXED
                    position_size_pct = base_size
                    multiplier = 1.0
                    sample = edge_data["sample_size"] if edge_data else 0
                    rationale = (
                        f"EDGE mode → FIXED fallback: "
                        f"insufficient history for {pattern_type} "
                        f"(n={sample}, need 30+)"
                    )
                else:
                    expectancy = edge_data["expectancy"]
                    win_rate = edge_data["win_rate_pct"] / 100

                    if expectancy > 0.5 and win_rate > 0.65:
                        multiplier = 1.5   # Strong edge
                    elif expectancy > 0.3 and win_rate > 0.55:
                        multiplier = 1.25  # Good edge
                    elif expectancy > 0.1 and win_rate > 0.45:
                        multiplier = 1.0   # Acceptable edge
                    elif expectancy > 0:
                        multiplier = 0.75  # Weak positive edge
                    else:
                        multiplier = 0.0   # Negative expectancy — skip
                        logger.warning(
                            "EDGE mode: negative expectancy for {} ({:.3f}) — sizing to 0, skipping",
                            pattern_type, expectancy
                        )

                    position_size_pct = base_size * multiplier
                    rationale = (
                        f"EDGE mode: {pattern_type} in {session} — "
                        f"win rate {win_rate*100:.0f}%, expectancy {expectancy:.3f} "
                        f"(n={edge_data['sample_size']}) → {multiplier}x multiplier"
                    )

        elif sizing_mode == "KELLY":
            # Fractional Kelly — needs overall win rate history
            overall_stats = await self._get_overall_stats()

            if overall_stats["total_trades"] < 50:
                # Fall back to FIXED
                position_size_pct = base_size
                multiplier = 1.0
                mode_used = "FIXED"
                rationale = f"KELLY → FIXED fallback: need 50 trades, have {overall_stats['total_trades']}"
            else:
                win_rate = overall_stats["win_rate"]
                avg_rr = overall_stats["avg_rr_achieved"]

                # Kelly formula: win_rate - ((1 - win_rate) / avg_rr)
                kelly_pct = win_rate - ((1 - win_rate) / avg_rr) if avg_rr > 0 else 0
                fractional_kelly = kelly_pct * 0.25  # 25% of Kelly for safety

                # kelly percentage of capital
                position_size_pct = max(fractional_kelly * 100, 0.0)
                multiplier = fractional_kelly * 100 / base_size if base_size else 1.0
                rationale = (
                    f"KELLY mode: win={win_rate:.0%}, avg_rr={avg_rr:.2f} → "
                    f"Kelly={kelly_pct:.3f}, fractional={fractional_kelly:.3f} (size={position_size_pct:.2f}%)"
                )

        else:
            # Unknown mode — use FIXED
            position_size_pct = base_size
            multiplier = 1.0
            rationale = f"Unknown mode {sizing_mode} → FIXED"

        final_size = round(min(position_size_pct, max_position_size_pct), 2)
        risk_amount_inr = capital * final_size / 100
        contracts = max(1, int(risk_amount_inr / (entry_price * risk_distance_pct / 100))) if entry_price and risk_distance_pct else 1

        detail = (
            f"{sizing_mode}: risk {risk_per_trade_pct}% of ₹{capital:,.0f} = ₹{risk_amount_inr:,.0f} | "
            f"SL distance {risk_distance_pct:.2f}% → base size {base_size:.2f}% | "
            f"multiplier {multiplier:.2f}x → final {final_size}% "
            f"(cap {max_position_size_pct}%) | {rationale}"
        )
        logger.info("Position sizing: {}", detail)
        return {
            "position_size_pct": final_size,
            "risk_amount_inr": round(risk_amount_inr, 2),
            "contracts": contracts,
            "sizing_mode_used": mode_used,
            "multiplier_applied": round(multiplier, 2),
            "calculation_detail": detail,
            "rationale": rationale,
        }

    async def _get_pattern_edge_stats(self, pattern_type: str, session: str, instrument: str) -> dict | None:
        """Fetch pattern stats from pattern_outcomes table."""
        from sqlalchemy import text
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(text("""
                    SELECT
                        COUNT(*) as sample_size,
                        COALESCE(AVG(CASE WHEN outcome='win' THEN 1.0 ELSE 0.0 END)*100, 0.0) as win_rate_pct,
                        COALESCE(AVG(rr_achieved), 0.0) as avg_rr,
                        COALESCE(AVG(rr_achieved) * AVG(CASE WHEN outcome='win' THEN 1.0 ELSE 0.0 END)
                        - (1.0 - AVG(CASE WHEN outcome='win' THEN 1.0 ELSE 0.0 END)), 0.0) as expectancy
                    FROM pattern_outcomes
                    WHERE pattern_type = :pattern_type AND session = :session AND instrument = :instrument
                """), {"pattern_type": pattern_type, "session": session, "instrument": instrument})
                
                row = result.fetchone()
                if row and row[0] >= 1:
                    return {
                        "sample_size": row[0],
                        "win_rate_pct": float(row[1]),
                        "avg_rr": float(row[2]),
                        "expectancy": float(row[3])
                    }
                return None
        except Exception:
            logger.exception("Failed to get pattern edge stats")
            return None

    async def _get_overall_stats(self) -> dict:
        """Fetch overall stats for Kelly sizing."""
        from sqlalchemy import text
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(text("""
                    SELECT
                        COUNT(*) as total_trades,
                        COALESCE(AVG(CASE WHEN pnl_pct > 0 THEN 1.0 ELSE 0.0 END), 0.0) as win_rate,
                        COALESCE(AVG(CASE WHEN pnl_pct > 0 THEN pnl_pct ELSE NULL END), 1.0) /
                        COALESCE(ABS(AVG(CASE WHEN pnl_pct <= 0 THEN pnl_pct ELSE NULL END)), 1.0) as avg_rr_achieved
                    FROM trades
                    WHERE status = 'closed' AND pnl_pct IS NOT NULL
                """))
                row = result.fetchone()
                if row:
                    return {
                        "total_trades": row[0],
                        "win_rate": float(row[1]),
                        "avg_rr_achieved": float(row[2])
                    }
                return {"total_trades": 0, "win_rate": 0.0, "avg_rr_achieved": 1.5}
        except Exception:
            logger.exception("Failed to get overall stats")
            return {"total_trades": 0, "win_rate": 0.0, "avg_rr_achieved": 1.5}

    async def get_pattern_edge(self, pattern_type: str) -> float | None:
        """Return historical win rate for a given pattern_type from closed trades.

        Returns None if fewer than 5 samples exist (not enough data to trust).
        Called before calculate_position_size when sizing_mode == 'EDGE'.
        """
        try:
            from sqlalchemy import text
            from backend.db.database import AsyncSessionLocal
            async with AsyncSessionLocal() as db:
                row = await db.execute(text("""
                    SELECT
                        COUNT(*) AS total,
                        SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) AS wins
                    FROM trades
                    WHERE status = 'closed'
                      AND trigger_event_type = :pattern_type
                """), {"pattern_type": pattern_type})
                rec = row.fetchone()
                if rec and rec.total >= 5:
                    return round(rec.wins / rec.total, 3)
                return None
        except Exception:
            logger.exception("get_pattern_edge failed for {}", pattern_type)
            return None



risk_manager = RiskProfileManager()
