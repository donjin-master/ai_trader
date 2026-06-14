"""v1.2: order state machine, options, trading DNA, scenario lab

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # AREA 1 — order state machine
    op.add_column("risk_profile", sa.Column("stale_order_candles", sa.Integer(), server_default=sa.text("3")))
    op.add_column("risk_profile", sa.Column("preferred_entry_mode", sa.String(), server_default=sa.text("'limit_preferred'")))
    # AREA 2 — options
    op.add_column("risk_profile", sa.Column("options_enabled", sa.Boolean(), server_default=sa.text("false")))
    op.add_column("risk_profile", sa.Column("max_options_loss_pct", sa.Numeric(), server_default=sa.text("1.0")))
    op.add_column("risk_profile", sa.Column("preferred_dte_min", sa.Integer(), server_default=sa.text("7")))
    op.add_column("risk_profile", sa.Column("preferred_dte_max", sa.Integer(), server_default=sa.text("21")))
    op.add_column("risk_profile", sa.Column("iv_regime_threshold_low", sa.Integer(), server_default=sa.text("30")))
    op.add_column("risk_profile", sa.Column("iv_regime_threshold_high", sa.Integer(), server_default=sa.text("70")))

    # AREA 5 — trading DNA
    op.create_table(
        "user_trades",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("delta_order_id", sa.String(), unique=True),
        sa.Column("instrument", sa.String()),
        sa.Column("direction", sa.String()),
        sa.Column("entry_price", sa.Numeric()),
        sa.Column("exit_price", sa.Numeric()),
        sa.Column("size", sa.Numeric()),
        sa.Column("pnl_inr", sa.Numeric()),
        sa.Column("pnl_pct", sa.Numeric()),
        sa.Column("entry_time", TIMESTAMP(timezone=True)),
        sa.Column("exit_time", TIMESTAMP(timezone=True)),
        sa.Column("duration_mins", sa.Integer()),
        sa.Column("order_type", sa.String()),
        sa.Column("fees_inr", sa.Numeric()),
        sa.Column("day_of_week", sa.Integer()),
        sa.Column("hour_of_entry", sa.Integer()),
        sa.Column("imported_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_user_trades_exit_time", "user_trades", ["exit_time"])

    op.create_table(
        "dna_reports",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("report", JSONB),
        sa.Column("overlay_text", sa.Text()),
        sa.Column("discipline_score", sa.Numeric()),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("dna_reports")
    op.drop_table("user_trades")
    for col in ("iv_regime_threshold_high", "iv_regime_threshold_low", "preferred_dte_max",
                "preferred_dte_min", "max_options_loss_pct", "options_enabled",
                "preferred_entry_mode", "stale_order_candles"):
        op.drop_column("risk_profile", col)
