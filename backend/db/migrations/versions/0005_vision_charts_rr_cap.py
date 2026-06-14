"""vision chart memory columns + max_rr_cap + vision_mode

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trades", sa.Column("chart_15m_path", sa.String()))
    op.add_column("trades", sa.Column("chart_1h_path", sa.String()))
    op.add_column("trades", sa.Column("chart_at_entry_b64", sa.Text()))
    op.add_column("trades", sa.Column("vision_used", sa.Boolean(), server_default=sa.text("false")))
    op.add_column("market_snapshots", sa.Column("chart_path", sa.String()))
    # NULL = no cap (default and recommended) — winners run as far as structure allows
    op.add_column("risk_profile", sa.Column("max_rr_cap", sa.Numeric(), nullable=True))
    op.add_column("risk_profile", sa.Column("vision_mode", sa.String(), server_default=sa.text("'CHAIR_ONLY'")))


def downgrade() -> None:
    op.drop_column("risk_profile", "vision_mode")
    op.drop_column("risk_profile", "max_rr_cap")
    op.drop_column("market_snapshots", "chart_path")
    op.drop_column("trades", "vision_used")
    op.drop_column("trades", "chart_at_entry_b64")
    op.drop_column("trades", "chart_1h_path")
    op.drop_column("trades", "chart_15m_path")
