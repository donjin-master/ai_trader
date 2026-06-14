"""IV regime detection from the Delta Exchange options chain."""

from datetime import datetime, timezone

from loguru import logger
from sqlalchemy import select

from backend.db.database import AsyncSessionLocal
from backend.db.models import MarketSnapshot
from backend.deps import delta_client


class IVAnalyser:
    """Computes ATM IV, percentile rank, skew, term structure, expected move."""

    async def _fetch_option_tickers(self, underlying: str) -> list[dict]:
        data = await delta_client._request(
            "GET",
            "/v2/tickers",
            params={"contract_types": "call_options,put_options"},
        )
        tickers = data.get("result", [])
        prefix = underlying.replace("USD", "")  # BTCUSD -> BTC
        return [
            t for t in tickers
            if (t.get("underlying_asset_symbol") or t.get("symbol", "")).startswith(prefix)
            or f"-{prefix}-" in t.get("symbol", "")
        ]

    @staticmethod
    def _iv_of(ticker: dict) -> float | None:
        for key in ("mark_vol", "iv"):
            v = ticker.get(key)
            if v is not None:
                try:
                    iv = float(v)
                    return iv * 100 if iv < 3 else iv  # normalise fraction → %
                except (TypeError, ValueError):
                    continue
        greeks = ticker.get("greeks") or {}
        v = greeks.get("iv") or greeks.get("vega_iv")
        try:
            iv = float(v)
            return iv * 100 if iv < 3 else iv
        except (TypeError, ValueError):
            return None

    async def _iv_percentile(self, current_iv: float) -> float | None:
        """Percentile vs IV values stored in market_snapshots over ~30 days."""
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    select(MarketSnapshot.iv)
                    .where(MarketSnapshot.iv.is_not(None))
                    .order_by(MarketSnapshot.created_at.desc())
                    .limit(2880)  # ~30 days of 15-min snapshots
                )
                history = [float(v) for (v,) in result.all() if v is not None]
            if len(history) < 20:
                return None  # not enough history to rank honestly
            below = sum(1 for v in history if v < current_iv)
            return round(below / len(history) * 100, 1)
        except Exception:
            logger.exception("IV percentile lookup failed")
            return None

    async def get_iv_snapshot(self, instrument: str = "BTCUSD") -> dict:
        from backend.execution.risk_profile import risk_manager

        try:
            profile = await risk_manager.get_profile()
        except Exception:
            profile = {}
        low_th = profile.get("iv_regime_threshold_low", 30)
        high_th = profile.get("iv_regime_threshold_high", 70)

        spot_ticker = await delta_client.get_ticker(instrument)
        spot = float(spot_ticker.get("close") or spot_ticker.get("spot_price") or 0)

        options = await self._fetch_option_tickers(instrument)
        if not options or not spot:
            return {
                "available": False,
                "reason": "no options chain data for this underlying",
                "atm_iv": None, "iv_percentile": None, "iv_regime": "UNKNOWN",
                "skew": "NEUTRAL", "expected_move_pct": None,
                "term_structure": "UNKNOWN", "best_strategy_type": "NEUTRAL",
            }

        def strike(t: dict) -> float:
            try:
                return float(t.get("strike_price") or 0)
            except (TypeError, ValueError):
                return 0.0

        def expiry_ts(t: dict) -> int:
            st = t.get("settlement_time") or t.get("expiry_time")
            if st:
                try:
                    return int(datetime.fromisoformat(str(st).replace("Z", "+00:00")).timestamp())
                except ValueError:
                    pass
            # Fallback: parse DDMMYY from symbol like C-BTC-63800-130626
            parts = str(t.get("symbol", "")).split("-")
            if parts and len(parts[-1]) == 6 and parts[-1].isdigit():
                raw = parts[-1]
                try:
                    return int(datetime(
                        2000 + int(raw[4:6]), int(raw[2:4]), int(raw[0:2]),
                        12, 0, tzinfo=timezone.utc,  # Delta daily expiry 17:30 IST ≈ 12:00 UTC
                    ).timestamp())
                except ValueError:
                    pass
            return 0

        # Nearest expiry chain
        expiries = sorted({expiry_ts(t) for t in options if expiry_ts(t) > 0})
        near_exp = expiries[0] if expiries else 0
        far_exp = expiries[-1] if len(expiries) > 1 else near_exp
        near_chain = [t for t in options if expiry_ts(t) == near_exp] or options

        # ATM = strike closest to spot
        atm_strike = min({strike(t) for t in near_chain if strike(t) > 0},
                         key=lambda s: abs(s - spot), default=0)
        atm_calls = [t for t in near_chain if strike(t) == atm_strike and "C" in t.get("contract_type", "").upper() or
                     (strike(t) == atm_strike and t.get("contract_type") == "call_options")]
        atm_puts = [t for t in near_chain if strike(t) == atm_strike and t.get("contract_type") == "put_options"]
        atm_calls = [t for t in near_chain if strike(t) == atm_strike and t.get("contract_type") == "call_options"]

        call_iv = next((self._iv_of(t) for t in atm_calls if self._iv_of(t)), None)
        put_iv = next((self._iv_of(t) for t in atm_puts if self._iv_of(t)), None)
        ivs = [v for v in (call_iv, put_iv) if v is not None]
        atm_iv = round(sum(ivs) / len(ivs), 2) if ivs else None

        if atm_iv is None:
            chain_ivs = [self._iv_of(t) for t in near_chain]
            chain_ivs = [v for v in chain_ivs if v]
            atm_iv = round(sum(chain_ivs) / len(chain_ivs), 2) if chain_ivs else None

        # Skew
        if call_iv is not None and put_iv is not None:
            diff = put_iv - call_iv
            skew = "PUT_SKEW" if diff > 2 else "CALL_SKEW" if diff < -2 else "NEUTRAL"
        else:
            skew = "NEUTRAL"

        # Expected move from ATM straddle (mark prices)
        def mark(t: dict) -> float:
            try:
                return float(t.get("mark_price") or 0)
            except (TypeError, ValueError):
                return 0.0

        straddle = (
            (mark(atm_calls[0]) if atm_calls else 0)
            + (mark(atm_puts[0]) if atm_puts else 0)
        )
        expected_move_pct = round(straddle / spot * 100, 2) if straddle and spot else None

        # Term structure: near vs far ATM IV
        term_structure = "UNKNOWN"
        if far_exp != near_exp:
            far_chain = [t for t in options if expiry_ts(t) == far_exp]
            far_ivs = [self._iv_of(t) for t in far_chain]
            far_ivs = [v for v in far_ivs if v]
            far_iv = sum(far_ivs) / len(far_ivs) if far_ivs else None
            if atm_iv is not None and far_iv is not None:
                spread = atm_iv - far_iv
                term_structure = (
                    "INVERTED" if spread > 3 else "FLAT" if abs(spread) <= 3 else "NORMAL"
                )

        iv_percentile = await self._iv_percentile(atm_iv) if atm_iv is not None else None
        ranked = iv_percentile if iv_percentile is not None else 50.0
        if ranked < 25:
            regime = "LOW"
        elif ranked <= 60:
            regime = "NORMAL"
        elif ranked <= 80:
            regime = "HIGH"
        else:
            regime = "EXTREME"

        if ranked < low_th:
            best = "BUY_OPTIONS"
        elif ranked > high_th:
            best = "SELL_OPTIONS"
        elif regime in ("HIGH",):
            best = "SPREAD"
        else:
            best = "NEUTRAL"

        snapshot = {
            "available": True,
            "underlying": instrument,
            "spot": spot,
            "atm_strike": atm_strike,
            "atm_iv": atm_iv,
            "iv_percentile": iv_percentile,
            "iv_regime": regime,
            "skew": skew,
            "expected_move_pct": expected_move_pct,
            "straddle_cost": round(straddle, 2) if straddle else None,
            "term_structure": term_structure,
            "best_strategy_type": best,
            "near_expiry_ts": near_exp,
            "chain_size": len(near_chain),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(
            "IV snapshot {}: ATM IV {} | pct {} | regime {} | exp move {}%",
            instrument, atm_iv, iv_percentile, regime, expected_move_pct,
        )
        return snapshot


iv_analyser = IVAnalyser()
