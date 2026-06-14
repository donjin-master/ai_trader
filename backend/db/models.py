"""SQLAlchemy models matching the schema in CLAUDE.md."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    timestamp: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    instrument: Mapped[str | None] = mapped_column(String)
    direction: Mapped[str | None] = mapped_column(String)  # long/short
    entry_price: Mapped[float | None] = mapped_column(Numeric)
    exit_price: Mapped[float | None] = mapped_column(Numeric)
    size_pct: Mapped[float | None] = mapped_column(Numeric)
    pnl_pct: Mapped[float | None] = mapped_column(Numeric)
    duration_mins: Mapped[int | None] = mapped_column(Integer)
    entry_reasoning: Mapped[str | None] = mapped_column(Text)
    market_snapshot: Mapped[dict | None] = mapped_column(JSONB)  # full perception state at entry
    exit_trigger: Mapped[str | None] = mapped_column(String)  # tp/sl/manual/ai_decision
    reflection: Mapped[dict | None] = mapped_column(JSONB)  # Loop 2 output
    counterfactuals: Mapped[dict | None] = mapped_column(JSONB)  # Loop 3 output
    bull_case: Mapped[str | None] = mapped_column(Text)
    bear_case: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[int | None] = mapped_column(Integer)
    boardroom_confidence: Mapped[int | None] = mapped_column(Integer)
    actual_outcome: Mapped[str | None] = mapped_column(String)
    # logged_only | pending_approval | executed | rejected | open | closed | skipped
    status: Mapped[str | None] = mapped_column(String)
    key_signals: Mapped[list | None] = mapped_column(JSONB)
    decision_json: Mapped[dict | None] = mapped_column(JSONB)  # full Judge/Chair output
    boardroom_votes: Mapped[dict | None] = mapped_column(JSONB)  # full vote record
    chart_15m_path: Mapped[str | None] = mapped_column(String)
    chart_1h_path: Mapped[str | None] = mapped_column(String)
    chart_at_entry_b64: Mapped[str | None] = mapped_column(Text)  # visual memory
    vision_used: Mapped[bool | None] = mapped_column(Boolean, server_default=text("false"))
    smc_analysis: Mapped[dict | None] = mapped_column(JSONB)  # SMC structures at entry
    setup_score: Mapped[float | None] = mapped_column(Numeric)
    setup_grade: Mapped[str | None] = mapped_column(String)
    position_params: Mapped[dict | None] = mapped_column(JSONB)  # sizing calculation
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )

    __table_args__ = (
        Index("ix_trades_timestamp", "timestamp"),
        Index("ix_trades_instrument", "instrument"),
    )


class MarketSnapshot(Base):
    __tablename__ = "market_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    timestamp: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    instrument: Mapped[str | None] = mapped_column(String)
    price: Mapped[float | None] = mapped_column(Numeric)
    funding_rate: Mapped[float | None] = mapped_column(Numeric)
    iv: Mapped[float | None] = mapped_column(Numeric)
    open_interest: Mapped[float | None] = mapped_column(Numeric)
    fear_greed_index: Mapped[int | None] = mapped_column(Integer)
    btc_dominance: Mapped[float | None] = mapped_column(Numeric)
    raw_data: Mapped[dict | None] = mapped_column(JSONB)
    chart_path: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )

    __table_args__ = (Index("ix_market_snapshots_timestamp", "timestamp"),)


class AgentLesson(Base):
    __tablename__ = "agent_lessons"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )
    lesson_text: Mapped[str | None] = mapped_column(Text)
    watch_for: Mapped[str | None] = mapped_column(Text)
    pattern_type: Mapped[str | None] = mapped_column(String)
    confidence_score: Mapped[int | None] = mapped_column(Integer)
    quality_score: Mapped[int | None] = mapped_column(Integer, server_default=text("3"))
    embedding: Mapped[list | None] = mapped_column(JSONB)
    source_trade_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("trades.id")
    )

    __table_args__ = (Index("ix_agent_lessons_source_trade_id", "source_trade_id"),)


class RiskProfile(Base):
    """Singleton row (id=1) — the user-configurable risk control panel."""

    __tablename__ = "risk_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # Capital
    total_capital: Mapped[float] = mapped_column(Numeric, server_default=text("50000"))
    daily_budget_pct: Mapped[float] = mapped_column(Numeric, server_default=text("10.0"))
    weekly_budget_pct: Mapped[float] = mapped_column(Numeric, server_default=text("24.0"))
    # Position sizing
    risk_per_trade_pct: Mapped[float] = mapped_column(Numeric, server_default=text("1.0"))
    sizing_mode: Mapped[str] = mapped_column(String, server_default=text("'DYNAMIC'"))
    max_position_size_pct: Mapped[float] = mapped_column(Numeric, server_default=text("3.0"))
    # Trade frequency
    max_trades_per_day: Mapped[int] = mapped_column(Integer, server_default=text("3"))
    max_trades_per_week: Mapped[int] = mapped_column(Integer, server_default=text("10"))
    max_concurrent_trades: Mapped[int] = mapped_column(Integer, server_default=text("2"))
    min_setup_score: Mapped[float] = mapped_column(Numeric, server_default=text("7.0"))
    # Trading hours (IST)
    trade_start_time: Mapped[str] = mapped_column(String, server_default=text("'09:30'"))
    trade_end_time: Mapped[str] = mapped_column(String, server_default=text("'23:00'"))
    blackout_windows: Mapped[list | None] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    avoid_weekends: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # Risk controls
    daily_loss_limit_pct: Mapped[float] = mapped_column(Numeric, server_default=text("3.0"))
    consecutive_loss_limit: Mapped[int] = mapped_column(Integer, server_default=text("3"))
    min_rr_ratio: Mapped[float] = mapped_column(Numeric, server_default=text("1.5"))
    require_confluence: Mapped[int] = mapped_column(Integer, server_default=text("3"))
    # Boardroom
    min_boardroom_votes: Mapped[int] = mapped_column(Integer, server_default=text("2"))
    min_avg_conviction: Mapped[float] = mapped_column(Numeric, server_default=text("6.5"))
    allow_chair_override: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    # Execution
    mode: Mapped[str] = mapped_column(String, server_default=text("'ADVISORY'"))
    approval_timeout_mins: Mapped[int] = mapped_column(Integer, server_default=text("10"))
    # Position management
    trail_method: Mapped[str] = mapped_column(String, server_default=text("'STRUCTURE'"))
    atr_trail_multiplier: Mapped[float] = mapped_column(Numeric, server_default=text("2.0"))
    tp1_exit_pct: Mapped[float] = mapped_column(Numeric, server_default=text("40"))
    breakeven_at_rr: Mapped[float] = mapped_column(Numeric, server_default=text("1.0"))
    tp1_rr_trigger: Mapped[float] = mapped_column(Numeric, server_default=text("1.5"))
    allow_position_assessment: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    # R:R philosophy: min is an entry gate; max cap is NULL (no ceiling) by default
    max_rr_cap: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    vision_mode: Mapped[str] = mapped_column(String, server_default=text("'CHAIR_ONLY'"))
    # V1.2 — order state machine
    stale_order_candles: Mapped[int] = mapped_column(Integer, server_default=text("3"))
    preferred_entry_mode: Mapped[str] = mapped_column(String, server_default=text("'limit_preferred'"))
    # V1.3 — timezone-aware scan cadence
    scan_interval_asia_mins: Mapped[int] = mapped_column(Integer, server_default=text("30"))
    scan_interval_london_mins: Mapped[int] = mapped_column(Integer, server_default=text("15"))
    scan_interval_us_mins: Mapped[int] = mapped_column(Integer, server_default=text("15"))
    scan_interval_overnight_mins: Mapped[int] = mapped_column(Integer, server_default=text("60"))
    # V1.2 — options
    options_enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    max_options_loss_pct: Mapped[float] = mapped_column(Numeric, server_default=text("1.0"))
    preferred_dte_min: Mapped[int] = mapped_column(Integer, server_default=text("7"))
    preferred_dte_max: Mapped[int] = mapped_column(Integer, server_default=text("21"))
    iv_regime_threshold_low: Mapped[int] = mapped_column(Integer, server_default=text("30"))
    iv_regime_threshold_high: Mapped[int] = mapped_column(Integer, server_default=text("70"))
    updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )


class UserTrade(Base):
    """Imported manual trading history from Delta Exchange (Trading DNA)."""

    __tablename__ = "user_trades"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    delta_order_id: Mapped[str | None] = mapped_column(String, unique=True)
    instrument: Mapped[str | None] = mapped_column(String)
    direction: Mapped[str | None] = mapped_column(String)
    entry_price: Mapped[float | None] = mapped_column(Numeric)
    exit_price: Mapped[float | None] = mapped_column(Numeric)
    size: Mapped[float | None] = mapped_column(Numeric)
    pnl_inr: Mapped[float | None] = mapped_column(Numeric)
    pnl_pct: Mapped[float | None] = mapped_column(Numeric)
    entry_time: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    exit_time: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    duration_mins: Mapped[int | None] = mapped_column(Integer)
    order_type: Mapped[str | None] = mapped_column(String)
    fees_inr: Mapped[float | None] = mapped_column(Numeric)
    day_of_week: Mapped[int | None] = mapped_column(Integer)
    hour_of_entry: Mapped[int | None] = mapped_column(Integer)
    imported_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )

    __table_args__ = (Index("ix_user_trades_exit_time", "exit_time"),)


class ChartDrawing(Base):
    """Persisted chart drawings per instrument and timeframe."""

    __tablename__ = "chart_drawings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    instrument: Mapped[str] = mapped_column(String)
    timeframe: Mapped[str] = mapped_column(String)
    drawing_type: Mapped[str] = mapped_column(String)
    points: Mapped[list | dict] = mapped_column(JSONB)
    style: Mapped[dict] = mapped_column(
        JSONB,
        server_default=text("""'{"color":"#3b82f6","lineWidth"\\:1,"lineStyle":"solid"}'::jsonb"""),
    )
    locked: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    label: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )

    __table_args__ = (Index("idx_drawings_instrument_tf", "instrument", "timeframe"),)


class PatternOutcome(Base):
    """Outcome registry for SMC patterns and imported manual history."""

    __tablename__ = "pattern_outcomes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    trade_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("trades.id"))
    instrument: Mapped[str] = mapped_column(String)
    direction: Mapped[str] = mapped_column(String)
    pattern_type: Mapped[str] = mapped_column(String)
    session: Mapped[str] = mapped_column(String)
    timeframe: Mapped[str | None] = mapped_column(String, server_default=text("'15m'"))
    setup_score: Mapped[float | None] = mapped_column(Numeric)
    boardroom_confidence: Mapped[int | None] = mapped_column(Integer)
    outcome: Mapped[str] = mapped_column(String)
    rr_achieved: Mapped[float | None] = mapped_column(Numeric)
    pnl_pct: Mapped[float | None] = mapped_column(Numeric)
    entry_time: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    exit_time: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    created_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )

    __table_args__ = (
        Index("idx_pattern_outcomes_type", "pattern_type"),
        Index("idx_pattern_outcomes_instrument", "instrument"),
        Index("idx_pattern_outcomes_session", "session", "instrument"),
    )


class ImportJob(Base):
    """Progress tracker for long-running Delta history imports."""

    __tablename__ = "import_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String, server_default=text("'running'"))
    progress: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    trades_imported: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    created_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )
    completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))


class DnaReport(Base):
    """Stored Trading DNA analysis reports."""

    __tablename__ = "dna_reports"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    report: Mapped[dict | None] = mapped_column(JSONB)
    overlay_text: Mapped[str | None] = mapped_column(Text)
    discipline_score: Mapped[float | None] = mapped_column(Numeric)
    created_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )


class ManagedPosition(Base):
    """Persisted PositionManager state — survives restarts."""

    __tablename__ = "managed_positions"

    instrument: Mapped[str] = mapped_column(String, primary_key=True)
    state: Mapped[dict] = mapped_column(JSONB)
    updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )


class SystemState(Base):
    """Singleton row (id=1) holding runtime safety state."""

    __tablename__ = "system_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    kill_switch_active: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false")
    )
    execution_mode: Mapped[str] = mapped_column(String, server_default=text("'ADVISORY'"))
    daily_pnl_pct: Mapped[float] = mapped_column(Numeric, server_default=text("0"))
    last_reset_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True))
    updated_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("now()")
    )
