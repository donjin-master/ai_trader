"""Stress Test — apply adverse shocks to a completed SMC backtest's trade list.

Runs the (network-heavy) candle backtest exactly once, then re-derives stats
under three deterministic shock scenarios from the same trade list — no
extra candle fetches.
"""

import copy

from backend.backtest.smc_backtester import SMCBacktester


def _build_equity_curve(trades: list[dict], starting_capital: float) -> list[dict]:
    if not trades:
        return []
    capital = starting_capital
    curve = [{"date": trades[0]["entry_time"], "equity": round(capital, 2)}]
    for t in trades:
        capital += t["pnl_inr"]
        curve.append({"date": t["exit_time"], "equity": round(capital, 2)})
    return curve


async def run_stress_test(
    instrument: str,
    timeframe: str,
    date_from: str,
    date_to: str,
    min_setup_score: float = 7.0,
    min_rr: float = 3.0,
    risk_per_trade_pct: float = 1.0,
    starting_capital: float = 50000,
) -> dict:
    backtester = SMCBacktester()
    base_result = await backtester.run(
        instrument=instrument,
        timeframe=timeframe,
        date_from=date_from,
        date_to=date_to,
        min_setup_score=min_setup_score,
        min_rr=min_rr,
        risk_per_trade_pct=risk_per_trade_pct,
        starting_capital=starting_capital,
    )
    base_trades = base_result["trades"]
    if not base_trades:
        return {"error": "no trades in selected window — widen the date range or lower min_setup_score"}

    scenarios: dict[str, dict] = {}

    # 1. Added slippage — every trade loses an extra 0.1R to entry/exit slippage
    slip_trades = copy.deepcopy(base_trades)
    for t in slip_trades:
        t["rr_achieved"] = round(t["rr_achieved"] - 0.1, 3)
        t["pnl_pct"] = round(risk_per_trade_pct * t["rr_achieved"], 3)
        t["pnl_inr"] = round(starting_capital * (risk_per_trade_pct / 100) * t["rr_achieved"], 2)
    scenarios["added_slippage"] = backtester._compute_stats(
        slip_trades, starting_capital, _build_equity_curve(slip_trades, starting_capital)
    )

    # 2. Win-rate shock — flip the weakest 20% of winning trades into losses
    shock_trades = copy.deepcopy(base_trades)
    wins_sorted = sorted((t for t in shock_trades if t["rr_achieved"] > 0), key=lambda t: t["rr_achieved"])
    flip_count = max(1, round(len(wins_sorted) * 0.2)) if wins_sorted else 0
    flip_ids = {id(t) for t in wins_sorted[:flip_count]}
    for t in shock_trades:
        if id(t) in flip_ids:
            t["rr_achieved"] = -1.0
            t["pnl_pct"] = round(-risk_per_trade_pct, 3)
            t["pnl_inr"] = round(-starting_capital * (risk_per_trade_pct / 100), 2)
    scenarios["win_rate_shock"] = backtester._compute_stats(
        shock_trades, starting_capital, _build_equity_curve(shock_trades, starting_capital)
    )

    # 3. Doubled risk — same R outcomes, double the capital staked per trade
    risk_trades = copy.deepcopy(base_trades)
    for t in risk_trades:
        t["pnl_pct"] = round(risk_per_trade_pct * 2 * t["rr_achieved"], 3)
        t["pnl_inr"] = round(starting_capital * (risk_per_trade_pct * 2 / 100) * t["rr_achieved"], 2)
    scenarios["doubled_risk"] = backtester._compute_stats(
        risk_trades, starting_capital, _build_equity_curve(risk_trades, starting_capital)
    )

    return {
        "instrument": instrument,
        "timeframe": timeframe,
        "window": {"from": date_from, "to": date_to},
        "base": base_result["stats"],
        "scenarios": scenarios,
        "disclaimer": (
            "Shocks are applied post-hoc to the base backtest's trade list — they "
            "approximate adverse conditions, not a fresh simulation."
        ),
    }
