# AI Trader — V1.4 Project Context

This document summarizes the context, environment variables, database structure, and execution parameters of the project.

## 1. System Requirements & Setup
- **OS**: macOS/Linux
- **Python Version**: Python 3.11+
- **Requirements**: FastAPI, SQLAlchemy, APScheduler, cachetools, websockets, asyncio-throttle, httpx, loguru, pandas, numpy, etc.

## 2. Environment Configurations (`.env`)
```bash
# WebSocket Connection Settings
WS_RECONNECT_DELAY_SECONDS=5
WS_HEARTBEAT_INTERVAL_SECONDS=30
MAX_BOARDROOM_CALLS_PER_HOUR=8

# Event Signal Thresholds
EVENT_KEY_LEVEL_TOLERANCE_PCT=0.10
EVENT_SIGNIFICANT_CANDLE_BODY_PCT=0.40
EVENT_VOLUME_SPIKE_MULTIPLIER=2.0
EVENT_FUNDING_THRESHOLD_1=0.01
EVENT_FUNDING_THRESHOLD_2=0.02

# Cooldowns (seconds)
COOLDOWN_OB_ENTRY=300
COOLDOWN_KEY_LEVEL=600
COOLDOWN_FUNDING=1800
COOLDOWN_VOLUME_SPIKE=180
COOLDOWN_CANDLE=300

# Custom Skills Directory
SKILLS_DIR=backend/skills

# AI API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
GOOGLE_API_KEY=AIzaSy...

# Scenario Simulation Configuration
SCENARIO_SIMULATION_ENABLED=true

# Scaling Infrastructure
EXCHANGE_ADAPTER=delta_india
ORDER_SPLIT_THRESHOLD_INR=500000
```

## 3. Database Schema Layout
The database consists of the following key tables managed via PostgreSQL:
1. `trades`: Main log of all system decisions, setups, boardroom deliberations, scenario simulations, visual charts, and outcomes.
2. `market_snapshots`: 5-minute historical records of prices, funding rates, open interest, and IV.
3. `agent_lessons`: Loop 2 generated lessons linked to specific trade outcomes.
4. `meta_lessons`: High-priority synthesis patterns compiled from agent lessons.
5. `user_trades`: Delta Exchange trade history imported for Trading DNA.
6. `pattern_outcomes`: Performance statistics recorded per setup/session/instrument for Edge Sizing.
7. `trade_ledger`: Financial ledger capturing gross/net P&L, exchange fees, GST, and fee drag.
8. `risk_profile`: Singleton configuration table holding risk margins and parameters.

## 4. Operational Execution Loops
- **Loop 1: Decision Loop (Event-driven)**: Triggered by real-time WebSocket ticks (OB entries, key levels) or APScheduler safety net (30-min scan). Assembles context, executes simulations, coordinates multi-model boardroom deliberations, applies risk sizing, and places order.
- **Loop 2: Reflection Loop (Async)**: Triggered upon position close. Reviews P&L and metrics, extracts lessons, and stores them in `agent_lessons`.
- **Loop 3: Counterfactual Loop (Nightly)**: Replays trade windows to evaluate "what-if" scenarios (e.g. if SL was trailing or exit was at TP1) to optimize parameters.
