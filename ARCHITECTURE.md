# AI Trader — V1.4 Architecture Specification

This document details the architectural layout of the V1.4 Event-Driven Trading System.

```mermaid
graph TD
    WS[Delta WebSocket Stream] -->|Real-time ticks| SP[MarketStreamProcessor]
    SP -->|SMC Signals & Candle Closed| ER[EventRouter]
    ER -->|Throttled Events| AD[AnalysisDispatcher]
    AD -->|Trigger Context| L1[Loop 1: Decision Loop]
    L1 -->|Pre-Checks| SS[ScenarioSimulator]
    SS -->|3 Stress Scenarios| BOARD[Multi-Model Boardroom]
    BOARD -->|Claude Sonnet + GPT 5.5 + Gemini 3.1| CHAIR[Claude Chair Decision]
    CHAIR -->|Verdict + Entry/SL/TP offsets| RP[RiskProfile / Sizing]
    RP -->|Kelly (25%) / Edge Sizing| EXEC[Order Execution Adapter]
    EXEC -->|Delta India Rest API| DB[(PostgreSQL Database)]
```

## 1. Real-Time Event Pipeline
- **MarketStreamProcessor** (`backend/websocket/stream_processor.py`): Connects to Delta Exchange real-time feed, processes live ticks, aggregates them into candle structures via `CandleBuilder`, and monitors structural levels.
- **EventRouter** (`backend/websocket/event_router.py`): Performs rate limiting and cooldown management per event type (Orderblock Entry: 300s, Key Level: 600s, Volume Spike: 180s) to prevent loop congestion.
- **AnalysisDispatcher** (`backend/websocket/analysis_dispatcher.py`): Orchestrates execution of the primary decision loop when a valid market event fires.

## 2. Tiered SMC Cache Layer
- **SMCTieredCache** (`backend/perception/smc_cache.py`): Implements timeframe-based caching (4H candles cached for 14 minutes, 15M candles for 60 seconds) to avoid repeated structure analysis overhead.

## 3. Pre-Decision Scenario Simulation
- **ScenarioSimulator** (`backend/simulation/scenario_simulator.py`): Simulates three market stress-test scenarios (Bullish Sweep, Bearish Sweep, Mean Reversion) before final boardroom votes to validate SL/TP locations.

## 4. Multi-Model Boardroom
- **Boardroom Members** (`backend/ai/agents.py`):
  1. `claude_technical` (Claude 3.5 Sonnet): Technical chart analyst focus.
  2. `gpt_macro` (GPT-5.5): Funding rates, Open Interest, derivatives analyst.
  3. `gemini_risk` (Gemini 3.1 Flash): Skeptical, downside-focused risk analyst.
  4. `claude_chair` (Claude 3.5 Opus): Final decision maker with visual chart processing capabilities.
- **Graceful Fallbacks**: If any API key is missing or calls fail, members automatically fall back to Claude Sonnet with mandate instructions appended to prompt.

## 5. Sizing & Risk Controls
- **Kelly Sizing**: Fractional Kelly formula (25% fraction) based on overall historical trade win rate and achieved average R:R. Falls back to FIXED if `< 50` trades.
- **Edge Sizing**: Computes win rate and expectancy per pattern type from `pattern_outcomes` table. Falls back to FIXED if `< 30` trades.
