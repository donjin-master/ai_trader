# Breakout Trading Protocol Skill

## When This Skill Is Active
Market regime = BREAKOUT_IMMINENT
(Bollinger Band squeeze + ATR compression + hours in range > 8)

## Core Reality About Breakouts
- 60-70% of apparent breakouts are false breakouts
- The direction of the breakout is unknowable in advance
- The AFTER-BREAKOUT trade (confirmed breakout) is safer than the anticipation trade
- Position size must be reduced due to directional uncertainty

## Two-Phase Breakout Approach

### Phase 1 — Anticipation Trade (Before Breakout Confirmed)
OPTIONAL. Only if setup is extremely clean.
- Size: 50% of normal (directional uncertainty penalty)
- Enter at edge of range in direction of HTF bias
- If SL hit: do not re-enter in same direction — reassess
- TP1: First level of resistance/support outside the range — then exit

### Phase 2 — Confirmation Trade (After Breakout Confirmed) — PREFERRED
Breakout confirmed when:
- Price closes OUTSIDE the range on 15M with body > 0.3%
- Volume is 1.5x or more above average on the breakout candle
- The breakout level is NOT immediately reclaimed

After confirmation:
- Enter on first 15M pullback to the broken level
- SL: Below the confirmation candle low (for longs)
- Size: Normal (risk_per_trade_pct from profile)

## Avoid After False Breakout
If price breaks out and immediately returns inside range:
- This is a failed breakout / liquidity grab
- Re-evaluate regime — may no longer be BREAKOUT_IMMINENT
- Wait for new squeeze to form before next attempt

## Squeeze Exit Criteria
The squeeze is over when BB width expands to 1.5x its squeeze minimum,
price has moved more than 1 ATR from the range midpoint,
or volume has sustained above average for 3+ consecutive candles.
