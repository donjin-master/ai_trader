"""
SCENARIO 02 — Place Limit Order and Watch Fill
Tests: Limit order placement, pending state, fill detection

What it does:
  1. Places a limit long order slightly below current price
     (should fill quickly on testnet as price fluctuates)
  2. Verifies order appears as pending
  3. Waits for fill (up to 60 seconds)
  4. Verifies position appears after fill
  5. Cancels if not filled within timeout
"""

import asyncio
from loguru import logger
from .scenario_base import ScenarioBase


class PlaceLimitScenario(ScenarioBase):

    NAME = "s02_place_limit_order"
    DESCRIPTION = "Place limit order and verify fill detection"

    async def run(self):

        ticker = await self.delta.get_ticker(self.instrument)
        current_price = float(ticker.get("mark_price", 0))
        ask_price = float(ticker.get("ask_price", current_price))

        # Place limit order 0.1% below ask (likely to fill quickly)
        limit_price = ask_price * 0.999
        sl_price    = limit_price * 0.995
        tp_price    = limit_price * 1.015

        logger.info(f"Placing LIMIT LONG at ${limit_price:,.2f} (ask: ${ask_price:,.2f})")

        order = await self.delta.place_order(
            instrument=self.instrument,
            side="buy",
            size=1,
            order_type="limit",
            limit_price=limit_price,
            stop_loss=sl_price,
            take_profit=tp_price
        )

        order_id = str(order.get("id", ""))
        self.check(bool(order_id), "Limit order placed")

        # Verify order exists as open order
        await asyncio.sleep(2)
        open_orders = await self.delta.get_open_orders(self.instrument)
        order_ids = [str(o.get("id")) for o in open_orders]
        self.check(order_id in order_ids, "Order visible in open orders")

        logger.info(f"Waiting for fill (up to 60s)...")

        async def is_filled():
            positions = await self.delta.get_positions()
            return any(
                p.get("product_symbol") == self.instrument and
                float(p.get("size", 0)) > 0
                for p in positions
            )

        filled = await self.wait_for(
            is_filled,
            timeout_seconds=60,
            poll_interval=3.0,
            description="Limit order filled"
        )

        if filled:
            self.check(True, "Limit order filled within 60 seconds")
            await asyncio.sleep(2)
            await self.delta.close_position(self.instrument)
            logger.info("Position closed after fill")
        else:
            # Not filled — cancel the order
            self.check(False, "Limit order filled within 60 seconds (TIMEOUT)")
            cancelled = await self.delta.cancel_order(order_id)
            logger.info(f"Order cancelled after timeout: {cancelled}")
