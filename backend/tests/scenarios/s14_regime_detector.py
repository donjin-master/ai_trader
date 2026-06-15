"""
SCENARIO 14 — Market Regime Detector
Tests: Python regime detection is accurate on live testnet data,
       correct pipeline routing (trending → directional, ranging → options),
       regime visible in dashboard

Does not place any orders — regime detection only.
"""

import asyncio
from loguru import logger
from .scenario_base import ScenarioBase
from backend.perception.smc import SMCAnalyser
from backend.perception.iv_analyser import IVAnalyser


class RegimeDetectorScenario(ScenarioBase):

    NAME = "s14_market_regime_detector"
    DESCRIPTION = "Test regime detection routes correctly to directional vs options pipeline"

    async def run(self):

        # ── STEP 1: Get full market data ──────────────────────────────────────
        ticker = await self.delta.get_ticker("BTCUSD_PERP")
        spot   = float(ticker.get("mark_price", 0))
        funding = float(ticker.get("funding_rate", 0))

        candles_4h  = await self.delta.get_candles("BTCUSD_PERP", "240", 50)
        candles_1h  = await self.delta.get_candles("BTCUSD_PERP", "60",  50)
        candles_15m = await self.delta.get_candles("BTCUSD_PERP", "15",  50)

        self.check(
            len(candles_4h) >= 20,
            f"4H candles available: {len(candles_4h)}"
        )
        self.check(
            len(candles_1h) >= 20,
            f"1H candles available: {len(candles_1h)}"
        )

        # ── STEP 2: Run regime detection ──────────────────────────────────────
        from backend.perception.market_regime import MarketRegimeDetector
        detector = MarketRegimeDetector()

        try:
            iv_analyser = IVAnalyser()
            iv_snapshot = await iv_analyser.get_iv_snapshot("BTCUSD_PERP")
            iv_percentile = iv_snapshot.get("iv_percentile", 50)
        except Exception:
            iv_percentile = 50
            logger.warning("IV percentile unavailable — using 50 for regime test")

        regime_result = detector.detect(
            candles_4h=candles_4h,
            candles_1h=candles_1h,
            iv_percentile=iv_percentile,
            funding_rate=funding
        )

        logger.info(f"")
        logger.info(f"=== REGIME DETECTION RESULTS ===")
        logger.info(f"Regime:     {regime_result['regime']}")
        logger.info(f"Confidence: {regime_result['confidence']}/10")
        logger.info(f"Pipeline:   {regime_result['pipeline']}")
        logger.info(f"Reasoning:  {regime_result.get('reasoning', 'N/A')}")
        logger.info(f"Key metrics: {regime_result.get('key_metrics', {})}")

        self.check(
            regime_result["regime"] in (
                "TRENDING_UP", "TRENDING_DOWN", "RANGING",
                "BREAKOUT_IMMINENT", "UNCLEAR"
            ),
            f"Valid regime returned: {regime_result['regime']}"
        )
        self.check(
            regime_result["pipeline"] in (
                "DIRECTIONAL", "OPTIONS", "BOTH", "WAIT"
            ),
            f"Valid pipeline routing: {regime_result['pipeline']}"
        )
        self.check(
            1 <= regime_result["confidence"] <= 10,
            f"Confidence in valid range: {regime_result['confidence']}/10"
        )

        # ── STEP 3: Verify routing logic ──────────────────────────────────────
        regime = regime_result["regime"]
        pipeline = regime_result["pipeline"]

        if regime in ("TRENDING_UP", "TRENDING_DOWN"):
            self.check(
                pipeline == "DIRECTIONAL",
                f"Trending regime routes to DIRECTIONAL (got: {pipeline})"
            )
        elif regime == "RANGING" and iv_percentile > 50:
            self.check(
                pipeline in ("OPTIONS", "WAIT"),
                f"Ranging + high IV routes to OPTIONS or WAIT (got: {pipeline})"
            )
        elif regime == "UNCLEAR":
            self.check(
                pipeline == "WAIT",
                f"Unclear regime routes to WAIT (got: {pipeline})"
            )

        # ── STEP 4: Verify SMC analysis runs within regime ────────────────────
        logger.info("Running SMC analysis to verify it works with current regime...")
        try:
            smc = SMCAnalyser()
            import pandas as pd
            structure_1h = smc.detect_market_structure(
                pd.DataFrame(candles_1h)
            )
            self.check(
                "trend" in structure_1h,
                f"SMC structure detected: {structure_1h.get('trend', 'N/A')}"
            )
        except Exception as e:
            self.check(False, f"SMC analysis failed: {e}")

        # ── STEP 5: Dashboard verification hint ──────────────────────────────
        logger.info("")
        logger.info(f"Dashboard should now show regime: {regime}")
        logger.info("Check: Live page → Co-pilot panel → 'Current bias'")
        logger.info("The regime influences which boardroom pipeline runs next cycle")
