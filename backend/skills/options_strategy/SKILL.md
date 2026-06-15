# Options Strategy Skill

## When This Skill Is Active
Ranging market regime + IV percentile above 50th percentile.
Do NOT use for directional trades — use smc_entry skill for those.

## Core Philosophy
In a ranging market with elevated IV:
- The market is pricing in movement that is NOT happening
- We collect that overpriced premium by selling options
- Our profit comes from time decay (theta), not direction
- We win by being RIGHT about the range boundaries

## Iron Condor Structure (Primary Strategy)

### Strike Selection Algorithm
1. Calculate 1 standard deviation expected move:
   1_SD = (IV / sqrt(365 / DTE)) * current_price / 100
2. Place short strikes at 1 SD from current price
3. Place long strikes 100-200 points wide for protection
4. Verify short strikes align with key levels (PDH/PDL ideal)

### Expiry Selection
- Minimum 7 DTE (avoid gamma risk of near-term expiry)
- Maximum 21 DTE (beyond this, theta decays too slowly)
- Optimal: 14 DTE — best theta decay rate vs gamma risk balance

### Entry Credit Requirements
- Minimum credit = 0.5% of the spread width
- If credit is too low, widen the wings or skip the trade

## Iron Condor Management Rules (NON-NEGOTIABLE)

### Close at 50% of Max Profit
- Do not wait for 100% — gamma risk increases too fast near expiry
- Set a limit close order at entry to automate this

### Close at 21 DTE
- Never hold inside 21 days to expiry
- Close at market price regardless of P&L

### Adjustment Trigger
When price is within 1/3 of wing width from short strike:
OPTION A: Close the threatened side, keep profitable side
OPTION B: Roll short strike further OTM
OPTION C: Close entire position if credit remaining < 25% of max profit

### Stop Loss at 2x Credit
- Max loss allowed = 2 times the initial credit received
- This prevents using the full theoretical max loss in practice

### Never Hold Through Major Events
- Close 24 hours before: major central bank decisions, regulatory news
- If India crypto regulatory news expected: close all options positions

## Signs to Skip the Trade
- IV percentile below 50 (premium too cheap to sell profitably)
- Market structure suggests imminent breakout (BB squeeze)
- Open interest expanding rapidly
- Within 48 hours of major macro event
