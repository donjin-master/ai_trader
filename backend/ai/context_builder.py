"""Single source of truth for boardroom context assembly."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from backend.perception.key_levels import key_levels_engine

IST = ZoneInfo("Asia/Kolkata")


class BoardroomContextBuilder:
    async def build(
        self,
        instrument: str,
        smc_analysis: dict,
        key_levels: dict,
        portfolio_state: dict,
        daily_stats: dict,
        recent_lessons: list[dict],
        counterfactual_insights: list[str],
        profile: dict | None = None,
    ) -> str:
        now = datetime.now(IST)
        session = key_levels.get("current_session") or key_levels_engine.get_current_session(now.hour)
        session_notes = key_levels.get("session_notes") or key_levels_engine.get_session_notes(instrument, session)
        price = float(smc_analysis.get("price") or key_levels.get("price") or 0)
        rr_analysis = self._compute_rr_analysis(smc_analysis, key_levels, portfolio_state, profile)

        # Fetch meta-lessons (always injected, high priority)
        from sqlalchemy import text
        from backend.db.database import AsyncSessionLocal
        from loguru import logger
        meta_lessons = []
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(text("""
                    SELECT pattern_text, confidence_score
                    FROM meta_lessons
                    WHERE active = true
                    ORDER BY confidence_score DESC, created_at DESC
                    LIMIT 5
                """))
                meta_lessons = [{"pattern_text": row[0], "confidence_score": float(row[1])} for row in result.all()]
        except Exception:
            logger.exception("Failed to fetch active meta-lessons")

        meta_text = ""
        if meta_lessons:
            meta_text = "=== ENDURING META-PATTERNS (highest priority) ===\n"
            meta_text += "\n".join([
                f"• [{r['confidence_score']:.0f}/10] {r['pattern_text']}"
                for r in meta_lessons
            ]) + "\n\n"

        individual_text = "=== RECENT SPECIFIC LESSONS ===\n" + self._format_lessons(recent_lessons)
        lessons_section = meta_text + individual_text

        return f"""{instrument} BOARDROOM - {now.strftime('%H:%M IST')} | {now.strftime('%A')} | {session.upper()} session
============================================================
{session_notes}

{key_levels_engine.format_for_boardroom(key_levels, price)}

{smc_analysis.get('context_text', '')}

=== R:R ANALYSIS ===
{rr_analysis}

=== PORTFOLIO STATE ===
{self._format_portfolio(portfolio_state, daily_stats)}

{lessons_section}

=== COUNTERFACTUAL INSIGHTS ===
{self._format_counterfactuals(counterfactual_insights)}
"""


    def _compute_rr_analysis(self, smc: dict, levels: dict, portfolio: dict, profile: dict | None = None) -> str:
        current = float(smc.get("price") or levels.get("price") or 0)
        proposed_sl = smc.get("suggested_sl") or smc.get("stop_loss")
        if not current or not proposed_sl:
            return "SL level not yet identified from SMC analysis."
        proposed_sl = float(proposed_sl)
        risk = abs(current - proposed_sl)
        if risk <= 0:
            return "Invalid SL distance; risk is zero."
        direction = "long" if proposed_sl < current else "short"
        source_levels = [
            ("PDH", levels.get("prev_day_high")),
            ("PWH", levels.get("prev_week_high")),
            ("Asia High", levels.get("prev_asia_high")),
            ("London High", levels.get("prev_london_high")),
            ("Major Round", levels.get("nearest_major_above")),
            ("PDL", levels.get("prev_day_low")),
            ("PWL", levels.get("prev_week_low")),
            ("Asia Low", levels.get("prev_asia_low")),
            ("London Low", levels.get("prev_london_low")),
            ("Major Round Below", levels.get("nearest_major_below")),
        ]
        lines = [f"Risk from entry to SL: ${risk:,.2f} ({risk / current * 100:.2f}%)", "", "Potential targets:"]
        
        min_rr = float((profile or {}).get("min_rr_ratio") or 1.5)
        strong_rr = min_rr * 1.5
        
        has_valid_rr = False
        for name, value in source_levels:
            if value is None:
                continue
            level = float(value)
            if direction == "long" and level <= current:
                continue
            if direction == "short" and level >= current:
                continue
            rr = abs(level - current) / risk
            marker = "STRONG" if rr >= strong_rr else ("VALID" if rr >= min_rr else "SKIP")
            lines.append(f"  {name}: ${level:,.2f} -> 1:{rr:.1f}R {marker}")
            has_valid_rr = has_valid_rr or rr >= min_rr
        lines.append("")
        lines.append(f"Minimum 1:{min_rr:.1f} R:R achievable - trade eligible" if has_valid_rr else f"No target gives 1:{min_rr:.1f} R:R - reject this trade")
        return "\n".join(lines)

    def _format_portfolio(self, portfolio: dict, daily: dict) -> str:
        positions = portfolio.get("positions") or []
        balance = portfolio.get("balance")
        return f"""Open positions: {len(positions)} / {portfolio.get('max_concurrent', 3)}
Balance snapshot: {balance if balance else 'n/a'}
Today's P&L: {daily.get('pnl_pct', portfolio.get('daily_pnl_pct', 0)):+.2f}%
Trades today: {daily.get('trade_count', 0)}
Consecutive losses: {daily.get('consecutive_losses', 0)}
Mode: {portfolio.get('execution_mode', 'ADVISORY')}"""

    def _format_lessons(self, lessons: list[dict]) -> str:
        if not lessons:
            return "No lessons yet. Make best judgment from current market data."
        rows = []
        for lesson in lessons[:10]:
            text = lesson.get("lesson_text") or lesson.get("lesson") or ""
            watch = lesson.get("watch_for") or ""
            quality = lesson.get("quality_score")
            suffix = f" [quality {quality}]" if quality is not None else ""
            rows.append(f"- {text} [watch: {watch}]{suffix}")
        return "\n".join(rows)

    def _format_counterfactuals(self, insights: list[str]) -> str:
        if not insights:
            return "No counterfactual data yet."
        return "\n".join(f"- {i}" for i in insights[:3])


context_builder = BoardroomContextBuilder()
