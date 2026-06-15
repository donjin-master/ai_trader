"""Market regime detector — classifies the current market state and routes
to the appropriate trading pipeline (directional vs options)."""

from __future__ import annotations

import statistics
from typing import Any

from loguru import logger


VALID_REGIMES = ("TRENDING_UP", "TRENDING_DOWN", "RANGING", "BREAKOUT_IMMINENT", "UNCLEAR")
VALID_PIPELINES = ("DIRECTIONAL", "OPTIONS", "BOTH", "WAIT")


class MarketRegimeDetector:
    """Classify the market regime from candle data and market context.

    detect() returns a dict with:
      regime     : one of TRENDING_UP | TRENDING_DOWN | RANGING | BREAKOUT_IMMINENT | UNCLEAR
      pipeline   : DIRECTIONAL | OPTIONS | BOTH | WAIT
      confidence : 1–10
      reasoning  : str
      key_metrics: dict
    """

    # EMA periods
    SHORT_EMA = 20
    LONG_EMA  = 50

    # ADX threshold for trending (higher = stronger trend)
    ADX_TREND_THRESHOLD = 25.0

    def detect(
        self,
        candles_4h: list[dict],
        candles_1h: list[dict],
        iv_percentile: float = 50.0,
        funding_rate: float = 0.0,
    ) -> dict[str, Any]:
        """Detect current market regime and return routing decision."""

        if len(candles_4h) < 20 or len(candles_1h) < 20:
            return self._result("UNCLEAR", "WAIT", 3, "Insufficient candle data", {})

        # ── 4H trend direction via EMA slope ─────────────────────────────────
        closes_4h = [float(c.get("close", c.get("c", 0))) for c in candles_4h]
        ema_short = self._ema(closes_4h, self.SHORT_EMA)
        ema_long  = self._ema(closes_4h, self.LONG_EMA)

        current_price = closes_4h[-1]
        ema_short_val = ema_short[-1] if ema_short else current_price
        ema_long_val  = ema_long[-1]  if ema_long  else current_price

        # Slope of long EMA over last 5 candles
        ema_slope_pct = 0.0
        if len(ema_long) >= 5:
            ema_slope_pct = (ema_long[-1] - ema_long[-5]) / ema_long[-5] * 100

        # ── ATR-based volatility (14 periods) ────────────────────────────────
        atr = self._atr(candles_1h[-20:])
        atr_pct = (atr / current_price * 100) if current_price else 0

        # ── 1H structure: higher highs/lower lows over last 20 candles ───────
        highs_1h = [float(c.get("high", c.get("h", 0))) for c in candles_1h[-20:]]
        lows_1h  = [float(c.get("low",  c.get("l", 0))) for c in candles_1h[-20:]]

        hh = highs_1h[-1] > max(highs_1h[:-1]) if len(highs_1h) > 1 else False
        ll = lows_1h[-1]  < min(lows_1h[:-1])  if len(lows_1h)  > 1 else False

        # ── Simple range detection: price within X% band for last 20 1H bars ─
        price_range_pct = (max(highs_1h) - min(lows_1h)) / current_price * 100 if current_price else 0
        is_ranging = price_range_pct < 3.0  # Less than 3% range over 20 1H bars

        # ── Breakout imminent: tight range + increasing volume/OI pressure ───
        closes_1h_recent = [float(c.get("close", c.get("c", 0))) for c in candles_1h[-10:]]
        recent_std_pct   = (statistics.stdev(closes_1h_recent) / current_price * 100) if len(closes_1h_recent) > 1 and current_price else 0
        breakout_imminent = is_ranging and recent_std_pct < 0.5 and atr_pct > 0.3

        key_metrics = {
            "ema_short": round(ema_short_val, 2),
            "ema_long": round(ema_long_val, 2),
            "ema_slope_pct_4h": round(ema_slope_pct, 3),
            "atr_pct_1h": round(atr_pct, 3),
            "price_range_pct_1h": round(price_range_pct, 2),
            "recent_std_pct_1h": round(recent_std_pct, 3),
            "iv_percentile": iv_percentile,
            "funding_rate": funding_rate,
        }

        # ── Classify ──────────────────────────────────────────────────────────
        if breakout_imminent:
            confidence = 6
            reasoning = f"Price coiling in tight range ({recent_std_pct:.2f}% std) with ATR expansion. Breakout likely."
            pipeline = "BOTH"
            return self._result("BREAKOUT_IMMINENT", pipeline, confidence, reasoning, key_metrics)

        if is_ranging:
            confidence = min(9, max(4, int(8 - price_range_pct)))
            if iv_percentile > 60:
                pipeline = "OPTIONS"
                reasoning = f"Ranging market ({price_range_pct:.1f}% range) + high IV ({iv_percentile:.0f}th percentile). Sell premium."
            elif iv_percentile < 30:
                pipeline = "WAIT"
                reasoning = f"Ranging market but IV too low ({iv_percentile:.0f}th percentile) for options premium. Wait."
            else:
                pipeline = "OPTIONS"
                reasoning = f"Ranging market ({price_range_pct:.1f}% range). IV neutral — options viable."
            return self._result("RANGING", pipeline, confidence, reasoning, key_metrics)

        # Trending
        if ema_slope_pct > 0.05 and ema_short_val > ema_long_val:
            confidence = min(9, max(5, int(5 + abs(ema_slope_pct) * 20)))
            reasoning = f"4H EMA bullish crossover. Slope +{ema_slope_pct:.3f}%. Higher highs: {hh}."
            return self._result("TRENDING_UP", "DIRECTIONAL", confidence, reasoning, key_metrics)

        if ema_slope_pct < -0.05 and ema_short_val < ema_long_val:
            confidence = min(9, max(5, int(5 + abs(ema_slope_pct) * 20)))
            reasoning = f"4H EMA bearish crossover. Slope {ema_slope_pct:.3f}%. Lower lows: {ll}."
            return self._result("TRENDING_DOWN", "DIRECTIONAL", confidence, reasoning, key_metrics)

        return self._result("UNCLEAR", "WAIT", 4, "No clear trend or range structure.", key_metrics)

    @staticmethod
    def _result(regime: str, pipeline: str, confidence: int, reasoning: str, metrics: dict) -> dict:
        return {
            "regime": regime,
            "pipeline": pipeline,
            "confidence": confidence,
            "reasoning": reasoning,
            "key_metrics": metrics,
        }

    @staticmethod
    def _ema(values: list[float], period: int) -> list[float]:
        if len(values) < period:
            return values[:]
        k = 2 / (period + 1)
        result = [sum(values[:period]) / period]
        for v in values[period:]:
            result.append(v * k + result[-1] * (1 - k))
        return result

    @staticmethod
    def _atr(candles: list[dict], period: int = 14) -> float:
        if not candles:
            return 0.0
        trs = []
        for i, c in enumerate(candles):
            h = float(c.get("high", c.get("h", 0)))
            l = float(c.get("low",  c.get("l", 0)))
            prev_close = float(candles[i - 1].get("close", c.get("c", l))) if i > 0 else l
            trs.append(max(h - l, abs(h - prev_close), abs(l - prev_close)))
        return sum(trs[-period:]) / min(len(trs), period) if trs else 0.0
