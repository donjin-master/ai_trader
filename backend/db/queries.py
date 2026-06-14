"""Higher-level DB queries used by V1.3 intelligence features."""

from __future__ import annotations

from loguru import logger
from sqlalchemy import select, text

from backend.db.database import AsyncSessionLocal
from backend.db.embeddings import generate_embedding, vector_literal
from backend.db.models import AgentLesson


async def get_relevant_lessons(current_context: str, limit: int = 5, min_quality: int = 3) -> list[dict]:
    """Return semantic lessons when pgvector is available; otherwise newest quality lessons."""
    context_embedding = await generate_embedding(current_context)
    if context_embedding is not None:
        try:
            literal = vector_literal(context_embedding)
            async with AsyncSessionLocal() as session:
                rows = await session.execute(
                    text(
                        """
                        SELECT lesson_text, watch_for, pattern_type, confidence_score,
                               quality_score, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
                        FROM agent_lessons
                        WHERE COALESCE(quality_score, 3) >= :min_quality
                          AND embedding IS NOT NULL
                        ORDER BY embedding <=> CAST(:embedding AS vector)
                        LIMIT :limit
                        """
                    ),
                    {"embedding": literal, "min_quality": min_quality, "limit": limit},
                )
                found = [dict(r._mapping) for r in rows.all()]
                if found:
                    return found
        except Exception as exc:
            logger.warning("Semantic lesson lookup failed; falling back to chronological: {}", exc)

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AgentLesson)
            .where(AgentLesson.quality_score >= min_quality)
            .order_by(AgentLesson.created_at.desc())
            .limit(limit)
        )
        return [
            {
                "lesson_text": l.lesson_text,
                "watch_for": l.watch_for,
                "pattern_type": l.pattern_type,
                "confidence_score": l.confidence_score,
                "quality_score": l.quality_score,
            }
            for l in result.scalars().all()
        ]
