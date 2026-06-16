"""Market perception layer — assembles a full market snapshot for the AI loops."""

from datetime import datetime, timezone
from typing import Any

import httpx
from loguru import logger

from backend.delta.client import DeltaClient

FEAR_GREED_URL = "https://api.alternative.me/fng/?limit=1"
COINGECKO_GLOBAL_URL = "https://api.coingecko.com/api/v3/global"

# Module-level TTL caches to avoid hitting external APIs on every snapshot request
_FEAR_GREED_CACHE: dict[str, Any] = {}
_BTC_DOMINANCE_CACHE: dict[str, Any] = {}
_CACHE_TTL_SECONDS = 3600  # 1 hour
_FAILURE_COOLDOWN_SECONDS = 600  # don't retry a failing API more than once per 10min


def _to_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


class MarketSnapshot:
    """Builds a single clean JSON snapshot of current market state."""

    def __init__(self, delta_client: DeltaClient) -> None:
        self.delta = delta_client

    async def _fetch_fear_greed(self) -> dict[str, Any]:
        cached = _FEAR_GREED_CACHE.get("data")
        now = datetime.now(timezone.utc)
        if cached and (now - cached["fetched_at"]).total_seconds() < _CACHE_TTL_SECONDS:
            return cached["value"]
        last_failure = _FEAR_GREED_CACHE.get("last_failure_at")
        if last_failure and (now - last_failure).total_seconds() < _FAILURE_COOLDOWN_SECONDS:
            return cached["value"] if cached else {"fear_greed_index": None, "fear_greed_classification": None}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(FEAR_GREED_URL)
                response.raise_for_status()
                entry = response.json()["data"][0]
                result = {
                    "fear_greed_index": int(entry["value"]),
                    "fear_greed_classification": entry["value_classification"],
                }
                _FEAR_GREED_CACHE["data"] = {"value": result, "fetched_at": now}
                _FEAR_GREED_CACHE.pop("last_failure_at", None)
                return result
        except Exception as exc:
            logger.warning("Fear & Greed API failed: {}", exc)
            _FEAR_GREED_CACHE["last_failure_at"] = now
            return cached["value"] if cached else {"fear_greed_index": None, "fear_greed_classification": None}

    async def _fetch_btc_dominance(self) -> dict[str, Any]:
        cached = _BTC_DOMINANCE_CACHE.get("data")
        now = datetime.now(timezone.utc)
        if cached and (now - cached["fetched_at"]).total_seconds() < _CACHE_TTL_SECONDS:
            return cached["value"]
        last_failure = _BTC_DOMINANCE_CACHE.get("last_failure_at")
        if last_failure and (now - last_failure).total_seconds() < _FAILURE_COOLDOWN_SECONDS:
            return cached["value"] if cached else {"btc_dominance": None}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(COINGECKO_GLOBAL_URL)
                response.raise_for_status()
                market_cap_pct = response.json()["data"]["market_cap_percentage"]
                result = {"btc_dominance": round(float(market_cap_pct["btc"]), 2)}
                _BTC_DOMINANCE_CACHE["data"] = {"value": result, "fetched_at": now}
                _BTC_DOMINANCE_CACHE.pop("last_failure_at", None)
                return result
        except Exception as exc:
            logger.warning("CoinGecko global API failed: {}", exc)
            _BTC_DOMINANCE_CACHE["last_failure_at"] = now
            return cached["value"] if cached else {"btc_dominance": None}

    @staticmethod
    def _market_regime(change_24h_pct: float | None) -> str:
        if change_24h_pct is None:
            return "ranging"
        if change_24h_pct > 1.5:
            return "trending_up"
        if change_24h_pct < -1.5:
            return "trending_down"
        return "ranging"

    async def build_snapshot(self, instrument: str, cache: Any = None) -> dict:
        ticker: dict[str, Any] = {}
        orderbook: dict[str, Any] = {}
        fear_greed: dict[str, Any] = {}
        dominance: dict[str, Any] = {}

        if cache is not None:
            try:
                ticker = await cache.get("ticker")
            except Exception as exc:
                logger.error("Failed to fetch cached ticker for {}: {}", instrument, exc)
            try:
                orderbook = await cache.get("orderbook")
            except Exception as exc:
                logger.warning("Failed to fetch cached orderbook for {}: {}", instrument, exc)
            try:
                fg_data = await cache.get("fear_greed")
                fear_greed = {
                    "fear_greed_index": fg_data.get("value") if fg_data else None,
                    "fear_greed_classification": fg_data.get("classification") if fg_data else None,
                }
            except Exception as exc:
                logger.warning("Failed to fetch cached fear_greed: {}", exc)
                fear_greed = {"fear_greed_index": None, "fear_greed_classification": None}
            try:
                btc_dom = await cache.get("btc_dominance")
                dominance = {"btc_dominance": round(float(btc_dom), 2) if btc_dom is not None else None}
            except Exception as exc:
                logger.warning("Failed to fetch cached btc_dominance: {}", exc)
                dominance = {"btc_dominance": None}
        else:
            try:
                ticker = await self.delta.get_ticker(instrument)
            except Exception as exc:
                logger.error("Failed to fetch ticker for {}: {}", instrument, exc)
            try:
                orderbook = await self.delta.get_orderbook(instrument, depth=5)
            except Exception as exc:
                logger.warning("Failed to fetch orderbook for {}: {}", instrument, exc)

            fear_greed = await self._fetch_fear_greed()
            dominance = await self._fetch_btc_dominance()

        price = _to_float(ticker.get("close") or ticker.get("spot_price"))
        open_24h = _to_float(ticker.get("open"))
        change_24h_pct: float | None = None
        if price is not None and open_24h:
            change_24h_pct = round((price - open_24h) / open_24h * 100, 2)

        buy_levels = orderbook.get("buy") or []
        sell_levels = orderbook.get("sell") or []
        best_bid = _to_float(buy_levels[0]["price"]) if buy_levels else None
        best_ask = _to_float(sell_levels[0]["price"]) if sell_levels else None
        spread = (
            round(best_ask - best_bid, 4)
            if best_bid is not None and best_ask is not None
            else None
        )

        snapshot: dict[str, Any] = {
            "instrument": instrument,
            "price": price,
            "funding_rate": _to_float(ticker.get("funding_rate")),
            "volume_24h": _to_float(ticker.get("volume")),
            "high_24h": _to_float(ticker.get("high")),
            "low_24h": _to_float(ticker.get("low")),
            "change_24h_pct": change_24h_pct,
            "best_bid": best_bid,
            "best_ask": best_ask,
            "spread": spread,
            "open_interest": _to_float(ticker.get("oi")),
            "mark_price": _to_float(ticker.get("mark_price")),
            **fear_greed,
            **dominance,
            "market_regime": self._market_regime(change_24h_pct),
            "snapshot_timestamp": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(
            "Snapshot built for {}: price={} regime={}",
            instrument, price, snapshot["market_regime"],
        )
        return snapshot

