"""boardroom votes, smc columns, risk_profile table

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trades", sa.Column("boardroom_votes", JSONB))
    op.add_column("trades", sa.Column("smc_analysis", JSONB))
    op.add_column("trades", sa.Column("setup_score", sa.Numeric()))
    op.add_column("trades", sa.Column("setup_grade", sa.String()))
    op.add_column("trades", sa.Column("position_params", JSONB))

    op.create_table(
        "risk_profile",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("total_capital", sa.Numeric(), server_default=sa.text("50000")),
        sa.Column("daily_budget_pct", sa.Numeric(), server_default=sa.text("10.0")),
        sa.Column("weekly_budget_pct", sa.Numeric(), server_default=sa.text("24.0")),
        sa.Column("risk_per_trade_pct", sa.Numeric(), server_default=sa.text("1.0")),
        sa.Column("sizing_mode", sa.String(), server_default=sa.text("'DYNAMIC'")),
        sa.Column("max_position_size_pct", sa.Numeric(), server_default=sa.text("3.0")),
        sa.Column("max_trades_per_day", sa.Integer(), server_default=sa.text("3")),
        sa.Column("max_trades_per_week", sa.Integer(), server_default=sa.text("10")),
        sa.Column("max_concurrent_trades", sa.Integer(), server_default=sa.text("2")),
        sa.Column("min_setup_score", sa.Numeric(), server_default=sa.text("7.0")),
        sa.Column("trade_start_time", sa.String(), server_default=sa.text("'09:30'")),
        sa.Column("trade_end_time", sa.String(), server_default=sa.text("'23:00'")),
        sa.Column("blackout_windows", JSONB, server_default=sa.text("'[]'::jsonb")),
        sa.Column("avoid_weekends", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("daily_loss_limit_pct", sa.Numeric(), server_default=sa.text("3.0")),
        sa.Column("consecutive_loss_limit", sa.Integer(), server_default=sa.text("3")),
        sa.Column("min_rr_ratio", sa.Numeric(), server_default=sa.text("1.5")),
        sa.Column("require_confluence", sa.Integer(), server_default=sa.text("3")),
        sa.Column("min_boardroom_votes", sa.Integer(), server_default=sa.text("2")),
        sa.Column("min_avg_conviction", sa.Numeric(), server_default=sa.text("6.5")),
        sa.Column("allow_chair_override", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("mode", sa.String(), server_default=sa.text("'ADVISORY'")),
        sa.Column("approval_timeout_mins", sa.Integer(), server_default=sa.text("10")),
        sa.Column("updated_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("INSERT INTO risk_profile (id) VALUES (1) ON CONFLICT DO NOTHING")


def downgrade() -> None:
    op.drop_table("risk_profile")
    op.drop_column("trades", "position_params")
    op.drop_column("trades", "setup_grade")
    op.drop_column("trades", "setup_score")
    op.drop_column("trades", "smc_analysis")
    op.drop_column("trades", "boardroom_votes")
