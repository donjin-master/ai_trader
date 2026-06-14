"""add decision columns to trades and create system_state

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trades", sa.Column("status", sa.String()))
    op.add_column("trades", sa.Column("key_signals", JSONB))
    op.add_column("trades", sa.Column("decision_json", JSONB))

    op.create_table(
        "system_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kill_switch_active", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("execution_mode", sa.String(), server_default=sa.text("'ADVISORY'")),
        sa.Column("daily_pnl_pct", sa.Numeric(), server_default=sa.text("0")),
        sa.Column("last_reset_at", TIMESTAMP(timezone=True)),
        sa.Column("updated_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("system_state")
    op.drop_column("trades", "decision_json")
    op.drop_column("trades", "key_signals")
    op.drop_column("trades", "status")
