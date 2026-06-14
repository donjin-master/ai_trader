"""Automated SMC strategy backtester."""

from __future__ import annotations

from datetime import datetime, timezone
from statistics import mean, pstdev

from backend.deps import delta_client, to_delta_symbol
from backend.perception.smc import smc_analyser

TIMEFRAME_RESOLUTIONS = {
    "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30",
    "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720",
    "1D": "1440", "1W": "10080",
}


class SMCBacktester:
    async def run(
        self,
        instrument: str,
        timeframe: str,
        date_from: str,
        date_to: str,
        min_setup_score: float = 7.0,
        min_rr: float = 3.0,
        risk_per_trade_pct: float = 1.0,
        starting_capital: float = 50000,
        train_end: str | None = None,
    ) -> dict:
        candles = await self._fetch_all_candles(instrument, timeframe, date_from, date_to)
        setups = self._slide_window(candles)
        trades = []
        capital = starting_capital
        equity_curve = [{"date": date_from, "equity": round(capital, 2), "period": "train"}]
        for setup in setups:
            analysis = setup["analysis"]
            score = float((analysis.get("raw_score_pre_boardroom") or {}).get("score") or 0)
            if score < min_setup_score:
                continue
            trade = self._build_setup_trade(setup, candles, min_rr)
            if trade is None:
                continue
            result = self._simulate_trade(trade, candles[setup["index"] + 1 :], risk_per_trade_pct, capital)
            capital += result["pnl_inr"]
            result["setup_score"] = score
            
            period = "train"
            if train_end and result["exit_time"] > train_end:
                period = "test"
            result["period"] = period
            
            trades.append(result)
            equity_curve.append({"date": result["exit_time"], "equity": round(capital, 2), "period": period})
            
        train_trades = [t for t in trades if t["period"] == "train"]
        test_trades = [t for t in trades if t["period"] == "test"]
        
        train_curve = [pt for pt in equity_curve if pt["period"] == "train"]
        test_curve = []
        if train_curve:
            test_curve = [train_curve[-1]] + [pt for pt in equity_curve if pt["period"] == "test"]
        
        stats = self._compute_stats(trades, starting_capital, equity_curve)
        
        train_stats = None
        test_stats = None
        
        if train_end:
            train_stats = self._compute_stats(train_trades, starting_capital, train_curve)
            test_start_cap = train_curve[-1]["equity"] if train_curve else starting_capital
            test_stats = self._compute_stats(test_trades, test_start_cap, test_curve)
            
        return {
            "instrument": instrument,
            "timeframe": timeframe,
            "date_from": date_from,
            "date_to": date_to,
            "train_end": train_end,
            "trades": trades,
            "stats": stats,
            "train_stats": train_stats,
            "test_stats": test_stats,
            "disclaimer": "These results reflect Python SMC pattern detection, not manual chart reading with trader discretion.",
        }

    async def _fetch_all_candles(
        self, instrument: str, timeframe: str, date_from: str, date_to: str
    ) -> list[dict]:
        resolution = TIMEFRAME_RESOLUTIONS.get(timeframe)
        if resolution is None:
            raise ValueError(f"unsupported timeframe: {timeframe}")
        end = int(datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc).timestamp())
        start = int(datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc).timestamp())
        minutes = int(resolution)
        approx_count = max(100, min(5000, int((end - start) / (minutes * 60)) + 50))
        # Delta client exposes count/end pagination. For V1.3 ranges, fetch in batches backward.
        all_candles: list[dict] = []
        cursor = end
        while cursor > start and len(all_candles) < approx_count:
            batch = await delta_client.get_candles(to_delta_symbol(instrument), resolution, 500, end=cursor)
            if not batch:
                break
            all_candles = batch + all_candles
            cursor = int(batch[0]["time"]) - 1
            if len(batch) < 500:
                break
        unique = {int(c["time"]): c for c in all_candles if start <= int(c["time"]) <= end}
        return [unique[t] for t in sorted(unique)]

    def _slide_window(self, all_candles: list, window_size: int = 100) -> list:
        setups = []
        for i in range(window_size, max(window_size, len(all_candles) - 20)):
            window = all_candles[i - window_size : i]
            analysis = smc_analyser.analyse_from_candles(window, "BACKTEST")
            score = float((analysis.get("raw_score_pre_boardroom") or {}).get("score") or 0)
            if score >= 5:
                setups.append({"index": i - 1, "analysis": analysis})
        return setups

    def _build_setup_trade(self, setup: dict, candles: list[dict], min_rr: float) -> dict | None:
        analysis = setup["analysis"]
        structure = analysis.get("structures", {}).get("15m", {})
        trend = structure.get("trend")
        if trend not in ("BULLISH", "BEARISH"):
            return None
        direction = "long" if trend == "BULLISH" else "short"
        entry = float(candles[setup["index"]]["close"])
        atr = self._atr(candles[max(0, setup["index"] - 20) : setup["index"] + 1])
        risk = atr or entry * 0.006
        sl = entry - risk if direction == "long" else entry + risk
        tp = entry + risk * min_rr if direction == "long" else entry - risk * min_rr
        return {
            "direction": direction,
            "entry_price": entry,
            "entry_time": self._iso(candles[setup["index"]]["time"]),
            "stop_loss": sl,
            "take_profit": tp,
            "risk": risk,
        }

    def _simulate_trade(self, setup: dict, candles_after_entry: list, risk_pct: float, capital: float) -> dict:
        direction = setup["direction"]
        entry = setup["entry_price"]
        sl = setup["stop_loss"]
        tp = setup["take_profit"]
        exit_price = candles_after_entry[-1]["close"] if candles_after_entry else entry
        exit_time = candles_after_entry[-1]["time"] if candles_after_entry else datetime.now().timestamp()
        exit_reason = "end_of_data"
        for idx, candle in enumerate(candles_after_entry[:96]):
            high = float(candle["high"])
            low = float(candle["low"])
            if direction == "long":
                if low <= sl:
                    exit_price, exit_time, exit_reason = sl, candle["time"], "stop_loss"
                    break
                if high >= tp:
                    exit_price, exit_time, exit_reason = tp, candle["time"], "take_profit"
                    break
            else:
                if high >= sl:
                    exit_price, exit_time, exit_reason = sl, candle["time"], "stop_loss"
                    break
                if low <= tp:
                    exit_price, exit_time, exit_reason = tp, candle["time"], "take_profit"
                    break
        rr = (exit_price - entry) / setup["risk"] if direction == "long" else (entry - exit_price) / setup["risk"]
        pnl_inr = capital * (risk_pct / 100) * rr
        return {
            **setup,
            "exit_price": round(float(exit_price), 2),
            "exit_time": self._iso(exit_time),
            "exit_reason": exit_reason,
            "pnl_pct": round(risk_pct * rr, 3),
            "pnl_inr": round(pnl_inr, 2),
            "rr_achieved": round(rr, 2),
        }

    def _compute_stats(self, trades: list, starting_capital: float, equity_curve: list) -> dict:
        wins = [t for t in trades if t["rr_achieved"] > 0]
        losses = [t for t in trades if t["rr_achieved"] < 0]
        returns = [t["pnl_pct"] for t in trades]
        peak = starting_capital
        max_dd = 0.0
        for point in equity_curve:
            peak = max(peak, point["equity"])
            max_dd = max(max_dd, (peak - point["equity"]) / peak * 100 if peak else 0)
        return {
            "total_trades": len(trades),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": round(len(wins) / len(trades) * 100, 1) if trades else 0,
            "avg_rr": round(mean([t["rr_achieved"] for t in trades]), 2) if trades else 0,
            "max_rr": round(max([t["rr_achieved"] for t in trades], default=0), 2),
            "avg_pnl_pct": round(mean(returns), 3) if returns else 0,
            "max_drawdown_pct": round(max_dd, 2),
            "sharpe_ratio": round(mean(returns) / (pstdev(returns) or 1), 2) if len(returns) > 1 else 0,
            "total_return_pct": round((equity_curve[-1]["equity"] - starting_capital) / starting_capital * 100, 2) if equity_curve else 0,
            "expectancy": round(mean([t["rr_achieved"] for t in trades]), 3) if trades else 0,
            "equity_curve": equity_curve,
        }

    def _atr(self, candles: list[dict]) -> float:
        if len(candles) < 2:
            return 0
        trs = []
        for prev, cur in zip(candles, candles[1:]):
            high = float(cur["high"])
            low = float(cur["low"])
            prev_close = float(prev["close"])
            trs.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
        return mean(trs[-14:]) if trs else 0

    def _iso(self, epoch: int | float | str) -> str:
        return datetime.fromtimestamp(int(epoch), timezone.utc).isoformat()
