"""Order splitter — splits large orders to avoid market impact at scale."""

import asyncio
import os
import random

from loguru import logger

from backend.execution.adapters.base import ExecutionAdapter, OrderResult


class OrderSplitter:
    """
    Splits large orders into smaller child orders.
    Currently inactive at normal scale (threshold ₹5L not reached).
    Activates automatically when order_size_inr exceeds threshold.
    """

    SPLIT_THRESHOLD_INR = float(os.getenv("ORDER_SPLIT_THRESHOLD_INR", "500000"))

    async def execute(
        self,
        adapter: ExecutionAdapter,
        instrument: str,
        side: str,
        total_size: int,
        order_size_inr: float,
        order_type: str = "limit",
        limit_price: float | None = None,
    ) -> list[OrderResult]:
        """Execute order — single if below threshold, split into 5 if above."""
        if order_size_inr < self.SPLIT_THRESHOLD_INR:
            logger.debug(
                "Order splitting INACTIVE: ₹{:,.0f} < threshold ₹{:,.0f}",
                order_size_inr, self.SPLIT_THRESHOLD_INR,
            )
            result = await adapter.place_order(
                instrument=instrument,
                side=side,
                size=total_size,
                order_type=order_type,
                limit_price=limit_price,
            )
            return [result]

        child_size = max(1, total_size // 5)
        logger.info(
            "Order splitting ACTIVE: ₹{:,.0f} → 5 × {} contracts",
            order_size_inr, child_size,
        )
        results: list[OrderResult] = []
        for i in range(5):
            varied_size = max(1, child_size + random.randint(-1, 1))
            result = await adapter.place_order(
                instrument=instrument,
                side=side,
                size=varied_size,
                order_type=order_type,
                limit_price=limit_price,
            )
            results.append(result)
            if not result.success:
                logger.error("Child order {}/5 failed: {}", i + 1, result.error_message)
            if i < 4:
                delay = random.randint(30, 120)
                logger.info("Child order {}/5 placed. Waiting {}s...", i + 1, delay)
                await asyncio.sleep(delay)
        return results


order_splitter = OrderSplitter()
