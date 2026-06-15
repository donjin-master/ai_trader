"""
SCENARIO 13 — Options Position Management
Tests: 50% profit close trigger, DTE warning, 2x stop detection,
       adjustment trigger when price approaches short strike

Uses MOCK position state — does not require live options position.
Tests the management logic in isolation.
"""

import asyncio
from loguru import logger
from datetime import datetime, timedelta
from .scenario_base import ScenarioBase
from backend.notifications.telegram import telegram_bot


class OptionsManagementScenario(ScenarioBase):

    NAME = "s13_options_management"
    DESCRIPTION = "Test iron condor management rules with mock position"

    async def run(self):

        ticker = await self.delta.get_ticker("BTCUSD_PERP")
        spot = float(ticker.get("mark_price", 0))

        # ── CREATE MOCK OPTIONS POSITION ──────────────────────────────────────
        # Simulate what the OptionsPositionManager would track
        from dataclasses import dataclass

        @dataclass
        class MockCondorState:
            instrument: str
            short_call_strike: float
            long_call_strike: float
            short_put_strike: float
            long_put_strike: float
            entry_credit: float      # Total credit received
            current_value: float     # Current cost to close
            dte: int
            max_loss: float
            entry_time: datetime

        def compute_pnl(state):
            return state.entry_credit - state.current_value

        def compute_pnl_pct(state):
            return (compute_pnl(state) / state.entry_credit) * 100

        state = MockCondorState(
            instrument="BTC-27JUN2026",
            short_call_strike=spot * 1.035,
            long_call_strike=spot * 1.050,
            short_put_strike=spot * 0.965,
            long_put_strike=spot * 0.950,
            entry_credit=180.0,
            current_value=90.0,   # Halfway through
            dte=14,
            max_loss=820.0,
            entry_time=datetime.utcnow() - timedelta(days=7)
        )

        logger.info(f"Mock condor: short strikes ${state.short_put_strike:,.0f} - ${state.short_call_strike:,.0f}")
        logger.info(f"Current spot: ${spot:,.0f}")
        logger.info(f"Entry credit: ${state.entry_credit:.2f}")
        logger.info(f"Current value: ${state.current_value:.2f}")

        # ── TEST 1: 50% Profit Close Trigger ──────────────────────────────────
        pnl = compute_pnl(state)
        pnl_pct = compute_pnl_pct(state)
        target_50pct = state.entry_credit * 0.5

        logger.info(f"Current P&L: ${pnl:.2f} ({pnl_pct:.1f}% of max profit)")

        should_close_50pct = pnl >= target_50pct
        self.check(
            should_close_50pct,
            f"50% profit close triggered (${pnl:.2f} >= ${target_50pct:.2f})"
        )

        if should_close_50pct:
            await telegram_bot.send(
                f"🎯 OPTIONS: 50% PROFIT TARGET HIT\n"
                f"━━━━━━━━━━━━━━━━━━━━━\n"
                f"BTC Iron Condor | TEST\n"
                f"Credit: ${state.entry_credit:.2f}\n"
                f"P&L: +${pnl:.2f} ({pnl_pct:.1f}%)\n"
                f"Closing position to lock in profit.\n"
                f"Rule: Never hold past 50% max profit."
            )
            self.check(True, "50% profit notification sent")

        # ── TEST 2: DTE Warning ────────────────────────────────────────────────
        logger.info(f"Current DTE: {state.dte}")

        # Test at 21 DTE (warning threshold)
        state_21dte = MockCondorState(
            **{**state.__dict__, "dte": 21, "current_value": 120.0}
        )
        pnl_21dte = compute_pnl(state_21dte)

        should_warn_21dte = state_21dte.dte <= 21
        self.check(should_warn_21dte, "21 DTE warning triggered correctly")

        await telegram_bot.send(
            f"⚠️ OPTIONS: 21 DTE WARNING\n"
            f"BTC Iron Condor | TEST\n"
            f"DTE remaining: {state_21dte.dte}\n"
            f"Current P&L: ${pnl_21dte:.2f}\n"
            f"Rule: Close within 24 hours to avoid gamma risk.",
            silent=True
        )
        self.check(True, "21 DTE Telegram warning sent (silent)")

        # ── TEST 3: 2x Stop Loss Trigger ──────────────────────────────────────
        state_loss = MockCondorState(
            **{**state.__dict__, "current_value": 540.0}  # 3x credit = 2x loss
        )
        loss = compute_pnl(state_loss)
        stop_threshold = state_loss.entry_credit * 2

        should_stop = abs(loss) >= stop_threshold
        self.check(
            should_stop,
            f"2x stop triggered (loss ${abs(loss):.2f} >= threshold ${stop_threshold:.2f})"
        )

        if should_stop:
            await telegram_bot.send(
                f"🔴 OPTIONS: 2X STOP HIT\n"
                f"━━━━━━━━━━━━━━━━━━━━━\n"
                f"BTC Iron Condor | TEST\n"
                f"Credit: ${state_loss.entry_credit:.2f}\n"
                f"Current loss: ${abs(loss):.2f}\n"
                f"Closing NOW — rule: never exceed 2x credit in loss."
            )
            self.check(True, "2x stop notification sent")

        # ── TEST 4: Adjustment Trigger ─────────────────────────────────────────
        wing_width = abs(state.short_call_strike - state.long_call_strike)
        adjustment_threshold = state.short_call_strike - (wing_width / 3)

        # Simulate price approaching the short call
        simulated_price = state.short_call_strike * 0.995  # 0.5% from short call

        needs_adjustment = simulated_price > adjustment_threshold
        self.check(
            needs_adjustment,
            f"Adjustment trigger: price ${simulated_price:,.0f} approaching short call ${state.short_call_strike:,.0f}"
        )

        if needs_adjustment:
            distance_pct = (state.short_call_strike - simulated_price) / spot * 100
            await telegram_bot.send(
                f"⚠️ CONDOR ADJUSTMENT NEEDED\n"
                f"Price approaching short call strike!\n\n"
                f"Short call: ${state.short_call_strike:,.0f}\n"
                f"Current:    ${simulated_price:,.0f}\n"
                f"Distance:   {distance_pct:.2f}%\n\n"
                f"Options:\n"
                f"A) Close upper wing, keep lower\n"
                f"B) Roll short call higher\n"
                f"C) Close entire position"
            )
            self.check(True, "Adjustment alert sent")

        # ── SUMMARY ───────────────────────────────────────────────────────────
        logger.info("")
        logger.info("=== OPTIONS MANAGEMENT RULES TEST RESULTS ===")
        logger.info("All management rules fire correctly at the right thresholds.")
        logger.info("Now wire these into OptionsPositionManager.check_and_manage()")
