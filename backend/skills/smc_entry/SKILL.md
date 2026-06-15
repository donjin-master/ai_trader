# SMC Entry Analysis Skill

## When This Skill Is Active
Trending market regime (TRENDING_UP, TRENDING_DOWN, BREAKOUT_IMMINENT).
Not loaded during RANGING regime — use options_strategy skill instead.

## Entry Checklist (All Must Be Met)

### Multi-Timeframe Alignment
- [ ] 4H bias established (clear higher highs/lows or lower highs/lows)
- [ ] 1H confirms same direction (no opposing CHoCH)
- [ ] 15M provides entry trigger (BOS or CHoCH in direction of HTF bias)
HARD RULE: Do not enter against the 4H bias. Ever.

### Liquidity Sweep Requirement
- [ ] 15M or 1H liquidity has been swept (stop run complete)
- [ ] Price has taken sell-side (for longs) or buy-side (for shorts) liquidity
- [ ] Swept BEFORE the entry — not during or after
WHY: Smart money triggers retail stops before moving in the true direction.

### Order Block Validity Criteria
A valid OB must be:
- The last OPPOSING candle before a significant impulse (BOS or CHoCH)
- Unmitigated (price has not returned to 50% level since formation)
- Clean body (minimal wicks on the OB candle itself)
- NOT a previously tested OB (first touch only)
INVALID OBs: Mitigated, overlapping with another OB, small body relative to range

### FVG Confluence
- FVG overlapping with OB dramatically increases setup quality
- FVG size should be meaningful (>0.2% of price)
- Price entering the FVG+OB overlap zone = highest priority entry

### Premium/Discount Positioning
- LONGS: Only enter in discount zone (below 50% of recent range)
- SHORTS: Only enter in premium zone (above 50% of recent range)
- Equilibrium entries (40-60% zone) require additional confluence

## Entry Timing Rules
- Wait for 15M candle CLOSE inside the zone (not during candle)
- Do not chase — if price runs through OB, do not chase
- If OB is more than 2% away from current price, wait for pullback
- Asia session setups (00:00-09:00 IST) require extra confirmation — reduce size

## Stop Loss Placement
- SL below the OB low (for longs) with 0.1% buffer
- SL must invalidate the entire OB, not just the wick
- If SL would be more than 1.2% away, skip the trade (too wide)
- NEVER move SL against the position

## Position Sizing Based on Setup Score
- Score 9-10: Full risk per trade (risk_per_trade_pct from profile)
- Score 7-8: 75% of standard risk
- Score 6:   50% of standard risk
- Score <6:  Do not take the trade
