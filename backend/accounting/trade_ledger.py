"""Financial accounting — precise fee calculations for every trade."""

from datetime import datetime

from loguru import logger

DELTA_TAKER_FEE = 0.0005  # 0.05%
DELTA_MAKER_FEE = 0.0002  # 0.02%
GST_RATE = 0.18           # 18% GST on fees


class TradeLedger:
    """
    Records every trade with exact fee calculations.
    Generates data for tax filing and P&L reporting.
    Delta taker fee: 0.05%, maker fee: 0.02%, GST: 18% on fees.
    """

    async def record_trade(
        self,
        trade_id: str,
        instrument: str,
        direction: str,
        entry_price: float,
        exit_price: float,
        size_contracts: int,
        entry_order_type: str,
        exit_order_type: str,
        capital_inr: float,
    ) -> dict:
        if direction == "long":
            gross_pnl_pct = (exit_price - entry_price) / entry_price * 100
        else:
            gross_pnl_pct = (entry_price - exit_price) / entry_price * 100

        notional_inr = size_contracts * entry_price * (capital_inr / 100)

        entry_fee_rate = DELTA_MAKER_FEE if entry_order_type == "limit" else DELTA_TAKER_FEE
        exit_fee_rate = DELTA_MAKER_FEE if exit_order_type == "limit" else DELTA_TAKER_FEE

        entry_fee_inr = notional_inr * entry_fee_rate
        entry_gst_inr = entry_fee_inr * GST_RATE
        exit_fee_inr = notional_inr * exit_fee_rate
        exit_gst_inr = exit_fee_inr * GST_RATE

        total_fees_inr = entry_fee_inr + entry_gst_inr + exit_fee_inr + exit_gst_inr
        gross_pnl_inr = notional_inr * gross_pnl_pct / 100
        net_pnl_inr = gross_pnl_inr - total_fees_inr
        net_pnl_pct = net_pnl_inr / capital_inr * 100 if capital_inr else 0

        record = {
            "trade_id": trade_id,
            "instrument": instrument,
            "direction": direction,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "size_contracts": size_contracts,
            "notional_inr": round(notional_inr, 2),
            "gross_pnl_inr": round(gross_pnl_inr, 2),
            "entry_fee_inr": round(entry_fee_inr, 2),
            "entry_gst_inr": round(entry_gst_inr, 2),
            "exit_fee_inr": round(exit_fee_inr, 2),
            "exit_gst_inr": round(exit_gst_inr, 2),
            "total_fees_inr": round(total_fees_inr, 2),
            "net_pnl_inr": round(net_pnl_inr, 2),
            "net_pnl_pct": round(net_pnl_pct, 4),
            "fee_drag_pct": round(total_fees_inr / capital_inr * 100 if capital_inr else 0, 4),
            "recorded_at": datetime.utcnow().isoformat(),
        }

        try:
            from sqlalchemy import text
            from backend.db.database import AsyncSessionLocal
            async with AsyncSessionLocal() as db:
                await db.execute(text("""
                    INSERT INTO trade_ledger
                      (trade_id, instrument, direction, entry_price, exit_price,
                       size_contracts, notional_inr, gross_pnl_inr, total_fees_inr,
                       net_pnl_inr, net_pnl_pct, entry_fee_inr, entry_gst_inr,
                       exit_fee_inr, exit_gst_inr, fee_drag_pct)
                    VALUES
                      (:trade_id, :instrument, :direction, :entry_price, :exit_price,
                       :size_contracts, :notional_inr, :gross_pnl_inr, :total_fees_inr,
                       :net_pnl_inr, :net_pnl_pct, :entry_fee_inr, :entry_gst_inr,
                       :exit_fee_inr, :exit_gst_inr, :fee_drag_pct)
                    ON CONFLICT (trade_id) DO NOTHING
                """), record)
                await db.commit()
        except Exception:
            logger.exception("Failed to store trade ledger record for {}", trade_id)

        return record


trade_ledger = TradeLedger()
