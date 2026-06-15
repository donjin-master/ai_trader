"""Trading DNA Analyser — extracts statistical insights and computes discipline score."""

import json
from datetime import datetime, timezone
import pandas as pd
from loguru import logger
from sqlalchemy import select

from backend.db.database import AsyncSessionLocal
from backend.db.models import UserTrade, DnaReport
from backend.ai.agents import _call_anthropic, _strip_json_fences

DNA_ANALYSIS_PROMPT = """You are a quantitative trading analyst reviewing a trader's historical performance data.
Your job: find statistically significant patterns.

RULES:
1. Only state facts supported by the data.
2. Never infer psychology or emotions.
3. Every claim must cite the specific numbers.
4. If sample size < 10 for a pattern: state "insufficient data (N={{n}})" and label confidence as LOW.
5. Suggested rules must be specific and implementable.

DATA:
{hourly_stats}

{instrument_stats}

{hold_time_stats}

{general_stats}

Find the top 5 most actionable patterns. For each:
- State the pattern with exact numbers.
- Calculate the statistical impact if the suggested rule were followed (e.g. "Removing these trades would have increased net P&L by ₹5,400").
- Suggest ONE specific rule to implement.

Output as JSON array of insight objects:
[
  {{
    "title": "string — brief pattern name",
    "finding": "string — exact numbers, no fluff",
    "sample_size": integer,
    "impact_estimate": "string — what applying this rule would have changed",
    "suggested_rule": "string — specific, implementable rule",
    "confidence": "HIGH (n>30) | MEDIUM (n=10-30) | LOW (n<10)"
  }}
]
"""

class DNAAnalyser:
    """Quantitative analyser for Trading DNA."""

    async def _load_trades_df(self) -> pd.DataFrame:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(UserTrade))
            rows = result.scalars().all()
        if not rows:
            return pd.DataFrame()
        return pd.DataFrame([{
            "id": r.id,
            "instrument": r.instrument,
            "direction": r.direction,
            "pnl_inr": float(r.pnl_inr or 0),
            "pnl_pct": float(r.pnl_pct or 0),
            "fees_inr": float(r.fees_inr or 0),
            "size": float(r.size or 0),
            "order_type": r.order_type,
            "day_of_week": r.day_of_week,
            "hour": r.hour_of_entry,
            "duration_mins": r.duration_mins,
            "exit_time": r.exit_time,
            "entry_time": r.entry_time,
        } for r in rows])

    async def generate_insights(self) -> list[dict]:
        df = await self._load_trades_df()
        if df.empty:
            logger.warning("No user trades found for DNA analysis.")
            return []

        # 1. Format Hourly Stats
        hourly_groups = df.groupby("hour")
        hourly_list = []
        for hour, group in hourly_groups:
            win_rate = (group["pnl_pct"] > 0).mean() * 100
            hourly_list.append(
                f"Hour {hour:02d}: {len(group)} trades, Win Rate: {win_rate:.1f}%, Net P&L: ₹{group['pnl_inr'].sum():,.2f}"
            )
        hourly_stats = "Hourly Stats:\n" + "\n".join(hourly_list)

        # 2. Format Instrument Stats
        inst_groups = df.groupby("instrument")
        inst_list = []
        for inst, group in inst_groups:
            win_rate = (group["pnl_pct"] > 0).mean() * 100
            inst_list.append(
                f"Instrument {inst}: {len(group)} trades, Win Rate: {win_rate:.1f}%, Net P&L: ₹{group['pnl_inr'].sum():,.2f}, Avg Duration: {group['duration_mins'].mean():.1f}m"
            )
        instrument_stats = "Instrument Stats:\n" + "\n".join(inst_list)

        # 3. Format Hold Time Stats
        winners = df[df["pnl_pct"] > 0.1]
        losers = df[df["pnl_pct"] < -0.1]
        avg_win_duration = winners["duration_mins"].mean() if not winners.empty else 0
        avg_loss_duration = losers["duration_mins"].mean() if not losers.empty else 0
        hold_time_stats = (
            f"Hold Time Stats:\n"
            f"- Avg Winner Hold Time: {avg_win_duration:.1f} minutes (N={len(winners)})\n"
            f"- Avg Loser Hold Time: {avg_loss_duration:.1f} minutes (N={len(losers)})\n"
        )

        # 4. Format General Stats
        win_rate = (df["pnl_pct"] > 0).mean() * 100
        general_stats = (
            f"General Stats:\n"
            f"- Total Trades: {len(df)}\n"
            f"- Overall Win Rate: {win_rate:.1f}%\n"
            f"- Net P&L: ₹{df['pnl_inr'].sum():,.2f}\n"
            f"- Total Fees: ₹{df['fees_inr'].sum():,.2f}\n"
            f"- Market Orders: {len(df[df['order_type'] == 'market'])}, Limit Orders: {len(df[df['order_type'] == 'limit'])}\n"
        )

        prompt = DNA_ANALYSIS_PROMPT.format(
            hourly_stats=hourly_stats,
            instrument_stats=instrument_stats,
            hold_time_stats=hold_time_stats,
            general_stats=general_stats
        )

        system = "You are a quantitative trading analyst. Write data-backed insights as JSON array of objects. Citing the numbers is mandatory. Do not include markdown around the JSON block, return ONLY the raw JSON array."
        
        try:
            raw = await _call_anthropic(
                model="claude-sonnet-4-6",
                system=system,
                user=prompt,
                max_tokens=2000
            )
            clean_raw = _strip_json_fences(raw)
            insights = json.loads(clean_raw)
            
            # Format and save to DnaReport
            discipline = await self.compute_discipline_score()
            report_data = {
                "stats": {
                    "trade_count": len(df),
                    "win_rate": round(win_rate, 2),
                    "total_pnl_inr": round(df["pnl_inr"].sum(), 2),
                    "total_fees_inr": round(df["fees_inr"].sum(), 2),
                },
                "insights": insights
            }
            
            # Generate overlay lines
            overlay_lines = []
            for ins in insights[:4]:
                overlay_lines.append(f"- {ins['title']}: {ins['finding']} (Rule: {ins['suggested_rule']})")
            overlay = "\n".join(overlay_lines)

            async with AsyncSessionLocal() as session:
                session.add(DnaReport(
                    report=report_data,
                    overlay_text=overlay,
                    discipline_score=discipline["score"],
                ))
                await session.commit()

            return insights
        except Exception as exc:
            logger.exception("Failed to generate DNA insights via LLM")
            return []

    async def compute_discipline_score(self) -> dict:
        """
        Discipline Score 1-100 based on:
        - Trading session adherence (50% weight): Trades within preferred hours (11:30 to 23:00 IST)
        - Position management consistency (30% weight): Winner vs loser hold times
        - Risk sizing consistency (20% weight): Consistency of trade sizing (standard deviation)
        """
        df = await self._load_trades_df()
        if df.empty:
            return {
                "score": 100,
                "adherence": 50,
                "management": 30,
                "sizing": 20,
                "detail": "No trades executed yet — perfect compliance by default."
            }

        # 1. Trading Session Adherence (50 points)
        # Preferred hours: 11:30 to 23:00 IST. Hour of entry is IST-based (as checked in import).
        # Let's count hours >= 11 and <= 23.
        total_trades = len(df)
        in_session_trades = df[(df["hour"] >= 11) & (df["hour"] <= 23)]
        adherence_rate = len(in_session_trades) / total_trades if total_trades > 0 else 1.0
        adherence_score = round(adherence_rate * 50, 1)

        # 2. Position Management Consistency (30 points)
        winners = df[df["pnl_pct"] > 0.1]
        losers = df[df["pnl_pct"] < -0.1]
        
        avg_win_time = winners["duration_mins"].mean() if not winners.empty else 0
        avg_loss_time = losers["duration_mins"].mean() if not losers.empty else 0
        
        if avg_win_time > 0 and avg_loss_time > 0:
            loss_aversion_ratio = avg_loss_time / avg_win_time
            if loss_aversion_ratio <= 1.0:
                management_score = 30.0
            else:
                # Penalize when losers are held longer than winners
                management_score = max(0.0, round(30.0 - (loss_aversion_ratio - 1.0) * 15.0, 1))
        else:
            loss_aversion_ratio = 1.0
            management_score = 30.0

        # 3. Risk Sizing Consistency (20 points)
        sizes = df["size"]
        if len(sizes) > 1:
            mean_size = sizes.mean()
            std_size = sizes.std()
            cv = std_size / mean_size if mean_size > 0 else 0
            if cv <= 0.2:
                sizing_score = 20.0
            else:
                sizing_score = max(0.0, round(20.0 - (cv - 0.2) * 20.0, 1))
        else:
            cv = 0.0
            sizing_score = 20.0

        total_score = round(adherence_score + management_score + sizing_score, 0)
        return {
            "score": int(total_score),
            "adherence": adherence_score,
            "management": management_score,
            "sizing": sizing_score,
            "loss_aversion_ratio": round(loss_aversion_ratio, 2),
            "coefficient_of_variation": round(cv, 2)
        }
