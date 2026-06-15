"""Order executor — turns validated AI decisions into real Delta orders."""

import math
from datetime import datetime, timezone

from loguru import logger

from backend.db.database import AsyncSessionLocal
from backend.db.models import Trade
from backend.deps import delta_client, to_delta_symbol
from backend.notifications import telegram

PRICE_DRIFT_REDUCE_THRESHOLD_PCT = 0.5


class OrderExecutor:
    """Executes validated trade decisions on Delta Exchange."""

    async def execute_decision(
        self,
        decision: dict,
        current_snapshot: dict,
        portfolio: dict,
        trade_id: str | None = None,
    ) -> dict:
        instrument = decision["instrument"]
        symbol = to_delta_symbol(instrument)
        action = decision["action"]
        side = "buy" if action == "long" else "sell"

        # 1. Live price recalculation — never trust the AI's stated price
        live_ticker = await delta_client.get_ticker(symbol)
        orderbook = await delta_client.get_orderbook(symbol, depth=1)
        buy_levels = orderbook.get("buy") or []
        sell_levels = orderbook.get("sell") or []
        best_bid = float(buy_levels[0]["price"]) if buy_levels else None
        best_ask = float(sell_levels[0]["price"]) if sell_levels else None
        live_price = best_ask if action == "long" else best_bid
        if live_price is None:
            live_price = float(live_ticker.get("close") or 0)
        if not live_price:
            return {"success": False, "error": "no live price available"}

        size_pct = float(decision["size_pct"])
        snapshot_price = current_snapshot.get("price")
        if snapshot_price:
            drift_pct = abs(live_price - float(snapshot_price)) / float(snapshot_price) * 100
            if drift_pct > PRICE_DRIFT_REDUCE_THRESHOLD_PCT:
                logger.warning(
                    "Price moved {:.2f}% since snapshot — reducing size 50%", drift_pct
                )
                size_pct = size_pct / 2

        offset_pct = float(decision.get("price_offset_pct") or 0)
        entry_type = decision.get("entry_type", "market")
        entry_price = round(live_price * (1 + offset_pct / 100), 1)

        # 2. SL / TP prices from offsets + staged exit targets
        sl_offset = float(decision["stop_loss_offset_pct"])
        tp_offset = float(decision["take_profit_offset_pct"])
        if action == "long":
            sl_price = round(entry_price * (1 - sl_offset / 100), 1)
            tp_price = round(entry_price * (1 + tp_offset / 100), 1)
        else:
            sl_price = round(entry_price * (1 + sl_offset / 100), 1)
            tp_price = round(entry_price * (1 - tp_offset / 100), 1)

        # Staged targets from initial risk distance (UPGRADE_POSITION_MANAGEMENT)
        from backend.execution.risk_profile import risk_manager

        try:
            profile = await risk_manager.get_profile()
        except Exception:
            profile = {}
        tp1_rr = float(profile.get("tp1_rr_trigger", 1.5))
        tp2_rr = max(3.0, float(profile.get("min_rr_ratio", 3.0)))
        risk_dist = abs(entry_price - sl_price)
        sign = 1 if action == "long" else -1
        tp1_price = round(entry_price + sign * risk_dist * tp1_rr, 1)
        tp2_price = round(entry_price + sign * risk_dist * tp2_rr, 1)
        beyond_tp2 = (tp_price > tp2_price) if action == "long" else (tp_price < tp2_price)
        tp3_price = tp_price if beyond_tp2 else None
        bracket_tp = tp3_price or tp2_price  # exchange-side safety net

        # 3. Contract size from available margin
        available_margin = self._available_margin(portfolio)
        contracts = await self._calculate_contract_size(
            size_pct, available_margin, symbol, live_price
        )

        logger.info(
            "Placing order: {} {} {} contracts @ {} (SL {} / TP {})",
            symbol, side, contracts, entry_price if entry_type == "limit" else "market",
            sl_price, tp_price,
        )

        # 4. Place the order
        try:
            order = await delta_client.place_order(
                instrument=symbol,
                side=side,
                size=contracts,
                order_type=entry_type,
                limit_price=entry_price if entry_type == "limit" else None,
                stop_loss=sl_price,
                take_profit=bracket_tp,
            )
        except Exception as exc:
            logger.error("Order placement FAILED: {}", exc)
            await telegram.send_message(f"❌ <b>ORDER FAILED</b>\n{symbol} {action.upper()}\n{exc}")
            return {"success": False, "error": str(exc)}

        logger.info("Order placed successfully: {}", order)

        # State machine: unfilled limit order → PENDING (monitored, not re-decided)
        from backend.execution.order_state_manager import order_state_manager

        if order.get("state") == "open" and int(order.get("unfilled_size") or 0) > 0:
            await order_state_manager.on_order_placed(symbol, {
                "order_id": order.get("id"),
                "product_id": order.get("product_id"),
                "direction": action,
                "entry_price": entry_price,
                "sl": sl_price,
                "tp1": tp1_price,
                "tp2": tp2_price,
                "trade_id": trade_id,
            })
            await telegram.send_message(
                f"⏳ <b>LIMIT ORDER RESTING</b>\n"
                f"{symbol} {action.upper()} @ {entry_price}\n"
                f"State: PENDING — boardroom paused until fill/cancel"
            )
            return {
                "success": True,
                "order_id": order.get("id"),
                "pending": True,
                "actual_entry_price": entry_price,
                "actual_size": contracts,
            }
        await order_state_manager.on_position_opened(symbol)

        # Register with the active position manager (R:R already gate-checked)
        fill_price = float(order.get("average_fill_price") or entry_price)
        try:
            from backend.execution.position_manager import position_manager

            await position_manager.register_new_position(
                trade_id=trade_id,
                instrument=symbol,
                direction=action,
                entry_price=fill_price,
                initial_sl=sl_price,
                tp1=tp1_price,
                tp2=tp2_price,
                tp3=tp3_price,
                contracts=contracts,
                risk_pct=round(abs(fill_price - sl_price) / fill_price * 100, 2),
            )
        except ValueError as exc:
            # R:R guard tripped post-fill (shouldn't happen — gate checks first).
            logger.error("Position registration rejected: {} — closing immediately", exc)
            await delta_client.close_position(symbol)
            return {"success": False, "error": str(exc)}
        except Exception:
            logger.exception("Position manager registration failed for {}", symbol)

        # 5. Update trade record with actual entry details
        if trade_id:
            try:
                async with AsyncSessionLocal() as session:
                    trade = await session.get(Trade, trade_id)
                    if trade is not None:
                        trade.entry_price = entry_price
                        trade.size_pct = size_pct
                        trade.status = "open"
                        trade.timestamp = datetime.now(timezone.utc)
                        await session.commit()
            except Exception:
                logger.exception("Failed to update trade record {}", trade_id)

        emoji = "🟢" if action == "long" else "🔴"
        await telegram.send_message(
            f"✅ <b>ORDER PLACED</b>\n"
            f"{emoji} {symbol} {action.upper()}\n"
            f"Entry: {entry_price} | Size: {size_pct}% ({contracts} contracts) | "
            f"Confidence: {decision.get('confidence')}/10\n"
            f"SL: {sl_price} | TP: {tp_price}\n"
            f"Reason: {', '.join(decision.get('key_signals', []))}"
        )
        return {
            "success": True,
            "order_id": order.get("id"),
            "actual_entry_price": entry_price,
            "actual_size": contracts,
        }

    async def partial_close(self, instrument: str, contracts: int, reason: str) -> dict:
        """Close part of an open position with a reduce-only market order."""
        symbol = to_delta_symbol(instrument)
        positions = await delta_client.get_positions()
        position = next((p for p in positions if p.get("product_symbol") == symbol), None)
        if position is None:
            logger.warning("partial_close: no open position for {}", symbol)
            return {"closed": False, "reason": "no_open_position"}

        size = int(position["size"])
        side = "sell" if size > 0 else "buy"
        contracts = min(abs(size), max(1, contracts))
        payload = {
            "product_symbol": symbol,
            "side": side,
            "size": contracts,
            "order_type": "market_order",
            "reduce_only": "true",
        }
        logger.info("Partial close {} ({} contracts, reason: {})", symbol, contracts, reason)
        data = await delta_client._request("POST", "/v2/orders", json_body=payload, auth=True)
        result = data.get("result", data)
        logger.info("Partial close filled: {} @ {}", symbol, result.get("average_fill_price"))
        return result

    async def close_position(self, instrument: str, reason: str) -> dict:
        symbol = to_delta_symbol(instrument)
        logger.info("Closing position {} (reason: {})", symbol, reason)
        result = await delta_client.close_position(symbol)
        await telegram.send_message(
            f"📕 <b>Position close requested</b>\n{symbol}\nReason: {reason}"
        )
        return result

    def _available_margin(self, portfolio: dict) -> float:
        balances = portfolio.get("balance", [])
        if isinstance(balances, dict):
            balances = [balances]
        for asset in balances:
            if asset.get("asset_symbol") in ("USD", "USDT"):
                return float(asset.get("available_balance") or 0)
        if balances:
            return float(balances[0].get("available_balance") or 0)
        return 0.0

    async def _calculate_contract_size(
        self,
        size_pct: float,
        available_margin: float,
        instrument: str,
        current_price: float,
    ) -> int:
        """Convert size_pct of margin into contract count. Minimum 1 contract."""
        contract_value_usd = 1.0
        try:
            product = await delta_client.get_product(instrument)
            raw_cv = float(product.get("contract_value") or 1)
            unit = (product.get("contract_unit_currency") or "").upper()
            if unit in ("BTC", "ETH"):
                contract_value_usd = raw_cv * current_price
            else:
                contract_value_usd = raw_cv
        except Exception as exc:
            logger.warning("Could not fetch product info for {}: {}", instrument, exc)

        budget = available_margin * size_pct / 100
        contracts = math.floor(budget / contract_value_usd) if contract_value_usd > 0 else 0
        return max(1, contracts)


executor = OrderExecutor()
