"""Single source of truth for all market data within a decision cycle."""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
from loguru import logger


@dataclass
class CacheEntry:
    data: Any
    fetched_at: datetime
    ttl_seconds: int
    fetch_count: int = 0
    hit_count: int = 0

    @property
    def is_expired(self) -> bool:
        return (datetime.utcnow() - self.fetched_at).total_seconds() > self.ttl_seconds

    @property
    def age_seconds(self) -> float:
        return (datetime.utcnow() - self.fetched_at).total_seconds()


class MarketDataCache:
    """
    Shared cache for one instrument per decision cycle.
    Eliminates 3–4 redundant Delta API calls per cycle.
    All modules (SMC, key levels, boardroom, charts) read from the same data.
    """

    TTL: dict[str, int] = {
        "ticker": 15,
        "candles_15m": 60,
        "candles_1h": 180,
        "candles_4h": 840,
        "candles_1d": 300,
        "candles_1w": 3600,
        "fear_greed": 3600,
        "btc_dominance": 3600,
        "options_chain": 300,
        "orderbook": 10,
    }

    def __init__(self, instrument: str, delta_client: Any) -> None:
        self.instrument = instrument
        self.delta = delta_client
        self._store: dict[str, CacheEntry] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._created_at = datetime.utcnow()

    async def get(self, data_type: str, force_refresh: bool = False) -> Any:
        if data_type not in self._locks:
            self._locks[data_type] = asyncio.Lock()

        entry = self._store.get(data_type)
        if entry and not entry.is_expired and not force_refresh:
            entry.hit_count += 1
            logger.debug("Cache HIT: {}/{} (age {:.1f}s)", data_type, self.instrument, entry.age_seconds)
            return entry.data

        async with self._locks[data_type]:
            entry = self._store.get(data_type)
            if entry and not entry.is_expired and not force_refresh:
                entry.hit_count += 1
                return entry.data

            logger.debug("Cache MISS: fetching {}/{}", data_type, self.instrument)
            data = await self._fetch(data_type)
            self._store[data_type] = CacheEntry(
                data=data,
                fetched_at=datetime.utcnow(),
                ttl_seconds=self.TTL.get(data_type, 60),
                fetch_count=1,
            )
            return data

    async def _fetch(self, data_type: str) -> Any:
        if data_type == "ticker":
            return await self.delta.get_ticker(self.instrument)

        if data_type.startswith("candles_"):
            tf_map = {
                "candles_15m": ("15", 100),
                "candles_1h": ("60", 300),
                "candles_4h": ("240", 300),
                "candles_1d": ("1440", 100),
                "candles_1w": ("10080", 50),
            }
            resolution, limit = tf_map[data_type]
            return await self.delta.get_candles(self.instrument, resolution, limit)

        if data_type == "fear_greed":
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://api.alternative.me/fng/?limit=1", timeout=5.0
                )
                d = resp.json()
                return {
                    "value": int(d["data"][0]["value"]),
                    "classification": d["data"][0]["value_classification"],
                }

        if data_type == "btc_dominance":
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://api.coingecko.com/api/v3/global", timeout=5.0
                )
                return resp.json()["data"]["market_cap_percentage"].get("btc", 0)

        if data_type == "options_chain":
            return await self.delta.get_options_chain(self.instrument)

        if data_type == "orderbook":
            return await self.delta.get_orderbook(self.instrument, depth=10)

        raise ValueError(f"Unknown data_type: {data_type}")

    def update_from_websocket(self, data_type: str, data: Any) -> None:
        """Called by WebSocket processor when a fresh tick arrives — bypasses TTL."""
        self._store[data_type] = CacheEntry(
            data=data,
            fetched_at=datetime.utcnow(),
            ttl_seconds=self.TTL.get(data_type, 60),
            fetch_count=1,
        )

    def get_stats(self) -> dict:
        stats = {}
        for key, entry in self._store.items():
            total = entry.fetch_count + entry.hit_count
            stats[key] = {
                "age_seconds": round(entry.age_seconds, 1),
                "ttl_seconds": entry.ttl_seconds,
                "expired": entry.is_expired,
                "fetch_count": entry.fetch_count,
                "hit_count": entry.hit_count,
                "hit_ratio": round(entry.hit_count / total if total else 0, 2),
            }
        return {
            "instrument": self.instrument,
            "cache_age_seconds": (datetime.utcnow() - self._created_at).total_seconds(),
            "entries": stats,
        }

    # Convenience accessors
    async def ticker(self) -> dict:
        return await self.get("ticker")

    async def price(self) -> float:
        t = await self.ticker()
        return float(t.get("mark_price") or t.get("close") or 0)

    async def candles_15m(self) -> list:
        return await self.get("candles_15m")

    async def candles_1h(self) -> list:
        return await self.get("candles_1h")

    async def candles_4h(self) -> list:
        return await self.get("candles_4h")

    async def candles_1d(self) -> list:
        return await self.get("candles_1d")

    async def fear_greed(self) -> dict:
        return await self.get("fear_greed")

    async def btc_dominance(self) -> float:
        return await self.get("btc_dominance")
