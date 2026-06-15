export const mockData = {
  account: { balance: 63916, change: 0.64 },

  btc: {
    price: 63916.5,
    change: 0.64,
    high24h: 64669,
    low24h: 63824,
    volume24h: "20.48B",
    funding: 0.010,
    fearGreed: 18,
    fearGreedLabel: "Extreme Fear",
  },

  keyLevels: {
    resistance2: 65255.0,
    resistance1: 64670.8,
    pivot:       64080.0,
    support1:    63697.0,
    support2:    62068.4,
  },

  upcomingEvents: [
    { time: "14:30", name: "US CPI Data Release",         impact: "high" },
    { time: "18:00", name: "Fed Chair Powell Speech",      impact: "high" },
    { time: "20:00", name: "Crypto Options Expiry ($2.1B)", impact: "medium" },
  ],

  openPosition: {
    entry:   64079.6,
    current: 63916.5,
    pnl:     -9089,
    pnlPct:  -0.22,
    size:    37.37,
    roe:     -0.60,
    tp1:     64670.8,
    tp2:     65255.0,
    sl:      63697.0,
    direction: "LONG" as const,
  },

  watchlist: [
    { pair: "ETH/USDT",  dir: "LONG",    score: 8.2, change:  2.14 },
    { pair: "SOL/USDT",  dir: "LONG",    score: 7.6, change:  3.21 },
    { pair: "BNB/USDT",  dir: "SHORT",   score: 6.8, change: -1.45 },
    { pair: "AVAX/USDT", dir: "NEUTRAL", score: 5.9, change:  0.82 },
  ],

  riskBudget: {
    dailyUsed:   3240,
    dailyMax:    6391,
    weeklyUsed:  8900,
    weeklyMax:   19174,
    drawdown:    2.1,
    maxDrawdown: 5.0,
  },

  aiSetup: {
    id:         2187,
    conviction: 7.8,
    direction:  "LONG" as const,
    timeframe:  "4H",
    rationale: {
      pros: [
        "4H trend aligned above EMA200",
        "London open support held",
        "Liquidity sweep at 63,334",
        "Volume increasing on bullish candles",
      ],
      cons: [
        "Funding rate elevated",
        "Price approaching R1",
        "Low timeframe overbought",
      ],
    },
    invalidation: "15m close below 63,697\nor 4H close below 63,413",
    levels: { entry: 64079.6, sl: 63697.0, tp1: 64670.8, tp2: 65255.0 },
    rrr:           "1 : 3.0",
    posSize:       37.37,
    expectedValue: 134000,
    probability:   { tp1: 63, breakeven: 28, slHit: 9 },
  },

  performance: {
    totalPnl:      12340,
    winRate:       58,
    profitFactor:  1.76,
    expectancy:    0.34,
    sharpe:        0.92,
    totalTrades:   147,
    avgWinner:     2.4,
    avgLoser:      1.0,
    maxDrawdown:   4.7,
    bestDay:       1430,
    worstDay:      -2180,
    edgeScore:     73,
  },

  brain: {
    confidenceScore: 73,
    weeklyDelta:     5,
  },

  dna: {
    score:        82,
    consistency:  72,
    riskMaturity: 76,
    psychology:   68,
    discipline:   85,
  },

  // Journal mock trades
  trades: [
    { id: 50, pair: "BTC/USDT", side: "LONG",  status: "OPEN",   date: "14 Jun 2026", time: "21:44", pnl: 7087,   confidence: 7.8, setup: "SMC Breakout",    rr: "1:3.2", result: "OPEN",   duration: "2h 15m", tags: ["SMC", "Breakout"] },
    { id: 49, pair: "ETH/USDT", side: "LONG",  status: "WIN",    date: "14 Jun 2026", time: "15:22", pnl: 4230,   confidence: 8.1, setup: "Trend Follow",   rr: "1:2.8", result: "WIN",    duration: "4h 10m", tags: ["Trend", "EMA"] },
    { id: 48, pair: "SOL/USDT", side: "SHORT", status: "LOSS",   date: "13 Jun 2026", time: "10:05", pnl: -2180,  confidence: 6.4, setup: "Liquidity Hunt", rr: "1:2.0", result: "LOSS",   duration: "1h 45m", tags: ["SMC"] },
    { id: 47, pair: "BTC/USDT", side: "LONG",  status: "WIN",    date: "13 Jun 2026", time: "08:30", pnl: 5640,   confidence: 7.5, setup: "London Open",    rr: "1:3.0", result: "WIN",    duration: "3h 20m", tags: ["London", "SMC"] },
    { id: 46, pair: "ETH/USDT", side: "SHORT", status: "WIN",    date: "12 Jun 2026", time: "20:15", pnl: 3120,   confidence: 7.2, setup: "Reversal",       rr: "1:2.5", result: "WIN",    duration: "2h 00m", tags: ["Reversal"] },
    { id: 45, pair: "BTC/USDT", side: "LONG",  status: "LOSS",   date: "12 Jun 2026", time: "14:40", pnl: -1890,  confidence: 6.8, setup: "Range Play",     rr: "1:2.0", result: "LOSS",   duration: "1h 30m", tags: ["Range"] },
    { id: 44, pair: "BNB/USDT", side: "LONG",  status: "WIN",    date: "11 Jun 2026", time: "11:00", pnl: 2890,   confidence: 7.0, setup: "SMC Breakout",   rr: "1:2.8", result: "WIN",    duration: "3h 45m", tags: ["SMC", "Breakout"] },
    { id: 43, pair: "BTC/USDT", side: "SHORT", status: "WIN",    date: "10 Jun 2026", time: "16:20", pnl: 6750,   confidence: 8.4, setup: "Trend Follow",   rr: "1:3.5", result: "WIN",    duration: "5h 10m", tags: ["Trend"] },
  ],

  journalStats: {
    totalTrades: 50,
    winRate:     58.3,
    totalPnl:    52340,
    avgRR:       1.76,
    bestTrade:   15980,
    worstTrade:  -4850,
  },

  // Equity curve monthly P&L
  equityCurve: [
    { month: "Jan", value: 0 },
    { month: "Feb", value: 3200 },
    { month: "Mar", value: 7800 },
    { month: "Apr", value: 5400 },
    { month: "May", value: 9600 },
    { month: "Jun", value: 12340 },
  ],

  monthlyPnl: [
    { month: "Jan", pct: 2.1 },
    { month: "Feb", pct: 4.3 },
    { month: "Mar", pct: -1.8 },
    { month: "Apr", pct: 3.7 },
    { month: "May", pct: -0.9 },
    { month: "Jun", pct: 5.2 },
  ],

  // AI Brain data
  brainLearnings: [
    { id: 1, title: "Avoid Friday trading after 8PM", detail: "Win rate improved by 11%",      type: "positive" },
    { id: 2, title: "Trade after 3 consecutive losses", detail: "Win rate drops by 35%",        type: "negative" },
    { id: 3, title: "BTC dominance > 52% favors longs", detail: "41 trades validated this",     type: "positive" },
  ],

  topWinningPatterns: [
    { name: "London Open Breakout",  winRate: 73, trades: 22, expectancy: 2.41 },
    { name: "SMC – Bullish Break",   winRate: 68, trades: 34, expectancy: 1.89 },
    { name: "4H EMA Bounce",         winRate: 65, trades: 17, expectancy: 1.76 },
    { name: "London Open Trap",      winRate: 63, trades: 12, expectancy: 1.60 },
    { name: "BTC Dominance Surge",   winRate: 61, trades: 9,  expectancy: 1.47 },
  ],

  topLosingPatterns: [
    { name: "Scalping below MiB",    winRate: 32, trades: 15, expectancy: -1.10 },
    { name: "BNB – Range Top Short", winRate: 37, trades: 8,  expectancy: -0.87 },
    { name: "Friday – Volume Fade",  winRate: 38, trades: 11, expectancy: -0.74 },
    { name: "Low Volatility Range",  winRate: 40, trades: 10, expectancy: -0.48 },
    { name: "Strategy Averaging",    winRate: 42, trades: 7,  expectancy: -0.28 },
  ],

  // DNA data
  radarAxes: [
    { axis: "Discipline",    value: 85 },
    { axis: "Patience",      value: 72 },
    { axis: "Risk Mgmt",     value: 76 },
    { axis: "Consistency",   value: 72 },
    { axis: "Resilience",    value: 68 },
  ],

  personalityTraits: [
    { trait: "Discipline",        score: 85, topTrader: 90, label: "Strong" },
    { trait: "Patience",          score: 72, topTrader: 88, label: "Good" },
    { trait: "Risk Tolerance",    score: 76, topTrader: 85, label: "Advanced" },
    { trait: "Emotional Control", score: 68, topTrader: 92, label: "Developing" },
    { trait: "Adaptability",      score: 74, topTrader: 87, label: "Good" },
  ],

  edgeProfile: [
    { type: "Momentum",     pct: 42, color: "#26d07c" },
    { type: "Breakout",     pct: 28, color: "#9d8fff" },
    { type: "Range Play",   pct: 15, color: "#f0b429" },
    { type: "News Reaction",pct: 10, color: "#ff4d6a" },
    { type: "Others",       pct: 5,  color: "#4a5568" },
  ],

  // Scenario lab
  scenarios: [
    { id: 1, name: "Bull Breakout",        conditions: "Trending, High Vol",  winRate: 68, avgReturn: 2.8, pf: 2.1, trades: 34, status: "Active" },
    { id: 2, name: "Liquidity + Reversal", conditions: "Trending, Med Vol",   winRate: 62, avgReturn: 1.9, pf: 1.8, trades: 28, status: "Active" },
    { id: 3, name: "Range Bounce",         conditions: "Ranging, Low Vol",    winRate: 55, avgReturn: 1.2, pf: 1.4, trades: 22, status: "Inactive" },
    { id: 4, name: "News Fade",            conditions: "Volatile",            winRate: 48, avgReturn: 0.8, pf: 1.1, trades: 15, status: "Inactive" },
    { id: 5, name: "Overnight Gap Fill",   conditions: "Trending, Any Vol",   winRate: 71, avgReturn: 3.2, pf: 2.4, trades: 18, status: "Active" },
  ],

  // Autonomous trading
  autonomous: {
    pnl:          71234,
    winRate:      68.5,
    totalTrades:  64,
    avgProfit:    1114,
    sharpe:       1.42,
    maxDrawdown:  3.8,
    decisionScore:8.7,
    strategies: [
      { name: "Momentum Hunter",  status: "Active", allocation: "40%", pnl: 28400, winRate: 72, trades: 28 },
      { name: "SMC Reversal",     status: "Active", allocation: "35%", pnl: 24300, winRate: 65, trades: 22 },
      { name: "Trend Following",  status: "Active", allocation: "25%", pnl: 18534, winRate: 68, trades: 14 },
    ],
    recentTrades: [
      { pair: "BTC/USDT", side: "LONG",  entry: 63420.0, exit: 64670.8, pnl: 3240,  time: "2h ago", status: "Closed" },
      { pair: "ETH/USDT", side: "SHORT", entry: 3412.0,  exit: 3318.0,  pnl: 1870,  time: "5h ago", status: "Closed" },
      { pair: "SOL/USDT", side: "LONG",  entry: 142.50,  exit: 149.20,  pnl: 2100,  time: "8h ago", status: "Closed" },
    ],
    positions: [
      { pair: "BTC/USDT", side: "LONG",  size: "0.052",  pnl: 7087, pnlPct:  2.1 },
      { pair: "ETH/USDT", side: "LONG",  size: "0.42",   pnl: 3240, pnlPct:  1.6 },
      { pair: "SOL/USDT", side: "SHORT", size: "1.8",    pnl: -890, pnlPct: -0.8 },
    ],
  },
};
