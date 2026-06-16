"""Smart Money Concepts multi-timeframe analysis engine.

Detects: market structure, order blocks, FVGs, liquidity levels,
CHoCH, BOS, premium/discount zones, inducement. Produces rich text
context for the LLM boardroom plus a raw confluence score.

All indicators computed with pandas/numpy directly (no pandas-ta).
"""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any

import numpy as np
import pandas as pd
from loguru import logger

PIVOT_WINDOW = 2  # 5-candle pivot: 2 before + pivot + 2 after
EQUAL_LEVEL_TOLERANCE_PCT = 0.15
IST = timezone(timedelta(hours=5, minutes=30))


class SMCAnalyser:
    """Multi-timeframe SMC analysis engine."""

    TIMEFRAMES = {
        "4h": {"resolution": "240", "candles": 300, "label": "4 Hour"},
        "1h": {"resolution": "60", "candles": 300, "label": "1 Hour"},
        "15m": {"resolution": "15", "candles": 100, "label": "15 Minute"},
    }

    # ------------------------------------------------------------------
    # Data prep
    # ------------------------------------------------------------------

    def _prepare_df(self, candles: list[dict]) -> pd.DataFrame:
        df = pd.DataFrame(candles)
        for col in ("open", "high", "low", "close", "volume"):
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
        # ATR(14) computed manually
        prev_close = df["close"].shift(1)
        tr = pd.concat(
            [
                df["high"] - df["low"],
                (df["high"] - prev_close).abs(),
                (df["low"] - prev_close).abs(),
            ],
            axis=1,
        ).max(axis=1)
        df["atr"] = tr.rolling(14).mean()
        df["vol_avg"] = df["volume"].rolling(20).mean()
        return df

    # ------------------------------------------------------------------
    # Swings
    # ------------------------------------------------------------------

    def _find_swings(self, df: pd.DataFrame) -> tuple[list[dict], list[dict]]:
        highs: list[dict] = []
        lows: list[dict] = []
        n = len(df)
        for i in range(PIVOT_WINDOW, n - PIVOT_WINDOW):
            window_high = df["high"].iloc[i - PIVOT_WINDOW : i + PIVOT_WINDOW + 1]
            window_low = df["low"].iloc[i - PIVOT_WINDOW : i + PIVOT_WINDOW + 1]
            if df["high"].iloc[i] == window_high.max() and (window_high == df["high"].iloc[i]).sum() == 1:
                highs.append({"price": float(df["high"].iloc[i]), "index": i})
            if df["low"].iloc[i] == window_low.min() and (window_low == df["low"].iloc[i]).sum() == 1:
                lows.append({"price": float(df["low"].iloc[i]), "index": i})
        return highs, lows

    # ------------------------------------------------------------------
    # Market structure
    # ------------------------------------------------------------------

    def detect_market_structure(self, df: pd.DataFrame) -> dict:
        swing_highs, swing_lows = self._find_swings(df)
        n = len(df)
        last_idx = n - 1

        higher_highs = (
            len(swing_highs) >= 2 and swing_highs[-1]["price"] > swing_highs[-2]["price"]
        )
        higher_lows = (
            len(swing_lows) >= 2 and swing_lows[-1]["price"] > swing_lows[-2]["price"]
        )
        lower_highs = (
            len(swing_highs) >= 2 and swing_highs[-1]["price"] < swing_highs[-2]["price"]
        )
        lower_lows = (
            len(swing_lows) >= 2 and swing_lows[-1]["price"] < swing_lows[-2]["price"]
        )

        if higher_highs and higher_lows:
            trend = "BULLISH"
        elif lower_highs and lower_lows:
            trend = "BEARISH"
        elif higher_highs and not lower_lows:
            trend = "BULLISH"
        elif higher_lows and not lower_highs:
            trend = "BULLISH"
        elif lower_highs and not higher_lows:
            trend = "BEARISH"
        elif lower_lows and not higher_highs:
            trend = "BEARISH"
        else:
            trend = "RANGING"

        # BOS: latest close crossing the previous swing high/low
        last_bos = None
        for i in range(n - 1, max(n - 40, PIVOT_WINDOW), -1):
            close = float(df["close"].iloc[i])
            prior_highs = [s for s in swing_highs if s["index"] < i]
            prior_lows = [s for s in swing_lows if s["index"] < i]
            if prior_highs and close > prior_highs[-1]["price"]:
                last_bos = {"type": "BULLISH", "price": prior_highs[-1]["price"], "candles_ago": last_idx - i}
                break
            if prior_lows and close < prior_lows[-1]["price"]:
                last_bos = {"type": "BEARISH", "price": prior_lows[-1]["price"], "candles_ago": last_idx - i}
                break

        # CHoCH: close breaking structure against the prevailing trend
        last_choch = None
        for i in range(n - 1, max(n - 40, PIVOT_WINDOW), -1):
            close = float(df["close"].iloc[i])
            prior_highs = [s for s in swing_highs if s["index"] < i]
            prior_lows = [s for s in swing_lows if s["index"] < i]
            if trend == "BULLISH" and prior_lows and close < prior_lows[-1]["price"]:
                last_choch = {"type": "BEARISH", "price": prior_lows[-1]["price"], "candles_ago": last_idx - i}
                break
            if trend == "BEARISH" and prior_highs and close > prior_highs[-1]["price"]:
                last_choch = {"type": "BULLISH", "price": prior_highs[-1]["price"], "candles_ago": last_idx - i}
                break

        structure_intact = last_choch is None or (
            last_bos is not None and last_bos["candles_ago"] < last_choch["candles_ago"]
        )

        return {
            "trend": trend,
            "last_bos": last_bos,
            "last_choch": last_choch,
            "swing_highs": swing_highs[-5:],
            "swing_lows": swing_lows[-5:],
            "higher_highs": bool(higher_highs),
            "higher_lows": bool(higher_lows),
            "structure_intact": bool(structure_intact),
        }

    # ------------------------------------------------------------------
    # Order blocks
    # ------------------------------------------------------------------

    def detect_order_blocks(self, df: pd.DataFrame, structure: dict) -> list[dict]:
        obs: list[dict] = []
        n = len(df)
        last_idx = n - 1
        atr = df["atr"].iloc[-1] or (df["close"].iloc[-1] * 0.005)
        current_price = float(df["close"].iloc[-1])

        for i in range(2, n - 3):
            candle_bearish = df["close"].iloc[i] < df["open"].iloc[i]
            candle_bullish = df["close"].iloc[i] > df["open"].iloc[i]
            # Impulse over the next 3 candles
            impulse_up = float(df["close"].iloc[i + 3] - df["close"].iloc[i])
            impulse_down = -impulse_up

            ob = None
            if candle_bearish and impulse_up > 1.5 * atr:
                ob_type, strength = "BULLISH", "STRONG" if impulse_up > 2.5 * atr else "MODERATE"
                ob = (ob_type, strength)
            elif candle_bullish and impulse_down > 1.5 * atr:
                ob_type, strength = "BEARISH", "STRONG" if impulse_down > 2.5 * atr else "MODERATE"
                ob = (ob_type, strength)
            if ob is None:
                continue

            high = float(df["high"].iloc[i])
            low = float(df["low"].iloc[i])
            midpoint = (high + low) / 2
            # Mitigated when price has traded back through the 50% level afterwards
            later_lows = df["low"].iloc[i + 4 :]
            later_highs = df["high"].iloc[i + 4 :]
            if ob[0] == "BULLISH":
                mitigated = bool((later_lows <= midpoint).any())
            else:
                mitigated = bool((later_highs >= midpoint).any())

            obs.append({
                "type": ob[0],
                "high": high,
                "low": low,
                "midpoint": round(midpoint, 2),
                "candles_ago": last_idx - i,
                "mitigated": mitigated,
                "strength": ob[1],
            })

        result = []
        for direction in ("BULLISH", "BEARISH"):
            unmitigated = [o for o in obs if o["type"] == direction and not o["mitigated"]]
            result.extend(sorted(unmitigated, key=lambda o: o["candles_ago"])[:3])
        return result

    # ------------------------------------------------------------------
    # Fair value gaps
    # ------------------------------------------------------------------

    def detect_fvg(self, df: pd.DataFrame) -> list[dict]:
        fvgs: list[dict] = []
        n = len(df)
        last_idx = n - 1
        for i in range(2, n):
            h2, l2 = float(df["high"].iloc[i - 2]), float(df["low"].iloc[i - 2])
            h0, l0 = float(df["high"].iloc[i]), float(df["low"].iloc[i])
            price = float(df["close"].iloc[i])

            gap = None
            if h2 < l0:  # bullish FVG
                gap = {"type": "BULLISH", "top": l0, "bottom": h2}
            elif l2 > h0:  # bearish FVG
                gap = {"type": "BEARISH", "top": l2, "bottom": h0}
            if gap is None:
                continue

            later_lows = df["low"].iloc[i + 1 :]
            later_highs = df["high"].iloc[i + 1 :]
            if gap["type"] == "BULLISH":
                filled = bool((later_lows <= gap["bottom"]).any()) if len(later_lows) else False
                partially = bool((later_lows < gap["top"]).any()) if len(later_lows) else False
            else:
                filled = bool((later_highs >= gap["top"]).any()) if len(later_highs) else False
                partially = bool((later_highs > gap["bottom"]).any()) if len(later_highs) else False

            fvgs.append({
                "type": gap["type"],
                "top": gap["top"],
                "bottom": gap["bottom"],
                "midpoint": round((gap["top"] + gap["bottom"]) / 2, 2),
                "size_pct": round((gap["top"] - gap["bottom"]) / price * 100, 3),
                "candles_ago": last_idx - i,
                "filled": filled,
                "partially_filled": partially and not filled,
            })

        unfilled = [f for f in fvgs if not f["filled"]]
        return sorted(unfilled, key=lambda f: f["candles_ago"])[:5]

    # ------------------------------------------------------------------
    # Liquidity
    # ------------------------------------------------------------------

    def detect_liquidity(self, df: pd.DataFrame) -> dict:
        swing_highs, swing_lows = self._find_swings(df)
        current_price = float(df["close"].iloc[-1])
        last_idx = len(df) - 1

        def _cluster(levels: list[dict]) -> list[dict]:
            clusters: list[dict] = []
            for level in levels:
                placed = False
                for c in clusters:
                    if abs(level["price"] - c["price"]) / c["price"] * 100 <= EQUAL_LEVEL_TOLERANCE_PCT:
                        c["strength"] += 1
                        c["price"] = (c["price"] + level["price"]) / 2
                        placed = True
                        break
                if not placed:
                    clusters.append({"price": level["price"], "strength": 1})
            return clusters

        equal_highs = _cluster(swing_highs)
        equal_lows = _cluster(swing_lows)

        buy_side: list[dict] = []
        sell_side: list[dict] = []
        for c in equal_highs:
            if c["price"] > current_price:
                buy_side.append({
                    "price": round(c["price"], 2),
                    "type": "equal_highs",
                    "strength": c["strength"],
                    "distance_pct": round((c["price"] - current_price) / current_price * 100, 3),
                })
        for c in equal_lows:
            if c["price"] < current_price:
                sell_side.append({
                    "price": round(c["price"], 2),
                    "type": "equal_lows",
                    "strength": c["strength"],
                    "distance_pct": round((current_price - c["price"]) / current_price * 100, 3),
                })

        # Round numbers (nearest 500 / 1000 for BTC-scale prices)
        step = 500 if current_price > 10000 else 50
        above = (int(current_price / step) + 1) * step
        below = int(current_price / step) * step
        buy_side.append({
            "price": float(above), "type": "round_number", "strength": 1,
            "distance_pct": round((above - current_price) / current_price * 100, 3),
        })
        sell_side.append({
            "price": float(below), "type": "round_number", "strength": 1,
            "distance_pct": round((current_price - below) / current_price * 100, 3),
        })

        # Recent sweep: wick beyond an equal level then close back inside (last 10 candles)
        recent_sweep: dict = {"occurred": False, "type": None, "price": None, "candles_ago": None}
        for i in range(len(df) - 1, max(len(df) - 11, 0), -1):
            hi, lo, close = float(df["high"].iloc[i]), float(df["low"].iloc[i]), float(df["close"].iloc[i])
            for c in equal_highs:
                if hi > c["price"] and close < c["price"]:
                    recent_sweep = {
                        "occurred": True, "type": "BUY_SIDE_SWEPT",
                        "price": round(c["price"], 2), "candles_ago": last_idx - i,
                        "strength": c["strength"],
                    }
                    break
            if not recent_sweep["occurred"]:
                for c in equal_lows:
                    if lo < c["price"] and close > c["price"]:
                        recent_sweep = {
                            "occurred": True, "type": "SELL_SIDE_SWEPT",
                            "price": round(c["price"], 2), "candles_ago": last_idx - i,
                            "strength": c["strength"],
                        }
                        break
            if recent_sweep["occurred"]:
                break

        buy_side.sort(key=lambda x: x["distance_pct"])
        sell_side.sort(key=lambda x: x["distance_pct"])
        return {
            "buy_side_liquidity": buy_side[:6],
            "sell_side_liquidity": sell_side[:6],
            "recent_sweep": recent_sweep,
            "equal_highs": equal_highs,
            "equal_lows": equal_lows,
        }

    # ------------------------------------------------------------------
    # Premium / discount
    # ------------------------------------------------------------------

    def calculate_premium_discount(self, df: pd.DataFrame, structure: dict) -> dict:
        highs = structure.get("swing_highs") or []
        lows = structure.get("swing_lows") or []
        if highs and lows:
            range_high = max(s["price"] for s in highs)
            range_low = min(s["price"] for s in lows)
        else:
            range_high = float(df["high"].max())
            range_low = float(df["low"].min())

        current = float(df["close"].iloc[-1])
        size = range_high - range_low
        position = ((current - range_low) / size * 100) if size > 0 else 50.0

        if position <= 25:
            zone, bias = "DEEP_DISCOUNT", "LONG"
        elif position <= 40:
            zone, bias = "DISCOUNT", "LONG"
        elif position < 60:
            zone, bias = "EQUILIBRIUM", "NEUTRAL"
        elif position < 75:
            zone, bias = "PREMIUM", "SHORT"
        else:
            zone, bias = "DEEP_PREMIUM", "SHORT"

        return {
            "range_high": round(range_high, 2),
            "range_low": round(range_low, 2),
            "range_size_pct": round(size / current * 100, 2) if current else 0,
            "current_position_pct": round(position, 1),
            "zone": zone,
            "bias": bias,
            "fifty_pct_level": round((range_high + range_low) / 2, 2),
        }

    # ------------------------------------------------------------------
    # Inducement
    # ------------------------------------------------------------------

    def detect_inducement(self, df: pd.DataFrame, structure: dict) -> dict:
        swing_highs, swing_lows = self._find_swings(df)
        n = len(df)
        last_idx = n - 1

        # Look in the last 20 candles for a wick-break of a minor swing then reversal
        for i in range(n - 1, max(n - 21, PIVOT_WINDOW), -1):
            hi, lo = float(df["high"].iloc[i]), float(df["low"].iloc[i])
            close_now = float(df["close"].iloc[-1])
            for s in swing_highs:
                if s["index"] < i - 1 and hi > s["price"]:
                    # Broke a minor high; did price then reverse below the break candle low?
                    later_close = df["close"].iloc[i:]
                    reversed_down = bool((later_close < float(df["low"].iloc[i])).any())
                    if reversed_down:
                        return {
                            "detected": True,
                            "type": "BEARISH",
                            "inducement_level": round(s["price"], 2),
                            "candles_ago": last_idx - i,
                            "followed_by_reversal": close_now < s["price"],
                        }
            for s in swing_lows:
                if s["index"] < i - 1 and lo < s["price"]:
                    later_close = df["close"].iloc[i:]
                    reversed_up = bool((later_close > float(df["high"].iloc[i])).any())
                    if reversed_up:
                        return {
                            "detected": True,
                            "type": "BULLISH",
                            "inducement_level": round(s["price"], 2),
                            "candles_ago": last_idx - i,
                            "followed_by_reversal": close_now > s["price"],
                        }
        return {
            "detected": False, "type": None, "inducement_level": None,
            "candles_ago": None, "followed_by_reversal": False,
        }

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    def _confluences(
        self,
        structure_4h: dict,
        structure_1h: dict,
        structure_15m: dict,
        obs_15m: list,
        fvgs_15m: list,
        liquidity: dict,
        pd_zone: dict,
        inducement: dict,
        df_15m: pd.DataFrame | None = None,
    ) -> tuple[float, list[str], list[str]]:
        score = 0.0
        found: list[str] = []
        missing: list[str] = []

        trends = {structure_4h["trend"], structure_1h["trend"], structure_15m["trend"]}
        if len(trends) == 1 and "RANGING" not in trends:
            score += 2.0
            found.append("Multi-TF alignment (4H + 1H + 15M same direction)")
        elif structure_4h["trend"] == structure_15m["trend"] and structure_4h["trend"] != "RANGING":
            score += 1.0
            found.append("Partial TF alignment (4H + 15M same direction)")
        else:
            missing.append("Multi-TF trend alignment")

        sweep = liquidity.get("recent_sweep", {})
        if sweep.get("occurred"):
            if sweep.get("strength", 1) >= 3:
                score += 2.0
                found.append(f"High-Prob Reversal: Liquidity sweep on Multi-Tap level ({sweep['type']})")
            else:
                score += 1.5
                found.append(f"Liquidity sweep ({sweep['type']})")
        else:
            missing.append("Liquidity sweep")

        ob_fvg_overlap = False
        for ob in obs_15m:
            for fvg in fvgs_15m:
                if ob["type"] == fvg["type"] and not (
                    fvg["top"] < ob["low"] or fvg["bottom"] > ob["high"]
                ):
                    ob_fvg_overlap = True
        if ob_fvg_overlap:
            score += 1.5
            found.append("OB + FVG confluence at same zone")
        else:
            missing.append("OB + FVG overlap")

        bias_dir = structure_4h["trend"]
        if (bias_dir == "BULLISH" and pd_zone["zone"] in ("DISCOUNT", "DEEP_DISCOUNT")) or (
            bias_dir == "BEARISH" and pd_zone["zone"] in ("PREMIUM", "DEEP_PREMIUM")
        ):
            score += 1.0
            found.append(f"Entry in {pd_zone['zone'].lower()} aligned with 4H bias")
        else:
            missing.append("Entry in discount (long) / premium (short)")

        choch = structure_15m.get("last_choch")
        if choch and choch["candles_ago"] <= 20:
            score += 1.0
            found.append(f"CHoCH confirmed on 15M ({choch['type']})")
        else:
            missing.append("CHoCH on 15M")

        if inducement.get("detected") and inducement.get("followed_by_reversal"):
            score += 0.5
            found.append("Inducement detected and swept")
        else:
            missing.append("Inducement sweep")

        bos = structure_15m.get("last_bos")
        if bos and bos["type"] == bias_dir and bias_dir != "RANGING":
            bos_price = bos.get("price", 0)
            strength = 1
            if bos["type"] == "BULLISH":
                for c in liquidity.get("equal_highs", []):
                    if bos_price and abs(c["price"] - bos_price) / bos_price <= 0.0015:
                        strength = c["strength"]
            else:
                for c in liquidity.get("equal_lows", []):
                    if bos_price and abs(c["price"] - bos_price) / bos_price <= 0.0015:
                        strength = c["strength"]
            
            if bos.get("candles_ago", 999) <= 20 and strength == 1:
                score += 1.5
                found.append("High-Prob Breakout: 15M BOS through 1st-Tap level")
            else:
                score += 0.5
                found.append("15M BOS in direction of 4H bias")
        else:
            missing.append("15M BOS aligned with 4H bias")

        if df_15m is not None and len(df_15m) > 20:
            recent_vol = float(df_15m["volume"].iloc[-3:].mean())
            avg_vol = float(df_15m["vol_avg"].iloc[-1] or 0)
            if avg_vol and recent_vol > avg_vol:
                score += 0.5
                found.append("Volume above average on recent candles")
            else:
                missing.append("Volume confirmation")
        else:
            missing.append("Volume confirmation")

        if any(not o["mitigated"] for o in obs_15m):
            score += 0.5
            found.append("Clean unmitigated OB on 15M")
        else:
            missing.append("Clean unmitigated OB")

        return score, found, missing

    def score_setup(
        self,
        structure_4h: dict,
        structure_1h: dict,
        structure_15m: dict,
        obs_15m: list,
        fvgs_15m: list,
        liquidity: dict,
        pd_zone: dict,
        inducement: dict,
        boardroom_conviction: float,
        df_15m: pd.DataFrame | None = None,
    ) -> dict:
        raw, found, missing = self._confluences(
            structure_4h, structure_1h, structure_15m,
            obs_15m, fvgs_15m, liquidity, pd_zone, inducement, df_15m,
        )
        bonus = max(0.0, min(1.0, (boardroom_conviction - 5) / 5))  # up to +1.0
        score = round(min(10.0, max(1.0, raw + bonus)), 1)

        if score >= 8.5:
            grade, mult = "A+", 1.5
        elif score >= 7.5:
            grade, mult = "A", 1.25
        elif score >= 6.5:
            grade, mult = "B", 1.0
        elif score >= 5.0:
            grade, mult = "C", 0.5
        else:
            grade, mult = "D", 0.5

        return {
            "score": score,
            "grade": grade,
            "confluences_found": found,
            "missing": missing,
            "recommended_size_multiplier": mult,
        }

    def _pre_score(self, *args: Any) -> dict:
        raw, found, missing = self._confluences(*args)
        return {"score": round(raw, 1), "confluences_found": found, "missing": missing}

    # ------------------------------------------------------------------
    # R:R validation (UPGRADE_POSITION_MANAGEMENT.md)
    # ------------------------------------------------------------------

    def validate_minimum_rr(
        self,
        entry_price: float,
        stop_loss_price: float,
        target_price: float,
        minimum_rr: float = 3.0,
    ) -> tuple[bool, float]:
        """Validates R:R ratio meets minimum threshold. Returns (is_valid, actual_rr)."""
        risk = abs(entry_price - stop_loss_price)
        reward = abs(target_price - entry_price)
        if risk == 0:
            return False, 0.0
        rr = reward / risk
        return rr >= minimum_rr, round(rr, 2)

    def calculate_tp_for_rr(
        self,
        entry_price: float,
        stop_loss_price: float,
        target_rr: float = 3.0,
    ) -> float:
        """TP price needed for the target R:R given entry and SL."""
        risk = abs(entry_price - stop_loss_price)
        required_reward = risk * target_rr
        if entry_price > stop_loss_price:  # long
            return round(entry_price + required_reward, 1)
        return round(entry_price - required_reward, 1)

    # ------------------------------------------------------------------
    # Full analysis
    # ------------------------------------------------------------------

    async def _compute_4h_structure(self, instrument: str, delta_client: Any) -> dict:
        if hasattr(delta_client, "get"):
            candles = await delta_client.get("candles_4h")
        else:
            candles = await delta_client.get_candles(instrument, "240", 300)
        df = self._prepare_df(candles)
        structure = self.detect_market_structure(df)
        obs = self.detect_order_blocks(df, structure)
        fvgs = self.detect_fvg(df)
        return {"df": df, "structure": structure, "obs": obs, "fvgs": fvgs}

    async def _compute_1h_structure(self, instrument: str, delta_client: Any) -> dict:
        if hasattr(delta_client, "get"):
            candles = await delta_client.get("candles_1h")
        else:
            candles = await delta_client.get_candles(instrument, "60", 300)
        df = self._prepare_df(candles)
        structure = self.detect_market_structure(df)
        obs = self.detect_order_blocks(df, structure)
        fvgs = self.detect_fvg(df)
        return {"df": df, "structure": structure, "obs": obs, "fvgs": fvgs}

    async def _compute_15m_structure(self, instrument: str, delta_client: Any) -> dict:
        if hasattr(delta_client, "get"):
            candles = await delta_client.get("candles_15m")
        else:
            candles = await delta_client.get_candles(instrument, "15", 100)
        df = self._prepare_df(candles)
        structure = self.detect_market_structure(df)
        obs = self.detect_order_blocks(df, structure)
        fvgs = self.detect_fvg(df)
        return {"df": df, "structure": structure, "obs": obs, "fvgs": fvgs}


    async def analyse(self, instrument: str, delta_client: Any, base_snapshot: dict, profile: dict | None = None) -> dict:
        from backend.perception.smc_cache import smc_cache

        s4h = await smc_cache.get_or_compute(
            "4h_structure", instrument, lambda: self._compute_4h_structure(instrument, delta_client)
        )
        s1h = await smc_cache.get_or_compute(
            "1h_structure", instrument, lambda: self._compute_1h_structure(instrument, delta_client)
        )
        s15m = await smc_cache.get_or_compute(
            "15m_structure", instrument, lambda: self._compute_15m_structure(instrument, delta_client)
        )

        df_4h = s4h["df"]
        structure_4h = s4h["structure"]
        obs_4h = s4h["obs"]
        fvgs_4h = s4h["fvgs"]

        df_1h = s1h["df"]
        structure_1h = s1h["structure"]
        obs_1h = s1h["obs"]
        fvgs_1h = s1h["fvgs"]

        df_15m = s15m["df"]
        structure_15m = s15m["structure"]
        obs_15m = s15m["obs"]
        fvgs_15m = s15m["fvgs"]

        liquidity_4h = self.detect_liquidity(df_4h)
        liquidity_1h = self.detect_liquidity(df_1h)
        liquidity_15m = self.detect_liquidity(df_15m)

        pd_zone = self.calculate_premium_discount(df_1h, structure_1h)
        inducement = self.detect_inducement(df_15m, structure_15m)

        pre_score = self._pre_score(
            structure_4h, structure_1h, structure_15m,
            obs_15m, fvgs_15m, liquidity_1h, pd_zone, inducement, df_15m,
        )

        context_text = self._build_context_text(
            instrument, base_snapshot,
            structure_4h, structure_1h, structure_15m,
            obs_4h, obs_1h, obs_15m,
            fvgs_4h, fvgs_1h, fvgs_15m,
            liquidity_1h, liquidity_15m,
            pd_zone, inducement, pre_score,
            profile,
        )

        htf_alerts = []
        for liq in liquidity_4h.get("buy_side_liquidity", []):
            if liq["distance_pct"] <= 0.5:
                htf_alerts.append(f"Price is dangerously close (+{liq['distance_pct']}%) to 4H Buy-Side Liquidity at {liq['price']}. Watch for a sweep and reversal, or consider selling calls.")
        for liq in liquidity_4h.get("sell_side_liquidity", []):
            if liq["distance_pct"] <= 0.5:
                htf_alerts.append(f"Price is dangerously close (-{liq['distance_pct']}%) to 4H Sell-Side Liquidity at {liq['price']}. Watch for a sweep and reversal, or consider selling puts.")

        if htf_alerts:
            context_text += "\n\n🚨 **HTF LIQUIDITY PROXIMITY ALERT** 🚨\n"
            for alert in htf_alerts:
                context_text += f"- {alert}\n"
            
            # Boost the pre-score to ensure the Boardroom evaluates this major HTF interaction
            pre_score["score"] = min(10.0, pre_score["score"] + 2.5)
            pre_score["confluences_found"].append("HTF Liquidity Proximity Alert (+2.5 bonus)")

        logger.info(
            "SMC analysis for {}: 4H={} 1H={} 15M={} | raw score {}/9",
            instrument, structure_4h["trend"], structure_1h["trend"],
            structure_15m["trend"], pre_score["score"],
        )

        # Calculate suggested params for scenario simulator
        dir_bias = "long" if structure_4h["trend"] == "BULLISH" else "short" if structure_4h["trend"] == "BEARISH" else None
        price = base_snapshot.get("price")
        s_entry = None
        s_sl = None
        s_tp = None
        if dir_bias and price:
            wanted = "BULLISH" if dir_bias == "long" else "BEARISH"
            candidates = [o for o in obs_15m if o["type"] == wanted]
            targets = (
                liquidity_1h["buy_side_liquidity"] if dir_bias == "long"
                else liquidity_1h["sell_side_liquidity"]
            )
            if candidates and targets:
                ob = candidates[0]
                s_entry = ob["midpoint"]
                if dir_bias == "long":
                    s_sl = ob["low"] * 0.998
                else:
                    s_sl = ob["high"] * 1.002
                s_tp = targets[0]["price"]

        return {
            "context_text": context_text,
            "price": price,
            "structures": {"4h": structure_4h, "1h": structure_1h, "15m": structure_15m},
            "order_blocks": {"4h": obs_4h, "1h": obs_1h, "15m": obs_15m},
            "fvgs": {"4h": fvgs_4h, "1h": fvgs_1h, "15m": fvgs_15m},
            "liquidity": {"1h": liquidity_1h, "15m": liquidity_15m},
            "premium_discount": pd_zone,
            "inducement": inducement,
            "raw_score_pre_boardroom": pre_score,
            "suggested_entry": s_entry,
            "suggested_sl": s_sl,
            "suggested_tp": s_tp,
            "_df_15m": df_15m,  # internal, dropped before DB storage
        }


    def analyse_from_candles(self, candles: list[dict], instrument: str = "REPLAY", profile: dict | None = None) -> dict:
        """Run the SMC detector on a supplied historical candle window."""
        df = self._prepare_df(candles)
        structure = self.detect_market_structure(df)
        obs = self.detect_order_blocks(df, structure)
        fvgs = self.detect_fvg(df)
        liquidity = self.detect_liquidity(df)
        pd_zone = self.calculate_premium_discount(df, structure)
        inducement = self.detect_inducement(df, structure)
        pre_score = self._pre_score(
            structure, structure, structure, obs, fvgs, liquidity, pd_zone, inducement, df
        )
        price = float(df["close"].iloc[-1]) if len(df) else None
        base_snapshot = {"price": price, "funding_rate": None, "open_interest": None}
        context_text = self._build_context_text(
            instrument, base_snapshot, structure, structure, structure,
            obs, obs, obs, fvgs, fvgs, fvgs, liquidity, liquidity,
            pd_zone, inducement, pre_score,
            profile,
        )
        return {
            "context_text": context_text,
            "price": price,
            "structures": {"4h": structure, "1h": structure, "15m": structure},
            "order_blocks": {"4h": obs, "1h": obs, "15m": obs},
            "fvgs": {"4h": fvgs, "1h": fvgs, "15m": fvgs},
            "liquidity": {"1h": liquidity, "15m": liquidity},
            "premium_discount": pd_zone,
            "inducement": inducement,
            "raw_score_pre_boardroom": pre_score,
        }

    def classify_pattern_type(self, smc_analysis: dict) -> str:
        """Return the primary SMC pattern type for outcome tracking."""
        structures = smc_analysis.get("structures", {})
        obs = smc_analysis.get("order_blocks", {})
        fvgs = smc_analysis.get("fvgs", {})
        liquidity = smc_analysis.get("liquidity", {})
        inducement = smc_analysis.get("inducement", {})

        has_ob = len(obs.get("15m", [])) > 0
        has_fvg = len([f for f in fvgs.get("15m", []) if not f.get("filled")]) > 0
        has_sweep = liquidity.get("1h", {}).get("recent_sweep", {}).get("occurred", False)
        has_choch = structures.get("15m", {}).get("last_choch") is not None
        has_bos = structures.get("15m", {}).get("last_bos") is not None
        has_inducement = inducement.get("detected", False)

        if has_ob and has_fvg and has_sweep:
            return "ob_fvg_sweep_confluence"
        if has_ob and has_fvg:
            return "ob_fvg_confluence"
        if has_sweep and has_choch:
            return "liquidity_sweep_choch"
        if has_ob and has_sweep:
            return "ob_after_sweep"
        if has_fvg and has_sweep:
            return "fvg_after_sweep"
        if has_choch:
            return "choch_entry"
        if has_bos:
            return "bos_continuation"
        if has_inducement:
            return "inducement_setup"
        return "general_smc"

    # ------------------------------------------------------------------
    # Context text for LLMs
    # ------------------------------------------------------------------

    def _fmt_obs(self, obs: list[dict]) -> str:
        if not obs:
            return "  None detected"
        return "\n".join(
            f"  {o['type']} OB: {o['low']}—{o['high']} | "
            f"{'mitigated' if o['mitigated'] else 'unmitigated'} | {o['strength']} "
            f"({o['candles_ago']} candles ago)"
            for o in obs
        )

    def _fmt_fvgs(self, fvgs: list[dict]) -> str:
        if not fvgs:
            return "  None unfilled"
        return "\n".join(
            f"  {f['type']} FVG: {f['bottom']}—{f['top']} ({f['size_pct']}%) | "
            f"{'partially filled' if f['partially_filled'] else 'unfilled'} "
            f"({f['candles_ago']} candles ago)"
            for f in fvgs
        )

    def _fmt_structure_line(self, s: dict) -> str:
        if s["higher_highs"] and s["higher_lows"]:
            return "Higher Highs + Higher Lows"
        if not s["higher_highs"] and not s["higher_lows"]:
            return "Lower Highs + Lower Lows"
        return "Mixed"

    def _build_context_text(
        self, instrument: str, base_snapshot: dict,
        structure_4h: dict, structure_1h: dict, structure_15m: dict,
        obs_4h: list, obs_1h: list, obs_15m: list,
        fvgs_4h: list, fvgs_1h: list, fvgs_15m: list,
        liquidity_1h: dict, liquidity_15m: dict,
        pd_zone: dict, inducement: dict, pre_score: dict,
        profile: dict | None = None,
    ) -> str:
        now_ist = datetime.now(IST).strftime("%Y-%m-%d %H:%M")
        price = base_snapshot.get("price")
        sweep = liquidity_1h.get("recent_sweep", {})
        bos_15 = structure_15m.get("last_bos")
        choch_15 = structure_15m.get("last_choch")
        bos_4h = structure_4h.get("last_bos")
        choch_4h = structure_4h.get("last_choch")

        def fmt_event(e: dict | None) -> str:
            return f"{e['type']} at {e['price']} ({e['candles_ago']} candles ago)" if e else "None"

        align_1h = "CONFIRMED" if structure_1h["trend"] == structure_4h["trend"] else (
            "MIXED" if "RANGING" in (structure_1h["trend"], structure_4h["trend"]) else "OPPOSING"
        )
        align_15m = "CONFIRMED" if structure_15m["trend"] == structure_4h["trend"] else "OPPOSING"

        liq_lines = []
        for l in liquidity_1h.get("buy_side_liquidity", [])[:3]:
            liq_lines.append(
                f"  Buy-side above: {l['price']} ({l['type']}, {l['distance_pct']}% away, strength {l['strength']})"
            )
        for l in liquidity_1h.get("sell_side_liquidity", [])[:3]:
            liq_lines.append(
                f"  Sell-side below: {l['price']} ({l['type']}, {l['distance_pct']}% away, strength {l['strength']})"
            )

        checks = "\n".join(f"  ✓ {c}" for c in pre_score["confluences_found"]) or "  (none)"
        misses = "\n".join(f"  ✗ {m}" for m in pre_score["missing"]) or "  (none)"

        # Suggested trade params from nearest aligned 15M OB + R:R enforcement
        suggestion = "No clean OB-based setup available right now."
        rr_analysis = "No OB-based setup to evaluate — R:R analysis unavailable."
        direction = "long" if structure_4h["trend"] == "BULLISH" else "short" if structure_4h["trend"] == "BEARISH" else None
        
        min_rr = float((profile or {}).get("min_rr_ratio") or 1.5)
        
        if direction:
            wanted = "BULLISH" if direction == "long" else "BEARISH"
            candidates = [o for o in obs_15m if o["type"] == wanted]
            targets = (
                liquidity_1h["buy_side_liquidity"] if direction == "long"
                else liquidity_1h["sell_side_liquidity"]
            )
            if candidates and targets and price:
                ob = candidates[0]
                entry_mid = ob["midpoint"]
                if direction == "long":
                    sl = ob["low"] * 0.998
                    t1 = targets[0]["price"]
                    rr = round((t1 - entry_mid) / max(entry_mid - sl, 1e-9), 2)
                else:
                    sl = ob["high"] * 1.002
                    t1 = targets[0]["price"]
                    rr = round((entry_mid - t1) / max(sl - entry_mid, 1e-9), 2)
                t2 = targets[1]["price"] if len(targets) > 1 else t1
                suggestion = (
                    f"Entry Zone: {ob['low']}—{ob['high']} (15M OB)\n"
                    f"Stop Loss: {round(sl, 1)} ({'below' if direction == 'long' else 'above'} 15M OB + buffer)\n"
                    f"Target 1: {t1} (nearest liquidity)\n"
                    f"Target 2: {t2}\n"
                    f"R:R Ratio: {rr}"
                )
                risk_dist = abs(entry_mid - sl)
                risk_pct = risk_dist / entry_mid * 100 if entry_mid else 0
                min_tp = self.calculate_tp_for_rr(entry_mid, sl, min_rr)
                rr_valid, _ = self.validate_minimum_rr(entry_mid, sl, t1, min_rr)
                # Furthest mapped liquidity may still satisfy min_rr even if nearest doesn't
                best_target = max(
                    (t["price"] for t in targets),
                    key=lambda p: abs(p - entry_mid),
                    default=t1,
                )
                best_valid, best_rr = self.validate_minimum_rr(entry_mid, sl, best_target, min_rr)
                verdict = (
                    f"✓ R:R VALID — 1:{best_rr} to {best_target} meets minimum 1:{min_rr:.1f}"
                    if best_valid else
                    f"✗ R:R INSUFFICIENT — best mapped target only gives 1:{best_rr}. REJECT TRADE."
                )
                rr_analysis = (
                    f"Entry zone: {entry_mid}\n"
                    f"Stop loss ({'below' if direction == 'long' else 'above'} OB): {round(sl, 1)}\n"
                    f"Risk distance: {round(risk_dist, 1)} ({risk_pct:.2f}%)\n\n"
                    f"For minimum 1:{min_rr:.1f} R:R, TP must be at: {min_tp}\n"
                    f"Nearest liquidity target: {t1} → R:R = 1:{rr}"
                    + ("" if rr_valid else " (insufficient alone)") + "\n"
                    f"Furthest mapped target: {best_target} → R:R = 1:{best_rr}\n\n"
                    f"{verdict}"
                )

        return f"""---
{instrument} — SMC Multi-Timeframe Analysis
Generated: {now_ist} IST

=== CURRENT PRICE ===
Price: {price}
24h Change: {base_snapshot.get('change_24h_pct')}%
Spread: {base_snapshot.get('spread')}

=== 4H TIMEFRAME — Directional Bias ===
Trend: {structure_4h['trend']}
Structure: {self._fmt_structure_line(structure_4h)}
Last BOS: {fmt_event(bos_4h)}
Last CHoCH: {fmt_event(choch_4h)}
Structure Intact: {'Yes' if structure_4h['structure_intact'] else 'No'}

Active Order Blocks (4H):
{self._fmt_obs(obs_4h)}

Fair Value Gaps (4H):
{self._fmt_fvgs(fvgs_4h)}

=== 1H TIMEFRAME — Confirmation ===
Trend: {structure_1h['trend']}
Alignment with 4H: {align_1h}
Recent Liquidity Sweep: {f"Yes — {sweep['type']} swept {sweep['candles_ago']} candles ago" if sweep.get('occurred') else 'No'}
Premium/Discount Zone: {pd_zone['zone']} ({pd_zone['current_position_pct']}% of range)
50% Level (OTE): {pd_zone['fifty_pct_level']}

Active Order Blocks (1H):
{self._fmt_obs(obs_1h)}

Fair Value Gaps (1H):
{self._fmt_fvgs(fvgs_1h)}

Liquidity Map (1H):
{chr(10).join(liq_lines) or '  None mapped'}

=== 15M TIMEFRAME — Entry Trigger ===
Trend: {structure_15m['trend']}
Alignment with 1H/4H: {align_15m}
BOS: {fmt_event(bos_15)}
CHoCH: {fmt_event(choch_15)}
Inducement: {f"Detected — swept {inducement['candles_ago']} candles ago" if inducement['detected'] else 'Not detected'}

Active Order Blocks (15M):
{self._fmt_obs(obs_15m)}

Fair Value Gaps (15M):
{self._fmt_fvgs(fvgs_15m)}

=== CONFLUENCE ANALYSIS ===
{checks}
{misses}

RAW SETUP SCORE: {pre_score['score']}/9 (before boardroom conviction)

=== DERIVATIVES CONTEXT ===
Funding Rate: {base_snapshot.get('funding_rate')}%
Open Interest: {base_snapshot.get('open_interest')}
Fear & Greed: {base_snapshot.get('fear_greed_index')} ({base_snapshot.get('fear_greed_classification')})
BTC Dominance: {base_snapshot.get('btc_dominance')}%

=== R:R ANALYSIS (minimum 1:{min_rr:.1f} enforced) ===
{rr_analysis}

=== SUGGESTED TRADE PARAMETERS ({direction or 'no bias'}) ===
{suggestion}
---"""


smc_analyser = SMCAnalyser()


def classify_pattern_type(smc_analysis: dict) -> str:
    return smc_analyser.classify_pattern_type(smc_analysis)
