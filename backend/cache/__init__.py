"""Market data cache registry — one cache instance per instrument, shared across cycles."""

from backend.cache.market_data_cache import MarketDataCache

_registry: dict[str, MarketDataCache] = {}


def get_cache(instrument: str, delta_client) -> MarketDataCache:
    """Get or create the cache for an instrument. Cache TTLs handle staleness."""
    if instrument not in _registry:
        _registry[instrument] = MarketDataCache(instrument, delta_client)
    return _registry[instrument]


def invalidate_instrument(instrument: str) -> None:
    """Force full refresh on next access (e.g. after major event or reconnect)."""
    _registry.pop(instrument, None)


__all__ = ["MarketDataCache", "get_cache", "invalidate_instrument"]
