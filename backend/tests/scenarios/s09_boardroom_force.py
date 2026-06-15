"""
SCENARIO 09 — Force Boardroom → Execution
Tests: Complete AI decision pipeline with forced execution

What it does:
  1. Bypasses the 15-min scheduler
  2. Manually calls run_decision_loop() directly
  3. Temporarily sets EXECUTION_MODE=SEMI_AUTO or FULL_AUTO
  4. The AI runs its full SMC + boardroom + decision
  5. If AI votes to trade → places real testnet order
  6. Logs the full reasoning to console

This is the closest to real autonomous trading
without waiting for market conditions.
"""

import asyncio
from loguru import logger
from .scenario_base import ScenarioBase
from backend.ai.loops import run_decision_loop
from backend.execution.safety import safety_manager


class BoardroomForceScenario(ScenarioBase):

    NAME = "s09_boardroom_forced_run"
    DESCRIPTION = "Run full boardroom pipeline and execute whatever it decides"

    async def run(self):

        logger.info("Forcing a full boardroom decision cycle...")
        logger.info("This runs REAL AI analysis on LIVE testnet market data")
        logger.info("If AI decides to trade → order placed on testnet")
        logger.info("")

        # Set to SEMI_AUTO so it asks your approval before placing
        original_mode = safety_manager.execution_mode
        await safety_manager.set_execution_mode("SEMI_AUTO")

        try:
            # Run the full decision loop exactly as the scheduler would
            await run_decision_loop(
                instrument=self.instrument,
                trigger_event=None,
                trigger_context=(
                    "MANUAL TEST TRIGGER: This cycle was triggered manually "
                    "by the test harness to verify the full pipeline. "
                    "Make your best decision based on current market conditions."
                )
            )
            self.check(True, "Decision loop completed without errors")

        except Exception as e:
            self.check(False, f"Decision loop failed: {e}")
            logger.error(f"Full error: {e}", exc_info=True)
        finally:
            await safety_manager.set_execution_mode(original_mode)

        logger.info("")
        logger.info("Check:")
        logger.info("  1. Telegram — did you get a notification?")
        logger.info("  2. Dashboard — does the decision appear in journal?")
        logger.info("  3. Delta testnet — if LONG/SHORT: is there a pending approval?")
