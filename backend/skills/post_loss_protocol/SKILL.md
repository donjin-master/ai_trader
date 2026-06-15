# Post-Loss Protocol Skill

## When This Skill Is Active
After 2 or more consecutive losing trades in the current session.
This skill overrides normal entry criteria and imposes stricter rules.

## Why This Skill Exists
After losses, systems tend to take lower-quality trades to "recover."
Consecutive losses often indicate a regime change the system hasn't detected.
The best trade after 2 losses is often NO TRADE.

## Post-Loss Rules (All Are Mandatory)

### Mandatory Cool-Down
- After 2nd consecutive loss: PAUSE for minimum 2 hours before next entry
- After 3rd consecutive loss: PAUSE for the rest of the trading day
- Only the safety net fires during cool-down, and only to monitor (not enter)

### Elevated Entry Requirements
During post-loss cool-down period, if considering re-entry:
- Minimum setup score: 8.5 (up from standard 7.5)
- Minimum boardroom votes: 3/3 unanimous (no exceptions)
- Minimum confidence: 8/10 (up from standard 6/10)
- ONLY US session entries allowed (highest quality setups)
- No XAUUSD trades during post-loss period

### Position Size Reduction
- Size reduced to 50% of normal risk_per_trade_pct
- Recovery comes from QUALITY trades, not large trades

### Additional Confluence Requirements
- MUST have liquidity sweep confirmation (not optional)
- MUST have OB + FVG overlap (not just OB alone)
- MUST be in clear discount zone (not just near it)

## When to Bypass
NEVER. An AI making an "exception" is exhibiting the same bias this skill prevents.
