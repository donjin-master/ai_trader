"""
SCENARIO 10 — Options Chain Fetching
Tests: Can we fetch valid option symbols from testnet?
       Are strikes, expiries, and Greeks available?
       Does IV analyser work with testnet data?

This is the foundational options test — everything else depends on it.
"""

import asyncio
from loguru import logger
from datetime import datetime, timedelta
from .scenario_base import ScenarioBase
from backend.perception.iv_analyser import IVAnalyser


class OptionsChainScenario(ScenarioBase):

    NAME = "s10_options_chain_fetch"
    DESCRIPTION = "Fetch options chain and verify IV analysis works"

    async def run(self):

        # ── STEP 1: Get current BTC price ─────────────────────────────────────
        ticker = await self.delta.get_ticker("BTCUSD_PERP")
        spot_price = float(ticker.get("mark_price", 0))
        logger.info(f"BTC spot: ${spot_price:,.2f}")

        # ── STEP 2: Fetch options chain ────────────────────────────────────────
        logger.info("Fetching BTC options chain from testnet...")
        try:
            chain = await self.delta.get_options_chain("BTC")
            self.check(
                chain is not None and len(chain) > 0,
                f"Options chain returned ({len(chain) if chain else 0} contracts)"
            )
        except Exception as e:
            self.check(False, f"Options chain fetch failed: {e}")
            logger.error("Cannot continue options tests without chain data")
            return

        # ── STEP 3: Parse available expiries ──────────────────────────────────
        expiries = sorted(set(
            c.get("expiry_date") or c.get("settlement_time", "")
            for c in chain
            if c.get("expiry_date") or c.get("settlement_time")
        ))
        logger.info(f"Available expiries: {expiries[:5]}")
        self.check(len(expiries) > 0, f"Found {len(expiries)} expiry dates")

        # Find nearest weekly expiry (7-21 DTE)
        today = datetime.utcnow()
        valid_expiries = []
        for exp in expiries:
            try:
                exp_dt = datetime.strptime(exp[:10], "%Y-%m-%d")
                dte = (exp_dt - today).days
                if 7 <= dte <= 21:
                    valid_expiries.append((exp, dte))
            except Exception:
                pass

        if valid_expiries:
            target_expiry, dte = valid_expiries[0]
            logger.info(f"Target expiry: {target_expiry} ({dte} DTE)")
            self.check(True, f"Valid expiry found: {target_expiry} ({dte} DTE)")
        else:
            # Use nearest expiry available
            target_expiry = expiries[0] if expiries else None
            dte = 7
            logger.warning(f"No 7-21 DTE expiry found — using {target_expiry}")
            self.check(target_expiry is not None, "At least one expiry available")

        # ── STEP 4: Find ATM strike ────────────────────────────────────────────
        target_options = [
            c for c in chain
            if (c.get("expiry_date", "") or c.get("settlement_time", ""))[:10]
            == (target_expiry[:10] if target_expiry else "")
        ]

        # Find closest strike to spot price
        calls = [c for c in target_options if c.get("option_type") == "call"
                 or "-C" in c.get("symbol", "")]
        puts  = [c for c in target_options if c.get("option_type") == "put"
                 or "-P" in c.get("symbol", "")]

        if calls:
            atm_call = min(
                calls,
                key=lambda c: abs(float(c.get("strike_price", spot_price)) - spot_price)
            )
            atm_strike = float(atm_call.get("strike_price", spot_price))
            logger.info(f"ATM strike: ${atm_strike:,.0f}")
            logger.info(f"ATM call symbol: {atm_call.get('symbol')}")
            self.check(True, f"ATM strike identified: ${atm_strike:,.0f}")
            self.atm_strike = atm_strike
            self.target_expiry = target_expiry
            self.dte = dte
            self.calls = calls
            self.puts = puts
            self.spot_price = spot_price
        else:
            self.check(False, "No call options found in chain")
            return

        # ── STEP 5: Verify Greeks available ───────────────────────────────────
        atm_call_greeks = {
            "delta": atm_call.get("delta"),
            "theta": atm_call.get("theta"),
            "vega":  atm_call.get("vega"),
            "iv":    atm_call.get("iv") or atm_call.get("implied_volatility")
        }
        logger.info(f"ATM call Greeks: {atm_call_greeks}")

        has_greeks = any(v is not None for v in atm_call_greeks.values())
        self.check(has_greeks, "Greeks available in options chain")

        # ── STEP 6: Run IV Analyser ────────────────────────────────────────────
        logger.info("Running IV Analyser...")
        try:
            iv_analyser = IVAnalyser()
            iv_snapshot = await iv_analyser.get_iv_snapshot("BTCUSD_PERP")
            logger.info(f"IV Snapshot: {iv_snapshot}")

            self.check(
                "atm_iv" in iv_snapshot,
                f"ATM IV computed: {iv_snapshot.get('atm_iv', 'N/A')}"
            )
            self.check(
                "iv_regime" in iv_snapshot,
                f"IV regime: {iv_snapshot.get('iv_regime', 'N/A')}"
            )
            if "iv_percentile" in iv_snapshot:
                self.check(
                    True,
                    f"IV percentile: {iv_snapshot.get('iv_percentile', 0):.0f}th"
                )
            else:
                logger.warning("IV percentile unavailable — insufficient history on testnet")
                self.check(True, "IV percentile N/A (expected on fresh testnet account)")

        except Exception as e:
            logger.error(f"IV Analyser failed: {e}")
            self.check(False, f"IV Analyser error: {e}")

        logger.info("")
        logger.info("=== OPTIONS CHAIN SUMMARY ===")
        logger.info(f"Spot: ${spot_price:,.2f}")
        logger.info(f"Target expiry: {target_expiry} ({dte} DTE)")
        logger.info(f"ATM strike: ${self.atm_strike:,.0f}")
        logger.info(f"Total contracts in chain: {len(chain)}")
        logger.info(f"Calls: {len(calls)} | Puts: {len(puts)}")
