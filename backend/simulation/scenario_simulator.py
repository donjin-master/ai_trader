"""Pre-decision scenario simulation engine."""

import json
from loguru import logger
from backend.ai.agents import _call_gemini, _strip_json_fences
from backend.ai.prompts import SCENARIO_SIMULATION

class ScenarioSimulator:
    """
    Runs three scenarios to stress-test a potential trade before the boardroom votes.
    Thesis Correct / Partially Wrong / Completely Wrong.
    Output feeds into board member prompts.
    """

    async def simulate(
        self,
        instrument: str,
        direction: str,           # "long" or "short" (proposed direction)
        entry_price: float,
        suggested_sl: float,
        suggested_tp: float,
        smc_context: str,         # SMC analysis text
        key_levels: dict
    ) -> dict:
        """
        Runs three scenarios and returns simulation context for boardroom.
        Uses Sonnet 4.6 — moderate cost, strong reasoning.
        """
        entry_price = float(entry_price or 0)
        suggested_sl = float(suggested_sl or 0)
        suggested_tp = float(suggested_tp or 0)

        risk_pct = abs(entry_price - suggested_sl) / entry_price * 100 if entry_price else 0
        reward_pct = abs(suggested_tp - entry_price) / entry_price * 100 if entry_price else 0

        prompt = SCENARIO_SIMULATION.format(
            instrument=instrument,
            direction=direction.upper(),
            entry_price=f"${entry_price:,.2f}",
            stop_loss=f"${suggested_sl:,.2f}",
            take_profit=f"${suggested_tp:,.2f}",
            risk_pct=f"{risk_pct:.2f}%",
            reward_pct=f"{reward_pct:.2f}%",
            smc_context=smc_context[:1500],  # Truncate to save tokens
            nearest_level_above=f"${key_levels.get('nearest_major_above', suggested_tp):,.2f}",
            nearest_level_below=f"${key_levels.get('nearest_major_below', suggested_sl):,.2f}"
        )

        try:
            raw = await _call_gemini(
                "gemini-2.5-flash",
                prompt,
                "Scenario Analyst"
            )
            result = json.loads(_strip_json_fences(raw))
            result["simulated"] = True
            result["direction"] = direction
            result["entry_price"] = entry_price
            return result
        except Exception as e:
            logger.error(f"Scenario simulation failed: {e}")
            return {"simulated": False, "error": str(e)}

    def format_for_boardroom(self, simulation: dict) -> str:
        """Format simulation output for boardroom context injection."""
        if not simulation.get("simulated"):
            return ""

        return f"""
=== PRE-TRADE SCENARIO ANALYSIS ===
(Completed before your vote — consider these outcomes in your assessment)

SCENARIO A — THESIS CORRECT:
{simulation.get("scenario_a_description", "N/A")}
How it plays out: {simulation.get("scenario_a_play_out", "N/A")}
Key monitoring point: {simulation.get("scenario_a_monitor", "N/A")}
Invalidation: {simulation.get("scenario_a_invalidation", "N/A")}

SCENARIO B — PARTIALLY WRONG:
{simulation.get("scenario_b_description", "N/A")}
What changes: {simulation.get("scenario_b_change", "N/A")}
Adjustment if this happens: {simulation.get("scenario_b_adjustment", "N/A")}

SCENARIO C — COMPLETELY WRONG:
{simulation.get("scenario_c_description", "N/A")}
Was the SL correctly placed for this scenario? {simulation.get("scenario_c_sl_valid", "N/A")}
What signals were missed: {simulation.get("scenario_c_missed_signals", "N/A")}

SIMULATION VERDICT:
{simulation.get("simulation_verdict", "N/A")}
Biggest risk factor: {simulation.get("biggest_risk", "N/A")}
====================================
"""
