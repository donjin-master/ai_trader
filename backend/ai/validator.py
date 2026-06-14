"""Post-LLM trade decision validation. The last line of defence before execution."""

from typing import Callable

from loguru import logger

from backend.deps import to_delta_symbol


class TradeDecisionValidator:
    """Validates a Judge decision against hard risk rules. Pure Python, no LLM."""

    VALID_INSTRUMENTS = [
        "BTCUSD_PERP", "ETHUSD_PERP",
        "BTC_USDT_PERP", "ETH_USDT_PERP",
    ]
    MIN_CONFIDENCE = 6
    MAX_SIZE_PCT = 2.0
    MIN_SIZE_PCT = 0.1

    def validate(self, decision: dict, portfolio: dict) -> tuple[bool, str]:
        """Returns (is_valid, rejection_reason). Runs all post-LLM checks."""
        checks: list[Callable[[dict, dict], tuple[bool, str]]] = [
            self._check_action_field,
            self._check_size_bounds,
            self._check_confidence_threshold,
            self._check_stop_loss_direction,
            self._check_instrument_valid,
            self._check_not_already_in_position,
        ]
        for check in checks:
            valid, reason = check(decision, portfolio)
            if not valid:
                logger.warning("Decision rejected: {}", reason)
                return False, reason
        return True, ""

    def _check_action_field(self, decision: dict, portfolio: dict) -> tuple[bool, str]:
        action = decision.get("action")
        if action not in ("long", "short", "hold"):
            return False, f"action '{action}' is not one of long/short/hold"
        return True, ""

    def _check_size_bounds(self, decision: dict, portfolio: dict) -> tuple[bool, str]:
        if decision.get("action") == "hold":
            return True, ""
        size = decision.get("size_pct")
        if not isinstance(size, (int, float)):
            return False, f"size_pct '{size}' is not a number"
        if size > self.MAX_SIZE_PCT:
            return False, f"size_pct {size} exceeds max {self.MAX_SIZE_PCT}"
        if size < self.MIN_SIZE_PCT:
            return False, f"size_pct {size} below min {self.MIN_SIZE_PCT}"
        return True, ""

    def _check_confidence_threshold(self, decision: dict, portfolio: dict) -> tuple[bool, str]:
        if decision.get("action") == "hold":
            return True, ""
        confidence = decision.get("confidence")
        if not isinstance(confidence, int) or confidence < self.MIN_CONFIDENCE:
            return False, f"confidence {confidence} below threshold {self.MIN_CONFIDENCE}"
        return True, ""

    def _check_stop_loss_direction(self, decision: dict, portfolio: dict) -> tuple[bool, str]:
        if decision.get("action") == "hold":
            return True, ""
        sl = decision.get("stop_loss_offset_pct")
        tp = decision.get("take_profit_offset_pct")
        if not isinstance(sl, (int, float)) or sl <= 0:
            return False, f"stop_loss_offset_pct {sl} must be a positive number"
        if not isinstance(tp, (int, float)) or tp <= 0:
            return False, f"take_profit_offset_pct {tp} must be a positive number"
        return True, ""

    def _check_instrument_valid(self, decision: dict, portfolio: dict) -> tuple[bool, str]:
        if decision.get("action") == "hold":
            return True, ""
        instrument = decision.get("instrument")
        if instrument not in self.VALID_INSTRUMENTS:
            return False, f"instrument '{instrument}' not in {self.VALID_INSTRUMENTS}"
        return True, ""

    def _check_not_already_in_position(self, decision: dict, portfolio: dict) -> tuple[bool, str]:
        if decision.get("action") == "hold":
            return True, ""
        symbol = to_delta_symbol(decision.get("instrument", ""))
        open_symbols = [
            p.get("product_symbol") for p in portfolio.get("positions", [])
        ]
        if symbol in open_symbols:
            return False, f"position already open on {symbol}"
        return True, ""
