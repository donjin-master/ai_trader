import asyncio
import os
import sys
from datetime import datetime
from loguru import logger
from backend.config import settings
from backend.delta.client import DeltaClient
from backend.notifications.telegram import telegram_bot
from backend.db.database import AsyncSessionLocal


class ScenarioBase:
    """
    Base class for all test scenarios.
    Handles setup, teardown, and result reporting.
    """

    NAME = "base_scenario"
    DESCRIPTION = "Override in subclass"

    def __init__(self):
        self.delta = DeltaClient()
        self.results = []
        self.start_time = None
        self.instrument = os.getenv("TEST_INSTRUMENT", "BTCUSD_PERP")

    async def setup(self):
        """Called before run(). Verify testnet connection."""
        logger.info(f"=== SCENARIO: {self.NAME} ===")
        logger.info(f"Instrument: {self.instrument}")
        logger.info(f"Environment: {settings.ENVIRONMENT}")

        # Hard safety check — never run on production
        if settings.ENVIRONMENT != "testnet":
            raise RuntimeError(
                "SAFETY BLOCK: Test scenarios only run on testnet. "
                "Set ENVIRONMENT=testnet in .env"
            )

        # Verify testnet connection
        try:
            ticker = await self.delta.get_ticker(self.instrument)
            price = ticker.get("mark_price") or ticker.get("close", 0)
            logger.info(f"Testnet connected. {self.instrument} price: ${float(price):,.2f}")
            self.current_price = float(price)
        except Exception as e:
            raise RuntimeError(f"Cannot connect to testnet: {e}")

        # Check wallet balance
        balance = await self.delta.get_wallet_balance()
        logger.info(f"Testnet wallet: {balance}")
        self.start_time = datetime.utcnow()

    async def run(self):
        """Override in subclass with actual test logic."""
        raise NotImplementedError

    async def teardown(self):
        """Called after run(). Cancels any open orders left by the test."""
        logger.info(f"--- TEARDOWN: {self.NAME} ---")
        try:
            cancelled = await self.delta.cancel_all_orders()
            logger.info(f"Cancelled {cancelled} open orders during teardown")
        except Exception as e:
            logger.warning(f"Teardown cleanup failed: {e}")

    def check(self, condition: bool, description: str):
        """Record a test assertion."""
        status = "PASS" if condition else "FAIL"
        self.results.append({"check": description, "status": status})
        icon = "✅" if condition else "❌"
        logger.info(f"{icon} {status}: {description}")
        return condition

    async def wait_for(
        self,
        condition_fn,
        timeout_seconds: int = 30,
        poll_interval: float = 2.0,
        description: str = "condition"
    ) -> bool:
        """Poll until condition is met or timeout."""
        logger.info(f"Waiting for: {description} (timeout: {timeout_seconds}s)")
        elapsed = 0
        while elapsed < timeout_seconds:
            result = await condition_fn()
            if result:
                logger.info(f"Condition met: {description} ({elapsed:.0f}s)")
                return True
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        logger.warning(f"TIMEOUT waiting for: {description}")
        return False

    def report(self) -> dict:
        """Generate test report."""
        total = len(self.results)
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        failed = total - passed
        duration = (datetime.utcnow() - self.start_time).total_seconds() if self.start_time else 0

        report = {
            "scenario": self.NAME,
            "total": total,
            "passed": passed,
            "failed": failed,
            "duration_seconds": round(duration, 1),
            "overall": "PASS" if failed == 0 else "FAIL",
            "checks": self.results
        }

        logger.info(f"")
        logger.info(f"=== RESULT: {self.NAME} ===")
        logger.info(f"Passed: {passed}/{total} | Duration: {duration:.1f}s")
        logger.info(f"Overall: {report['overall']}")

        return report
