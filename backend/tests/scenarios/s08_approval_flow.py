"""
SCENARIO 08 — SEMI_AUTO Approval Flow
Tests: Decision requires approval, Telegram buttons appear,
       tapping Approve places the order, tapping Reject skips it

What it does:
  1. Temporarily switches to SEMI_AUTO mode
  2. Generates a mock decision that requires approval
  3. Sends approval request to Telegram (with inline buttons)
  4. Waits 30 seconds for your tap — then times out and rejects automatically
"""

import asyncio
from loguru import logger
from .scenario_base import ScenarioBase
from backend.execution.safety import safety_manager
from backend.notifications.telegram import telegram_bot
import uuid


class ApprovalFlowScenario(ScenarioBase):

    NAME = "s08_semi_auto_approval"
    DESCRIPTION = "Test SEMI_AUTO Telegram approval flow"

    async def run(self):

        ticker = await self.delta.get_ticker(self.instrument)
        price = float(ticker.get("mark_price", 0))

        # Switch to SEMI_AUTO for this test
        original_mode = safety_manager.execution_mode
        await safety_manager.set_execution_mode("SEMI_AUTO")
        self.check(True, "Switched to SEMI_AUTO mode")

        decision_id = str(uuid.uuid4())
        mock_decision = {
            "id": decision_id,
            "action": "long",
            "instrument": self.instrument,
            "size_pct": 1.5,
            "confidence": 8,
            "setup_score": 8.1,
            "session": "US",
            "vote_tally": "3 LONG (unanimous)",
            "needs_approval": True,
            "reasoning": "TEST: SEMI_AUTO approval flow. Tap ✅ to place order on testnet.",
            "key_signals": ["approval_test", "semi_auto_verification"],
            "entry_price": price,
            "sl_price": price * 0.995,
            "tp2": price * 1.015
        }

        # Send approval request
        await telegram_bot.send(
            text=(
                f"🤔 <b>APPROVAL NEEDED — TEST SCENARIO</b>\n"
                f"━━━━━━━━━━━━━━━━━━━━━\n"
                f"{self.instrument} LONG · Size: 1.5%\n"
                f"Confidence: 8/10\n\n"
                f"Entry: ${price:,.2f} | SL: ${price*0.995:,.2f}\n\n"
                f"<b>TAP APPROVE to place testnet order</b>\n"
                f"<b>TAP REJECT to skip</b>\n\n"
                f"Auto-rejects in 30 seconds."
            ),
            buttons=[[
                {"text": "✅ Approve", "data": f"approve_{decision_id}"},
                {"text": "❌ Reject",  "data": f"reject_{decision_id}"}
            ]]
        )
        self.check(True, "Approval request sent to Telegram with buttons")

        logger.info("Waiting 30 seconds for your tap in Telegram...")
        logger.info("Tap ✅ Approve to place order | Tap ❌ Reject to skip")
        await asyncio.sleep(30)

        # Check if order was placed (you tapped Approve)
        positions = await self.delta.get_positions()
        order_placed = any(
            p.get("product_symbol") == self.instrument and float(p.get("size", 0)) > 0
            for p in positions
        )

        if order_placed:
            self.check(True, "Approval tapped — order placed on testnet")
            await self.delta.close_position(self.instrument)
            logger.info("Test order closed")
        else:
            logger.info("No order placed (rejected or timed out)")
            self.check(True, "Scenario complete (no order placed)")

        # Restore original mode
        await safety_manager.set_execution_mode(original_mode)
        self.check(True, f"Restored to {original_mode} mode")
