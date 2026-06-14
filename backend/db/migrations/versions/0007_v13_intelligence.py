"""v1.3: intelligence, chart persistence, patterns, calibration

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "chart_drawings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("instrument", sa.String(), nullable=False),
        sa.Column("timeframe", sa.String(), nullable=False),
        sa.Column("drawing_type", sa.String(), nullable=False),
        sa.Column("points", JSONB, nullable=False),
        sa.Column(
            "style",
            JSONB,
            nullable=False,
            server_default=sa.text("""'{"color":"#3b82f6","lineWidth"\\:1,"lineStyle":"solid"}'::jsonb"""),
        ),
        sa.Column("locked", sa.Boolean(), server_default=sa.text("false")),
        sa.Column("label", sa.String()),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_drawings_instrument_tf", "chart_drawings", ["instrument", "timeframe"])

    op.add_column("agent_lessons", sa.Column("quality_score", sa.Integer(), server_default=sa.text("3")))
    op.execute("ALTER TABLE agent_lessons ADD COLUMN IF NOT EXISTS embedding vector(1536)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_lessons_embedding "
        "ON agent_lessons USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)"
    )

    op.create_table(
        "pattern_outcomes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("trade_id", UUID(as_uuid=True), sa.ForeignKey("trades.id")),
        sa.Column("instrument", sa.String(), nullable=False),
        sa.Column("direction", sa.String(), nullable=False),
        sa.Column("pattern_type", sa.String(), nullable=False),
        sa.Column("session", sa.String(), nullable=False),
        sa.Column("timeframe", sa.String(), server_default=sa.text("'15m'")),
        sa.Column("setup_score", sa.Numeric()),
        sa.Column("boardroom_confidence", sa.Integer()),
        sa.Column("outcome", sa.String(), nullable=False),
        sa.Column("rr_achieved", sa.Numeric()),
        sa.Column("pnl_pct", sa.Numeric()),
        sa.Column("entry_time", TIMESTAMP(timezone=True)),
        sa.Column("exit_time", TIMESTAMP(timezone=True)),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_pattern_outcomes_type", "pattern_outcomes", ["pattern_type"])
    op.create_index("idx_pattern_outcomes_instrument", "pattern_outcomes", ["instrument"])
    op.create_index("idx_pattern_outcomes_session", "pattern_outcomes", ["session", "instrument"])

    op.add_column("trades", sa.Column("boardroom_confidence", sa.Integer()))
    op.add_column("trades", sa.Column("actual_outcome", sa.String()))

    op.add_column("risk_profile", sa.Column("scan_interval_asia_mins", sa.Integer(), server_default=sa.text("30")))
    op.add_column("risk_profile", sa.Column("scan_interval_london_mins", sa.Integer(), server_default=sa.text("15")))
    op.add_column("risk_profile", sa.Column("scan_interval_us_mins", sa.Integer(), server_default=sa.text("15")))
    op.add_column("risk_profile", sa.Column("scan_interval_overnight_mins", sa.Integer(), server_default=sa.text("60")))

    op.create_table(
        "import_jobs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("status", sa.String(), server_default=sa.text("'running'")),
        sa.Column("progress", sa.Integer(), server_default=sa.text("0")),
        sa.Column("trades_imported", sa.Integer(), server_default=sa.text("0")),
        sa.Column("created_at", TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("completed_at", TIMESTAMP(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("import_jobs")
    for col in (
        "scan_interval_overnight_mins",
        "scan_interval_us_mins",
        "scan_interval_london_mins",
        "scan_interval_asia_mins",
    ):
        op.drop_column("risk_profile", col)
    op.drop_column("trades", "actual_outcome")
    op.drop_column("trades", "boardroom_confidence")
    op.drop_table("pattern_outcomes")
    op.execute("DROP INDEX IF EXISTS idx_lessons_embedding")
    op.drop_column("agent_lessons", "embedding")
    op.drop_column("agent_lessons", "quality_score")
    op.drop_table("chart_drawings")
