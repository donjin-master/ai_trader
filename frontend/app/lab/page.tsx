"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Skeleton from "@/components/Skeleton";
import { api, type LabBacktest, type LabReplay, type LabSimulate } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";

const CurveChart = dynamic(() => import("@/components/LabCurve"), { ssr: false });
const LabBacktestCurve = dynamic(() => import("@/components/LabBacktestCurve"), { ssr: false });

const MODES = ["Rule Backtester", "Market Replay", "Strategy Simulator"] as const;
type Mode = (typeof MODES)[number];

const PREBUILT_RULES: { id: string; label: string }[] = [
  { id: "no_morning", label: "No trades before 11:30am IST" },
  { id: "max_2_per_day", label: "Max 2 trades per day" },
  { id: "no_mondays", label: "Skip Mondays" },
  { id: "no_weekend", label: "Skip weekends" },
  { id: "cooldown_2h", label: "No trade within 2h of a loss" },
  { id: "longs_only", label: "Longs only" },
  { id: "shorts_only", label: "Shorts only" },
];

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

export default function LabPage() {
  const [mode, setMode] = useState<Mode>("Rule Backtester");
  const [busy, setBusy] = useState(false);

  // Mode 1
  const [customRule, setCustomRule] = useState("");
  const [backtest, setBacktest] = useState<LabBacktest | null>(null);

  // Mode 2
  const [dateFrom, setDateFrom] = useState(daysAgoISO(3));
  const [dateTo, setDateTo] = useState(daysAgoISO(1));
  const [minScore, setMinScore] = useState(7);
  const [replay, setReplay] = useState<LabReplay | null>(null);

  // Mode 3
  const [simInstrument, setSimInstrument] = useState("BTCUSD");
  const [simTimeframe, setSimTimeframe] = useState("15m");
  const [minRr, setMinRr] = useState(3.0);
  const [riskPct, setRiskPct] = useState(1.0);
  const [startingCapital, setStartingCapital] = useState(50000);
  const [enableWalkForward, setEnableWalkForward] = useState(false);
  const [trainEnd, setTrainEnd] = useState(daysAgoISO(2));
  const [smcBacktestResult, setSmcBacktestResult] = useState<any | null>(null);

  const runBacktest = async (rule: string) => {
    setBusy(true);
    setBacktest(await api.labBacktest(rule));
    setBusy(false);
  };
  const runReplay = async () => {
    setBusy(true);
    setReplay(await api.labReplay("BTCUSD", `${dateFrom}T00:00:00Z`, `${dateTo}T23:59:59Z`, minScore));
    setBusy(false);
  };
  const runSim = async () => {
    setBusy(true);
    try {
      const res = await api.smcBacktest({
        instrument: simInstrument,
        timeframe: simTimeframe,
        date_from: `${dateFrom}T00:00:00Z`,
        date_to: `${dateTo}T23:59:59Z`,
        min_setup_score: minScore,
        min_rr: minRr,
        risk_per_trade_pct: riskPct,
        starting_capital: startingCapital,
        train_end: enableWalkForward ? `${trainEnd}T23:59:59Z` : null,
      });
      setSmcBacktestResult(res);
    } catch (err) {
      console.error(err);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-mono text-sm font-black tracking-widest">SCENARIO LAB</h1>
        <p className="text-xs text-slate-500">Test rules and strategies against your real trade history + live market data</p>
      </div>

      <div className="flex gap-1">
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-lg px-3 py-1.5 font-mono text-[11px] font-bold",
              mode === m ? "bg-slate-100 text-slate-900" : "bg-white/5 text-slate-400 hover:text-slate-200"
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "Rule Backtester" && (
        <div className="space-y-3">
          <div className="glass-card p-4">
            <div className="mb-2 font-mono text-xs font-bold tracking-widest text-slate-400">PREBUILT RULES</div>
            <div className="flex flex-wrap gap-2">
              {PREBUILT_RULES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => runBacktest(r.id)}
                  disabled={busy}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={customRule}
                onChange={(e) => setCustomRule(e.target.value)}
                placeholder="Custom rule (AI interprets), e.g. 'No trades on Fridays after 8pm'"
                className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs"
              />
              <button
                onClick={() => customRule && runBacktest(customRule)}
                disabled={busy || !customRule}
                className="rounded-lg bg-blue-600 px-4 py-2 font-mono text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Run
              </button>
            </div>
          </div>

          {busy && <Skeleton className="h-40" />}
          {!busy && backtest && (
            backtest.error ? (
              <div className="glass-card p-4 text-xs text-amber-300">{backtest.error}</div>
            ) : (
              <div className="glass-card p-4">
                <div className="mb-2 font-mono text-xs text-slate-400">
                  Rule: <span className="text-slate-100">{backtest.rule}</span>
                  {backtest.interpreted_by_ai && <span className="ml-2 text-purple-400">👁 AI-interpreted</span>}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Original P&L" value={formatCurrency(backtest.original.pnl_inr)} cls={backtest.original.pnl_inr >= 0 ? "text-emerald-400" : "text-red-400"} />
                  <Stat label="With Rule" value={formatCurrency(backtest.with_rule.pnl_inr)} cls={backtest.with_rule.pnl_inr >= 0 ? "text-emerald-400" : "text-red-400"} />
                  <Stat label="P&L Change" value={formatCurrency(backtest.pnl_improvement_inr)} cls={backtest.pnl_improvement_inr >= 0 ? "text-emerald-400" : "text-red-400"} />
                  <Stat label="Win Rate Δ" value={`${backtest.win_rate_change >= 0 ? "+" : ""}${backtest.win_rate_change}%`} cls={backtest.win_rate_change >= 0 ? "text-emerald-400" : "text-red-400"} />
                </div>
                <div className="mt-1 font-mono text-[11px] text-slate-500">
                  Trades removed: {backtest.trades_removed} · kept: {backtest.with_rule.trades}
                </div>
                {backtest.curve.dates.length > 1 && (
                  <div className="mt-3">
                    <CurveChart curve={backtest.curve} />
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {mode === "Market Replay" && (
        <div className="space-y-3">
          <div className="glass-card flex flex-wrap items-end gap-3 p-4">
            <Field label="From"><input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white" /></Field>
            <Field label="To"><input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white" /></Field>
            <Field label={`Min Setup Score: ${minScore}`}>
              <input type="range" min={3} max={9} step={0.5} value={minScore} onChange={(e) => setMinScore(parseFloat(e.target.value))} className="accent-blue-500" />
            </Field>
            <button
              onClick={runReplay}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 font-mono text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? "Replaying…" : "Replay Market"}
            </button>
          </div>

          {busy && <Skeleton className="h-40" />}

          {!busy && replay && (
            replay.error ? <div className="glass-card p-4 text-xs text-amber-300">{replay.error}</div> : (
              <div className="glass-card p-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Signals" value={`${replay.signals_found}`} />
                  <Stat label="Wins" value={`${replay.wins}`} cls="text-emerald-400" />
                  <Stat label="Losses" value={`${replay.losses}`} cls="text-red-400" />
                  <Stat label="Total R" value={`${replay.total_r >= 0 ? "+" : ""}${replay.total_r}R`} cls={replay.total_r >= 0 ? "text-emerald-400" : "text-red-400"} />
                </div>
                <SignalTable signals={replay.decisions} />
              </div>
            )
          )}
        </div>
      )}

      {mode === "Strategy Simulator" && (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Left panel: settings */}
          <div className="lg:col-span-1 space-y-4">
            <div className="panel p-4 space-y-4">
              <div className="font-mono text-xs font-bold tracking-widest text-slate-400">
                STRATEGY CONFIG
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <Field label="Instrument">
                  <select
                    value={simInstrument}
                    onChange={(e) => setSimInstrument(e.target.value)}
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white"
                  >
                    <option value="BTCUSD">BTCUSD</option>
                    <option value="ETHUSD">ETHUSD</option>
                    <option value="SOLUSD">SOLUSD</option>
                    <option value="XAUUSD">XAUUSD</option>
                  </select>
                </Field>
                <Field label="Timeframe">
                  <select
                    value={simTimeframe}
                    onChange={(e) => setSimTimeframe(e.target.value)}
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white"
                  >
                    <option value="15m">15m</option>
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="From">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white"
                  />
                </Field>
                <Field label="To">
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white"
                  />
                </Field>
              </div>

              <Field label={`Min Setup Score: ${minScore}`}>
                <input
                  type="range"
                  min={5}
                  max={10}
                  step={0.5}
                  value={minScore}
                  onChange={(e) => setMinScore(parseFloat(e.target.value))}
                  className="accent-blue-500 w-full"
                />
              </Field>

              <div className="grid grid-cols-3 gap-2">
                <Field label="Min R:R">
                  <select
                    value={minRr}
                    onChange={(e) => setMinRr(parseFloat(e.target.value))}
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white"
                  >
                    <option value={2.0}>1:2</option>
                    <option value={3.0}>1:3</option>
                    <option value={4.0}>1:4</option>
                    <option value={5.0}>1:5</option>
                  </select>
                </Field>
                <Field label="Risk %">
                  <input
                    type="number"
                    step={0.1}
                    value={riskPct}
                    onChange={(e) => setRiskPct(parseFloat(e.target.value))}
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white w-full font-mono"
                  />
                </Field>
                <Field label="Capital">
                  <input
                    type="number"
                    value={startingCapital}
                    onChange={(e) => setStartingCapital(parseInt(e.target.value))}
                    className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white w-full font-mono"
                  />
                </Field>
              </div>

              <div className="border-t border-white/5 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-slate-400">Enable walk-forward</span>
                  <input
                    type="checkbox"
                    checked={enableWalkForward}
                    onChange={(e) => setEnableWalkForward(e.target.checked)}
                    className="rounded border-white/10 bg-black/30 accent-blue-500"
                  />
                </div>

                {enableWalkForward && (
                  <Field label="Train period end">
                    <input
                      type="date"
                      value={trainEnd}
                      onChange={(e) => setTrainEnd(e.target.value)}
                      className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-white"
                    />
                  </Field>
                )}
              </div>

              <button
                onClick={runSim}
                disabled={busy}
                className="rounded-lg bg-blue-600 w-full py-2 font-mono text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {busy ? "Running Backtest..." : "Run Backtest"}
              </button>
            </div>

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
              ⚠️ <strong>Disclaimer:</strong> These results reflect Python's SMC pattern detection,
              not manual chart reading with trader discretion. Live results will differ. Use as directional guidance only.
            </div>
          </div>

          {/* Right panel: results */}
          <div className="lg:col-span-2 space-y-4">
            {busy && <Skeleton className="h-96 w-full" />}
            
            {!busy && smcBacktestResult && (
              smcBacktestResult.error ? (
                <div className="panel p-4 text-xs text-amber-300">{smcBacktestResult.error}</div>
              ) : (
                <div className="space-y-4">
                  {/* Overall / Train / Test stats cards */}
                  <div className="panel p-4 space-y-3">
                    <div className="font-mono text-xs font-bold tracking-widest text-slate-400">
                      PERFORMANCE METRICS
                    </div>
                    
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg bg-white/5 p-2">
                        <div className="font-mono text-[9px] uppercase text-blue-400 font-bold">Overall Period</div>
                        <div className="mt-1 space-y-1 font-mono text-xs text-slate-300">
                          <div>Trades: <span className="text-white font-bold">{smcBacktestResult.stats.total_trades}</span></div>
                          <div>Win Rate: <span className={cn("font-bold", smcBacktestResult.stats.win_rate_pct >= 50 ? "text-emerald-400" : "text-red-400")}>{smcBacktestResult.stats.win_rate_pct}%</span></div>
                          <div>Drawdown: <span className="text-white font-bold">{smcBacktestResult.stats.max_drawdown_pct}%</span></div>
                          <div>Return: <span className={cn("font-bold", smcBacktestResult.stats.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400")}>{smcBacktestResult.stats.total_return_pct}%</span></div>
                        </div>
                      </div>

                      {smcBacktestResult.train_stats && (
                        <div className="rounded-lg bg-white/5 p-2 border border-blue-500/20">
                          <div className="font-mono text-[9px] uppercase text-blue-400 font-bold">Train Period</div>
                          <div className="mt-1 space-y-1 font-mono text-xs text-slate-300">
                            <div>Trades: <span className="text-white font-bold">{smcBacktestResult.train_stats.total_trades}</span></div>
                            <div>Win Rate: <span className={cn("font-bold", smcBacktestResult.train_stats.win_rate_pct >= 50 ? "text-emerald-400" : "text-red-400")}>{smcBacktestResult.train_stats.win_rate_pct}%</span></div>
                            <div>Drawdown: <span className="text-white font-bold">{smcBacktestResult.train_stats.max_drawdown_pct}%</span></div>
                            <div>Return: <span className={cn("font-bold", smcBacktestResult.train_stats.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400")}>{smcBacktestResult.train_stats.total_return_pct}%</span></div>
                          </div>
                        </div>
                      )}

                      {smcBacktestResult.test_stats && (
                        <div className="rounded-lg bg-white/5 p-2 border border-amber-500/20">
                          <div className="font-mono text-[9px] uppercase text-amber-400 font-bold">Test Period</div>
                          <div className="mt-1 space-y-1 font-mono text-xs text-slate-300">
                            <div>Trades: <span className="text-white font-bold">{smcBacktestResult.test_stats.total_trades}</span></div>
                            <div>Win Rate: <span className={cn("font-bold", smcBacktestResult.test_stats.win_rate_pct >= 50 ? "text-emerald-400" : "text-red-400")}>{smcBacktestResult.test_stats.win_rate_pct}%</span></div>
                            <div>Drawdown: <span className="text-white font-bold">{smcBacktestResult.test_stats.max_drawdown_pct}%</span></div>
                            <div>Return: <span className={cn("font-bold", smcBacktestResult.test_stats.total_return_pct >= 0 ? "text-emerald-400" : "text-red-400")}>{smcBacktestResult.test_stats.total_return_pct}%</span></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Recharts Curve */}
                  <div className="panel p-4">
                    <div className="mb-2 font-mono text-xs font-bold tracking-widest text-slate-400">
                      EQUITY CURVE
                    </div>
                    <LabBacktestCurve equityCurve={smcBacktestResult.stats.equity_curve} />
                  </div>

                  {/* Trade details */}
                  <div className="panel p-4">
                    <div className="mb-2 font-mono text-xs font-bold tracking-widest text-slate-400">
                      TRADE LOG
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      <table className="w-full text-left font-mono text-[10px]">
                        <thead className="text-slate-500 border-b border-white/5">
                          <tr>
                            <th className="py-1">Date</th>
                            <th>Dir</th>
                            <th>Score</th>
                            <th>Entry</th>
                            <th>Exit</th>
                            <th>Outcome</th>
                            <th>R</th>
                            <th>P&L</th>
                            {enableWalkForward && <th>Period</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {smcBacktestResult.trades.map((t: any, i: number) => (
                            <tr key={i} className="border-t border-white/5 text-slate-300">
                              <td className="py-1">
                                {new Date(t.entry_time).toLocaleDateString("en-IN", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </td>
                              <td className={t.direction === "long" ? "text-emerald-400" : "text-red-400"}>
                                {t.direction.toUpperCase()}
                              </td>
                              <td>{t.setup_score}</td>
                              <td>{t.entry_price}</td>
                              <td>{t.exit_price}</td>
                              <td className={t.exit_reason === "take_profit" ? "text-emerald-400" : t.exit_reason === "stop_loss" ? "text-red-400" : "text-slate-500"}>
                                {t.exit_reason.toUpperCase()}
                              </td>
                              <td className={t.rr_achieved >= 0 ? "text-emerald-400" : "text-red-400"}>
                                {t.rr_achieved >= 0 ? "+" : ""}{t.rr_achieved}R
                              </td>
                              <td className={t.pnl_inr >= 0 ? "text-emerald-400" : "text-red-400"}>
                                {t.pnl_inr >= 0 ? "+" : ""}₹{t.pnl_inr.toLocaleString("en-IN")}
                              </td>
                              {enableWalkForward && (
                                <td className={t.period === "train" ? "text-blue-400 font-bold" : "text-amber-400 font-bold"}>
                                  {t.period.toUpperCase()}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            )}

            {!busy && !smcBacktestResult && (
              <div className="panel p-6 text-center text-xs text-slate-500">
                Select configuration on the left and click "Run Backtest" to begin.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, cls = "text-slate-100" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-white/5 p-2">
      <div className="font-mono text-[10px] uppercase text-slate-500">{label}</div>
      <div className={cn("font-mono text-lg font-bold", cls)}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 font-mono text-[11px] text-slate-400">
      {label}
      {children}
    </label>
  );
}

function SignalTable({ signals }: { signals: { time: string; direction: string; score: number; price: number; outcome?: string; r_multiple?: number }[] }) {
  if (!signals.length) return <p className="mt-3 text-xs text-slate-500">No signals in this window.</p>;
  return (
    <div className="mt-3 max-h-64 overflow-y-auto">
      <table className="w-full text-left font-mono text-[11px]">
        <thead className="text-slate-500">
          <tr><th className="py-1">Time</th><th>Dir</th><th>Score</th><th>Price</th><th>Outcome</th><th>R</th></tr>
        </thead>
        <tbody>
          {signals.map((s, i) => (
            <tr key={i} className="border-t border-white/5">
              <td className="py-1 text-slate-400">{s.time}</td>
              <td className={s.direction === "long" ? "text-emerald-400" : "text-red-400"}>{s.direction}</td>
              <td className="text-slate-300">{s.score}</td>
              <td className="text-slate-300">{s.price}</td>
              <td className={s.outcome === "win" ? "text-emerald-400" : s.outcome === "loss" ? "text-red-400" : "text-slate-500"}>{s.outcome ?? "—"}</td>
              <td className={(s.r_multiple ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}>{s.r_multiple ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
