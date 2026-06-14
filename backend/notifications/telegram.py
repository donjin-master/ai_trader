"""Telegram notifications, approval flow, and bot commands.

send_message never raises — logs and continues if anything fails.
"""

import time as time_module
from typing import Any

import httpx
from loguru import logger
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
)

from backend.config import settings

APPROVAL_EXPIRY_SECONDS = 300

# decision_id -> {"decision": dict, "snapshot": dict, "portfolio": dict, "expires_at": float}
pending_approvals: dict[str, dict[str, Any]] = {}

_application: Application | None = None


async def send_message(text: str) -> bool:
    """Send a message to the configured Telegram chat. Never raises."""
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        logger.warning("Telegram not configured — skipping message: {}", text[:80])
        return False

    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    payload = {
        "chat_id": settings.telegram_chat_id,
        "text": text,
        "parse_mode": "HTML",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload)
            if response.status_code != 200:
                logger.error("Telegram send failed: {} {}", response.status_code, response.text)
                return False
        logger.info("Telegram message sent: {}", text[:80])
        return True
    except Exception as exc:
        logger.error("Telegram send error: {}", exc)
        return False


async def notify_startup() -> None:
    await send_message(
        f"🤖 <b>AI Trader started</b>\n"
        f"🌐 Environment: {settings.environment}\n"
        f"⚙️ Mode: {settings.execution_mode}"
    )


async def notify_kill_switch() -> None:
    await send_message("🔴 <b>KILL SWITCH ACTIVATED</b>\nAll orders cancelled. Trading halted.")


# ---------------------------------------------------------------------------
# Approval flow (SEMI_AUTO, size > 1%)
# ---------------------------------------------------------------------------

def _expire_stale_approvals() -> None:
    now = time_module.time()
    for decision_id in list(pending_approvals.keys()):
        if pending_approvals[decision_id]["expires_at"] < now:
            logger.info("Approval expired for decision {}", decision_id)
            del pending_approvals[decision_id]


async def send_smc_alert(
    instrument: str, decision: dict, setup_score: dict | None, position_params: dict | None
) -> None:
    """Rich ADVISORY alert with boardroom + SMC setup context."""
    score_line = (
        f"Setup: {setup_score['score']}/10 ({setup_score['grade']})\n"
        f"Confluences: {', '.join(setup_score['confluences_found'][:3]) or 'none'}"
        if setup_score else "Setup: n/a"
    )
    size_line = (
        f"\nSuggested size: {position_params['position_size_pct']}%"
        if position_params else ""
    )
    await send_message(
        f"🧠 <b>Boardroom signal (ADVISORY): {str(decision.get('action', '')).upper()}</b>\n"
        f"{instrument} | {decision.get('consensus_level', '—')} "
        f"({decision.get('vote_tally', '—')}) | Confidence {decision.get('confidence')}/10\n"
        f"{score_line}{size_line}\n"
        f"{str(decision.get('reasoning'))[:250]}"
    )


async def send_approval_request(
    decision_id: str,
    decision: dict,
    snapshot: dict,
    portfolio: dict,
    timeout_mins: int | None = None,
    setup_score: dict | None = None,
) -> None:
    """Send approval request with inline Approve/Reject buttons."""
    _expire_stale_approvals()
    expiry_seconds = (timeout_mins * 60) if timeout_mins else APPROVAL_EXPIRY_SECONDS
    pending_approvals[decision_id] = {
        "decision": decision,
        "snapshot": snapshot,
        "portfolio": portfolio,
        "expires_at": time_module.time() + expiry_seconds,
    }

    score_line = (
        f"Setup: {setup_score['score']}/10 ({setup_score['grade']})\n" if setup_score else ""
    )
    text = (
        f"🤔 <b>APPROVAL NEEDED</b> (expires in {expiry_seconds // 60}min)\n"
        f"{decision.get('instrument')} {str(decision.get('action', '')).upper()} | "
        f"Size: {decision.get('size_pct')}%\n"
        f"Confidence: {decision.get('confidence')}/10 | "
        f"Votes: {decision.get('vote_tally', '—')}\n{score_line}\n"
        f"Bull: {str(decision.get('bull_case'))[:100]}\n"
        f"Bear: {str(decision.get('bear_case'))[:100]}\n"
        f"Chair: {str(decision.get('reasoning'))[:150]}..."
    )
    keyboard = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Approve", callback_data=f"approve:{decision_id}"),
        InlineKeyboardButton("❌ Reject", callback_data=f"reject:{decision_id}"),
    ]])

    if _application is not None:
        try:
            await _application.bot.send_message(
                chat_id=settings.telegram_chat_id,
                text=text,
                parse_mode="HTML",
                reply_markup=keyboard,
            )
            logger.info("Approval request sent for decision {}", decision_id)
            return
        except Exception as exc:
            logger.error("Approval request via bot failed: {}", exc)
    # Fallback: plain message without buttons
    await send_message(text + f"\n\nApprove via API: POST /api/approve/{decision_id}")


async def approve_decision(decision_id: str) -> dict:
    """Execute a pending approval. Shared by Telegram button and REST endpoint."""
    from backend.execution.executor import executor

    _expire_stale_approvals()
    pending = pending_approvals.pop(decision_id, None)
    if pending is None:
        return {"success": False, "error": "approval not found or expired"}
    result = await executor.execute_decision(
        pending["decision"], pending["snapshot"], pending["portfolio"], decision_id
    )
    return result


async def reject_decision(decision_id: str) -> bool:
    from backend.db.database import AsyncSessionLocal
    from backend.db.models import Trade

    pending_approvals.pop(decision_id, None)
    try:
        async with AsyncSessionLocal() as session:
            trade = await session.get(Trade, decision_id)
            if trade is not None:
                trade.status = "rejected"
                trade.exit_trigger = "manual"
                await session.commit()
        return True
    except Exception:
        logger.exception("Failed to mark decision {} rejected", decision_id)
        return False


# ---------------------------------------------------------------------------
# Bot handlers
# ---------------------------------------------------------------------------

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle Approve/Reject button presses."""
    query = update.callback_query
    if query is None or not query.data:
        return
    await query.answer()
    action, _, decision_id = query.data.partition(":")

    if action == "approve":
        result = await approve_decision(decision_id)
        if result.get("success"):
            await query.edit_message_text(
                f"✅ Approved and executed.\nOrder ID: {result.get('order_id')} "
                f"@ {result.get('actual_entry_price')}"
            )
        else:
            await query.edit_message_text(f"❌ Execution failed: {result.get('error')}")
    elif action == "reject":
        await reject_decision(decision_id)
        await query.edit_message_text("❌ Trade rejected by user.")


async def handle_stop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    from backend.execution.safety import safety_manager

    await safety_manager.activate_kill_switch("Telegram /stop command")
    if update.message:
        await update.message.reply_text("🔴 Kill switch activated.")


async def handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    from backend.execution.safety import safety_manager

    if safety_manager.kill_switch_active:
        await safety_manager.deactivate_kill_switch()
        if update.message:
            await update.message.reply_text("🟢 Kill switch deactivated. Trading resumed.")
    else:
        if update.message:
            await update.message.reply_text(
                "🤖 AI Trader is running. Kill switch is not active.\n"
                "Commands: /stop /status /mode advisory|semi|full"
            )


async def handle_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    from backend.deps import delta_client
    from backend.execution.safety import safety_manager

    open_count = 0
    try:
        open_count = len(await delta_client.get_positions())
    except Exception as exc:
        logger.warning("Status command: positions fetch failed: {}", exc)
    if update.message:
        await update.message.reply_text(
            f"⚙️ Mode: {safety_manager.execution_mode}\n"
            f"🔪 Kill switch: {'ACTIVE' if safety_manager.kill_switch_active else 'armed'}\n"
            f"📈 Daily P&L: {safety_manager.daily_pnl_pct:.2f}%\n"
            f"📊 Open positions: {open_count}"
        )


async def handle_mode(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    from backend.execution.safety import safety_manager

    mode_map = {"advisory": "ADVISORY", "semi": "SEMI_AUTO", "full": "FULL_AUTO"}
    args = context.args or []
    if not args or args[0].lower() not in mode_map:
        if update.message:
            await update.message.reply_text("Usage: /mode advisory|semi|full")
        return
    mode = mode_map[args[0].lower()]
    await safety_manager.set_execution_mode(mode)
    if update.message:
        await update.message.reply_text(f"⚙️ Execution mode set to {mode}")


# ---------------------------------------------------------------------------
# Bot lifecycle (started from FastAPI lifespan)
# ---------------------------------------------------------------------------

async def start_bot() -> None:
    """Start the Telegram bot polling loop. No-op if not configured."""
    global _application
    if not settings.telegram_bot_token:
        logger.warning("Telegram bot token missing — bot commands disabled")
        return
    try:
        _application = (
            Application.builder().token(settings.telegram_bot_token).build()
        )
        _application.add_handler(CommandHandler("stop", handle_stop))
        _application.add_handler(CommandHandler("start", handle_start))
        _application.add_handler(CommandHandler("status", handle_status))
        _application.add_handler(CommandHandler("mode", handle_mode))
        _application.add_handler(CallbackQueryHandler(handle_callback))
        await _application.initialize()
        await _application.start()
        if _application.updater is not None:
            await _application.updater.start_polling(drop_pending_updates=True)
        logger.info("Telegram bot polling started")
    except Exception:
        logger.exception("Failed to start Telegram bot — notifications still work")
        _application = None


async def stop_bot() -> None:
    global _application
    if _application is None:
        return
    try:
        if _application.updater is not None:
            await _application.updater.stop()
        await _application.stop()
        await _application.shutdown()
        logger.info("Telegram bot stopped")
    except Exception as exc:
        logger.error("Error stopping Telegram bot: {}", exc)
    _application = None
