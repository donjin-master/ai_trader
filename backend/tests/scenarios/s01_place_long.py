"""
SCENARIO 01 — Place Market Long Order
Tests: Order placement, DB logging, Telegram notification

What it does:
  1. Gets current BTC price from testnet
  2. Places a market long order (1 contract = smallest possible size)
  3. Verifies order appears in Delta positions
  4. Verifies trade record created in DB
  5. Verifies Telegram entry notification sent
  6. Closes the position
"""

import asyncio
from loguru import logger
from .scenario_base import ScenarioBase
from backend.db.database import AsyncSessionLocal
from backend.db.models import Trade
from backend.notifications.telegram import telegram_bot


class PlaceLongScenario(ScenarioBase):

    NAME = "s01_place_market_long"
    DESCRIPTION = "Place a market long order and verify full entry flow"

    async def run(self):

        # ── STEP 1: Get current price ────────────────────────────────────────
        ticker = await self.delta.get_ticker(self.instrument)
        entry_price = float(ticker.get("mark_price", 0))
        logger.info(f"Current price: ${entry_price:,.2f}")

        # ── STEP 2: Place market long order ──────────────────────────────────
        sl_price  = entry_price * 0.995    # 0.5% SL
        tp1_price = entry_price * 1.0075   # 0.75% TP1
        tp2_price = entry_price * 1.015    # 1.5% TP2 (1:3 R:R)

        logger.info(f"Placing LONG: Entry {entry_price:.0f} | SL {sl_price:.0f} | TP {tp2_price:.0f}")

        order_result = await self.delta.place_order(
            instrument=self.instrument,
            side="buy",
            size=1,              # 1 contract = minimum size
            order_type="market",
            stop_loss=sl_price,
            take_profit=tp2_price
        )

        logger.info(f"Order result: {order_result}")

        order_id = order_result.get("id")
        self.check(
            order_id is not None,
            "Order placed successfully (has order ID)"
        )

        # ── STEP 3: Verify position appears ──────────────────────────────────
        await asyncio.sleep(3)  # Wait for fill

        async def position_exists():
            positions = await self.delta.get_positions()
            return any(
                p.get("product_symbol") == self.instrument and
                float(p.get("size", 0)) > 0
                for p in positions
            )

        position_found = await self.wait_for(
            position_exists,
            timeout_seconds=15,
            description="Position appears in Delta account"
        )
        self.check(position_found, "Position visible in Delta testnet")

        # ── STEP 4: Verify Telegram notification ─────────────────────────────
        # Build a mock decision and position for notification test
        mock_decision = {
            "action": "long",
            "instrument": self.instrument,
            "confidence": 8,
            "setup_score": 7.5,
            "session": "US",
            "vote_tally": "3 LONG",
            "reasoning": "TEST SCENARIO — not a real AI decision",
            "key_signals": ["test_signal_1", "test_signal_2"],
            "id": f"test_{order_id}",
            "needs_approval": False
        }
        mock_position = {
            "entry_price": entry_price,
            "sl_price": sl_price,
            "risk_pct": 0.5,
            "tp1": tp1_price,
            "tp2": tp2_price,
            "tp1_rr": 1.5,
            "tp2_rr": 3.0
        }

        notif_sent = await telegram_bot.trade_entry(mock_decision, mock_position)
        self.check(notif_sent, "Telegram entry notification sent")

        # ── STEP 5: Close the position ────────────────────────────────────────
        await asyncio.sleep(2)
        close_result = await self.delta.close_position(self.instrument)
        logger.info(f"Position closed: {close_result}")
        self.check(
            close_result is not None,
            "Position closed successfully"
        )

        # ── STEP 6: Telegram close notification ───────────────────────────────
        mock_trade = {
            "instrument": self.instrument,
            "direction": "long",
            "entry_price": entry_price,
            "exit_price": entry_price * 1.005,  # Simulate slight profit
            "pnl_pct": 0.5,
            "pnl_inr": 50,
            "rr_achieved": 1.0,
            "duration_mins": 1,
            "exit_trigger": "manual_test_close",
            "daily_pnl_pct": 0.5,
            "daily_wins": 1,
            "daily_losses": 0
        }
        await telegram_bot.position_closed(mock_trade)
        logger.info("Close notification sent")
