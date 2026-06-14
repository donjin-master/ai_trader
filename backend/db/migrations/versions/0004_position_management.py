"""position management: profile fields + managed_positions table

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("risk_profile", sa.Column("trail_method", sa.String(), server_default=sa.text("'STRUCTURE'")))
    op.add_column("risk_profile", sa.Column("atr_trail_multiplier", sa.Numeric(), server_default=sa.text("2.0")))
    op.add_column("risk_profile", sa.Column("tp1_exit_pct", sa.Numeric(), server_default=sa.text("40")))
    op.add_column("risk_profile", sa.Column("breakeven_at_rr", sa.Numeric(), server_default=sa.text("1.0")))
    op.add_column("risk_profile", sa.Column("tp1_rr_trigger", sa.Numeric(), server_default=sa.text("1.5")))
    op.add_column("risk_profile", sa.Column("allow_position_assessment", sa.Boolean(), server_default=sa.text("true")))
    # Minimum R:R is now an absolute 1:3 per UPGRADE_POSITION_MANAGEMENT.md
    op.alter_column("risk_profile", "min_rr_ratio", server_default=sa.text("3.0"))
    op.execute("UPDATE risk_profile SET min_rr_ratio = 3.0 WHERE min_rr_ratio < 3.0")

    op.create_table(
        "managed_positions",
        sa.Column("instrument", sa.String(), primary_key=True),
        sa.Column("state", JSONB, nullable=False),
        sa.Column("updated_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("managed_positions")
    op.alter_column("risk_profile", "min_rr_ratio", server_default=sa.text("1.5"))
    for col in ("allow_position_assessment", "tp1_rr_trigger", "breakeven_at_rr",
                "tp1_exit_pct", "atr_trail_multiplier", "trail_method"):
        op.drop_column("risk_profile", col)
