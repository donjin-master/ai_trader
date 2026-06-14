# Pro AI Trader

An autonomous AI trading system for **Delta Exchange India** (crypto derivatives).  
The AI reasons about markets using a multi-model Boardroom debate pattern, places orders via the Delta Exchange API, and continuously improves through a counterfactual feedback loop.

> **Status:** Active development — testnet only by default.

---

## Screenshots

| Live Trading Room | AI Brain / Boardroom |
|---|---|
| ![Live](screenshots/dash-live-desktop.png) | ![Brain](screenshots/dash-brain-desktop.png) |

| Trade Journal | DNA & Lab |
|---|---|
| ![Journal](screenshots/dash-journal-desktop.png) | ![DNA](screenshots/dash-dna-desktop.png) |

---

## Architecture

```
Market Data (Delta WS)
        │
        ▼
  Perception Snapshot
  (price · funding · IV · OB · FVGs · BTC dom · Fear & Greed)
        │
        ▼
  ┌─────────────────────────────────────┐
  │          AI Boardroom               │
  │  Technical  │  Risk  │  Momentum   │
  │  (Haiku)    │ (GPT)  │  (Gemini)  │
  │             ▼                       │
  │         Chair (Sonnet 4.6)          │
  │     consensus → trade decision      │
  └─────────────────────────────────────┘
        │
        ▼
  Python Validator  ←  never trust LLM output directly
  (size ≤ 2% · SL direction · instrument check · confidence ≥ 6)
        │
        ▼
  Execution Engine (ADVISORY / SEMI_AUTO / FULL_AUTO)
        │
        ▼
  Delta Exchange REST API  →  Telegram notifications
        │
        ▼
  Loop 2: Position Reflection (on close)
  Loop 3: Counterfactual Analysis (nightly)
        │
        ▼
  Agent Lessons DB  →  fed back into next decision prompt
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 · FastAPI · async/await throughout |
| Database | PostgreSQL (Supabase free tier) |
| Cache | Redis (optional, in-memory fallback for v1) |
| AI Models | Claude Sonnet 4.6 (Chair) · Claude Haiku 4.5 (Technical) · GPT (Momentum) · Gemini (Risk) |
| Scheduler | APScheduler |
| Notifications | Telegram Bot API |
| Frontend | Next.js 14 · Tailwind CSS · shadcn/ui · Recharts · lightweight-charts |
| Exchange | Delta Exchange India API |
| Hosting | Vultr Mumbai VPS (backend) · Vercel (frontend) |

---

## Project Structure

```
.
├── backend/
│   ├── main.py                 # FastAPI app entry point
│   ├── config.py               # ENV config & constants
│   ├── delta/
│   │   ├── client.py           # Delta Exchange REST client
│   │   └── websocket.py        # Real-time price feed
│   ├── perception/
│   │   └── snapshot.py         # Market snapshot assembler
│   ├── ai/
│   │   ├── loops.py            # Loop 1, 2, 3 orchestration
│   │   ├── agents.py           # Bull, Bear, Judge agents + Boardroom
│   │   ├── prompts.py          # All prompt strings as constants
│   │   └── validator.py        # Post-LLM output validation
│   ├── execution/
│   │   ├── executor.py         # Order placement + position mgmt
│   │   └── safety.py           # Guardrails · kill switch · limits
│   ├── db/
│   │   ├── models.py           # SQLAlchemy models
│   │   └── migrations/         # Alembic migrations
│   ├── notifications/
│   │   └── telegram.py         # Telegram bot integration
│   └── scheduler.py            # APScheduler job definitions
├── frontend/
│   ├── app/
│   │   ├── page.tsx            # Live Trading Room
│   │   ├── journal/page.tsx    # Trade Journal
│   │   ├── brain/page.tsx      # AI Insights / Boardroom
│   │   └── performance/page.tsx
│   ├── components/
│   │   ├── LiveChart.tsx       # Interactive chart (drawing tools, keyboard shortcuts)
│   │   └── chart/              # DrawingToolbar · IndicatorsPanel · ContextMenu
│   └── lib/
│       └── api.ts              # Backend API client
├── .env.example                # Template — copy to .env and fill in
├── requirements.txt
├── docker-compose.yml          # Postgres + Redis for local dev
└── README.md
```

---

## Non-Negotiables (Hard-Coded Safety Rules)

| Rule | Value |
|---|---|
| Max position size | 2% of available margin |
| Max open positions | 3 simultaneously |
| Daily loss limit | 5% → auto-switch to ADVISORY mode |
| Kill switch | `/api/kill` endpoint + Telegram `/stop` |
| Default environment | **testnet** (ENV flag controls live) |
| LLM output trust | Never — always validated in Python before execution |

---

## Execution Modes

| Mode | Behaviour |
|---|---|
| `ADVISORY` | AI reasons and logs, no orders placed |
| `SEMI_AUTO` | AI places trades ≤1% size; larger needs Telegram approval |
| `FULL_AUTO` | AI trades within all risk guardrails automatically |

Default during development: **ADVISORY**

---

## Quick Start

### 1. Clone

```bash
git clone git@github.com:donjin-master/ai_trader.git
cd ai_trader
```

### 2. Environment

```bash
cp .env.example .env
# Fill in your keys — see .env.example for all required vars
```

```bash
cp frontend/.env.local.example frontend/.env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 3. Backend

```bash
# Start Postgres + Redis (or use your own)
docker-compose up -d

# Python env
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# DB migrations
alembic upgrade head

# Run
uvicorn backend.main:app --reload --port 8000
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
# Exchange (get from Delta Exchange dashboard)
DELTA_API_KEY_TESTNET=
DELTA_API_SECRET_TESTNET=
DELTA_API_KEY_PROD=          # only needed for live trading
DELTA_API_SECRET_PROD=
ENVIRONMENT=testnet          # "testnet" | "production"

# AI (get from respective providers)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=              # optional — GPT board member
GEMINI_API_KEY=              # optional — Gemini board member

# Database
DATABASE_URL=postgresql+asyncpg://user:pass@host/dbname

# Telegram (create bot via @BotFather)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Risk guardrails
EXECUTION_MODE=ADVISORY
MAX_POSITION_SIZE_PCT=2.0
MAX_OPEN_POSITIONS=3
DAILY_LOSS_LIMIT_PCT=5.0
DECISION_INTERVAL_MINUTES=15
```

---

## Delta Exchange API

| Environment | Base URL |
|---|---|
| Testnet | `https://cdn-ind.testnet.deltaex.org` |
| Production | `https://api.india.delta.exchange` |
| WebSocket | `wss://socket.india.delta.exchange` |

---

## AI Decision Flow (every 15 minutes)

```
1. Pre-checks (1ms)     — daily loss hit? positions full? blackout window?
2. Perception (500ms)   — price · funding · IV · Fear&Greed · BTC dominance
3. Context (50ms)       — last 10 lessons · recent counterfactual insights
4. Boardroom Round 1    — each model votes independently with conviction score
5. Boardroom Round 2    — deliberation · models can update their votes
6. Chair decision       — final action with consensus level
7. Validator (1ms)      — sanity check all fields (Python, not LLM)
8. Live recalculation   — use current bid/ask, not AI's stated price
9. Execute or log       — depends on EXECUTION_MODE
10. Store to DB         — full snapshot + decision + reasoning
```

---

## Chart Features

The live chart (Interactive mode) supports:

- **Drawing tools** — Trendline, Horizontal/Vertical lines, Ray, Extended, Arrow, Channel, Fibonacci, Rectangle, Circle, Triangle
- **Keyboard shortcuts** — `T` Trendline · `H` Horizontal · `V` Vertical · `R` Ray · `F` Fibonacci · `B` Rectangle · `Esc` Cursor · `Delete` remove selected
- **Reset chart** — `0` key or `⊡ Reset` button
- **Fullscreen** — `F11` or `⛶ Full` button
- **Indicators** — EMA 20/50/200 · SMA · VWAP · Bollinger Bands · RSI · MACD · ATR
- **SMC overlays** — Order Blocks · Fair Value Gaps · Liquidity levels · BOS/CHoCH
- **Replay mode** — step through historical bars with AI analysis

---

## Deployment

### Backend (Vultr Mumbai VPS)

```bash
# Build and run with systemd or PM2
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 2

# Or with Docker
docker build -t ai-trader-backend .
docker run -d --env-file .env -p 8000:8000 ai-trader-backend
```

### Frontend (Vercel)

```bash
cd frontend
vercel --prod
# Set NEXT_PUBLIC_API_URL to your VPS backend URL in Vercel dashboard
```

---

## Contributing

This is a personal trading system. PRs are welcome for bug fixes and improvements.  
**Never commit `.env` files or real API keys.**

---

## Disclaimer

This software is for educational and personal use only.  
Crypto trading involves significant financial risk. Past performance does not guarantee future results.  
Always start on testnet. The authors accept no liability for financial losses.
