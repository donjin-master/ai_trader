"""
V1.4 Event-Flow Integration Tests
==================================
Run with:  pytest backend/tests/test_event_flow.py -v

These tests cover the new event-driven pipeline without hitting live APIs.
All external calls (Delta, LLM, Telegram) are mocked.
"""

import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# CandleBuilder tests
# ---------------------------------------------------------------------------

class TestCandleBuilder:
    def setup_method(self):
        from backend.websocket.candle_builder import CandleBuilder
        self.builder = CandleBuilder(timeframes=["15m"])
        self.closed_candles: list = []
        
        async def _cb(c):
            self.closed_candles.append(c)
        self.builder.on_candle_close(_cb)

    @pytest.mark.asyncio
    async def test_first_tick_opens_candle(self):
        ts = datetime.fromtimestamp(1_700_000_000.0, tz=timezone.utc)
        result = self.builder.update("BTCUSD_PERP", 50000.0, 1.0, ts)
        assert result == {}  # no closed candles yet
        current = self.builder.get_current("BTCUSD_PERP", "15m")
        assert current is not None
        assert current.open == 50000.0
        assert current.high == 50000.0
        assert current.low == 50000.0
        assert current.close == 50000.0

    @pytest.mark.asyncio
    async def test_candle_updates_high_low(self):
        ts = datetime.fromtimestamp(1_700_000_000.0, tz=timezone.utc)
        self.builder.update("BTCUSD_PERP", 50000.0, 1.0, ts)
        self.builder.update("BTCUSD_PERP", 51000.0, 2.0, ts + timedelta(seconds=10))
        self.builder.update("BTCUSD_PERP", 49000.0, 1.5, ts + timedelta(seconds=20))
        current = self.builder.get_current("BTCUSD_PERP", "15m")
        assert current.high == 51000.0
        assert current.low == 49000.0
        assert current.close == 49000.0

    @pytest.mark.asyncio
    async def test_candle_closes_on_period_boundary(self):
        # 15M candle: first tick at t=0, next tick > 900s later
        ts0 = datetime.fromtimestamp(1_700_000_000.0, tz=timezone.utc)
        self.builder.update("BTCUSD_PERP", 50000.0, 1.0, ts0)
        ts1 = ts0 + timedelta(seconds=901)  # crosses the 15-min boundary
        result = self.builder.update("BTCUSD_PERP", 51000.0, 2.0, ts1)
        assert "15m" in result
        closed = result["15m"]
        assert closed.open == 50000.0
        assert closed.closed is True

    @pytest.mark.asyncio
    async def test_callback_fires_on_close(self):
        ts0 = datetime.fromtimestamp(1_700_000_000.0, tz=timezone.utc)
        self.builder.update("BTCUSD_PERP", 50000.0, 1.0, ts0)
        self.builder.update("BTCUSD_PERP", 51000.0, 1.0, ts0 + timedelta(seconds=901))
        await asyncio.sleep(0.01)  # Allow async tasks to run
        assert len(self.closed_candles) == 1
        assert self.closed_candles[0].close == 50000.0

    @pytest.mark.asyncio
    async def test_multiple_instruments_independent(self):
        ts = datetime.fromtimestamp(1_700_000_000.0, tz=timezone.utc)
        self.builder.update("BTCUSD_PERP", 50000.0, 1.0, ts)
        self.builder.update("ETHUSD_PERP", 3000.0, 5.0, ts)
        btc = self.builder.get_current("BTCUSD_PERP", "15m")
        eth = self.builder.get_current("ETHUSD_PERP", "15m")
        assert btc.open == 50000.0
        assert eth.open == 3000.0


# ---------------------------------------------------------------------------
# MarketEvent / EventTier tests
# ---------------------------------------------------------------------------

class TestMarketEvent:
    def test_event_tier_ordering(self):
        from backend.websocket.stream_processor import EventTier
        assert EventTier.IMMEDIATE.value < EventTier.DELAYED.value
        assert EventTier.DELAYED.value < EventTier.IGNORE.value

    def test_market_event_dataclass(self):
        from backend.websocket.stream_processor import MarketEvent, EventTier
        event = MarketEvent(
            type="OB_ENTRY",
            instrument="BTCUSD_PERP",
            price=50000.0,
            tier=EventTier.IMMEDIATE,
            message="Price entered order block",
        )
        assert event.type == "OB_ENTRY"
        assert event.tier == EventTier.IMMEDIATE
        assert event.instrument == "BTCUSD_PERP"
        assert event.timestamp is not None


# ---------------------------------------------------------------------------
# EventRouter gate tests
# ---------------------------------------------------------------------------

class TestEventRouter:
    def setup_method(self):
        from backend.websocket.event_router import EventRouter
        self.mock_dispatcher = MagicMock()
        self.router = EventRouter(dispatcher=self.mock_dispatcher)

    @pytest.mark.asyncio
    async def test_ignore_tier_never_dispatches(self):
        from backend.websocket.stream_processor import MarketEvent, EventTier
        event = MarketEvent(
            type="NOISE",
            instrument="BTCUSD_PERP",
            price=50000.0,
            tier=EventTier.IGNORE,
            message="Ignore me",
        )
        dispatched = []
        self.router._dispatch_now = AsyncMock(side_effect=lambda e: dispatched.append(e))
        await self.router.emit(event)
        assert len(dispatched) == 0

    @pytest.mark.asyncio
    async def test_cooldown_blocks_duplicate_events(self):
        from backend.websocket.stream_processor import MarketEvent, EventTier
        event = MarketEvent(
            type="KEY_LEVEL_CROSS",
            instrument="BTCUSD_PERP",
            price=50000.0,
            tier=EventTier.IMMEDIATE,
            message="Key level crossed",
        )
        dispatched = []
        self.router._dispatch_now = AsyncMock(side_effect=lambda e: dispatched.append(e))

        with patch('backend.execution.order_state_manager.order_state_manager.get_state', new_callable=AsyncMock) as mock_get_state:
            from backend.execution.order_state_manager import InstrumentState
            mock_get_state.return_value = InstrumentState.WATCHING
            
            with patch('backend.execution.risk_profile.risk_manager.is_trading_hours', new_callable=AsyncMock) as mock_hours:
                mock_hours.return_value = True

                await self.router.emit(event)
                await self.router.emit(event)  # same type + instrument → within cooldown

        assert len(dispatched) == 1  # second was blocked

    @pytest.mark.asyncio
    async def test_circuit_breaker_blocks_after_limit(self):
        """After MAX_CALLS_PER_HOUR events, circuit breaker should engage."""
        from backend.websocket.stream_processor import MarketEvent, EventTier
        from backend.websocket.event_router import EventRouter

        router = EventRouter(dispatcher=MagicMock())
        router.MAX_CALLS_PER_HOUR = 3  # override for test
        dispatched = []
        router._dispatch_now = AsyncMock(side_effect=lambda e: dispatched.append(e))

        with patch('backend.execution.order_state_manager.order_state_manager.get_state', new_callable=AsyncMock) as mock_get_state:
            from backend.execution.order_state_manager import InstrumentState
            mock_get_state.return_value = InstrumentState.WATCHING
            
            with patch('backend.execution.risk_profile.risk_manager.is_trading_hours', new_callable=AsyncMock) as mock_hours:
                mock_hours.return_value = True

                for i in range(5):
                    event = MarketEvent(
                        type=f"VOLUME_SPIKE_{i}",  # unique type to bypass cooldown
                        instrument="BTCUSD_PERP",
                        price=50000.0 + i,
                        tier=EventTier.IMMEDIATE,
                        message=f"spike {i}",
                    )
                    await router.emit(event)

        assert len(dispatched) <= 3

    def test_get_stats_returns_expected_keys(self):
        stats = self.router.get_stats()
        assert "hourly_calls" in stats
        assert "max_per_hour" in stats
        assert "rejection_stats" in stats
        assert "last_dispatch_per_instrument" in stats


# ---------------------------------------------------------------------------
# AnalysisDispatcher trigger context tests
# ---------------------------------------------------------------------------

class TestAnalysisDispatcher:
    def test_trigger_context_ob_entry(self):
        from backend.websocket.analysis_dispatcher import AnalysisDispatcher
        from backend.websocket.stream_processor import MarketEvent, EventTier

        dispatcher = AnalysisDispatcher()
        event = MarketEvent(
            type="OB_ENTRY",
            instrument="BTCUSD_PERP",
            price=50123.45,
            tier=EventTier.IMMEDIATE,
            message="Price entered bullish order block",
            level=50000.0,
        )
        context = dispatcher._build_trigger_context(event)
        assert "OB_ENTRY" in context
        assert "50,123.45" in context
        assert "BTCUSD_PERP" in context

    def test_trigger_context_safety_scan(self):
        from backend.websocket.analysis_dispatcher import AnalysisDispatcher
        dispatcher = AnalysisDispatcher()
        context = dispatcher._build_trigger_context(None)
        assert "safety" in context.lower() or context == ""


# ---------------------------------------------------------------------------
# Position sizing — EDGE mode
# ---------------------------------------------------------------------------

class TestEdgeSizing:
    def setup_method(self):
        from backend.execution.risk_profile import RiskProfileManager
        self.rm = RiskProfileManager()

    async def _size(self, sizing_mode: str, edge_factor=None, win_rate=None):
        return await self.rm.calculate_position_size(
            risk_per_trade_pct=1.0,
            entry_price=50000.0,
            stop_loss_price=49500.0,  # 1% SL
            available_margin=100000.0,
            setup_score=7.5,
            sizing_mode=sizing_mode,
            win_rate_history=win_rate,
            max_position_size_pct=3.0,
            total_capital=100000.0,
            edge_factor=edge_factor,
        )

    @pytest.mark.asyncio
    async def test_fixed_mode_baseline(self):
        result = await self._size("FIXED")
        assert result["position_size_pct"] > 0
        assert result["sizing_mode_used"] == "FIXED"

    @pytest.mark.asyncio
    async def test_edge_mode_high_edge_scales_up(self):
        result_edge = await self._size("EDGE", edge_factor=0.70)
        result_fixed = await self._size("FIXED")
        assert result_edge["position_size_pct"] >= result_fixed["position_size_pct"]
        assert result_edge["multiplier_applied"] > 1.0

    @pytest.mark.asyncio
    async def test_edge_mode_low_edge_scales_down(self):
        result_edge = await self._size("EDGE", edge_factor=0.30)
        result_fixed = await self._size("FIXED")
        assert result_edge["position_size_pct"] <= result_fixed["position_size_pct"]
        assert result_edge["multiplier_applied"] < 1.0

    @pytest.mark.asyncio
    async def test_edge_mode_no_data_falls_back_to_fixed(self):
        result = await self._size("EDGE", edge_factor=None)
        assert "EDGE" in result["sizing_mode_used"]
        assert result["position_size_pct"] > 0

    @pytest.mark.asyncio
    async def test_kelly_mode_no_history_falls_back(self):
        result = await self._size("KELLY", win_rate=None)
        assert result["sizing_mode_used"] == "FIXED"

    @pytest.mark.asyncio
    async def test_dynamic_mode_high_score_multiplier(self):
        result = await self._size("DYNAMIC")
        assert result["multiplier_applied"] >= 1.0

    @pytest.mark.asyncio
    async def test_max_cap_enforced(self):
        # EDGE with high edge_factor should still not exceed max_position_size_pct
        result = await self._size("EDGE", edge_factor=0.95)
        assert result["position_size_pct"] <= 3.0


# ---------------------------------------------------------------------------
# Boardroom response_time_ms tracking
# ---------------------------------------------------------------------------

class TestBoardroomTracking:
    @pytest.mark.asyncio
    async def test_boardroom_record_has_timing_fields(self):
        """Confirm run_boardroom returns deliberation_change_rate and avg_vote_response_ms."""
        from unittest.mock import AsyncMock, patch
        import json

        mock_vote = {
            "member": "claude_technical", "model": "claude-haiku-4-5-20251001",
            "vote": "LONG", "conviction": 7, "primary_reason": "test",
            "key_signals": [], "biggest_risk": "none",
            "suggested_entry_offset_pct": 0, "suggested_sl_offset_pct": 1.0,
            "suggested_tp_offset_pct": 2.0, "response_time_ms": 350,
        }
        mock_deliberation = {
            "member": "claude_technical", "decision": "HOLD_POSITION",
            "final_vote": "LONG", "final_conviction": 7, "reasoning": "maintained",
            "original_vote": "LONG",
        }
        mock_chair_decision = {
            "action": "long", "size_pct": 1.0, "entry_type": "limit",
            "price_offset_pct": -0.05, "stop_loss_offset_pct": 0.8,
            "take_profit_offset_pct": 1.6, "confidence": 7,
            "chair_reasoning": "test", "consensus_level": "strong",
            "vote_tally": {"LONG": 1}, "overriding_majority": False,
            "override_reason": None, "dissenting_view": None, "key_signals": [],
        }
        with patch("backend.ai.agents.active_board_members", return_value=[
            {"name": "claude_technical", "model": "claude-haiku-4-5-20251001",
             "provider": "anthropic",
             "system": "You are a technical analyst."},
        ]):
            with patch("backend.ai.agents._cast_vote", new=AsyncMock(return_value=mock_vote)):
                with patch("backend.ai.agents._call_anthropic", new=AsyncMock(return_value=json.dumps(mock_chair_decision))):
                    from backend.ai import agents
                    result = await agents.run_boardroom(
                        instrument="BTCUSD_PERP",
                        market_snapshot={"price": 50000},
                        portfolio_state={},
                        recent_lessons=[],
                        counterfactual_insights=[],
                    )
                    boardroom = result.get("boardroom", {})
                    assert "deliberation_change_rate" in boardroom
                    assert "avg_vote_response_ms" in boardroom
                    assert boardroom["avg_vote_response_ms"] == 350
                    assert boardroom["deliberation_change_rate"] == 0.0  # no change


# ---------------------------------------------------------------------------
# trigger_event_type stored in Trade
# ---------------------------------------------------------------------------

class TestTriggerEventType:
    def test_valid_sizing_includes_edge(self):
        from backend.execution.risk_profile import VALID_SIZING
        assert "EDGE" in VALID_SIZING

    def test_trade_model_has_trigger_event_type(self):
        from backend.db.models import Trade
        assert hasattr(Trade, "trigger_event_type")


# ---------------------------------------------------------------------------
# Event-Driven Flow end-to-end integration tests (Goal 20)
# ---------------------------------------------------------------------------

class TestEventDrivenFlow:
    @pytest.mark.asyncio
    async def test_ob_entry_triggers_boardroom(self):
        """Simulate an OB entry event and verify it reaches the decision loop."""
        from backend.websocket.stream_processor import MarketEvent, EventTier
        from backend.websocket.event_router import EventRouter
        from backend.websocket.analysis_dispatcher import AnalysisDispatcher

        decision_calls = []
        async def mock_dispatch(event):
            decision_calls.append({
                "instrument": event.instrument,
                "trigger_type": event.type,
                "trigger_context": dispatcher._build_trigger_context(event)
            })

        dispatcher = AnalysisDispatcher()
        dispatcher.dispatch = AsyncMock(side_effect=mock_dispatch)

        router = EventRouter(dispatcher=dispatcher)

        # Mock order_state_manager and risk_manager
        with patch('backend.execution.order_state_manager.order_state_manager.get_state', new_callable=AsyncMock) as mock_get_state:
            from backend.execution.order_state_manager import InstrumentState
            mock_get_state.return_value = InstrumentState.WATCHING
            
            with patch('backend.execution.risk_profile.risk_manager.is_trading_hours', new_callable=AsyncMock) as mock_hours:
                mock_hours.return_value = True

                # Emit an OB_ENTRY event
                event = MarketEvent(
                    type="OB_ENTRY",
                    instrument="BTCUSD_PERP",
                    price=64000.0,
                    tier=EventTier.IMMEDIATE,
                    message="Price entered bullish OB 63800-64100",
                    level=63800.0,
                )

                await router.emit(event)

        assert len(decision_calls) == 1
        assert decision_calls[0]["instrument"] == "BTCUSD_PERP"
        assert decision_calls[0]["trigger_type"] == "OB_ENTRY"
        assert "OB_ENTRY" in decision_calls[0]["trigger_context"]

    @pytest.mark.asyncio
    async def test_pending_state_blocks_events(self):
        """Verify events are blocked when instrument is not in WATCHING state."""
        from backend.websocket.stream_processor import MarketEvent, EventTier
        from backend.websocket.event_router import EventRouter
        from backend.websocket.analysis_dispatcher import AnalysisDispatcher

        decision_calls = []
        async def mock_dispatch(event):
            decision_calls.append(event)

        dispatcher = AnalysisDispatcher()
        dispatcher.dispatch = AsyncMock(side_effect=mock_dispatch)

        router = EventRouter(dispatcher=dispatcher)

        with patch('backend.execution.order_state_manager.order_state_manager.get_state', new_callable=AsyncMock) as mock_get_state:
            from backend.execution.order_state_manager import InstrumentState
            mock_get_state.return_value = InstrumentState.PENDING
            
            with patch('backend.execution.risk_profile.risk_manager.is_trading_hours', new_callable=AsyncMock) as mock_hours:
                mock_hours.return_value = True

                event = MarketEvent(
                    type="OB_ENTRY",
                    instrument="BTCUSD_PERP",
                    price=64000.0,
                    tier=EventTier.IMMEDIATE,
                    message="Price entered bullish OB"
                )

                await router.emit(event)

        assert len(decision_calls) == 0
