"""
SCENARIO 03 — Simulate TP1 Being Reached
Tests: Partial exit (40%), breakeven SL movement, trail activation,
       Telegram TP1 notification

What it does:
  1. Places a long order
  2. Manually calls the TP1 logic with current price as if TP was reached
  3. Verifies 40% partial close is placed
  4. Verifies SL update call is made (breakeven)
  5. Verifies trail is marked as active
  6. Sends TP1 Telegram notification
"""

import asyncio
from loguru import logger
from .scenario_base import ScenarioBase
from backend.execution.position_manager import PositionManager, PositionState
from backend.notifications.telegram import telegram_bot
from datetime import datetime
import uuid


class TP1HitScenario(ScenarioBase):

    NAME = "s03_tp1_hit_simulation"
    DESCRIPTION = "Simulate TP1 trigger and verify partial exit + breakeven"

    async def run(self):

        # ── STEP 1: Place initial long ────────────────────────────────────────
        ticker = await self.delta.get_ticker(self.instrument)
        entry_price = float(ticker.get("mark_price", 0))
        sl_price    = entry_price * 0.995
        tp1_price   = entry_price * 1.0075
        tp2_price   = entry_price * 1.015

        order = await self.delta.place_order(
            instrument=self.instrument,
            side="buy",
            size=5,          # 5 contracts so 40% = 2 contracts
            order_type="market",
            stop_loss=sl_price,
            take_profit=tp2_price
        )
        self.check(order.get("id") is not None, "Initial long placed (5 contracts)")
        await asyncio.sleep(3)

        # ── STEP 2: Create PositionState as if position manager registered it ─
        trade_id = str(uuid.uuid4())
        position_manager = PositionManager()

        await position_manager.register_new_position(
            trade_id=trade_id,
            instrument=self.instrument,
            direction="long",
            entry_price=entry_price,
            initial_sl=sl_price,
            tp1=tp1_price,
            tp2=tp2_price,
            tp3=None,
            contracts=5,
            risk_pct=0.5
        )
        self.check(
            self.instrument in position_manager._managed_positions,
            "Position registered with PositionManager"
        )

        # ── STEP 3: Manually trigger TP1 logic ───────────────────────────────
        # Pretend current price equals TP1
        state = position_manager._managed_positions[self.instrument]
        logger.info(f"Simulating TP1 hit at ${tp1_price:,.2f}")

        # Call the assessment with TP1 price as current
        # This tests the _assess_position logic directly
        await position_manager._assess_position(
            state=state,
            current_price=tp1_price,    # Price IS at TP1
            live_data={"mark_price": tp1_price}
        )

        # ── STEP 4: Verify state changed ─────────────────────────────────────
        self.check(state.tp1_hit, "TP1 flagged as hit in PositionState")
        self.check(state.breakeven_set, "Breakeven flag set")
        self.check(state.trail_active, "Trail marked as active")
        self.check(
            state.current_sl == state.entry_price,
            f"SL moved to entry (breakeven): ${state.current_sl:,.2f}"
        )
        self.check(
            state.current_size_contracts == 3,  # 40% of 5 = 2 closed, 3 remain
            f"Remaining contracts = 3 (was 5, closed 2)"
        )

        # ── STEP 5: Telegram TP1 notification ────────────────────────────────
        mock_position = {
            "instrument": self.instrument,
            "direction": "long",
            "tp1_price": tp1_price,
            "tp1_pnl_pct": 0.75,
            "entry_price": entry_price,
            "target_rr": 3.0
        }
        await telegram_bot.tp1_hit(mock_position)
        logger.info("TP1 Telegram notification sent")

        # ── STEP 6: Close remaining position ─────────────────────────────────
        await self.delta.close_position(self.instrument)
        logger.info("Remaining position closed")
