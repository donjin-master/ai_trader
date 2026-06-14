"""Deterministic key-level engine for charting and boardroom context."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from loguru import logger

from backend.deps import delta_client, to_delta_symbol

IST = ZoneInfo("Asia/Kolkata")


class KeyLevelsEngine:
    INSTRUMENT_ROUND_NUMBERS = {
        "BTCUSD_PERP": {"minor": 1000, "major": [5000, 10000, 50000]},
        "BTCUSD": {"minor": 1000, "major": [5000, 10000, 50000]},
        "ETHUSD_PERP": {"minor": 100, "major": [500, 1000, 5000]},
        "ETHUSD": {"minor": 100, "major": [500, 1000, 5000]},
        "SOLUSD_PERP": {"minor": 10, "major": [50, 100, 500]},
        "SOLUSD": {"minor": 10, "major": [50, 100, 500]},
        "XAUUSD_PERP": {"minor": 50, "major": [100, 500, 1000]},
        "XAUUSD": {"minor": 50, "major": [100, 500, 1000]},
    }

    SESSIONS_IST = {
        "asia": (0, 9),
        "london_pre": (9, 13),
        "london": (13, 18),
        "us_london": (18, 23),
        "us_late": (23, 24),
    }

    async def compute(self, instrument: str, current_price: float) -> dict:
        """Fetch required candles and compute daily, weekly, session and round levels."""
        symbol = to_delta_symbol(instrument)
        current_price = float(current_price or 0)
        daily: list[dict] = []
        weekly: list[dict] = []
        hourly: list[dict] = []
        try:
            daily = await self._fetch_daily_candles(symbol, 8)
            weekly = await self._fetch_weekly_candles(symbol, 6)
            hourly = await self._fetch_hourly_candles(symbol, 96)
        except Exception:
            logger.exception("Key level candle fetch failed for {}", instrument)

        now_ist = datetime.now(IST)
        prev_day = daily[-2] if len(daily) >= 2 else (daily[-1] if daily else {})
        today = daily[-1] if daily else {}
        prev_week = weekly[-2] if len(weekly) >= 2 else (weekly[-1] if weekly else {})
        week = weekly[-1] if weekly else {}

        sessions = self._compute_session_levels(hourly, instrument)
        rounds = self._compute_round_numbers(instrument, current_price)
        daily_open = float(today.get("open") or current_price)
        weekly_open = float(week.get("open") or current_price)
        macro_bias = self._compute_macro_bias(current_price, daily_open, weekly_open)
        current_session = self.get_current_session(now_ist.hour)

        levels = {
            "instrument": instrument,
            "price": current_price,
            "generated_at": now_ist.isoformat(),
            "current_session": current_session,
            "session_notes": self.get_session_notes(instrument, current_session),
            "daily_open": daily_open,
            "prev_day_high": self._f(prev_day.get("high")),
            "prev_day_low": self._f(prev_day.get("low")),
            "prev_day_close": self._f(prev_day.get("close")),
            "weekly_open": weekly_open,
            "prev_week_high": self._f(prev_week.get("high")),
            "prev_week_low": self._f(prev_week.get("low")),
            "current_week_high": self._f(week.get("high")),
            "current_week_low": self._f(week.get("low")),
            "macro_bias": macro_bias,
            **sessions,
            **rounds,
        }
        levels["chart_levels"] = self._chart_levels(levels)
        levels["text"] = self.format_for_boardroom(levels, current_price)
        return levels

    def get_current_session(self, hour_ist: int) -> str:
        for name, (start, end) in self.SESSIONS_IST.items():
            if start <= hour_ist < end:
                return name
        return "dead_zone"

    def get_session_notes(self, instrument: str, session: str) -> str:
        notes = {
            "XAUUSD_PERP": {
                "asia": "XAUUSD Asia session: thin liquidity, avoid fresh entries.",
                "london_pre": "XAUUSD pre-London: watch early moves, avoid chasing.",
                "london": "XAUUSD London session: primary window for high-quality setups.",
                "us_london": "XAUUSD London/NY overlap: highest volatility and best follow-through.",
                "us_late": "XAUUSD US late: fading liquidity, be cautious.",
            },
            "XAUUSD": {
                "asia": "XAUUSD Asia session: thin liquidity, avoid fresh entries.",
                "london_pre": "XAUUSD pre-London: watch early moves, avoid chasing.",
                "london": "XAUUSD London session: primary window for high-quality setups.",
                "us_london": "XAUUSD London/NY overlap: highest volatility and best follow-through.",
                "us_late": "XAUUSD US late: fading liquidity, be cautious.",
            },
            "BTCUSD_PERP": {
                "asia": "BTC Asia: lower volume and more false signals; reduce aggression.",
                "london": "BTC London open: volume increases; watch for manipulation.",
                "us_london": "BTC US session: highest volume and cleaner setups.",
                "us_late": "BTC US late: volume fades; only clear momentum trades.",
            },
            "BTCUSD": {
                "asia": "BTC Asia: lower volume and more false signals; reduce aggression.",
                "london": "BTC London open: volume increases; watch for manipulation.",
                "us_london": "BTC US session: highest volume and cleaner setups.",
                "us_late": "BTC US late: volume fades; only clear momentum trades.",
            },
        }
        return notes.get(instrument, {}).get(session, "")

    async def _fetch_daily_candles(self, instrument: str, count: int) -> list:
        return await delta_client.get_candles(instrument, "1440", count)

    async def _fetch_weekly_candles(self, instrument: str, count: int) -> list:
        return await delta_client.get_candles(instrument, "10080", count)

    async def _fetch_hourly_candles(self, instrument: str, count: int) -> list:
        return await delta_client.get_candles(instrument, "60", count)

    def _compute_session_levels(self, hourly_candles: list, instrument: str) -> dict:
        grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
        now_session = self.get_current_session(datetime.now(IST).hour)
        today = datetime.now(IST).date().isoformat()
        for candle in hourly_candles:
            ts = self._dt(candle.get("time"))
            session = self.get_current_session(ts.hour)
            grouped[(ts.date().isoformat(), session)].append(candle)

        def high_low(items: list[dict]) -> tuple[float | None, float | None]:
            if not items:
                return None, None
            return max(float(c["high"]) for c in items), min(float(c["low"]) for c in items)

        result: dict[str, float | str | None] = {}
        for session in ("asia", "london", "us_london"):
            previous = [
                items for (day, name), items in grouped.items()
                if name == session and not (day == today and name == now_session)
            ]
            items = previous[-1] if previous else []
            hi, lo = high_low(items)
            result[f"prev_{session}_high"] = hi
            result[f"prev_{session}_low"] = lo

        current_items = grouped.get((today, now_session), [])
        hi, lo = high_low(current_items)
        result["current_session_high"] = hi
        result["current_session_low"] = lo
        return result

    def _compute_round_numbers(self, instrument: str, current_price: float) -> dict:
        config = self.INSTRUMENT_ROUND_NUMBERS.get(instrument, {"minor": 100, "major": [500, 1000]})
        minor = float(config["minor"])
        below = math.floor(current_price / minor) * minor
        above = math.ceil(current_price / minor) * minor
        major_step = float(config["major"][0])
        major_below = math.floor(current_price / major_step) * major_step
        major_above = math.ceil(current_price / major_step) * major_step
        if major_above == major_below:
            major_above += major_step
        near_major = min(
            abs(current_price - major_below) / current_price if current_price else 1,
            abs(major_above - current_price) / current_price if current_price else 1,
        ) <= 0.003
        return {
            "nearest_round_above": above,
            "nearest_round_below": below,
            "nearest_major_above": major_above,
            "nearest_major_below": major_below,
            "at_major_level": near_major,
        }

    def _compute_macro_bias(self, current_price: float, daily_open: float, weekly_open: float) -> str:
        if current_price > daily_open and current_price > weekly_open:
            return "BULLISH"
        if current_price < daily_open and current_price < weekly_open:
            return "BEARISH"
        return "MIXED"

    def format_for_boardroom(self, levels: dict, current_price: float) -> str:
        def fmt(label: str, key: str) -> str:
            value = levels.get(key)
            if value is None:
                return f"  {label}: n/a"
            pct = (float(value) - current_price) / current_price * 100 if current_price else 0
            side = "above" if pct > 0 else "below"
            return f"  {label}: ${float(value):,.2f} ({pct:+.2f}% {side})"

        now = datetime.now(IST)
        return "\n".join([
            "=== KEY LEVELS ===",
            f"Session: {levels.get('current_session', 'n/a')} | Day: {now.strftime('%A')} | {now.strftime('%H:%M IST')}",
            levels.get("session_notes") or "",
            "",
            "Daily:",
            fmt("Open", "daily_open"),
            fmt("PDH", "prev_day_high"),
            fmt("PDL", "prev_day_low"),
            fmt("PDC", "prev_day_close"),
            "",
            "Weekly:",
            fmt("Open", "weekly_open"),
            fmt("PWH", "prev_week_high"),
            fmt("PWL", "prev_week_low"),
            fmt("Week high so far", "current_week_high"),
            fmt("Week low so far", "current_week_low"),
            "",
            "Sessions (previous):",
            fmt("Asia High", "prev_asia_high"),
            fmt("Asia Low", "prev_asia_low"),
            fmt("London High", "prev_london_high"),
            fmt("London Low", "prev_london_low"),
            fmt("US/London High", "prev_us_london_high"),
            fmt("US/London Low", "prev_us_london_low"),
            "",
            "Round Numbers:",
            fmt("Next round above", "nearest_round_above"),
            fmt("Next round below", "nearest_round_below"),
            fmt("Next major above", "nearest_major_above"),
            fmt("Next major below", "nearest_major_below"),
            f"  At major level: {'YES' if levels.get('at_major_level') else 'NO'}",
            "",
            f"MACRO BIAS: {levels.get('macro_bias', 'MIXED')}",
        ])

    def _chart_levels(self, levels: dict) -> list[dict]:
        specs = [
            ("daily_open", "Daily Open", "#f59e0b", "dashed", 1),
            ("prev_day_high", "PDH", "#ef4444", "dotted", 1),
            ("prev_day_low", "PDL", "#22c55e", "dotted", 1),
            ("prev_day_close", "PDC", "#94a3b8", "dotted", 1),
            ("weekly_open", "Weekly Open", "#f59e0b", "solid", 2),
            ("prev_week_high", "PWH", "#ef4444", "dashed", 2),
            ("prev_week_low", "PWL", "#22c55e", "dashed", 2),
            ("prev_asia_high", "Asia H", "#3b82f6", "dotted", 1),
            ("prev_asia_low", "Asia L", "#8b5cf6", "dotted", 1),
            ("prev_london_high", "London H", "#3b82f6", "dotted", 1),
            ("prev_london_low", "London L", "#8b5cf6", "dotted", 1),
            ("nearest_major_above", "Major", "#475569", "dotted", 1),
            ("nearest_major_below", "Major", "#475569", "dotted", 1),
        ]
        out = []
        seen: set[tuple[str, float]] = set()
        for key, label, color, style, width in specs:
            value = levels.get(key)
            if value is None:
                continue
            dedupe = (label, round(float(value), 2))
            if dedupe in seen:
                continue
            seen.add(dedupe)
            out.append({"key": key, "price": float(value), "label": label, "color": color, "style": style, "width": width})
        return out

    def _dt(self, epoch: Any) -> datetime:
        return datetime.fromtimestamp(int(epoch), timezone.utc).astimezone(IST)

    def _f(self, value: Any) -> float | None:
        if value is None:
            return None
        return float(value)


key_levels_engine = KeyLevelsEngine()
