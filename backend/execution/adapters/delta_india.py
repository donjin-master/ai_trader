"""Delta Exchange India adapter — wraps DeltaClient with the abstract ExecutionAdapter interface."""

from loguru import logger

from backend.execution.adapters.base import ExecutionAdapter, OrderResult, PositionData


class DeltaIndiaAdapter(ExecutionAdapter):
    """
    Wraps the existing DeltaClient.
    Adding a new exchange = write a new Adapter, wire it in deps.py.
    """

    def __init__(self, delta_client) -> None:
        self.client = delta_client

    async def place_order(
        self,
        instrument: str,
        side: str,
        size: int,
        order_type: str,
        limit_price: float | None = None,
        stop_loss: float | None = None,
        take_profit: float | None = None,
    ) -> OrderResult:
        try:
            result = await self.client.place_order(
                instrument=instrument,
                side=side,
                size=size,
                order_type=order_type,
                limit_price=limit_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
            )
            return OrderResult(
                success=True,
                order_id=str(result.get("id")),
                fill_price=float(result.get("avg_fill_price") or 0),
                fill_size=int(result.get("size") or 0),
            )
        except Exception as exc:
            logger.error("DeltaIndiaAdapter.place_order failed: {}", exc)
            return OrderResult(
                success=False, order_id=None,
                fill_price=None, fill_size=None,
                error_message=str(exc),
            )

    async def cancel_order(self, order_id: str) -> bool:
        try:
            await self.client.cancel_order(order_id)
            return True
        except Exception as exc:
            logger.error("cancel_order failed: {}", exc)
            return False

    async def cancel_all_orders(self, instrument: str | None = None) -> int:
        try:
            result = await self.client.cancel_all_orders(instrument)
            return result.get("count", 0) if isinstance(result, dict) else 0
        except Exception as exc:
            logger.error("cancel_all_orders failed: {}", exc)
            return 0

    async def close_position(self, instrument: str) -> OrderResult:
        try:
            result = await self.client.close_position(instrument)
            return OrderResult(
                success=True,
                order_id=str(result.get("id", "")),
                fill_price=float(result.get("avg_fill_price") or 0),
                fill_size=int(result.get("size") or 0),
            )
        except Exception as exc:
            logger.error("close_position failed for {}: {}", instrument, exc)
            return OrderResult(
                success=False, order_id=None,
                fill_price=None, fill_size=None,
                error_message=str(exc),
            )

    async def get_positions(self) -> list[PositionData]:
        try:
            raw = await self.client.get_positions()
            return [
                PositionData(
                    instrument=p.get("product_symbol", ""),
                    direction="long" if float(p.get("size", 0)) > 0 else "short",
                    size=abs(int(p.get("size", 0))),
                    entry_price=float(p.get("entry_price", 0)),
                    mark_price=float(p.get("mark_price", 0)),
                    unrealized_pnl=float(p.get("unrealized_pnl", 0)),
                    unrealized_pnl_pct=float(p.get("unrealized_pnl_pct", 0)),
                )
                for p in (raw or [])
                if p.get("size") and float(p.get("size", 0)) != 0
            ]
        except Exception as exc:
            logger.error("get_positions failed: {}", exc)
            return []

    async def get_balance(self) -> dict:
        try:
            return await self.client.get_wallet_balance() or {}
        except Exception as exc:
            logger.error("get_balance failed: {}", exc)
            return {}
