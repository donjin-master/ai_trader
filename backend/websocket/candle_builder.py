"""Builds OHLCV candles from real-time ticks."""

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Optional

from loguru import logger


@dataclass
class Candle:
    instrument: str
    timeframe: str
    period_start: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    closed: bool = False
    tick_count: int = 0

    def to_dict(self) -> dict:
        return {
            "time": int(self.period_start.timestamp()),
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
            "closed": self.closed,
        }


class CandleBuilder:
    """
    Builds OHLCV candles from real-time tick stream.
    Supports multiple timeframes per instrument.
    Fires on_candle_close callbacks when a period ends.
    """

    TIMEFRAME_SECONDS: dict[str, int] = {
        "1m": 60,
        "3m": 180,
        "5m": 300,
        "15m": 900,
        "1h": 3600,
        "4h": 14400,
    }

    def __init__(self, timeframes: list[str] | None = None) -> None:
        self.timeframes = timeframes or ["1m", "15m", "1h"]
        self._candles: dict[tuple[str, str], Candle] = {}
        self._callbacks: list[Callable] = []

    def on_candle_close(self, callback: Callable) -> None:
        self._callbacks.append(callback)

    def update(
        self,
        instrument: str,
        price: float,
        volume: float,
        timestamp: Optional[datetime] = None,
    ) -> dict[str, Candle]:
        """Process a tick. Returns any candles that closed this tick."""
        ts = timestamp or datetime.utcnow()
        closed: dict[str, Candle] = {}

        for tf in self.timeframes:
            period_secs = self.TIMEFRAME_SECONDS[tf]
            period_start = datetime.utcfromtimestamp(
                int(ts.timestamp() / period_secs) * period_secs
            )
            key = (instrument, tf)
            current = self._candles.get(key)

            if current and current.period_start != period_start:
                current.closed = True
                closed[tf] = current
                for cb in self._callbacks:
                    asyncio.create_task(cb(current))
                current = None

            if current is None:
                self._candles[key] = Candle(
                    instrument=instrument,
                    timeframe=tf,
                    period_start=period_start,
                    open=price,
                    high=price,
                    low=price,
                    close=price,
                    volume=volume,
                    tick_count=1,
                )
            else:
                current.high = max(current.high, price)
                current.low = min(current.low, price)
                current.close = price
                current.volume += volume
                current.tick_count += 1

        return closed

    def get_current(self, instrument: str, timeframe: str) -> Optional[Candle]:
        return self._candles.get((instrument, timeframe))
