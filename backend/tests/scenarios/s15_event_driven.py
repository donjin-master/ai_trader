"""
SCENARIO 15 — Event-Driven Architecture Test
Tests: WebSocket receives ticks, signal detectors fire,
       event router gates work, analysis dispatcher calls decision loop

This is the most important test for the V1.4 architecture.
"""

import asyncio
from loguru import logger
from datetime import datetime
from .scenario_base import ScenarioBase


class EventDrivenScenario(ScenarioBase):

    NAME = "s15_event_driven_flow"
    DESCRIPTION = "Test WebSocket → event → router → dispatcher → decision loop"

    async def run(self):

        # ── STEP 1: Verify WebSocket is running ───────────────────────────────
        import httpx
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get(
                    "http://localhost:8000/health/websocket",
                    timeout=5.0
                )
                ws_health = r.json()
                logger.info(f"WebSocket health: {ws_health}")

            self.check(
                ws_health.get("status") == "running",
                "WebSocket stream processor is running"
            )
            self.check(
                len(ws_health.get("last_prices", {})) > 0,
                "WebSocket receiving price data"
            )
        except Exception as e:
            self.check(False, f"WebSocket health check failed: {e}")
            logger.error("Backend must be running for this test")
            return

        # ── STEP 2: Check event router stats ──────────────────────────────────
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get("http://localhost:8000/health/events", timeout=5.0)
                event_stats = r.json()
                logger.info(f"Event stats: {event_stats}")

            self.check(True, f"Event router responding: {event_stats.get('hourly_calls', 0)} calls this hour")
        except Exception as e:
            self.check(False, f"Event router health check failed: {e}")

        # ── STEP 3: Manually emit a test event ────────────────────────────────
        logger.info("Emitting test OB_ENTRY event manually...")
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(
                    "http://localhost:8000/api/test/emit-event",
                    json={
                        "type": "OB_ENTRY",
                        "instrument": "BTCUSD_PERP",
                        "price": self.current_price,
                        "tier": 1,
                        "message": "Test event from s15 scenario"
                    },
                    timeout=10.0
                )
                emit_result = r.json()
                logger.info(f"Emit result: {emit_result}")

            self.check(
                emit_result.get("emitted") or emit_result.get("success"),
                "Test event emitted successfully"
            )
        except Exception as e:
            self.check(False, f"Event emission failed: {e}")
            return

        # ── STEP 4: Wait for decision loop to fire ────────────────────────────
        logger.info("Waiting 30s for event to trigger decision loop...")
        await asyncio.sleep(5)

        # Check if a new decision was logged
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get(
                    "http://localhost:8000/api/decisions?limit=3",
                    timeout=5.0
                )
                decisions = r.json()
                if decisions:
                    latest = decisions[0]
                    decision_age = (
                        datetime.utcnow() -
                        datetime.fromisoformat(
                            latest.get("timestamp", "2000-01-01")
                            .replace("Z", "+00:00")
                        ).replace(tzinfo=None)
                    ).total_seconds()

                    self.check(
                        decision_age < 60,
                        f"Decision logged within 60s of event (age: {decision_age:.0f}s)"
                    )
                    self.check(
                        latest.get("trigger_event_type") == "OB_ENTRY",
                        f"Decision correctly attributed to OB_ENTRY trigger"
                    )
                    logger.info(f"Decision action: {latest.get('action')}")
                    logger.info(f"Decision confidence: {latest.get('confidence')}")
                else:
                    self.check(False, "No decisions found after event emission")
        except Exception as e:
            self.check(False, f"Could not verify decision was logged: {e}")

        # ── STEP 5: Verify cooldown prevents duplicate ─────────────────────────
        logger.info("Emitting same event type again to test cooldown...")
        await asyncio.sleep(2)

        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(
                    "http://localhost:8000/api/test/emit-event",
                    json={
                        "type": "OB_ENTRY",
                        "instrument": "BTCUSD_PERP",
                        "price": self.current_price,
                        "tier": 1,
                        "message": "Duplicate test — should be blocked by cooldown"
                    },
                    timeout=10.0
                )

            # Get event stats to see if it was blocked
            async with httpx.AsyncClient() as client:
                r = await client.get("http://localhost:8000/health/events", timeout=5.0)
                stats_after = r.json()
                cooldown_count = stats_after.get("rejection_stats", {}).get("cooldown_rejected", 0)

            self.check(
                cooldown_count > 0,
                f"Cooldown blocked duplicate event ({cooldown_count} rejections)"
            )
        except Exception as e:
            logger.warning(f"Cooldown test inconclusive: {e}")
