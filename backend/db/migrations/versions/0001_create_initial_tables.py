"""create initial tables

Revision ID: 0001
Revises:
Create Date: 2026-06-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "trades",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("timestamp", TIMESTAMP(timezone=True)),
        sa.Column("instrument", sa.String()),
        sa.Column("direction", sa.String()),
        sa.Column("entry_price", sa.Numeric()),
        sa.Column("exit_price", sa.Numeric()),
        sa.Column("size_pct", sa.Numeric()),
        sa.Column("pnl_pct", sa.Numeric()),
        sa.Column("duration_mins", sa.Integer()),
        sa.Column("entry_reasoning", sa.Text()),
        sa.Column("market_snapshot", JSONB),
        sa.Column("exit_trigger", sa.String()),
        sa.Column("reflection", JSONB),
        sa.Column("counterfactuals", JSONB),
        sa.Column("bull_case", sa.Text()),
        sa.Column("bear_case", sa.Text()),
        sa.Column("confidence", sa.Integer()),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_trades_timestamp", "trades", ["timestamp"])
    op.create_index("ix_trades_instrument", "trades", ["instrument"])

    op.create_table(
        "market_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("timestamp", TIMESTAMP(timezone=True)),
        sa.Column("instrument", sa.String()),
        sa.Column("price", sa.Numeric()),
        sa.Column("funding_rate", sa.Numeric()),
        sa.Column("iv", sa.Numeric()),
        sa.Column("open_interest", sa.Numeric()),
        sa.Column("fear_greed_index", sa.Integer()),
        sa.Column("btc_dominance", sa.Numeric()),
        sa.Column("raw_data", JSONB),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_market_snapshots_timestamp", "market_snapshots", ["timestamp"])

    op.create_table(
        "agent_lessons",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("lesson_text", sa.Text()),
        sa.Column("watch_for", sa.Text()),
        sa.Column("pattern_type", sa.String()),
        sa.Column("confidence_score", sa.Integer()),
        sa.Column("source_trade_id", UUID(as_uuid=True), sa.ForeignKey("trades.id")),
    )
    op.create_index("ix_agent_lessons_source_trade_id", "agent_lessons", ["source_trade_id"])


def downgrade() -> None:
    op.drop_table("agent_lessons")
    op.drop_table("market_snapshots")
    op.drop_table("trades")
