# Scaling & Execution Protocol Skill

## When This Skill Is Active
Position size exceeds ₹5,00,000 (₹5 Lakh) per trade.
Currently inactive at normal trading scale. Ready for when capital grows.

## Why This Skill Is Needed at Scale
At small capital (under ₹1L per position): single orders fill instantly.
At large capital (₹5L+ per position): large orders are visible in the orderbook,
other algorithms can front-run them, causing worse average entry price.

## Order Splitting Rules

### Threshold Activation
- ORDER_SPLIT_THRESHOLD_INR: ₹5,00,000
- Below threshold: single order as normal
- Above threshold: apply splitting logic below

### Splitting Algorithm
For position of size N INR, split into 5 equal child orders:
- Time between child orders: 30-120 seconds (randomised)
- Price limit per child: entry_price ± 0.1% (tight limit, not market)
- If child order not filled in 2 minutes: cancel and retry or abandon

### Anti-Pattern Detection
- Same size orders at regular intervals → randomise size by ±20%
- Same entry price repeatedly → use relative limit (entry ± ATR * 0.1)
- Never consume more than 30% of visible orderbook liquidity

### Failed Fill Handling
If child order fails to fill:
- Wait 60 seconds then reassess if price still at valid entry zone
- If yes: retry with market order (accept taker fee)
- If price has moved: abandon and wait for next setup

## Multi-Leg Execution (Options Iron Condor)
Send all 4 legs simultaneously to avoid leg risk.
Leg risk = if first legs fill but last don't = naked exposure.
If all 4 legs don't fill within 60 seconds: cancel ALL legs.
Never hold a 2-leg or 3-leg partial iron condor.
