"""Weekly meta-lesson synthesis — Opus distils 30 days of lessons into 5 meta-patterns."""

from datetime import datetime

from loguru import logger

META_SYNTHESIS_PROMPT = """
You are a trading system analyst reviewing 30 days of individual trading lessons.
Your job: synthesise these into the 5 most important ENDURING patterns.

Individual lessons from the last 30 days:
{all_lessons}

Extract exactly 5 meta-lessons. Each must be:
1. Based on MULTIPLE individual lessons (not a single observation)
2. Specific and actionable (not "be careful" or "check the chart")
3. Generalisable to future similar situations
4. Based on evidence, not inference

Rank them by importance (1 = most important).

Respond as JSON array with no preamble:
[
  {{
    "rank": 1,
    "pattern_text": "string — the enduring lesson in one clear sentence",
    "supporting_evidence": "string — which individual lessons support this pattern",
    "confidence_score": 8,
    "trade_count_basis": 15
  }}
]
"""


async def run_meta_synthesis() -> None:
    """
    Synthesises last 30 days of individual lessons into meta-lessons.
    Called weekly by scheduler (Sunday 11pm IST).
    """
    from sqlalchemy import text

    from backend.ai.agents import _call_anthropic, _parse_json
    from backend.db.database import AsyncSessionLocal
    from backend.notifications.telegram import telegram_bot

    async with AsyncSessionLocal() as db:
        rows = await db.execute(text("""
            SELECT lesson_text, watch_for, confidence_score, created_at
            FROM agent_lessons
            WHERE created_at >= NOW() - INTERVAL '30 days'
              AND quality_score >= 3
            ORDER BY created_at DESC
            LIMIT 100
        """))
        lesson_rows = [dict(r) for r in rows.mappings()]

    if len(lesson_rows) < 5:
        logger.info("Meta-synthesis: only {} lessons in last 30 days, skipping", len(lesson_rows))
        return

    lessons_text = "\n".join([
        f"[{r['created_at'].strftime('%b %d') if hasattr(r['created_at'], 'strftime') else r['created_at']}"
        f" | score {r['confidence_score']}] {r['lesson_text']} "
        f"[watch: {r.get('watch_for') or 'N/A'}]"
        for r in lesson_rows
    ])

    try:
        raw = await _call_anthropic(
            "claude-opus-4-8",
            "You are a trading pattern analyst. Synthesise individual lessons into enduring meta-patterns.",
            META_SYNTHESIS_PROMPT.format(all_lessons=lessons_text[:8000]),
            max_tokens=1500,
        )
        meta_lessons = _parse_json(raw)
    except Exception:
        logger.exception("Meta-synthesis LLM call failed")
        return

    async with AsyncSessionLocal() as db:
        await db.execute(text("""
            UPDATE meta_lessons SET active = false
            WHERE created_at < NOW() - INTERVAL '7 days'
        """))

        for lesson in meta_lessons:
            await db.execute(text("""
                INSERT INTO meta_lessons
                  (pattern_text, supporting_evidence, confidence_score,
                   original_confidence, trade_count_basis,
                   synthesis_period_start, synthesis_period_end, active)
                VALUES
                  (:pattern, :evidence, :conf, :conf, :trade_count,
                   NOW() - INTERVAL '30 days', NOW(), true)
            """), {
                "pattern": lesson.get("pattern_text", ""),
                "evidence": lesson.get("supporting_evidence", ""),
                "conf": float(lesson.get("confidence_score", 7)),
                "trade_count": int(lesson.get("trade_count_basis", 0)),
            })

        await db.commit()
        logger.info("Meta-synthesis complete: {} meta-lessons generated", len(meta_lessons))

    summary = f"🧠 META-LESSON SYNTHESIS COMPLETE\n{len(meta_lessons)} patterns extracted\n\n"
    for lesson in meta_lessons[:3]:
        summary += f"• {lesson.get('pattern_text', '')}\n"
    await telegram_bot.send(summary, silent=True)


async def get_active_meta_lessons(limit: int = 5) -> list[dict]:
    """Fetch current active meta-lessons for boardroom injection."""
    from sqlalchemy import text

    from backend.db.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            rows = await db.execute(text("""
                SELECT pattern_text, confidence_score
                FROM meta_lessons
                WHERE active = true
                ORDER BY confidence_score DESC, created_at DESC
                LIMIT :limit
            """), {"limit": limit})
            return [dict(r) for r in rows.mappings()]
    except Exception:
        logger.exception("Failed to fetch meta-lessons")
        return []
