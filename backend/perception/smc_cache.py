"""Tiered TTL cache for SMC analysis results by timeframe."""

import asyncio

from cachetools import TTLCache
from loguru import logger


class SMCTieredCache:
    """
    Tiered cache for SMC analysis by timeframe.
    4H structure changes every 14+ minutes; 15M changes every 60 seconds.
    Prevents recomputing expensive analysis on every decision cycle.
    """

    TTL_CONFIG = {
        "4h_structure": 14 * 60,
        "1h_structure": 3 * 60,
        "15m_structure": 60,
        "key_levels": 5 * 60,
        "iv_snapshot": 5 * 60,
        "market_snapshot": 30,
    }

    def __init__(self) -> None:
        self._caches = {
            key: TTLCache(maxsize=10, ttl=ttl) for key, ttl in self.TTL_CONFIG.items()
        }
        self._locks: dict[str, asyncio.Lock] = {key: asyncio.Lock() for key in self.TTL_CONFIG}

    async def get_or_compute(self, tier: str, cache_key: str, compute_fn):
        """Get from cache or compute if expired/missing. Double-check locking."""
        cache = self._caches[tier]
        if cache_key in cache:
            return cache[cache_key]

        async with self._locks[tier]:
            if cache_key in cache:
                return cache[cache_key]
            logger.debug("SMC cache MISS: {}/{}", tier, cache_key)
            result = await compute_fn()
            cache[cache_key] = result
            return result

    def invalidate(self, tier: str, cache_key: str) -> None:
        self._caches[tier].pop(cache_key, None)

    def invalidate_instrument(self, instrument: str) -> None:
        """Invalidate all tiers for an instrument (e.g. after major event)."""
        for cache in self._caches.values():
            for key in list(cache.keys()):
                if instrument in key:
                    cache.pop(key, None)


smc_cache = SMCTieredCache()
