"""Abstract exchange execution adapter."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class OrderResult:
    success: bool
    order_id: str | None
    fill_price: float | None
    fill_size: int | None
    error_message: str | None = None


@dataclass
class PositionData:
    instrument: str
    direction: str
    size: int
    entry_price: float
    mark_price: float
    unrealized_pnl: float
    unrealized_pnl_pct: float


class ExecutionAdapter(ABC):
    """
    Abstract base for exchange execution.
    All trading code depends on this interface, not on Delta-specific code.
    Adding a new exchange = new adapter subclass.
    """

    @abstractmethod
    async def place_order(
        self,
        instrument: str,
        side: str,
        size: int,
        order_type: str,
        limit_price: float | None = None,
        stop_loss: float | None = None,
        take_profit: float | None = None,
    ) -> OrderResult: ...

    @abstractmethod
    async def cancel_order(self, order_id: str) -> bool: ...

    @abstractmethod
    async def cancel_all_orders(self, instrument: str | None = None) -> int: ...

    @abstractmethod
    async def close_position(self, instrument: str) -> OrderResult: ...

    @abstractmethod
    async def get_positions(self) -> list[PositionData]: ...

    @abstractmethod
    async def get_balance(self) -> dict: ...
