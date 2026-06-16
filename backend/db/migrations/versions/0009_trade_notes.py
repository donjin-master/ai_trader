"""v1.4: real user notes per trade (Journal page)

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("trades", sa.Column("notes", sa.Text()))


def downgrade() -> None:
    op.drop_column("trades", "notes")
