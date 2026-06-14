"""Scenario Lab — test hypothetical rules and strategies on real data.

Mode 1: Rule backtester  — apply a rule to the user's actual trade history.
Mode 2: Market replay    — run the SMC engine over a historical window and
                           report the setups/decisions it would have flagged.
Mode 3: Strategy sim     — replay with a config (score threshold, timeframe,
                           interval) and simulate SL/TP outcomes per signal.

Replay uses the deterministic SMC engine (no LLM calls) so a month of replay
costs nothing — the boardroom's hard gates (score, alignment) are what is
being simulated.
"""

import json
from datetime import datetime, timedelta, timezone

import pandas as pd
from loguru import logger
from sqlalchemy import select

from backend.db.database import AsyncSessionLocal
from backend.db.models import UserTrade
from backend.deps import delta_client

IST = timezone(timedelta(hours=5, minutes=30))

PREBUILT_RULES = {
    "no_morning": "No trades before 11:30am IST",
    "max_2_per_day": "Max 2 trades per day",
    "no_mondays": "Skip trades on Mondays",
    "no_weekend": "Skip trades on Saturday and Sunday",
    "cooldown_2h": "No trades within 2h of a losing trade",
    "longs_only": "Only long trades",
    "shorts_only": "Only short trades",
}

# Rule spec schema (what custom rules are translated to):
# {"min_hour_ist": int|null, "max_hour_ist": int|null, "skip_days": [0-6],
#  "max_trades_per_day": int|null, "cooldown_after_loss_mins": int|null,
#  "allowed_instruments": [..]|null, "blocked_instruments": [..]|null,
#  "allowed_directions": ["long","short"]|null}

_PREBUILT_SPECS: dict[str, dict] = {
    "no_morning": {"min_hour_ist": 11},
    "max_2_per_day": {"max_trades_per_day": 2},
    "no_mondays": {"skip_days": [0]},
    "no_weekend": {"skip_days": [5, 6]},
    "cooldown_2h": {"cooldown_after_loss_mins": 120},
    "longs_only": {"allowed_directions": ["long"]},
    "shorts_only": {"allowed_directions": ["short"]},
}


async def _interpret_custom_rule(rule_text: str) -> dict:
    """Sonnet translates a plain-text rule into the filter spec."""
    from backend.ai.agents import _call_anthropic, _strip_json_fences

    system = (
        "Translate the trading rule into JSON with ONLY these keys (null when "
        "not applicable): min_hour_ist, max_hour_ist, skip_days (0=Mon..6=Sun), "
        "max_trades_per_day, cooldown_after_loss_mins, allowed_instruments, "
        "blocked_instruments, allowed_directions. Respond ONLY with the JSON."
    )
    raw = await _call_anthropic("claude-sonnet-4-6", system, f"Rule: {rule_text}")
    return json.loads(_strip_json_fences(raw))


def _apply_rule_spec(df: pd.DataFrame, spec: dict) -> pd.Series:
    """Boolean mask of trades KEPT under the rule."""
    keep = pd.Series(True, index=df.index)
    if spec.get("min_hour_ist") is not None:
        keep &= df["hour"] >= int(spec["min_hour_ist"])
    if spec.get("max_hour_ist") is not None:
        keep &= df["hour"] <= int(spec["max_hour_ist"])
    if spec.get("skip_days"):
        keep &= ~df["day_of_week"].isin([int(d) for d in spec["skip_days"]])
    if spec.get("allowed_instruments"):
        keep &= df["instrument"].isin(spec["allowed_instruments"])
    if spec.get("blocked_instruments"):
        keep &= ~df["instrument"].isin(spec["blocked_instruments"])
    if spec.get("allowed_directions"):
        keep &= df["direction"].isin(spec["allowed_directions"])

    ordered = df.sort_values("exit_time")
    if spec.get("max_trades_per_day") is not None:
        limit = int(spec["max_trades_per_day"])
        date = pd.to_datetime(ordered["exit_time"]).dt.tz_convert(IST).dt.date
        rank = ordered.groupby(date).cumcount()
        keep &= pd.Series(rank < limit, index=ordered.index).reindex(df.index, fill_value=True)
    if spec.get("cooldown_after_loss_mins") is not None:
        cooldown = timedelta(minutes=int(spec["cooldown_after_loss_mins"]))
        last_loss_time = None
        drop_ids = []
        for idx, row in ordered.iterrows():
            t = row["exit_time"]
            if last_loss_time is not None and t - last_loss_time < cooldown:
                drop_ids.append(idx)
            if row["pnl_inr"] < 0:
                last_loss_time = t
        keep &= ~df.index.isin(drop_ids)
    return keep


async def backtest_rule(rule: str, date_from: str | None = None, date_to: str | None = None) -> dict:
    """Mode 1 — apply a rule to user_trades and compare P&L."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(UserTrade))
        rows = result.scalars().all()
    if not rows:
        return {"error": "no imported trades — run /api/dna/import first"}

    df = pd.DataFrame([{
        "instrument": r.instrument, "direction": r.direction,
        "pnl_inr": float(r.pnl_inr or 0), "hour": r.hour_of_entry,
        "day_of_week": r.day_of_week, "exit_time": r.exit_time,
    } for r in rows]).dropna(subset=["exit_time"])

    if date_from:
        df = df[df["exit_time"] >= pd.to_datetime(date_from, utc=True)]
    if date_to:
        df = df[df["exit_time"] <= pd.to_datetime(date_to, utc=True)]
    if df.empty:
        return {"error": "no trades in the selected date range"}

    spec = _PREBUILT_SPECS.get(rule)
    interpreted = None
    if spec is None:
        interpreted = await _interpret_custom_rule(rule)
        spec = interpreted

    keep = _apply_rule_spec(df, spec)
    kept, removed = df[keep], df[~keep]

    def stats(frame: pd.DataFrame) -> dict:
        return {
            "trades": int(len(frame)),
            "pnl_inr": round(frame["pnl_inr"].sum(), 2),
            "win_rate": round((frame["pnl_inr"] > 0).mean() * 100, 1) if len(frame) else 0,
        }

    ordered = df.sort_values("exit_time")
    original_curve = ordered["pnl_inr"].cumsum().round(2).tolist()
    rule_curve = ordered.assign(p=ordered["pnl_inr"].where(keep, 0))["p"].cumsum().round(2).tolist()
    dates = pd.to_datetime(ordered["exit_time"]).dt.tz_convert(IST).dt.strftime("%d %b").tolist()

    original, applied = stats(df), stats(kept)
    return {
        "rule": rule,
        "rule_spec": spec,
        "interpreted_by_ai": interpreted is not None,
        "original": original,
        "with_rule": applied,
        "trades_removed": int(len(removed)),
        "removed_pnl_inr": round(removed["pnl_inr"].sum(), 2),
        "win_rate_change": round(applied["win_rate"] - original["win_rate"], 1),
        "pnl_improvement_inr": round(applied["pnl_inr"] - original["pnl_inr"], 2),
        "curve": {"dates": dates, "original": original_curve, "with_rule": rule_curve},
    }


# ---------------------------------------------------------------------------
# Mode 2 + 3 — historical replay through the SMC engine
# ---------------------------------------------------------------------------

async def _replay_signals(
    instrument: str,
    date_from: str,
    date_to: str,
    min_setup_score: float,
    scan_interval_minutes: int = 60,
    timeframe: str = "15",
) -> list[dict]:
    """Walk the window; at each step run SMC structure on data up to that point."""
    from backend.perception.smc import smc_analyser

    start = int(pd.to_datetime(date_from, utc=True).timestamp())
    end = int(pd.to_datetime(date_to, utc=True).timestamp())
    signals: list[dict] = []
    step = scan_interval_minutes * 60
    ts = start

    while ts <= end:
        try:
            candles_15 = await delta_client.get_candles(instrument, timeframe, 100, end=ts)
            candles_1h = await delta_client.get_candles(instrument, "60", 100, end=ts)
            candles_4h = await delta_client.get_candles(instrument, "240", 100, end=ts)
            if len(candles_15) < 30:
                ts += step
                continue
            df15 = smc_analyser._prepare_df(candles_15)
            df1h = smc_analyser._prepare_df(candles_1h)
            df4h = smc_analyser._prepare_df(candles_4h)
            s15 = smc_analyser.detect_market_structure(df15)
            s1h = smc_analyser.detect_market_structure(df1h)
            s4h = smc_analyser.detect_market_structure(df4h)
            obs = smc_analyser.detect_order_blocks(df15, s15)
            fvgs = smc_analyser.detect_fvg(df15)
            liq = smc_analyser.detect_liquidity(df1h)
            pdz = smc_analyser.calculate_premium_discount(df1h, s1h)
            ind = smc_analyser.detect_inducement(df15, s15)
            score, found, _ = smc_analyser._confluences(
                s4h, s1h, s15, obs, fvgs, liq, pdz, ind, df15
            )
            direction = (
                "long" if s4h["trend"] == "BULLISH"
                else "short" if s4h["trend"] == "BEARISH" else None
            )
            price = float(df15["close"].iloc[-1])
            if direction and score >= min_setup_score:
                signals.append({
                    "time": datetime.fromtimestamp(ts, tz=IST).strftime("%d %b %H:%M"),
                    "ts": ts,
                    "direction": direction,
                    "score": round(score, 1),
                    "price": price,
                    "confluences": found[:4],
                })
        except Exception as exc:
            logger.warning("Replay step failed at {}: {}", ts, exc)
        ts += step
    return signals


async def _simulate_outcomes(
    instrument: str, signals: list[dict], sl_pct: float = 0.5, rr: float = 3.0
) -> list[dict]:
    """For each signal: entry at signal price, which hits first — SL or TP?"""
    results = []
    for sig in signals:
        try:
            future = await delta_client.get_candles(
                instrument, "15", 96, end=sig["ts"] + 96 * 900
            )
            future = [c for c in future if c["time"] > sig["ts"]]
            entry = sig["price"]
            if sig["direction"] == "long":
                sl, tp = entry * (1 - sl_pct / 100), entry * (1 + sl_pct * rr / 100)
            else:
                sl, tp = entry * (1 + sl_pct / 100), entry * (1 - sl_pct * rr / 100)
            outcome, exit_price = "open", entry
            for c in future:
                lo, hi = float(c["low"]), float(c["high"])
                if sig["direction"] == "long":
                    if lo <= sl:
                        outcome, exit_price = "loss", sl
                        break
                    if hi >= tp:
                        outcome, exit_price = "win", tp
                        break
                else:
                    if hi >= sl:
                        outcome, exit_price = "loss", sl
                        break
                    if lo <= tp:
                        outcome, exit_price = "win", tp
                        break
            r_multiple = rr if outcome == "win" else -1.0 if outcome == "loss" else 0.0
            results.append({**sig, "outcome": outcome, "exit_price": round(exit_price, 1),
                            "r_multiple": r_multiple})
        except Exception as exc:
            logger.warning("Outcome sim failed for signal {}: {}", sig["time"], exc)
    return results


async def replay_market(instrument: str, date_from: str, date_to: str,
                        min_setup_score: float = 7.0) -> dict:
    """Mode 2 — what would the engine have flagged in this window?"""
    signals = await _replay_signals(instrument, date_from, date_to, min_setup_score)
    outcomes = await _simulate_outcomes(instrument, signals)
    wins = sum(1 for o in outcomes if o["outcome"] == "win")
    losses = sum(1 for o in outcomes if o["outcome"] == "loss")
    return {
        "instrument": instrument,
        "window": {"from": date_from, "to": date_to},
        "min_setup_score": min_setup_score,
        "signals_found": len(signals),
        "wins": wins,
        "losses": losses,
        "open_or_undecided": len(outcomes) - wins - losses,
        "total_r": round(sum(o["r_multiple"] for o in outcomes), 1),
        "decisions": outcomes,
        "note": "Deterministic SMC replay (no LLM) — boardroom gates simulated via setup score.",
    }


async def simulate_strategy(config: dict, date_from: str, date_to: str) -> dict:
    """Mode 3 — replay with custom config and simulate P&L vs risk profile."""
    from backend.execution.risk_profile import risk_manager

    profile = await risk_manager.get_profile()
    instrument = config.get("instrument", "BTCUSD")
    min_score = float(config.get("min_setup_score", profile["min_setup_score"]))
    interval = int(config.get("scan_interval_minutes", 60))
    rr = float(config.get("rr", max(3.0, profile["min_rr_ratio"])))
    sl_pct = float(config.get("sl_pct", 0.5))
    risk_per_trade = float(config.get("risk_per_trade_pct", profile["risk_per_trade_pct"]))
    capital = profile["total_capital"]

    signals = await _replay_signals(instrument, date_from, date_to, min_score, interval)
    outcomes = await _simulate_outcomes(instrument, signals, sl_pct, rr)
    risk_inr = capital * risk_per_trade / 100
    pnl = sum(o["r_multiple"] * risk_inr for o in outcomes)
    wins = sum(1 for o in outcomes if o["outcome"] == "win")
    decided = [o for o in outcomes if o["outcome"] in ("win", "loss")]
    return {
        "config": {"instrument": instrument, "min_setup_score": min_score,
                   "scan_interval_minutes": interval, "rr": rr, "sl_pct": sl_pct,
                   "risk_per_trade_pct": risk_per_trade},
        "window": {"from": date_from, "to": date_to},
        "trades_taken": len(decided),
        "win_rate": round(wins / len(decided) * 100, 1) if decided else None,
        "simulated_pnl_inr": round(pnl, 2),
        "total_r": round(sum(o["r_multiple"] for o in outcomes), 1),
        "decisions": outcomes,
    }
