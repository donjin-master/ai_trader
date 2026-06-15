"""Options strategy selector — picks structure from direction + IV regime.

Runs AFTER the directional boardroom. Backend-only in V1.2 (UI in V1.3).
"""

from datetime import datetime, timezone

from loguru import logger

from backend.deps import delta_client

STRATEGIES = {
    # DIRECTIONAL — low to medium IV
    "long_call": {
        "when": "BULLISH direction + LOW/NORMAL IV",
        "max_loss": "premium paid",
        "max_gain": "unlimited",
        "theta": "negative (hurts you daily)",
    },
    "long_put": {
        "when": "BEARISH direction + LOW/NORMAL IV",
        "max_loss": "premium paid",
        "max_gain": "strike - 0",
        "theta": "negative",
    },
    "bull_call_spread": {
        "when": "BULLISH + NORMAL/HIGH IV",
        "max_loss": "net debit",
        "max_gain": "spread width - net debit",
        "theta": "slight negative",
    },
    "bear_put_spread": {
        "when": "BEARISH + NORMAL/HIGH IV",
        "max_loss": "net debit",
        "max_gain": "spread width - net debit",
        "theta": "slight negative",
    },
    # PREMIUM COLLECTION — high IV
    "short_strangle": {
        "when": "NEUTRAL + HIGH IV + ranging market",
        "max_loss": "unlimited (hedge required)",
        "max_gain": "net credit",
        "theta": "positive (earns daily)",
    },
    "iron_condor": {
        "when": "NEUTRAL + HIGH IV + range-bound",
        "max_loss": "defined (spread width - credit)",
        "max_gain": "net credit",
        "theta": "positive",
    },
    # VOLATILITY
    "long_straddle": {
        "when": "NEUTRAL direction + LOW IV + big move expected",
        "max_loss": "total premium",
        "max_gain": "unlimited",
        "theta": "very negative",
    },
}


class OptionsStrategySelector:
    """Maps (direction, conviction, IV regime, DTE prefs) → concrete legs."""

    def _pick_strategy(self, direction: str, conviction: int, regime: str) -> str:
        if direction == "long":
            if regime in ("LOW", "NORMAL"):
                return "long_call"
            return "bull_call_spread"
        if direction == "short":
            if regime in ("LOW", "NORMAL"):
                return "long_put"
            return "bear_put_spread"
        # neutral
        if regime in ("HIGH", "EXTREME"):
            return "iron_condor" if conviction < 7 else "short_strangle"
        return "long_straddle"

    async def _chain_for_expiry(self, underlying: str, dte_min: int, dte_max: int) -> tuple[list[dict], int]:
        from backend.perception.iv_analyser import iv_analyser

        options = await iv_analyser._fetch_option_tickers(underlying)
        now = datetime.now(timezone.utc).timestamp()

        def expiry_of(t: dict) -> int:
            parts = str(t.get("symbol", "")).split("-")
            if parts and len(parts[-1]) == 6 and parts[-1].isdigit():
                raw = parts[-1]
                try:
                    return int(datetime(
                        2000 + int(raw[4:6]), int(raw[2:4]), int(raw[0:2]),
                        12, 0, tzinfo=timezone.utc,
                    ).timestamp())
                except ValueError:
                    return 0
            return 0

        by_expiry: dict[int, list[dict]] = {}
        for t in options:
            e = expiry_of(t)
            if e > now:
                by_expiry.setdefault(e, []).append(t)

        # Prefer an expiry inside the DTE window; else the nearest beyond min
        in_window = sorted(
            e for e in by_expiry
            if dte_min <= (e - now) / 86400 <= dte_max
        )
        chosen = in_window[0] if in_window else (sorted(by_expiry)[ -1 ] if by_expiry else 0)
        if not in_window and by_expiry:
            # nearest expiry with at least dte_min days, else longest available
            beyond = sorted(e for e in by_expiry if (e - now) / 86400 >= dte_min)
            chosen = beyond[0] if beyond else sorted(by_expiry)[-1]
        return by_expiry.get(chosen, []), chosen

    @staticmethod
    def _mark(t: dict) -> float:
        try:
            return float(t.get("mark_price") or 0)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _strike(t: dict) -> float:
        try:
            return float(t.get("strike_price") or 0)
        except (TypeError, ValueError):
            return 0.0

    def _nearest(self, chain: list[dict], contract_type: str, target_strike: float) -> dict | None:
        candidates = [t for t in chain if t.get("contract_type") == contract_type and self._strike(t) > 0]
        if not candidates:
            return None
        return min(candidates, key=lambda t: abs(self._strike(t) - target_strike))

    async def select_strategy(
        self,
        direction: str,
        conviction: int,
        iv_snapshot: dict,
        days_to_expiry: int,
        max_loss_pct: float,
        instrument: str = "BTCUSD",
        total_capital: float = 50000.0,
        dte_min: int = 7,
        dte_max: int = 21,
    ) -> dict:
        regime = iv_snapshot.get("iv_regime", "NORMAL")
        spot = float(iv_snapshot.get("spot") or 0)
        max_loss_budget = total_capital * max_loss_pct / 100

        chain, expiry = await self._chain_for_expiry(instrument, dte_min, dte_max)
        if not chain or not spot:
            return {
                "strategy": "none", "available": False,
                "reason": "no options chain in the preferred DTE window",
                "meta": {},
            }
        
        expiry_str = datetime.fromtimestamp(expiry, tz=timezone.utc).strftime("%d%b%Y").upper()
        dte = round((expiry - datetime.now(timezone.utc).timestamp()) / 86400, 1)

        filtered_chain = []
        for opt in chain:
            strike = self._strike(opt)
            if strike > 0 and spot * 0.9 <= strike <= spot * 1.1:
                filtered_chain.append({
                    "symbol": opt.get("symbol"),
                    "contract_type": opt.get("contract_type"),
                    "strike": strike,
                    "mark_price": self._mark(opt),
                })
        
        from backend.ai.agents import _call_gemini, _strip_json_fences
        import json

        strategies_list = list(STRATEGIES.keys())
        prompt = f"""You are the Options Council AI.
Direction Bias: {direction}
Conviction: {conviction}/10
IV Regime: {regime} (Expected move: {iv_snapshot.get('expected_move_pct')}%)
Spot Price: {spot}
Max Budget INR: {max_loss_budget}

Available Options (+/- 10% spot, expiry {expiry_str}, DTE {dte}):
{json.dumps(filtered_chain, indent=2)}

Select the optimal strategy from: {strategies_list}
Output JSON:
{{
  "strategy": "one of the allowed strategies",
  "reasoning": "why you chose this strategy and these strikes based on liquidity/greeks",
  "legs": [
    {{"symbol": "OPT-...", "action": "buy" or "sell", "type": "call" or "put", "quantity": 1}}
  ]
}}
"""
        raw = await _call_gemini("gemini-2.5-flash", prompt, "Options Council")
        try:
            ai_decision = json.loads(_strip_json_fences(raw))
            strategy = ai_decision.get("strategy")
            meta = STRATEGIES.get(strategy, {"when": "AI picked", "max_loss": "unknown", "max_gain": "unknown", "theta": "unknown"})
            legs = []
            for ai_leg in ai_decision.get("legs", []):
                opt = next((o for o in chain if o.get("symbol") == ai_leg.get("symbol")), None)
                if opt:
                    legs.append({
                        "action": ai_leg.get("action", "buy"),
                        "type": ai_leg.get("type", "call"),
                        "strike": self._strike(opt),
                        "expiry": expiry_str,
                        "quantity": ai_leg.get("quantity", 1),
                        "symbol": opt.get("symbol"),
                        "mark_price": self._mark(opt)
                    })
        except Exception as e:
            logger.error(f"Options AI parsing failed: {e}")
            return {"strategy": "error", "available": False, "reason": f"AI failed: {e}", "meta": {}}

        if not legs:
            return {"strategy": strategy, "available": False,
                    "reason": "could not assemble legs from AI response", "meta": meta}

        debit = sum(l["mark_price"] for l in legs if l["action"] == "buy")
        credit = sum(l["mark_price"] for l in legs if l["action"] == "sell")
        net = debit - credit  # positive = net debit

        strikes = sorted({l["strike"] for l in legs})
        width = (strikes[-1] - strikes[0]) if len(strikes) > 1 else None
        if strategy in ("long_call", "long_put", "long_straddle"):
            max_loss, max_gain = net, None  # unlimited / spot-bounded
            breakeven = (
                [strikes[0] + net] if strategy == "long_call"
                else [strikes[0] - net] if strategy == "long_put"
                else [strikes[0] - net, strikes[0] + net]
            )
        elif strategy in ("bull_call_spread", "bear_put_spread"):
            max_loss, max_gain = net, (width or 0) - net
            breakeven = [strikes[0] + net] if strategy == "bull_call_spread" else [strikes[-1] - net]
        elif strategy == "iron_condor":
            inner = sorted({l["strike"] for l in legs if l["action"] == "sell"})
            outer = sorted({l["strike"] for l in legs if l["action"] == "buy"})
            wing = min(abs(outer[0] - inner[0]), abs(outer[-1] - inner[-1])) if outer and inner else 0
            max_loss, max_gain = wing - (-net), -net  # net is negative (credit)
            breakeven = [inner[0] + net, inner[-1] - net] if inner else []
        else:  # short_strangle
            max_loss, max_gain = None, -net  # unlimited risk
            breakeven = [strikes[0] + (-net), strikes[-1] - (-net)] if len(strikes) > 1 else []

        # Theta estimate from greeks if present
        theta = 0.0
        for l in legs:
            t = next((o for o in chain if o.get("symbol") == l["symbol"]), {})
            g = t.get("greeks") or {}
            try:
                leg_theta = float(g.get("theta") or 0)
            except (TypeError, ValueError):
                leg_theta = 0.0
            theta += leg_theta if l["action"] == "buy" else -leg_theta

        within_budget = max_loss is None or max_loss <= max_loss_budget
        result = {
            "available": True,
            "strategy": strategy,
            "meta": meta,
            "instrument": legs[0]["symbol"],
            "legs": legs,
            "dte": dte,
            "net_debit": round(net, 2),
            "max_loss_inr": round(max_loss, 2) if max_loss is not None else None,
            "max_gain_inr": round(max_gain, 2) if max_gain is not None else None,
            "max_loss_budget_inr": round(max_loss_budget, 2),
            "within_budget": within_budget,
            "breakeven": [round(b, 1) for b in breakeven],
            "theta_per_day": round(theta, 2),
            "reasoning": (
                f"{direction.upper()} conviction {conviction} + IV {regime} "
                f"({iv_snapshot.get('atm_iv')}% ATM, pct {iv_snapshot.get('iv_percentile')}) "
                f"→ {strategy}. {meta['when']}. DTE {dte}."
            ),
        }
        logger.info("Options strategy selected: {} ({} legs, max loss {})",
                    strategy, len(legs), result["max_loss_inr"])
        return result


options_selector = OptionsStrategySelector()


# ---------------------------------------------------------------------------
# Options position management rules (V1.2 backend logic; UI in V1.3)
# ---------------------------------------------------------------------------

OPTIONS_MANAGEMENT_RULES = {
    "loss_limit_pct_of_premium": -50,      # close at -50% of premium paid
    "profit_target_pct_of_premium": 100,   # +100% on long options
    "credit_profit_target_pct": 50,        # 50% of max profit on credit spreads
    "close_at_dte": 2,                     # never hold inside 2 DTE (gamma risk)
    "theta_alert_pct_of_value": 5,         # alert if daily theta > 5% of value
}


def assess_options_position(position: dict, dte: float, premium_paid: float,
                            current_value: float, is_credit: bool) -> dict:
    """Pure decision function for an options position. Returns action + reason."""
    rules = OPTIONS_MANAGEMENT_RULES
    pnl_pct = ((current_value - premium_paid) / premium_paid * 100) if premium_paid else 0
    if is_credit:
        pnl_pct = -pnl_pct  # credit positions profit when value decays

    if dte <= rules["close_at_dte"]:
        return {"action": "CLOSE", "reason": f"{dte} DTE ≤ {rules['close_at_dte']} — gamma risk"}
    if pnl_pct <= rules["loss_limit_pct_of_premium"]:
        return {"action": "CLOSE", "reason": f"loss {pnl_pct:.0f}% hit -50% premium limit"}
    if is_credit and pnl_pct >= rules["credit_profit_target_pct"]:
        return {"action": "CLOSE", "reason": f"captured {pnl_pct:.0f}% of max credit profit"}
    if not is_credit and pnl_pct >= rules["profit_target_pct_of_premium"]:
        return {"action": "CLOSE", "reason": f"profit {pnl_pct:.0f}% hit +100% target"}
    return {"action": "HOLD", "reason": f"pnl {pnl_pct:.0f}%, {dte} DTE — within rules"}
