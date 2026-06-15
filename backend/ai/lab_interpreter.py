"""Lab Interpreter — translates natural language rules into PostgreSQL WHERE clauses."""

import json
from loguru import logger
from backend.ai.agents import _call_anthropic, _strip_json_fences

LAB_INTERPRETER_PROMPT = """You are a quantitative developer writing a translator from natural language trading rules to PostgreSQL WHERE clauses for the 'user_trades' table.

Available Columns in 'user_trades':
- instrument (VARCHAR): e.g. 'BTCUSD_PERP', 'SOLUSD_PERP', 'ETHUSD_PERP'
- direction (VARCHAR): 'long' or 'short'
- entry_price (NUMERIC)
- exit_price (NUMERIC)
- size (NUMERIC)
- pnl_inr (NUMERIC)
- pnl_pct (NUMERIC)
- entry_time (TIMESTAMP WITH TIME ZONE)
- exit_time (TIMESTAMP WITH TIME ZONE)
- duration_mins (INTEGER)
- order_type (VARCHAR): 'limit' or 'market'
- fees_inr (NUMERIC)
- day_of_week (INTEGER): 0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday, 4 = Friday, 5 = Saturday, 6 = Sunday
- hour_of_entry (INTEGER): 0 to 23 (IST timezone)

Your job: Translate the natural language rule into a PostgreSQL WHERE clause segment.
Only output the raw SQL WHERE clause segment, with NO extra explanation, NO markdown code block formatting (like ```sql), and NO surrounding text.

Examples:
- "No Monday trades" -> "day_of_week != 0"
- "Only BTC trades" -> "instrument = 'BTCUSD_PERP'"
- "Only trade during London session (1pm to 7pm IST)" -> "hour_of_entry >= 13 AND hour_of_entry < 19"
- "Only trades with duration less than 1 hour" -> "duration_mins < 60"
- "Limit orders only" -> "order_type = 'limit'"
- "No trades with size greater than 1.5" -> "size <= 1.5"

Rule to translate: "{rule}"
"""

async def interpret_rule(rule: str) -> str:
    """Translate natural language rule into SQL filter."""
    prompt = LAB_INTERPRETER_PROMPT.format(rule=rule)
    system = "You translate natural language trading rules to PostgreSQL WHERE clauses. Return ONLY the raw SQL condition string, no markdown fences, no explanation."
    
    try:
        raw = await _call_anthropic(
            model="claude-sonnet-4-6",
            system=system,
            user=prompt,
            max_tokens=200
        )
        sql_filter = _strip_json_fences(raw).strip()
        
        # Strip trailing/leading quotes if any returned by model
        if sql_filter.startswith('"') and sql_filter.endswith('"'):
            sql_filter = sql_filter[1:-1].strip()
            
        logger.info(f"Translated rule '{rule}' to SQL filter: '{sql_filter}'")
        return sql_filter
    except Exception as exc:
        logger.error(f"Failed to translate rule '{rule}': {exc}")
        # Return fallback that doesn't filter out anything
        return "1=1"
