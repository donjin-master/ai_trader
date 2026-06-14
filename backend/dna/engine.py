"""Trading DNA — import the user's real Delta trade history and find patterns.

Analysis is statistical (pandas) with a single Sonnet pass to phrase the
data-backed insights. The AI never speculates about psychology and never
auto-adjusts the risk profile — the user applies rules manually.
"""

import json
from datetime import datetime, timedelta, timezone

import pandas as pd
from loguru import logger
from sqlalchemy import delete, select

from backend.db.database import AsyncSessionLocal
from backend.db.models import DnaReport, UserTrade
from backend.deps import delta_client

IST = timezone(timedelta(hours=5, minutes=30))


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

async def import_trade_history(max_pages: int = 10) -> dict:
    """Paginate Delta closed-order history; store realized round-trips.

    Delta attaches realized P&L metadata to reduce/close orders
    (meta_data.pnl + entry_price), which gives us entry/exit/P&L per trade.
    """
    imported = 0
    skipped = 0
    after: str | None = None

    async with AsyncSessionLocal() as session:
        for _ in range(max_pages):
            params: dict = {"page_size": 100, "states": "closed"}
            if after:
                params["after"] = after
            data = await delta_client._request("GET", "/v2/orders/history", params=params, auth=True)
            orders = data.get("result", [])
            if not orders:
                break

            for order in orders:
                meta = order.get("meta_data") or {}
                pnl = meta.get("pnl")
                entry_price = meta.get("entry_price")
                fill = order.get("average_fill_price")
                if pnl is None or entry_price is None or not fill:
                    skipped += 1
                    continue
                order_id = str(order.get("id"))
                existing = await session.execute(
                    select(UserTrade.id).where(UserTrade.delta_order_id == order_id)
                )
                if existing.scalar_one_or_none() is not None:
                    skipped += 1
                    continue

                exit_time = pd.to_datetime(order.get("created_at"), utc=True)
                exit_ist = exit_time.tz_convert(IST)
                side = order.get("side")  # the CLOSING side
                direction = "long" if side == "sell" else "short"
                entry = float(entry_price)
                exit_px = float(fill)
                pnl_val = float(pnl)
                pnl_pct = (
                    (exit_px - entry) / entry * 100 * (1 if direction == "long" else -1)
                    if entry else None
                )
                session.add(UserTrade(
                    delta_order_id=order_id,
                    instrument=order.get("product_symbol"),
                    direction=direction,
                    entry_price=entry,
                    exit_price=exit_px,
                    size=abs(float(order.get("size") or 0)),
                    pnl_inr=pnl_val,
                    pnl_pct=round(pnl_pct, 4) if pnl_pct is not None else None,
                    entry_time=None,  # Delta close orders don't carry entry time
                    exit_time=exit_time.to_pydatetime(),
                    duration_mins=None,
                    order_type=order.get("order_type"),
                    fees_inr=float(order.get("paid_commission") or 0),
                    day_of_week=int(exit_ist.dayofweek),
                    hour_of_entry=int(exit_ist.hour),
                ))
                imported += 1

            after = data.get("meta", {}).get("after")
            if not after:
                break

        await session.commit()

    logger.info("DNA import complete: {} imported, {} skipped", imported, skipped)
    return {"imported": imported, "skipped": skipped}


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

async def _load_trades_df() -> pd.DataFrame:
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(UserTrade))
        rows = result.scalars().all()
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame([{
        "instrument": r.instrument,
        "direction": r.direction,
        "pnl_inr": float(r.pnl_inr or 0),
        "pnl_pct": float(r.pnl_pct or 0),
        "fees_inr": float(r.fees_inr or 0),
        "size": float(r.size or 0),
        "order_type": r.order_type,
        "day_of_week": r.day_of_week,
        "hour": r.hour_of_entry,
        "exit_time": r.exit_time,
    } for r in rows])


def _session_of_hour(hour_ist: int) -> str:
    if 5 <= hour_ist < 13:
        return "Asia"
    if 13 <= hour_ist < 19:
        return "London"
    return "US"


def compute_dna_stats(df: pd.DataFrame) -> dict:
    """All ANALYSIS_DIMENSIONS computed deterministically."""
    if df.empty:
        return {"trade_count": 0}
    df = df.copy()
    df["win"] = df["pnl_inr"] > 0
    df["session"] = df["hour"].apply(_session_of_hour)
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    def rate(group: pd.DataFrame) -> float:
        return round(group["win"].mean() * 100, 1) if len(group) else 0.0

    hourly = {
        int(h): {"win_rate": rate(g), "trades": int(len(g)), "pnl": round(g["pnl_inr"].sum(), 2)}
        for h, g in df.groupby("hour")
    }
    by_day = {
        days[int(d)]: {"win_rate": rate(g), "trades": int(len(g)), "pnl": round(g["pnl_inr"].sum(), 2)}
        for d, g in df.groupby("day_of_week")
    }
    by_session = {
        s: {"win_rate": rate(g), "trades": int(len(g)), "pnl": round(g["pnl_inr"].sum(), 2)}
        for s, g in df.groupby("session")
    }
    by_instrument = {
        i: {
            "win_rate": rate(g), "trades": int(len(g)),
            "pnl": round(g["pnl_inr"].sum(), 2),
            "avg_pnl_pct": round(g["pnl_pct"].mean(), 3),
        }
        for i, g in df.groupby("instrument")
    }
    long_short = {
        d: {"win_rate": rate(g), "trades": int(len(g)), "pnl": round(g["pnl_inr"].sum(), 2)}
        for d, g in df.groupby("direction")
    }

    # Consecutive-loss behaviour (ordered by exit time)
    ordered = df.sort_values("exit_time").reset_index(drop=True)
    after_two_losses = []
    streak = 0
    for _, row in ordered.iterrows():
        if streak >= 2:
            after_two_losses.append(bool(row["win"]))
        streak = streak + 1 if not row["win"] else 0
    after_loss_winrate = (
        round(sum(after_two_losses) / len(after_two_losses) * 100, 1)
        if after_two_losses else None
    )

    # Daily P&L for heatmap
    ordered["date"] = pd.to_datetime(ordered["exit_time"]).dt.tz_convert(IST).dt.strftime("%Y-%m-%d")
    daily_pnl = {
        d: round(g["pnl_inr"].sum(), 2) for d, g in ordered.groupby("date")
    }

    total_pnl = round(df["pnl_inr"].sum(), 2)
    total_fees = round(df["fees_inr"].sum(), 2)

    # Discipline score: composition of fee drag, session focus, and loss control
    win_rate = rate(df)
    fee_drag = min(30, abs(total_fees) / max(abs(total_pnl), 1) * 30)
    loss_control = 30 if after_loss_winrate is None else max(0, 30 * (after_loss_winrate / max(win_rate, 1)))
    consistency = min(40, len(df) / 50 * 10 + win_rate * 0.3)
    discipline = round(max(1, min(100, consistency + (30 - fee_drag) + min(30, loss_control))), 0)

    return {
        "trade_count": int(len(df)),
        "win_rate": win_rate,
        "total_pnl_inr": total_pnl,
        "total_fees_inr": total_fees,
        "fee_pct_of_pnl": round(abs(total_fees) / max(abs(total_pnl), 0.01) * 100, 1),
        "hourly": hourly,
        "by_day": by_day,
        "by_session": by_session,
        "by_instrument": by_instrument,
        "long_vs_short": long_short,
        "after_two_losses_win_rate": after_loss_winrate,
        "daily_pnl": daily_pnl,
        "avg_size": round(df["size"].mean(), 2),
        "market_vs_limit": {
            t: {"win_rate": rate(g), "trades": int(len(g))}
            for t, g in df.groupby("order_type")
        },
        "discipline_score": discipline,
    }


async def analyse_trading_dna() -> dict:
    """Compute stats, ask Sonnet to phrase data-backed insights, store report."""
    df = await _load_trades_df()
    stats = compute_dna_stats(df)
    if stats["trade_count"] == 0:
        return {"error": "no imported trades — run /api/dna/import first", "stats": stats}

    insights: list[dict] = []
    overlay = ""
    try:
        from backend.ai.agents import _call_anthropic, _strip_json_fences

        system = (
            "You are a quantitative trading analyst. You receive computed statistics "
            "about a trader's real history. Write insights that are STRICTLY data-backed: "
            "cite the numbers. NEVER speculate about emotions, psychology, or motives. "
            "Respond ONLY in valid JSON: {\"insights\": [{\"title\": str, \"stat\": str, "
            "\"explanation\": str, \"suggested_rule\": str}], \"overlay\": \"3-6 bullet lines "
            "for the trading AI, each a concrete data-backed pattern\"}"
        )
        raw = await _call_anthropic(
            "claude-sonnet-4-6", system,
            f"Trader statistics (all computed from real Delta Exchange history):\n"
            f"{json.dumps(stats, indent=1, default=str)}\n\n"
            f"Produce up to 6 insights and the overlay.",
            max_tokens=3000,
        )
        parsed = json.loads(_strip_json_fences(raw))
        insights = parsed.get("insights", [])
        overlay = parsed.get("overlay", "")
    except Exception:
        logger.exception("DNA insight generation failed — storing stats only")

    report = {"stats": stats, "insights": insights}
    async with AsyncSessionLocal() as session:
        session.add(DnaReport(
            report=report,
            overlay_text=overlay,
            discipline_score=stats.get("discipline_score"),
        ))
        await session.commit()
    logger.info("DNA analysis stored: {} trades, {} insights, discipline {}",
                stats["trade_count"], len(insights), stats.get("discipline_score"))
    return report


async def latest_dna_overlay() -> str | None:
    """Most recent overlay text — injected into the boardroom Chair context."""
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(DnaReport.overlay_text)
                .where(DnaReport.overlay_text.is_not(None))
                .order_by(DnaReport.created_at.desc())
                .limit(1)
            )
            row = result.scalar_one_or_none()
            return row or None
    except Exception:
        return None


async def latest_dna_report() -> dict | None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(DnaReport).order_by(DnaReport.created_at.desc()).limit(1)
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        return {
            "report": row.report,
            "overlay_text": row.overlay_text,
            "discipline_score": float(row.discipline_score) if row.discipline_score else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
