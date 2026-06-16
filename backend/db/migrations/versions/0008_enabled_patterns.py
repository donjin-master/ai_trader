"""v1.4: strategy deploy — enabled_patterns allow-list on risk_profile

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "risk_profile",
        sa.Column("enabled_patterns", JSONB, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("risk_profile", "enabled_patterns")
