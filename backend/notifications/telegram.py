"""Telegram notification system — chart images, approvals, silent updates, daily summary."""

import base64
from datetime import datetime
from io import BytesIO
from typing import Optional

from loguru import logger
from backend.config import settings

try:
    from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup
except ImportError:
    Bot = None  # type: ignore[assignment,misc]
    InlineKeyboardButton = None  # type: ignore[assignment,misc]
    InlineKeyboardMarkup = None  # type: ignore[assignment,misc]


class TradingTelegramBot:
    """
    Unified Telegram notifications for AI Trader.
    Photo-then-text pattern to bypass 1,024-char caption limit.
    Silent mode for informational updates (trail moves, meta-lessons).
    """

    CHAR_LIMIT = 4096
    CAPTION_LIMIT = 1024

    def __init__(self, token: str, chat_id: str) -> None:
        self.token = token
        self.chat_id = chat_id
        self._bot: Optional[object] = None
        self._pending_approvals: dict[str, dict] = {}
        if token and Bot is not None:
            try:
                self._bot = Bot(token=token)
            except Exception:
                logger.warning("Telegram Bot init failed — notifications disabled")

    async def send(
        self,
        text: str,
        chart_bytes: Optional[bytes] = None,
        caption: Optional[str] = None,
        buttons: Optional[list] = None,
        silent: bool = False,
    ) -> bool:
        """Universal send. Never raises. Returns True on success."""
        if not self._bot or not self.chat_id:
            logger.debug("Telegram disabled — would send: {}", text[:80])
            return False
        try:
            if len(text) > self.CHAR_LIMIT:
                text = text[: self.CHAR_LIMIT - 50] + "\n\n<i>... message truncated</i>"
            if caption and len(caption) > self.CAPTION_LIMIT:
                caption = caption[: self.CAPTION_LIMIT - 3] + "..."

            reply_markup = None
            if buttons and InlineKeyboardMarkup is not None:
                keyboard = [
                    [InlineKeyboardButton(b["text"], callback_data=b["data"]) for b in row]
                    for row in buttons
                ]
                reply_markup = InlineKeyboardMarkup(keyboard)

            # chart_bytes may be raw bytes or a {"image_base64": "..."} dict from chart_generator
            if isinstance(chart_bytes, dict):
                b64 = chart_bytes.get("image_base64", "")
                chart_bytes = base64.b64decode(b64) if b64 else None
            if chart_bytes:
                if not caption and len(text) <= self.CAPTION_LIMIT:
                    caption = text
                    text = ""

                await self._bot.send_photo(
                    chat_id=self.chat_id,
                    photo=BytesIO(chart_bytes),
                    caption=caption or "",
                    parse_mode="HTML",
                    disable_notification=silent,
                )
                if text.strip() and text != caption:
                    await self._bot.send_message(
                        chat_id=self.chat_id,
                        text=text,
                        parse_mode="HTML",
                        reply_markup=reply_markup,
                        disable_notification=True,
                    )
            else:
                await self._bot.send_message(
                    chat_id=self.chat_id,
                    text=text,
                    parse_mode="HTML",
                    reply_markup=reply_markup,
                    disable_notification=silent,
                )
            return True
        except Exception:
            logger.exception("Telegram send failed")
            return False

    async def trade_entry(
        self, decision: dict, position: dict, chart_bytes: Optional[bytes] = None
    ) -> None:
        direction = decision.get("action", "").upper()
        emoji = "📈" if direction == "LONG" else "📉"
        confidence = decision.get("confidence", 0)
        conf_bar = "█" * confidence + "░" * (10 - confidence)
        instrument = decision.get("instrument", "BTCUSD_PERP")
        needs_approval = decision.get("needs_approval", False)

        caption = f"{emoji} {instrument} {direction} · Conf {confidence}/10"
        text = (
            f"{emoji} <b>TRADE SIGNAL</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
            f"<b>{instrument}</b> · {direction}\n\n"
            f"<b>Entry:</b> ${position.get('entry_price', 0):,.2f}\n"
            f"<b>Stop:</b> ${position.get('sl_price', 0):,.2f} (−{position.get('risk_pct', 0):.2f}%)\n"
            f"<b>TP1:</b> ${position.get('tp1', 0):,.2f} (+1:{position.get('tp1_rr', 1.5):.1f}R)\n"
            f"<b>TP2:</b> ${position.get('tp2', 0):,.2f} (+1:{position.get('tp2_rr', 3.0):.1f}R)\n\n"
            f"<b>Confidence:</b> [{conf_bar}] {confidence}/10\n"
            f"<b>Score:</b> {decision.get('setup_score', 0):.1f}/10\n"
            f"<b>Boardroom:</b> {decision.get('vote_tally', 'N/A')}\n\n"
            f"<b>Why:</b>\n{(decision.get('reasoning') or 'No reasoning available')[:250]}\n\n"
            f"<b>Signals:</b> {', '.join((decision.get('key_signals') or [])[:3])}"
        )
        buttons = None
        if needs_approval:
            buttons = [[
                {"text": "✅ Approve", "data": f"approve_{decision.get('id', 'unknown')}"},
                {"text": "❌ Reject", "data": f"reject_{decision.get('id', 'unknown')}"},
            ]]
        await self.send(text=text, chart_bytes=chart_bytes, buttons=buttons, silent=False)

    async def tp1_hit(self, position: dict) -> None:
        text = (
            f"⚡ <b>TP1 HIT — PARTIAL EXIT</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
            f"{position.get('instrument')} · {(position.get('direction') or '').upper()}\n\n"
            f"40% closed at ${position.get('tp1_price', 0):,.2f}\n"
            f"Profit locked: +{position.get('tp1_pnl_pct', 0):.2f}%\n\n"
            f"SL → breakeven: ${position.get('entry_price', 0):,.2f}\n"
            f"Remaining 60% riding FREE 🚀\n"
            f"Trail activated · Target: 1:{position.get('target_rr', 3):.0f}R"
        )
        await self.send(text=text, silent=False)

    async def trail_moved(self, position: dict, old_trail: float, new_trail: float) -> None:
        move = new_trail - old_trail
        pnl = position.get("unrealized_pnl_pct", 0)
        text = (
            f"📐 Trail: ${old_trail:,.0f} → ${new_trail:,.0f} (+${move:,.0f})\n"
            f"{position.get('instrument')} · P&L: {pnl:+.2f}%"
        )
        await self.send(text=text, silent=True)

    async def position_closed(
        self, trade: dict, chart_bytes: Optional[bytes] = None
    ) -> None:
        won = (trade.get("pnl_pct") or 0) > 0
        emoji = "✅" if won else "🔴"
        result_str = "WIN" if won else "LOSS"
        caption = (
            f"{emoji} {trade.get('instrument')} {result_str} · "
            f"{(trade.get('pnl_pct') or 0):+.2f}% · 1:{(trade.get('rr_achieved') or 0):.1f}R"
        )
        text = (
            f"{emoji} <b>POSITION CLOSED · {result_str}</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
            f"<b>{trade.get('instrument')}</b> · {(trade.get('direction') or '').upper()}\n\n"
            f"Entry: ${(trade.get('entry_price') or 0):,.2f}\n"
            f"Exit:  ${(trade.get('exit_price') or 0):,.2f} "
            f"({(trade.get('exit_trigger') or 'manual').replace('_', ' ').title()})\n"
            f"P&L:   {(trade.get('pnl_pct') or 0):+.2f}% "
            f"({'+'if won else ''}{(trade.get('pnl_inr') or 0):,.0f} INR)\n"
            f"R:R:   1:{(trade.get('rr_achieved') or 0):.1f} achieved\n"
            f"Time:  {trade.get('duration_mins', 0)} minutes\n\n"
            f"Today: {(trade.get('daily_pnl_pct') or 0):+.2f}% · "
            f"{trade.get('daily_wins', 0)}W/{trade.get('daily_losses', 0)}L"
        )
        await self.send(text=text, chart_bytes=chart_bytes, silent=False)

    async def kill_switch_activated(self, reason: str, positions_closed: int) -> None:
        text = (
            f"🔴 <b>KILL SWITCH ACTIVATED</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
            f"Reason: {reason}\n"
            f"Positions closed: {positions_closed}\n"
            f"All open orders cancelled.\n\n"
            f"To resume trading: /resume"
        )
        await self.send(text=text, silent=False)

    async def daily_summary(
        self, stats: dict, chart_bytes: Optional[bytes] = None
    ) -> None:
        won = (stats.get("total_pnl_pct") or 0) > 0
        emoji = "📊" if won else "📉"
        date_str = datetime.now().strftime("%b %d, %Y")
        caption = f"{emoji} Daily Summary · {date_str} · {(stats.get('total_pnl_pct') or 0):+.2f}%"
        text = (
            f"{emoji} <b>DAILY SUMMARY</b> · {date_str}\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
            f"P&L: {(stats.get('total_pnl_pct') or 0):+.2f}% · "
            f"{'+'if won else ''}{(stats.get('total_pnl_inr') or 0):,.0f} INR\n\n"
            f"Trades: {stats.get('total_trades', 0)} · "
            f"{stats.get('wins', 0)}W / {stats.get('losses', 0)}L\n"
            f"Win rate: {stats.get('win_rate', 0):.0f}%\n"
            f"Best R:R: 1:{stats.get('best_rr', 0):.1f}\n\n"
            f"Scans: {stats.get('setups_scanned', 0)} · "
            f"Signals: {stats.get('signals_triggered', 0)}\n"
            f"Regime: {stats.get('primary_regime', 'Unknown')}\n\n"
            f"Budget used: {stats.get('budget_used_pct', 0):.0f}%"
        )
        await self.send(text=text, chart_bytes=chart_bytes, silent=False)

    async def handle_approval_callback(self, callback_query) -> None:
        data = callback_query.data
        if data.startswith("approve_"):
            decision_id = data.replace("approve_", "")
            pending = self._pending_approvals.get(decision_id)
            if pending:
                await callback_query.answer("Approved ✅")
                from backend.ai.loops import execute_approved_decision
                await execute_approved_decision(decision_id, pending["decision"])
                del self._pending_approvals[decision_id]
            else:
                await callback_query.answer("Approval expired ❌")
        elif data.startswith("reject_"):
            decision_id = data.replace("reject_", "")
            self._pending_approvals.pop(decision_id, None)
            await callback_query.answer("Trade rejected ❌")

    async def handle_command(self, message) -> None:
        cmd = (message.text or "").strip().lower()
        if cmd == "/stop":
            from backend.execution.safety import safety_manager
            await safety_manager.activate_kill_switch("Manual Telegram command")
            await self.send("🔴 Kill switch activated via Telegram.")
        elif cmd == "/resume":
            from backend.execution.safety import safety_manager
            await safety_manager.deactivate_kill_switch()
            await self.send("🟢 Kill switch deactivated. Trading resumed.")
        elif cmd == "/status":
            from backend.execution.safety import safety_manager
            status = await safety_manager.get_status()
            await self.send(
                f"📊 STATUS\n"
                f"Mode: {status.get('execution_mode')}\n"
                f"Kill switch: {'ARMED' if not status.get('kill_switch_active') else 'TRIGGERED'}\n"
                f"Daily P&L: {(status.get('daily_pnl_pct') or 0):+.2f}%\n"
                f"Open positions: {status.get('open_positions', 0)}"
            )


telegram_bot = TradingTelegramBot(
    token=settings.telegram_bot_token,
    chat_id=settings.telegram_chat_id,
)

# Module-level helpers used by main.py

async def start_bot() -> None:
    """No-op lifecycle hook — Bot instance is created at import time."""
    pass


async def stop_bot() -> None:
    """No-op lifecycle hook."""
    pass


async def notify_startup() -> None:
    from backend.execution.safety import safety_manager
    from backend.config import settings
    await telegram_bot.send(
        f"🚀 <b>AI Trader started</b>\n"
        f"Environment: {settings.environment}\n"
        f"Mode: {safety_manager.execution_mode}",
        silent=True,
    )


async def approve_decision(decision_id: str) -> dict:
    """Approve a pending SEMI_AUTO decision by ID."""
    pending = telegram_bot._pending_approvals.get(decision_id)
    if not pending:
        return {"approved": False, "reason": "Decision not found or already handled"}
    del telegram_bot._pending_approvals[decision_id]
    return {"approved": True, "decision": pending.get("decision")}


async def send_message(text: str, silent: bool = False) -> bool:
    """Module-level helper — delegates to telegram_bot.send()."""
    return await telegram_bot.send(text=text, silent=silent)


async def send_decision_summary(
    instrument: str,
    decision: dict,
    setup_score: dict | None,
    chart_bytes: bytes | None,
    rejection: str | None = None,
) -> None:
    """Send boardroom HOLD/advisory result — includes chart if available."""
    action = (decision.get("action") or "hold").upper()
    consensus = decision.get("consensus_level", "—")
    vote_tally = decision.get("vote_tally", "—")
    score = (setup_score or {}).get("score", "—")
    grade = (setup_score or {}).get("grade", "")
    signals = decision.get("key_signals") or []
    signals_str = (" · ".join(str(s) for s in signals[:3])) if signals else ""

    header = (
        f"🧠 Boardroom: {action} ({consensus}, {vote_tally})\n"
        f"{instrument} | Setup: {score}/10 {grade}\n"
        f"{('❌ Rejected: ' + rejection + chr(10)) if rejection else ''}"
    )
    reasoning = str(decision.get("reasoning") or "")
    # Full text for text-only message (4096 char limit)
    full_text = header + reasoning[:800] + (f"\n\nSignals: {signals_str}" if signals_str else "")

    await telegram_bot.send(text=full_text, chart_bytes=chart_bytes, silent=False)


async def send_smc_alert(
    instrument: str,
    decision: dict,
    setup_score: dict | None,
    chart_bytes: bytes | None,
) -> None:
    """Send an SMC signal alert — good setup identified but not yet executed."""
    action = (decision.get("action") or "hold").upper()
    score = (setup_score or {}).get("score", "—")
    grade = (setup_score or {}).get("grade", "")
    votes = decision.get("vote_tally", "—")
    confidence = decision.get("confidence", 0)
    conf_bar = "█" * confidence + "░" * (10 - confidence)

    text = (
        f"🔍 <b>SMC SIGNAL — {instrument}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"Direction: <b>{action}</b>\n"
        f"Boardroom: {votes} · Conf [{conf_bar}] {confidence}/10\n"
        f"Setup score: {score}/10 {grade}\n\n"
        f"<i>Signal logged — execution pending risk/mode gate</i>\n"
        f"{(decision.get('reasoning') or '')[:200]}"
    )
    await telegram_bot.send(text=text, chart_bytes=chart_bytes, silent=False)


async def send_approval_request(
    trade_id: str,
    decision: dict,
    snapshot: dict,
    portfolio: dict,
) -> None:
    """Store decision for approval and send Telegram message with approve/reject buttons."""
    telegram_bot._pending_approvals[trade_id] = {"decision": decision, "snapshot": snapshot}
    await telegram_bot.trade_entry(
        {**decision, "id": trade_id, "needs_approval": True},
        portfolio,
    )
