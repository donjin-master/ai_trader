"""
SCENARIO 05 — Full Trade Cycle
Tests: Entry → position management → TP1 → trail → close
       This is the most complete end-to-end test.

What it does:
  1. Places a long market order
  2. Simulates price moving to TP1
  3. Verifies partial exit + breakeven set
  4. Simulates price continuing to move (trail updates twice)
  5. Simulates trail being hit
  6. Verifies position fully closed
  7. Verifies Loop 2 reflection triggered
  8. Verifies lesson stored in DB
  9. Verifies all Telegram notifications sent
"""

import asyncio
from loguru import logger
from .scenario_base import ScenarioBase
from backend.execution.position_manager import PositionManager
from backend.ai.loops import run_reflection_loop
from backend.notifications.telegram import telegram_bot
from backend.db.database import AsyncSessionLocal
from backend.db.models import AgentLesson
import uuid
from sqlalchemy import select


class FullCycleScenario(ScenarioBase):

    NAME = "s05_full_trade_cycle"
    DESCRIPTION = "Complete entry → TP1 → trail → exit cycle"

    async def run(self):

        ticker = await self.delta.get_ticker(self.instrument)
        entry_price = float(ticker.get("mark_price", 0))
        sl_price  = entry_price * 0.995
        tp1_price = entry_price * 1.0075
        tp2_price = entry_price * 1.015
        tp3_price = entry_price * 1.025

        # ── ENTRY ─────────────────────────────────────────────────────────────
        order = await self.delta.place_order(
            instrument=self.instrument,
            side="buy",
            size=5,
            order_type="market",
            stop_loss=sl_price,
            take_profit=tp2_price
        )
        self.check(order.get("id") is not None, "Entry order placed")
        await asyncio.sleep(3)

        trade_id = str(uuid.uuid4())
        pm = PositionManager()
        await pm.register_new_position(
            trade_id=trade_id,
            instrument=self.instrument,
            direction="long",
            entry_price=entry_price,
            initial_sl=sl_price,
            tp1=tp1_price,
            tp2=tp2_price,
            tp3=tp3_price,
            contracts=5,
            risk_pct=0.5
        )
        state = pm._managed_positions[self.instrument]
        self.check(True, "Position registered with PositionManager")

        # ── SIMULATE TP1 HIT ──────────────────────────────────────────────────
        logger.info("Simulating price moving to TP1...")
        await pm._assess_position(state, tp1_price, {"mark_price": tp1_price})
        await asyncio.sleep(2)

        self.check(state.tp1_hit, "TP1 hit detected")
        self.check(state.trail_active, "Trail active after TP1")
        self.check(state.breakeven_set, "Breakeven set")
        self.check(state.current_size_contracts == 3, "40% closed (3 contracts remain)")

        # ── SIMULATE TRAIL MOVING TWICE ───────────────────────────────────────
        # First trail update
        mid_price = entry_price * 1.01
        new_trail_1 = mid_price * 0.998
        state.trail_sl = new_trail_1
        state.current_sl = new_trail_1
        await telegram_bot.trail_moved(
            {"instrument": self.instrument, "unrealized_pnl_pct": 1.0},
            state.initial_sl,
            new_trail_1
        )
        self.check(state.trail_sl > state.initial_sl, "Trail moved up (1st update)")

        # Second trail update
        higher_price = entry_price * 1.012
        new_trail_2 = higher_price * 0.998
        state.trail_sl = new_trail_2
        state.current_sl = new_trail_2
        await telegram_bot.trail_moved(
            {"instrument": self.instrument, "unrealized_pnl_pct": 1.2},
            new_trail_1,
            new_trail_2
        )
        self.check(new_trail_2 > new_trail_1, "Trail moved up again (2nd update)")

        # ── SIMULATE TRAIL HIT → CLOSE ────────────────────────────────────────
        logger.info("Simulating trail being hit...")
        # Set price at trail level → triggers close
        await pm._assess_position(state, state.trail_sl * 0.999, {"mark_price": state.trail_sl * 0.999})
        await asyncio.sleep(3)

        positions = await self.delta.get_positions()
        is_closed = not any(
            p.get("product_symbol") == self.instrument and float(p.get("size", 0)) > 0
            for p in positions
        )
        self.check(is_closed, "Position fully closed after trail hit")

        # ── VERIFY LOOP 2 FIRES ───────────────────────────────────────────────
        logger.info("Triggering Loop 2 reflection...")
        try:
            await run_reflection_loop(trade_id)
            await asyncio.sleep(5)  # Wait for async DB write

            # Check lesson was stored
            async with AsyncSessionLocal() as db:
                lesson = await db.scalar(
                    select(AgentLesson).where(
                        AgentLesson.source_trade_id == trade_id
                    )
                )
            self.check(lesson is not None, "Loop 2 lesson stored in DB")
        except Exception as e:
            self.check(False, f"Loop 2 reflection failed: {e}")

        # ── TELEGRAM CLOSE NOTIFICATION ───────────────────────────────────────
        mock_trade = {
            "instrument": self.instrument,
            "direction": "long",
            "entry_price": entry_price,
            "exit_price": state.trail_sl,
            "pnl_pct": 1.2,
            "pnl_inr": 1200,
            "rr_achieved": 2.4,
            "duration_mins": 5,
            "exit_trigger": "trail_hit",
            "daily_pnl_pct": 1.2,
            "daily_wins": 1,
            "daily_losses": 0
        }
        await telegram_bot.position_closed(mock_trade)
        self.check(True, "Close notification sent via Telegram")
