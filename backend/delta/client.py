"""Delta Exchange India REST client.

Auth: HMAC-SHA256 over (method + timestamp + path + query_string + body).
Timestamp is unix epoch in SECONDS (Delta rejects signatures older than 5s).
Public market-data endpoints are called without auth headers.
"""

import asyncio
import hashlib
import hmac
import json
import time
from typing import Any

import httpx
from loguru import logger

from backend.config import settings

MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 1.0
USER_AGENT = "ai-trader/1.0 (python-httpx)"


class DeltaAPIError(Exception):
    """Raised when Delta Exchange returns an error response."""

    def __init__(self, status_code: int, body: Any) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"Delta API error {status_code}: {body}")


class DeltaClient:
    """Async client for the Delta Exchange India v2 API."""

    def __init__(
        self,
        api_key: str | None = None,
        api_secret: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else settings.delta_api_key
        self.api_secret = (
            api_secret if api_secret is not None else settings.delta_api_secret
        )
        self.base_url = (base_url or settings.delta_base_url).rstrip("/")
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=15.0)

    async def close(self) -> None:
        await self._client.aclose()

    def _sign(self, method: str, path: str, query_string: str, body: str) -> dict[str, str]:
        timestamp = str(int(time.time()))
        message = method + timestamp + path + query_string + body
        signature = hmac.new(
            self.api_secret.encode(),
            message.encode(),
            hashlib.sha256,
        ).hexdigest()
        return {
            "api-key": self.api_key,
            "signature": signature,
            "timestamp": timestamp,
        }

    async def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        auth: bool = False,
    ) -> Any:
        body = json.dumps(json_body, separators=(",", ":")) if json_body else ""
        query_string = ""
        if params:
            query_string = "?" + "&".join(f"{k}={v}" for k, v in params.items())

        last_error: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
            if auth:
                headers.update(self._sign(method, path, query_string, body))

            logger.info(
                "Delta request: {} {}{} (attempt {}/{})",
                method, path, query_string, attempt, MAX_RETRIES,
            )
            try:
                response = await self._client.request(
                    method,
                    path + query_string,
                    content=body if body else None,
                    headers=headers,
                )
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_error = exc
                logger.error("Delta network error on {} {}: {}", method, path, exc)
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(RETRY_BACKOFF_SECONDS)
                continue

            try:
                data = response.json()
            except json.JSONDecodeError:
                data = response.text

            if response.status_code >= 400:
                logger.error(
                    "Delta API error: {} {} -> {} {}",
                    method, path, response.status_code, data,
                )
                raise DeltaAPIError(response.status_code, data)

            logger.info("Delta response: {} {} -> {}", method, path, response.status_code)
            return data

        logger.exception("Delta request failed after {} attempts: {} {}", MAX_RETRIES, method, path)
        raise DeltaAPIError(0, f"Network failure after {MAX_RETRIES} retries: {last_error}")

    # ------------------------------------------------------------------
    # Market data (public)
    # ------------------------------------------------------------------

    # Delta resolution strings keyed by minutes (full 1m → 1W ladder)
    RESOLUTION_MAP = {
        1: "1m", 3: "3m", 5: "5m", 15: "15m", 30: "30m",
        60: "1h", 120: "2h", 240: "4h", 360: "6h", 720: "12h",
        1440: "1d", 10080: "1w",  # Delta has no 3d resolution
    }

    async def get_candles(
        self,
        symbol: str,
        resolution: str,
        count: int = 100,
        end: int | None = None,
    ) -> list[dict]:
        """OHLCV history. resolution in minutes as string ("1".."10080").

        Optional `end` (epoch seconds) anchors the window for historical replay.
        """
        minutes = int(resolution)
        delta_res = self.RESOLUTION_MAP.get(minutes)
        if delta_res is None:
            raise ValueError(f"Unsupported resolution: {resolution} minutes")
        res_seconds = minutes * 60
        end_ts = end or int(time.time())
        start = end_ts - res_seconds * (count + 5)
        data = await self._request(
            "GET",
            "/v2/history/candles",
            params={
                "resolution": delta_res,
                "symbol": symbol,
                "start": start,
                "end": end_ts,
            },
        )
        candles = data.get("result", [])
        # Delta returns newest-first; normalise to oldest-first
        return sorted(candles, key=lambda c: c.get("time", 0))[-count:]

    async def get_product(self, symbol: str) -> dict:
        data = await self._request("GET", f"/v2/products/{symbol}")
        return data.get("result", data)

    async def get_ticker(self, symbol: str) -> dict:
        data = await self._request("GET", f"/v2/tickers/{symbol}")
        return data.get("result", data)

    async def get_orderbook(self, symbol: str, depth: int = 10) -> dict:
        data = await self._request("GET", f"/v2/l2orderbook/{symbol}", params={"depth": depth})
        return data.get("result", data)

    # ------------------------------------------------------------------
    # Account (authenticated)
    # ------------------------------------------------------------------

    async def get_positions(self) -> list[dict]:
        data = await self._request("GET", "/v2/positions/margined", auth=True)
        result = data.get("result", [])
        # Only positions with non-zero size are actually open
        return [p for p in result if p.get("size")]

    async def get_wallet_balance(self) -> dict:
        data = await self._request("GET", "/v2/wallet/balances", auth=True)
        return data.get("result", data)

    async def place_order(
        self,
        instrument: str,
        side: str,
        size: int,
        order_type: str,
        limit_price: float | None = None,
        stop_loss: float | None = None,
        take_profit: float | None = None,
    ) -> dict:
        payload: dict[str, Any] = {
            "product_symbol": instrument,
            "side": side,  # "buy" | "sell"
            "size": size,
            "order_type": "limit_order" if order_type == "limit" else "market_order",
        }
        if order_type == "limit" and limit_price is not None:
            payload["limit_price"] = str(limit_price)
        if stop_loss is not None:
            payload["bracket_stop_loss_price"] = str(stop_loss)
            payload["bracket_stop_trigger_method"] = "last_traded_price"
        if take_profit is not None:
            payload["bracket_take_profit_price"] = str(take_profit)

        logger.info("Placing order: {}", payload)
        data = await self._request("POST", "/v2/orders", json_body=payload, auth=True)
        logger.info("Order placed: {}", data.get("result", data))
        return data.get("result", data)

    async def cancel_order(self, order_id: str, product_id: int | None = None) -> dict:
        payload: dict[str, Any] = {"id": int(order_id)}
        if product_id is not None:
            payload["product_id"] = product_id
        logger.info("Cancelling order {}", order_id)
        data = await self._request("DELETE", "/v2/orders", json_body=payload, auth=True)
        logger.info("Order cancelled: {}", order_id)
        return data.get("result", data)

    async def cancel_all_orders(self) -> dict:
        logger.info("Cancelling ALL open orders")
        payload = {
            "cancel_limit_orders": "true",
            "cancel_stop_orders": "true",
            "cancel_reduce_only_orders": "true",
        }
        data = await self._request("DELETE", "/v2/orders/all", json_body=payload, auth=True)
        logger.info("All orders cancelled")
        return data.get("result", data)

    async def update_stop_loss(self, instrument: str, stop_loss_price: float) -> dict:
        """Move the bracket stop-loss for an open position (edit, fallback create)."""
        payload = {
            "product_symbol": instrument,
            "bracket_stop_loss_price": str(round(stop_loss_price, 1)),
            "bracket_stop_trigger_method": "last_traded_price",
        }
        logger.info("Updating stop loss for {} -> {}", instrument, stop_loss_price)
        # POST replaces the position's bracket orders (PUT requires an order id)
        data = await self._request("POST", "/v2/orders/bracket", json_body=payload, auth=True)
        logger.info("Stop loss updated for {}", instrument)
        return data.get("result", data)

    async def close_position(self, instrument: str) -> dict:
        """Close an open position by placing an opposite reduce-only market order."""
        positions = await self.get_positions()
        position = next(
            (p for p in positions if p.get("product_symbol") == instrument),
            None,
        )
        if position is None:
            logger.warning("close_position: no open position for {}", instrument)
            return {"closed": False, "reason": "no_open_position"}

        size = int(position["size"])
        side = "sell" if size > 0 else "buy"
        payload = {
            "product_symbol": instrument,
            "side": side,
            "size": abs(size),
            "order_type": "market_order",
            "reduce_only": "true",
        }
        logger.info("Closing position {} with {}", instrument, payload)
        data = await self._request("POST", "/v2/orders", json_body=payload, auth=True)
        logger.info("Position closed: {}", instrument)
        return data.get("result", data)

    async def get_trade_history(
        self,
        limit: int = 20,
        page: int = 1,
        state: str | None = None,
    ) -> list[dict]:
        params: dict[str, Any] = {"page_size": limit, "page": page}
        if state:
            params["state"] = state
        data = await self._request(
            "GET", "/v2/orders/history", params=params, auth=True
        )
        return data.get("result", [])
