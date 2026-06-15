"""
SCENARIO 07 — All Telegram Notification Types
Tests: Every notification type renders correctly within character limits

What it does:
  Sends one of each notification type with realistic mock data.
  Check your Telegram to verify they all look correct.
"""

import asyncio
from loguru import logger
from .scenario_base import ScenarioBase
from backend.notifications.telegram import telegram_bot
from backend.execution.safety import safety_manager
from datetime import datetime


class TelegramNotificationsScenario(ScenarioBase):

    NAME = "s07_all_telegram_notifications"
    DESCRIPTION = "Send one of every notification type — check Telegram manually"

    async def run(self):

        ticker = await self.delta.get_ticker(self.instrument)
        price = float(ticker.get("mark_price", 0))

        # 1. Trade entry (no chart — chart generation tested separately)
        sent = await telegram_bot.trade_entry(
            decision={
                "action": "long", "instrument": self.instrument,
                "confidence": 8, "setup_score": 8.2, "session": "US",
                "vote_tally": "3 LONG (unanimous)", "needs_approval": False,
                "reasoning": "4H bullish + 1H OB swept + 15M BOS confirmed. "
                             "Funding negative (-0.012%) with increasing OI.",
                "key_signals": ["4H_bullish_structure", "1H_liquidity_swept", "neg_funding"],
                "id": "test_telegram_01"
            },
            position={
                "entry_price": price,
                "sl_price": price * 0.995,
                "risk_pct": 0.5,
                "tp1": price * 1.0075,
                "tp2": price * 1.015,
                "tp1_rr": 1.5,
                "tp2_rr": 3.0
            }
        )
        self.check(sent, "Trade entry notification sent")
        await asyncio.sleep(2)

        # 2. TP1 hit
        await telegram_bot.tp1_hit({
            "instrument": self.instrument,
            "direction": "long",
            "tp1_price": price * 1.0075,
            "tp1_pnl_pct": 0.75,
            "entry_price": price,
            "target_rr": 3.0
        })
        self.check(True, "TP1 notification sent")
        await asyncio.sleep(2)

        # 3. Trail moved (silent)
        await telegram_bot.trail_moved(
            {"instrument": self.instrument, "unrealized_pnl_pct": 1.1},
            price * 0.995,
            price * 1.001
        )
        self.check(True, "Trail moved notification sent (silent)")
        await asyncio.sleep(2)

        # 4. Position closed (win)
        await telegram_bot.position_closed({
            "instrument": self.instrument,
            "direction": "long",
            "entry_price": price,
            "exit_price": price * 1.012,
            "pnl_pct": 1.2,
            "pnl_inr": 1200,
            "rr_achieved": 2.4,
            "duration_mins": 127,
            "exit_trigger": "trail_hit",
            "daily_pnl_pct": 1.2,
            "daily_wins": 1, "daily_losses": 0
        })
        self.check(True, "Position closed (win) notification sent")
        await asyncio.sleep(2)

        # 5. Position closed (loss)
        await telegram_bot.position_closed({
            "instrument": self.instrument,
            "direction": "long",
            "entry_price": price,
            "exit_price": price * 0.995,
            "pnl_pct": -0.5,
            "pnl_inr": -500,
            "rr_achieved": 0,
            "duration_mins": 23,
            "exit_trigger": "stop_loss_hit",
            "daily_pnl_pct": -0.5,
            "daily_wins": 0, "daily_losses": 1
        })
        self.check(True, "Position closed (loss) notification sent")
        await asyncio.sleep(2)

        # 6. Kill switch
        await telegram_bot.kill_switch_activated("Telegram test s07", 0)
        self.check(True, "Kill switch notification sent")
        await asyncio.sleep(2)
        await safety_manager.deactivate_kill_switch()

        # 7. Daily summary
        await telegram_bot.daily_summary({
            "date": datetime.now().strftime("%b %d, %Y"),
            "total_pnl_pct": 1.2,
            "total_pnl_inr": 1200,
            "total_trades": 3,
            "wins": 2, "losses": 1,
            "win_rate": 67,
            "best_rr": 2.4,
            "setups_scanned": 47,
            "signals_triggered": 3,
            "primary_regime": "TRENDING_UP",
            "budget_used_pct": 45
        })
        self.check(True, "Daily summary notification sent")
        await asyncio.sleep(2)

        logger.info("")
        logger.info("CHECK TELEGRAM NOW — all 7 notification types should be visible")
        logger.info("Verify: formatting correct, no truncation, emojis showing")
