"""Seed realistic synthetic closed trades for Loop 2/3 testing.

Run once:
    python3 backend/scripts/seed_test_trades.py
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select

from backend.db.database import AsyncSessionLocal
from backend.db.models import Trade


SYNTHETIC_TRADES = [
    {
        "instrument": "BTCUSD_PERP",
        "direction": "long",
        "entry_price": 63200,
        "exit_price": 64800,
        "pnl_pct": 2.53,
        "pnl_inr": 2530,
        "duration_mins": 187,
        "exit_trigger": "tp2_hit",
        "confidence": 8,
        "setup_score": 8.2,
        "days_ago": 3,
        "entry_reasoning": (
            "4H bullish structure intact. 1H swept sell-side liquidity at 63050 "
            "and CHoCH confirmed. 15M OB at 63150-63250 held as support. "
            "Funding negative -0.015% with OI expanding. Entered long from OB zone."
        ),
        "key_signals": ["4H_bullish", "1H_sweep_complete", "neg_funding", "ob_entry"],
    },
    {
        "instrument": "BTCUSD_PERP",
        "direction": "long",
        "entry_price": 62400,
        "exit_price": 62010,
        "pnl_pct": -0.62,
        "pnl_inr": -620,
        "duration_mins": 43,
        "exit_trigger": "stop_loss_hit",
        "confidence": 7,
        "setup_score": 7.1,
        "days_ago": 2,
        "entry_reasoning": (
            "4H bullish but 1H structure had not yet confirmed CHoCH. Entered "
            "on 15M BOS alone without waiting for 1H confirmation. Premature entry."
        ),
        "key_signals": ["4H_bullish", "15M_bos", "missing_1H_confirm"],
    },
    {
        "instrument": "BTCUSD_PERP",
        "direction": "short",
        "entry_price": 64600,
        "exit_price": 63800,
        "pnl_pct": 1.24,
        "pnl_inr": 1240,
        "duration_mins": 312,
        "exit_trigger": "trail_hit",
        "confidence": 9,
        "setup_score": 9.1,
        "days_ago": 5,
        "entry_reasoning": (
            "4H bearish structure. 1H swept buy-side liquidity at 64750 and "
            "immediately rejected. 15M bearish OB at 64550-64650 as entry zone. "
            "Premium zone entry. Funding positive 0.025% indicating crowded longs."
        ),
        "key_signals": ["4H_bearish", "bss_swept", "premium_zone", "pos_funding"],
    },
    {
        "instrument": "ETHUSD_PERP",
        "direction": "long",
        "entry_price": 3380,
        "exit_price": 3290,
        "pnl_pct": -2.66,
        "pnl_inr": -2660,
        "duration_mins": 28,
        "exit_trigger": "stop_loss_hit",
        "confidence": 6,
        "setup_score": 6.8,
        "days_ago": 4,
        "entry_reasoning": (
            "ETH setup looked similar to BTC setup from previous day. However ETH "
            "had not confirmed 1H structure and BTC/ETH correlation was weak. "
            "Setup score was borderline."
        ),
        "key_signals": ["4H_bullish", "low_score", "correlation_ignored"],
    },
    {
        "instrument": "BTCUSD_PERP",
        "direction": "long",
        "entry_price": 61500,
        "exit_price": 63100,
        "pnl_pct": 2.60,
        "pnl_inr": 2600,
        "duration_mins": 445,
        "exit_trigger": "tp2_hit",
        "confidence": 9,
        "setup_score": 9.3,
        "days_ago": 7,
        "entry_reasoning": (
            "Best setup of the week. 4H + 1H + 15M fully aligned bullish. Deep "
            "discount zone at 32% of weekly range. Sell-side swept on 1H. "
            "Inducement taken. OB + FVG confluence at 61400-61550."
        ),
        "key_signals": ["full_mtf_alignment", "discount_zone", "ss_swept", "ob_fvg_confluence", "us_session"],
    },
    {
        "instrument": "BTCUSD_PERP",
        "direction": "long",
        "entry_price": 62800,
        "exit_price": 63650,
        "pnl_pct": 1.35,
        "pnl_inr": 1350,
        "duration_mins": 156,
        "exit_trigger": "trail_hit",
        "confidence": 7,
        "setup_score": 7.4,
        "days_ago": 6,
        "entry_reasoning": (
            "4H bullish. 1H CHoCH confirmed. 15M entry on OB at 62750-62850. "
            "Missed the ideal entry on pullback; entered slightly late."
        ),
        "key_signals": ["4H_bullish", "1H_choch", "15M_ob", "late_entry"],
    },
    {
        "instrument": "SOLUSD_PERP",
        "direction": "long",
        "entry_price": 148.5,
        "exit_price": 145.2,
        "pnl_pct": -2.22,
        "pnl_inr": -2220,
        "duration_mins": 67,
        "exit_trigger": "stop_loss_hit",
        "confidence": 6,
        "setup_score": 6.5,
        "days_ago": 3,
        "entry_reasoning": (
            "SOL setup appeared to mirror BTC structure but SOL has independent "
            "price action. Asia session entry was historically weak for SOL."
        ),
        "key_signals": ["sol_structure", "asia_session", "borderline_score"],
    },
    {
        "instrument": "BTCUSD_PERP",
        "direction": "short",
        "entry_price": 63900,
        "exit_price": 63020,
        "pnl_pct": 1.38,
        "pnl_inr": 1380,
        "duration_mins": 223,
        "exit_trigger": "tp2_hit",
        "confidence": 8,
        "setup_score": 8.0,
        "days_ago": 1,
        "entry_reasoning": (
            "4H bearish momentum. 1H swept BSL at 64050 exactly. 15M bearish "
            "OB at 63850-63950 as entry. Premium zone. US/London overlap session."
        ),
        "key_signals": ["4H_bearish", "bsl_swept", "15M_ob", "premium_zone", "us_london"],
    },
    {
        "instrument": "BTCUSD_PERP",
        "direction": "long",
        "entry_price": 62150,
        "exit_price": 62050,
        "pnl_pct": -0.16,
        "pnl_inr": -160,
        "duration_mins": 12,
        "exit_trigger": "stop_loss_hit",
        "confidence": 7,
        "setup_score": 7.0,
        "days_ago": 8,
        "entry_reasoning": (
            "Monday morning setup was historically weak. Should have waited until "
            "after 11:30am IST before liquidity stabilised."
        ),
        "key_signals": ["monday_morning", "early_session", "borderline"],
    },
    {
        "instrument": "BTCUSD_PERP",
        "direction": "long",
        "entry_price": 60800,
        "exit_price": 62400,
        "pnl_pct": 2.63,
        "pnl_inr": 2630,
        "duration_mins": 534,
        "exit_trigger": "trail_hit",
        "confidence": 9,
        "setup_score": 9.0,
        "days_ago": 10,
        "entry_reasoning": (
            "Weekly low sweep. Sell-side liquidity taken at 60650. Strong 4H "
            "bullish OB at 60700-60900 held perfectly. Held through two pullbacks."
        ),
        "key_signals": ["weekly_low_sweep", "4H_ob_hold", "deep_discount", "strong_rr", "held_through_pullback"],
    },
]


def _seed_id(index: int, trade: dict) -> uuid.UUID:
    key = f"{index}:{trade['instrument']}:{trade['direction']}:{trade['entry_price']}:{trade['days_ago']}"
    return uuid.uuid5(uuid.NAMESPACE_URL, f"pro-ai-trader/manual-seed/{key}")


async def seed() -> None:
    inserted = 0
    skipped = 0
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as session:
        for index, data in enumerate(SYNTHETIC_TRADES):
            trade_id = _seed_id(index, data)
            existing = await session.execute(select(Trade.id).where(Trade.id == trade_id))
            if existing.scalar_one_or_none() is not None:
                skipped += 1
                continue

            entry_time = now - timedelta(days=data["days_ago"], hours=index * 2)
            risk_price = float(data["entry_price"]) * 0.005
            rr_achieved = abs(float(data["exit_price"]) - float(data["entry_price"])) / risk_price
            pnl_pct = float(data["pnl_pct"])

            trade = Trade(
                id=trade_id,
                timestamp=entry_time,
                instrument=data["instrument"],
                direction=data["direction"],
                entry_price=data["entry_price"],
                exit_price=data["exit_price"],
                size_pct=1.0,
                pnl_pct=pnl_pct,
                duration_mins=data["duration_mins"],
                entry_reasoning=data["entry_reasoning"],
                exit_trigger=data["exit_trigger"],
                confidence=data["confidence"],
                boardroom_confidence=data["confidence"],
                actual_outcome="win" if pnl_pct > 0.1 else "loss" if pnl_pct < -0.1 else "breakeven",
                status="closed",
                key_signals=data["key_signals"],
                boardroom_votes={
                    "manual_seed": True,
                    "key_signals": data["key_signals"],
                    "synthetic_pnl_inr": data["pnl_inr"],
                },
                decision_json={
                    "action": data["direction"],
                    "instrument": data["instrument"],
                    "manual_seed": True,
                },
                setup_score=data["setup_score"],
                setup_grade="A" if data["setup_score"] >= 8 else "B" if data["setup_score"] >= 7 else "C",
                trigger_event_type="manual_seed",
                position_params={
                    "position_size_pct": 1.0,
                    "synthetic_pnl_inr": data["pnl_inr"],
                    "management": {
                        "initial_rr_planned": 3.0,
                        "rr_achieved_on_exit": round(rr_achieved, 2),
                    },
                },
            )
            session.add(trade)
            inserted += 1

        await session.commit()

    wins = sum(1 for t in SYNTHETIC_TRADES if t["pnl_pct"] > 0)
    losses = sum(1 for t in SYNTHETIC_TRADES if t["pnl_pct"] < 0)
    print(f"Seeded {inserted} synthetic trades ({skipped} already present)")
    print(f"Win/Loss: {wins}W / {losses}L")
    print("Now run Loop 2 on each seeded trade to generate lessons:")
    print("  POST /api/run-reflection/{trade_id}")


if __name__ == "__main__":
    asyncio.run(seed())
