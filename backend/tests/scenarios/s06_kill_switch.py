"""
SCENARIO 06 — Kill Switch Test
Tests: Kill switch activates, all orders cancelled, trading blocked,
       Telegram kill notification, /resume re-enables trading

What it does:
  1. Places two limit orders (won't fill immediately)
  2. Activates kill switch via API
  3. Verifies both orders are cancelled
  4. Verifies system refuses new orders while killed
  5. Sends Telegram kill notification
  6. Deactivates via /resume equivalent
  7. Verifies system accepts new orders again
"""

import asyncio
from loguru import logger
from .scenario_base import ScenarioBase
from backend.execution.safety import safety_manager
from backend.notifications.telegram import telegram_bot


class KillSwitchScenario(ScenarioBase):

    NAME = "s06_kill_switch"
    DESCRIPTION = "Test kill switch cancels all orders and blocks trading"

    async def run(self):

        ticker = await self.delta.get_ticker(self.instrument)
        price = float(ticker.get("mark_price", 0))

        # ── PLACE TWO LIMIT ORDERS (far from price — won't fill) ──────────────
        limit_far = price * 0.97  # 3% below — won't fill

        order1 = await self.delta.place_order(
            instrument=self.instrument,
            side="buy", size=1,
            order_type="limit", limit_price=limit_far
        )
        order2 = await self.delta.place_order(
            instrument=self.instrument,
            side="buy", size=1,
            order_type="limit", limit_price=limit_far * 0.999
        )
        self.check(order1.get("id") and order2.get("id"), "Two limit orders placed")

        open_before = await self.delta.get_open_orders(self.instrument)
        self.check(len(open_before) >= 2, f"Confirmed {len(open_before)} open orders before kill")

        # ── ACTIVATE KILL SWITCH ──────────────────────────────────────────────
        logger.info("Activating kill switch...")
        await safety_manager.activate_kill_switch("Test scenario s06")
        await asyncio.sleep(3)

        # ── VERIFY ALL ORDERS CANCELLED ───────────────────────────────────────
        open_after = await self.delta.get_open_orders(self.instrument)
        self.check(len(open_after) == 0, "All open orders cancelled by kill switch")

        # ── VERIFY SYSTEM BLOCKS NEW ORDERS ──────────────────────────────────
        is_killed = safety_manager.kill_switch_active
        self.check(is_killed, "Kill switch confirmed active")

        can_trade, reason = await safety_manager.check_pre_trade(self.instrument, {})
        self.check(not can_trade, f"System blocks trading when killed: {reason}")

        # ── TELEGRAM NOTIFICATION ─────────────────────────────────────────────
        await telegram_bot.kill_switch_activated("Test scenario s06", 2)
        logger.info("Kill switch Telegram notification sent")

        # ── DEACTIVATE ────────────────────────────────────────────────────────
        await safety_manager.deactivate_kill_switch()
        is_killed_after = safety_manager.kill_switch_active
        self.check(not is_killed_after, "Kill switch deactivated")

        can_trade_after, _ = await safety_manager.check_pre_trade(self.instrument, {"open_count": 0})
        self.check(can_trade_after, "System accepts trading after kill switch deactivated")
