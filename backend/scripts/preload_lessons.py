"""Preload high-quality SMC rules into agent_lessons."""

from __future__ import annotations

import asyncio
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from loguru import logger
from sqlalchemy import text

from backend.db.database import AsyncSessionLocal
from backend.db.embeddings import generate_embedding, vector_literal

PRE_LOADED_LESSONS = [
    {
        "lesson_text": "Never enter a long during Asia session when funding rate exceeds 0.02%; crowded longs often sweep before reversing.",
        "watch_for": "Funding > 0.02% during Asia session",
        "pattern_type": "session_funding_conflict",
        "confidence_score": 9,
    },
    {
        "lesson_text": "CHoCH on 1H is only valid confirmation when preceded by a visible liquidity sweep on the same timeframe.",
        "watch_for": "CHoCH without prior liquidity sweep on same timeframe",
        "pattern_type": "choch_validity_check",
        "confidence_score": 9,
    },
    {
        "lesson_text": "XAUUSD setups before London open have poor follow-through; wait for the first 30 minutes of London session.",
        "watch_for": "XAUUSD entry attempt before London session matures",
        "pattern_type": "xauusd_session_timing",
        "confidence_score": 8,
    },
    {
        "lesson_text": "When OB and FVG overlap at the same zone, that confluence is stronger than either signal alone.",
        "watch_for": "OB and FVG overlap at same level",
        "pattern_type": "ob_fvg_confluence",
        "confidence_score": 9,
    },
    {
        "lesson_text": "Equal highs within 0.15% represent resting buy-side liquidity; avoid shorting below them before a sweep.",
        "watch_for": "Equal highs visible above current price",
        "pattern_type": "equal_highs_liquidity",
        "confidence_score": 8,
    },
    {
        "lesson_text": "After 2 consecutive losses, require at least 3 confluences and setup score 8.0+ before entering again.",
        "watch_for": "Two consecutive losses in current session",
        "pattern_type": "consecutive_loss_discipline",
        "confidence_score": 9,
    },
    {
        "lesson_text": "BTC US session produces the cleanest SMC follow-through after London creates the sweep and entry zone.",
        "watch_for": "BTC setups into US session after London manipulation",
        "pattern_type": "btc_session_quality",
        "confidence_score": 8,
    },
    {
        "lesson_text": "When price is in premium zone and funding is positive, avoid longs; this is often distribution.",
        "watch_for": "Premium zone plus positive funding",
        "pattern_type": "premium_zone_funding",
        "confidence_score": 8,
    },
    {
        "lesson_text": "Monday often stop-hunts both directions before weekly direction forms; wait for Monday high or low sweep.",
        "watch_for": "Monday range unresolved",
        "pattern_type": "monday_manipulation",
        "confidence_score": 7,
    },
    {
        "lesson_text": "15M BOS is meaningful for entry only when 1H and 4H structure align in the same direction.",
        "watch_for": "15M BOS against 1H or 4H structure",
        "pattern_type": "bos_multitf_alignment",
        "confidence_score": 9,
    },
]


async def main() -> None:
    loaded = 0
    async with AsyncSessionLocal() as session:
        for lesson in PRE_LOADED_LESSONS:
            embedding = await generate_embedding(f"{lesson['lesson_text']} {lesson['watch_for']}")
            params = {**lesson, "embedding": vector_literal(embedding) if embedding else None}
            if embedding:
                stmt = text(
                    """
                    INSERT INTO agent_lessons
                      (lesson_text, watch_for, pattern_type, confidence_score, quality_score, embedding)
                    VALUES (:lesson_text, :watch_for, :pattern_type, :confidence_score, 5, CAST(:embedding AS vector))
                    ON CONFLICT DO NOTHING
                    """
                )
            else:
                stmt = text(
                    """
                    INSERT INTO agent_lessons
                      (lesson_text, watch_for, pattern_type, confidence_score, quality_score)
                    VALUES (:lesson_text, :watch_for, :pattern_type, :confidence_score, 5)
                    ON CONFLICT DO NOTHING
                    """
                )
            try:
                await session.execute(stmt, params)
                loaded += 1
            except Exception:
                logger.exception("Failed to preload lesson {}", lesson["pattern_type"])
        await session.commit()
    print(f"Loaded {loaded} SMC rules into agent_lessons")


if __name__ == "__main__":
    asyncio.run(main())
