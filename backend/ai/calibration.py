"""Confidence calibration — checks whether boardroom confidence scores predict outcomes."""

from datetime import datetime

from loguru import logger


async def run_calibration_report() -> dict:
    """
    Analyses confidence vs outcome correlation.
    Requires 20+ closed trades to be meaningful.
    """
    from backend.db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        from sqlalchemy import text
        rows = await db.execute(text("""
            SELECT
                boardroom_confidence,
                COUNT(*) as total,
                SUM(CASE WHEN actual_outcome = 'win' THEN 1 ELSE 0 END) as wins,
                AVG(rr_achieved) as avg_rr,
                ROUND(
                    SUM(CASE WHEN actual_outcome = 'win' THEN 1.0 ELSE 0.0 END) /
                    COUNT(*) * 100, 1
                ) as win_rate_pct
            FROM trades
            WHERE actual_outcome IS NOT NULL
              AND boardroom_confidence IS NOT NULL
            GROUP BY boardroom_confidence
            HAVING COUNT(*) >= 3
            ORDER BY boardroom_confidence
        """))
        calibration_data = [dict(r) for r in rows.mappings()]

        total_count_row = await db.execute(text("""
            SELECT COUNT(*) as n FROM trades WHERE actual_outcome IS NOT NULL
        """))
        total_trades = (total_count_row.scalar() or 0)

    if total_trades < 20:
        return {
            "sufficient_data": False,
            "total_trades": total_trades,
            "min_required": 20,
            "message": f"Need {20 - total_trades} more closed trades for calibration analysis",
        }

    high_conf_rows = [r for r in calibration_data if r["boardroom_confidence"] >= 8]
    if high_conf_rows:
        high_conf_total = sum(r["total"] for r in high_conf_rows)
        high_conf_wins = sum(r["wins"] for r in high_conf_rows)
        high_conf_win_rate = high_conf_wins / high_conf_total * 100 if high_conf_total else 0.0
    else:
        high_conf_total = 0
        high_conf_win_rate = None

    calibrated = (high_conf_win_rate >= 55) if high_conf_win_rate is not None else None

    recommendation = None
    if not calibrated and high_conf_win_rate is not None:
        if high_conf_win_rate < 40:
            recommendation = (
                f"High-confidence decisions are winning only {high_conf_win_rate:.0f}%. "
                "Consider raising min_avg_conviction to 7.5 or higher in Settings."
            )
        elif high_conf_win_rate < 55:
            recommendation = (
                f"High-confidence decisions win {high_conf_win_rate:.0f}% (target: 55%+). "
                "Monitor for another 10 trades before adjusting thresholds."
            )

    return {
        "sufficient_data": True,
        "total_trades": total_trades,
        "calibration_data": calibration_data,
        "high_conf_win_rate": high_conf_win_rate,
        "high_conf_total_trades": high_conf_total,
        "calibrated": calibrated,
        "recommendation": recommendation,
        "generated_at": datetime.utcnow().isoformat(),
    }
