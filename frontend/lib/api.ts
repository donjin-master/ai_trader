const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const API_BASE = BASE;
export const WS_BASE = BASE.replace(/^http/, "ws");
export const API_HEADERS = { "x-api-secret": process.env.NEXT_PUBLIC_FRONTEND_API_SECRET || "" };

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchingItem {
  condition: string;
  met: boolean;
}

export interface Watching {
  verdict: string | null;
  confidence: number | null;
  setup_score: number | null;
  setup_grade: string | null;
  decided_at: string | null;
  vision_used: boolean;
  why_not: string[];
  watching: WatchingItem[];
  expected_direction: string | null;
}

export interface Status {
  mode: string;
  kill_switch: boolean;
  daily_pnl: number;
  open_positions_count: number;
  next_decision_in_seconds: number | null;
  risk?: {
    trades_today: number;
    max_trades_per_day: number | null;
    daily_budget_inr: number;
    daily_budget_used_inr: number;
    max_concurrent_trades: number | null;
    consecutive_losses: number;
    consecutive_loss_limit: number | null;
    min_setup_score: number | null;
    total_capital: number | null;
  };
}

export interface RiskProfile {
  active_instruments?: string[];
  enabled_patterns: string[];
  total_capital: number;
  daily_budget_pct: number;
  weekly_budget_pct: number;
  risk_per_trade_pct: number;
  sizing_mode: "FIXED" | "DYNAMIC" | "KELLY";
  max_position_size_pct: number;
  max_trades_per_day: number;
  max_trades_per_week: number;
  max_concurrent_trades: number;
  min_setup_score: number;
  trade_start_time: string;
  trade_end_time: string;
  blackout_windows: string[];
  avoid_weekends: boolean;
  daily_loss_limit_pct: number;
  consecutive_loss_limit: number;
  min_rr_ratio: number;
  require_confluence: number;
  min_boardroom_votes: number;
  min_avg_conviction: number;
  allow_chair_override: boolean;
  mode: "ADVISORY" | "SEMI_AUTO" | "AUTONOMOUS" | "SCHEDULED";
  approval_timeout_mins: number;
  trail_method: "STRUCTURE" | "ATR";
  atr_trail_multiplier: number;
  tp1_exit_pct: number;
  breakeven_at_rr: number;
  tp1_rr_trigger: number;
  allow_position_assessment: boolean;
  max_rr_cap: number | null;
  vision_mode: "OFF" | "CHAIR_ONLY" | "ALL_MEMBERS";
  // V1.2 — order state machine
  stale_order_candles: number;
  preferred_entry_mode: "limit_preferred" | "market_allowed" | "limit_only";
  // V1.2 — options
  options_enabled: boolean;
  max_options_loss_pct: number;
  preferred_dte_min: number;
  preferred_dte_max: number;
  iv_regime_threshold_low: number;
  iv_regime_threshold_high: number;
  updated_at: string | null;
}

export interface ManagedPositionState {
  instrument: string;
  direction: "long" | "short";
  entry_price: number;
  initial_sl: number;
  current_sl: number;
  tp1: number;
  tp2: number;
  tp3: number | null;
  initial_size_contracts: number;
  current_size_contracts: number;
  tp1_hit: boolean;
  breakeven_set: boolean;
  trail_active: boolean;
  trail_sl: number | null;
  initial_risk_pct: number;
  initial_rr_ratio: number;
  trail_history: { sl: number; reason: string; at: string }[];
}

export interface ManagementSummary {
  trigger?: string;
  exit_price?: number;
  tp1_hit?: boolean;
  breakeven_set?: boolean;
  initial_rr_planned?: number;
  rr_achieved_on_exit?: number;
  trail_updates?: number;
  trail_history?: { sl: number; reason: string; at: string }[];
  initial_size_contracts?: number;
  final_size_contracts?: number;
}

export interface BoardroomVote {
  member: string;
  model?: string;
  vote: string;
  conviction: number;
  primary_reason?: string;
}

export interface BoardroomDeliberation {
  member: string;
  decision?: string;
  final_vote: string;
  final_conviction: number;
  reasoning?: string;
  original_vote?: string;
}

export interface BoardroomRecord {
  votes: BoardroomVote[];
  deliberations: BoardroomDeliberation[];
  vote_tally: Record<string, number>;
  active_members?: string[];
}

export interface Snapshot {
  instrument: string;
  price: number | null;
  funding_rate: number | null;
  volume_24h: number | null;
  high_24h: number | null;
  low_24h: number | null;
  change_24h_pct: number | null;
  best_bid: number | null;
  best_ask: number | null;
  fear_greed_index: number | null;
  fear_greed_classification: string | null;
  btc_dominance: number | null;
  market_regime: string;
  snapshot_timestamp: string;
  open_interest?: number | null;
  mark_price?: number | null;
}

export interface CounterfactualScenario {
  name: string;
  simulated_pnl_pct: number;
  outcome_better: boolean;
  leading_indicator: string;
  explanation: string;
}

export interface Trade {
  id: string;
  timestamp: string | null;
  instrument: string | null;
  action: string | null;
  direction: string | null;
  entry_price: number | null;
  exit_price: number | null;
  size_pct: number | null;
  pnl_pct: number | null;
  duration_mins: number | null;
  confidence: number | null;
  boardroom_confidence?: number | null;
  status: string | null;
  exit_trigger: string | null;
  reasoning: string | null;
  bull_case: string | null;
  bear_case: string | null;
  key_signals: string[] | null;
  created_at: string | null;
  reflection: {
    thesis_correct?: boolean;
    execution_quality?: number;
    luck_factor?: number;
    what_went_right?: string;
    what_went_wrong?: string | null;
    lesson?: string;
    watch_for?: string;
    would_take_again?: boolean;
  } | null;
  counterfactuals: {
    scenarios?: CounterfactualScenario[];
    best_scenario?: string;
    key_insight?: string;
  } | null;
  decision_json?: {
    bull_full?: { conviction?: number; entry_rationale?: string };
    bear_full?: { conviction?: number; entry_rationale?: string };
    why_over_alternative?: string;
    chair_reasoning?: string;
    consensus_level?: string;
    vote_tally?: string;
    skip_reason?: string;
  } | null;
  market_snapshot?: { market_regime?: string } | null;
  setup_score?: number | null;
  setup_grade?: string | null;
  vision_used?: boolean;
  has_chart?: boolean;
  boardroom_votes?: BoardroomRecord | null;
  position_params?: {
    position_size_pct?: number;
    risk_amount_inr?: number;
    sizing_mode_used?: string;
    calculation_detail?: string;
    management?: ManagementSummary;
  } | null;
  smc_summary?: {
    structures?: Record<string, { trend?: string }>;
    premium_discount?: string | null;
    regime?: string | null;
    confluences_found?: string[];
    missing?: string[];
  } | null;
  regime?: string | null;
  trigger_event_type?: string | null;
  scenario_simulation?: {
    simulated?: boolean;
    direction?: string;
    entry_price?: number;
    scenario_a_description?: string;
    scenario_a_play_out?: string;
    scenario_a_monitor?: string;
    scenario_a_invalidation?: string;
    scenario_b_description?: string;
    scenario_b_change?: string;
    scenario_b_adjustment?: string;
    scenario_c_description?: string;
    scenario_c_sl_valid?: string;
    scenario_c_missed_signals?: string;
    simulation_verdict?: string;
    biggest_risk?: string;
  } | null;
  options_strategy?: {
    available?: boolean;
    strategy?: string;
    dte?: number;
    reasoning?: string;
    max_loss_inr?: number;
    legs?: Array<{ type: string; strike: number; side: string; premium: number }>;
  } | null;
  notes?: string | null;
}

export interface Lesson {
  id: string;
  lesson_text: string | null;
  watch_for: string | null;
  pattern_type: string | null;
  confidence_score: number | null;
  quality_score: number | null;
  source_trade_id: string | null;
  created_at: string | null;
}

export interface Position {
  product_symbol: string;
  size: number;
  entry_price: string;
  mark_price?: string;
  unrealized_pnl?: string;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      cache: "no-store",
      headers: {
        "x-api-secret": process.env.NEXT_PUBLIC_FRONTEND_API_SECRET || "",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        "x-api-secret": process.env.NEXT_PUBLIC_FRONTEND_API_SECRET || "",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function put<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": process.env.NEXT_PUBLIC_FRONTEND_API_SECRET || "",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface AccountSummary {
  asset: string;
  available_margin: number;
  available_balance: number;
  total_balance: number;
  raw: Array<{
    asset_symbol: string;
    balance: string;
    available_balance: string;
    balance_inr: string;
    available_balance_inr: string;
  }>;
}

export interface KeyLevels {
  instrument: string;
  price: number;
  chart_levels: Array<{
    price: number;
    label: string;
    color: string;
    type: string;
    distance_pct?: number;
  }>;
  prev_day_high: number;
  prev_day_low: number;
  nearest_round_above: number;
  nearest_round_below: number;
}

export interface PatternStat {
  pattern_type: string;
  total_trades: number;
  win_rate: number;
  avg_pnl_pct: number;
  avg_confidence: number | null;
  enabled: boolean;
  untraded: boolean;
}

export const api = {
  status: () => get<Status>("/api/status"),
  snapshot: (instrument: string) => get<Snapshot>(`/api/snapshot/${instrument}`),
  accountSummary: () => get<AccountSummary>("/api/account/summary"),
  keyLevels: (instrument: string) => get<KeyLevels>(`/api/key-levels/${instrument}`),
  decisions: (limit = 20) => get<Trade[]>(`/api/decisions?limit=${limit}`),
  decision: (id: string) => get<Trade>(`/api/decisions/${id}`),
  trades: (limit = 100, offset = 0) => get<Trade[]>(`/api/trades?limit=${limit}&offset=${offset}`),
  lessons: () => get<Lesson[]>("/api/lessons"),
  positions: () => get<Position[]>("/api/positions"),
  kill: () => post<{ kill_switch: boolean }>("/api/kill"),
  resume: () => post<{ kill_switch: boolean }>("/api/resume"),
  setMode: (mode: string) => post<{ mode: string }>("/api/mode", { mode }),
  managedPositions: () => get<ManagedPositionState[]>("/api/managed-positions"),
  candles: (instrument: string, timeframe: string, limit = 100, before?: number) =>
    get<Candle[]>(`/api/candles/${instrument}/${timeframe}?limit=${limit}${before ? `&before=${before}` : ""}`),
  watching: () => get<Watching>("/api/watching"),
  smc: (instrument: string) => get<Record<string, any>>(`/api/smc/${instrument}`),
  calibration: () => get<{ rows: any[]; calibrated: boolean | null; min_trades: number }>("/api/calibration"),
  // V1.2
  stateMachine: () => get<{ states: Record<string, string>; pending_orders: Record<string, unknown> }>("/api/state-machine"),
  dnaReport: () => get<DnaReport>("/api/dna/report"),
  dnaImport: () => post<{ job_id: string; status: string }>("/api/dna/import"),
  dnaImportStatus: (jobId: string) =>
    get<{
      job_id: string;
      status: string;
      progress: number;
      trades_imported: number;
      completed_at: string | null;
    }>(`/api/dna/import/status/${jobId}`),
  dnaAnalyse: () => post<DnaReport["report"] & { error?: string }>("/api/dna/analyse"),
  labBacktest: (rule: string, dateFrom?: string, dateTo?: string) =>
    post<LabBacktest>("/api/lab/backtest-rule", { rule, date_from: dateFrom, date_to: dateTo }),
  labReplay: (instrument: string, dateFrom: string, dateTo: string, minScore: number) =>
    post<LabReplay>("/api/lab/replay-market", { instrument, date_from: dateFrom, date_to: dateTo, min_setup_score: minScore }),
  labSimulate: (config: Record<string, unknown>, dateFrom: string, dateTo: string) =>
    post<LabSimulate>("/api/lab/simulate-strategy", { config, date_from: dateFrom, date_to: dateTo }),
  ivSnapshot: (instrument: string) => get<Record<string, any>>(`/api/options/iv/${instrument}`),
  riskProfile: () => get<RiskProfile>("/api/risk-profile"),
  updateRiskProfile: (updates: Partial<RiskProfile>) =>
    put<RiskProfile>("/api/risk-profile", updates),
  resetRiskProfile: () => post<RiskProfile>("/api/risk-profile/reset"),
  updateLessonQuality: (id: string, qualityScore: number) =>
    put<{ status: string; quality_score: number }>(`/api/lessons/${id}/quality`, { quality_score: qualityScore }),
  updateTradeNotes: (id: string, notes: string) =>
    put<{ id: string; notes: string | null }>(`/api/trades/${id}/notes`, { notes }),
  runReflection: (tradeId: string) =>
    post<{ reflection?: unknown; error?: string }>(`/api/run-reflection/${tradeId}`),
  closePosition: (instrument: string) =>
    post<{ success?: boolean; error?: string }>(`/api/close/${instrument}`),
  decisionChartBlobUrl: async (decisionId: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/decisions/${decisionId}/chart`, { headers: API_HEADERS });
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  },
  patternStats: () => get<PatternStat[]>("/api/patterns/stats"),
  togglePattern: (patternType: string, enabled: boolean) =>
    post<{ pattern_type: string; enabled: boolean; enabled_patterns: string[] }>(
      `/api/patterns/${patternType}/toggle`, { enabled }
    ),
  smcBacktest: (config: Record<string, unknown>) =>
    post<SmcBacktestResult>("/api/backtest/smc", config),
  labMonteCarlo: (dateFrom?: string, dateTo?: string, simulations = 1000, startingCapital?: number) =>
    post<LabMonteCarlo>("/api/lab/monte-carlo", {
      date_from: dateFrom, date_to: dateTo, simulations, starting_capital: startingCapital,
    }),
  labStressTest: (config: Record<string, unknown>) =>
    post<LabStressTest>("/api/lab/stress-test", config),
};

// ── V1.2 types ──────────────────────────────────────────────────────────────

export interface DnaInsight {
  title: string;
  stat: string;
  explanation: string;
  suggested_rule: string;
}

export interface DnaStats {
  trade_count: number;
  win_rate: number;
  total_pnl_inr: number;
  total_fees_inr: number;
  fee_pct_of_pnl: number;
  discipline_score: number;
  hourly: Record<string, { win_rate: number; trades: number; pnl: number }>;
  by_day: Record<string, { win_rate: number; trades: number; pnl: number }>;
  by_session: Record<string, { win_rate: number; trades: number; pnl: number }>;
  by_instrument: Record<string, { win_rate: number; trades: number; pnl: number; avg_pnl_pct: number }>;
  long_vs_short: Record<string, { win_rate: number; trades: number; pnl: number }>;
  after_two_losses_win_rate: number | null;
  daily_pnl: Record<string, number>;
}

export interface DnaReport {
  report: { stats: DnaStats; insights: DnaInsight[] };
  overlay_text: string | null;
  discipline_score: number | null;
  created_at: string | null;
}

export interface LabBacktest {
  rule: string;
  rule_spec: Record<string, unknown>;
  interpreted_by_ai: boolean;
  original: { trades: number; pnl_inr: number; win_rate: number };
  with_rule: { trades: number; pnl_inr: number; win_rate: number };
  trades_removed: number;
  win_rate_change: number;
  pnl_improvement_inr: number;
  curve: { dates: string[]; original: number[]; with_rule: number[] };
  error?: string;
}

export interface LabSignal {
  time: string;
  direction: string;
  score: number;
  price: number;
  outcome?: string;
  r_multiple?: number;
  confluences?: string[];
}

export interface LabReplay {
  instrument: string;
  signals_found: number;
  wins: number;
  losses: number;
  total_r: number;
  decisions: LabSignal[];
  error?: string;
}

export interface LabSimulate {
  config: Record<string, unknown>;
  trades_taken: number;
  win_rate: number | null;
  simulated_pnl_inr: number;
  total_r: number;
  decisions: LabSignal[];
  error?: string;
}

export interface SmcBacktestTrade {
  direction: string;
  entry_price: number;
  entry_time: string;
  stop_loss: number;
  take_profit: number;
  exit_price: number;
  exit_time: string;
  exit_reason: string;
  pnl_pct: number;
  pnl_inr: number;
  rr_achieved: number;
  setup_score: number;
  period: "train" | "test";
}

export interface SmcBacktestStats {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  avg_rr: number;
  max_rr: number;
  avg_pnl_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  total_return_pct: number;
  expectancy: number;
  equity_curve: { date: string; equity: number; period?: string }[];
}

export interface SmcBacktestResult {
  instrument: string;
  timeframe: string;
  date_from: string;
  date_to: string;
  train_end: string | null;
  trades: SmcBacktestTrade[];
  stats: SmcBacktestStats;
  train_stats: SmcBacktestStats | null;
  test_stats: SmcBacktestStats | null;
  disclaimer?: string;
  error?: string;
}

export interface LabMonteCarlo {
  trades_used: number;
  simulations: number;
  starting_capital: number;
  ruin_threshold_pct: number;
  probability_of_ruin: number;
  final_return_pct: { p5: number; p50: number; p95: number; mean: number };
  max_drawdown_pct: { p5: number; p50: number; p95: number; mean: number };
  fan_chart: { checkpoint: number; p5: number; p50: number; p95: number }[];
  disclaimer?: string;
  error?: string;
}

export interface LabStressTest {
  instrument: string;
  timeframe: string;
  window: { from: string; to: string };
  base: SmcBacktestStats;
  scenarios: {
    added_slippage: SmcBacktestStats;
    win_rate_shock: SmcBacktestStats;
    doubled_risk: SmcBacktestStats;
  };
  disclaimer?: string;
  error?: string;
}

export const swrFetcher = <T>(path: string) => get<T>(path);
