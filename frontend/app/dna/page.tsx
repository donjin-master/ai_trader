"use client";

import { useState } from "react";
import useSWR from "swr";
import Skeleton from "@/components/Skeleton";
import { api, type DnaReport } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MetricBox({ label, value, valueClass = "text-slate-100", sub }: {
  label: string; value: string; valueClass?: string; sub?: string;
}) {
  return (
    <div className="glass-card p-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-bold", valueClass)}>{value}</div>
      {sub && <div className="font-mono text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function winColor(rate: number): string {
  if (rate >= 60) return "text-emerald-400";
  if (rate >= 45) return "text-amber-400";
  return "text-red-400";
}

export default function DnaPage() {
  const { data: report, mutate } = useSWR<DnaReport | null>("dna-report", () => api.dnaReport());
  const [busy, setBusy] = useState<string | null>(null);
  const [appliedRules, setAppliedRules] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importedCount, setImportedCount] = useState(0);

  const runImportAnalyse = async () => {
    setBusy("Initializing Import...");
    setImportProgress(0);
    setImportedCount(0);
    
    try {
      const res = await api.dnaImport();
      if (!res || !res.job_id) {
        setBusy(null);
        alert("Failed to start import job.");
        return;
      }
      
      const jobId = res.job_id;
      setBusy("Importing...");
      
      const poll = setInterval(async () => {
        const statusRes = await api.dnaImportStatus(jobId);
        if (!statusRes) return;
        
        setImportProgress(statusRes.progress);
        setImportedCount(statusRes.trades_imported);
        
        if (statusRes.status === "complete") {
          clearInterval(poll);
          setBusy("Analysing...");
          await api.dnaAnalyse();
          setBusy(null);
          setImportProgress(0);
          mutate();
        } else if (statusRes.status === "failed") {
          clearInterval(poll);
          setBusy(null);
          setImportProgress(0);
          alert("Import job failed.");
        }
      }, 2000);
      
    } catch (err) {
      console.error(err);
      setBusy(null);
      setImportProgress(0);
    }
  };

  const applyRule = async (insight: { suggested_rule: string }) => {
    // Heuristic mapping of common rule phrasing to profile fields
    const text = insight.suggested_rule.toLowerCase();
    const updates: Record<string, unknown> = {};
    const hourMatch = text.match(/before (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (hourMatch || text.includes("morning")) {
      updates.trade_start_time = "11:30";
    }
    if (text.includes("max") && text.match(/(\d+)\s*trades?\s*(per|\/)\s*day/)) {
      updates.max_trades_per_day = parseInt(text.match(/(\d+)\s*trades?\s*(per|\/)\s*day/)![1]);
    }
    if (Object.keys(updates).length === 0) {
      updates.trade_start_time = "11:30"; // safe default from the dominant pattern
    }
    await api.updateRiskProfile(updates);
    setAppliedRules((r) => [...r, insight.suggested_rule]);
  };

  const stats = report?.report?.stats;
  const insights = report?.report?.insights ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-sm font-black tracking-widest">TRADING DNA</h1>
          <p className="text-xs text-slate-500">
            Patterns from YOUR real Delta Exchange history
            {report?.created_at && ` · last analysed ${new Date(report.created_at).toLocaleString("en-IN")}`}
            {stats && ` · Total trades: ${stats.trade_count}`}
          </p>
        </div>
        <button
          onClick={runImportAnalyse}
          disabled={!!busy}
          className="rounded-lg bg-blue-600 px-4 py-2 font-mono text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ?? "Import + Analyse from Delta"}
        </button>
      </div>

      {importProgress > 0 && (
        <div className="glass-card p-4 space-y-2">
          <div className="flex justify-between font-mono text-xs">
            <span className="text-slate-400">Import Progress: {importProgress}%</span>
            <span className="text-slate-300">{importedCount} trades imported</span>
          </div>
          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${importProgress}%` }}
            />
          </div>
        </div>
      )}

      {!report || !stats ? (
        <div className="glass-card p-6 text-sm text-slate-400">
          {busy ? <Skeleton className="h-20" /> : "No DNA report yet. Click “Import + Analyse” to pull your Delta history and find patterns."}
        </div>
      ) : (
        <>
          {/* DNA summary score + key metrics */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricBox
              label="Discipline Score"
              value={`${stats.discipline_score}/100`}
              valueClass={winColor(stats.discipline_score)}
            />
            <MetricBox label="Trades" value={`${stats.trade_count}`} />
            <MetricBox label="Win Rate" value={`${stats.win_rate}%`} valueClass={winColor(stats.win_rate)} />
            <MetricBox
              label="Net P&L"
              value={formatCurrency(stats.total_pnl_inr)}
              valueClass={stats.total_pnl_inr >= 0 ? "text-emerald-400" : "text-red-400"}
            />
            <MetricBox
              label="Fee Drag"
              value={`${stats.fee_pct_of_pnl}%`}
              valueClass={stats.fee_pct_of_pnl > 50 ? "text-red-400" : "text-slate-100"}
              sub="of gross P&L"
            />
          </div>

          {/* Session + Day breakdown */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="glass-card p-4">
              <div className="mb-2 font-mono text-xs font-bold tracking-widest text-slate-400">SESSION PERFORMANCE</div>
              <div className="grid grid-cols-3 gap-2">
                {["Asia", "London", "US"].map((s) => {
                  const d = stats.by_session[s];
                  return (
                    <div key={s} className="rounded-lg bg-white/5 p-2 text-center">
                      <div className="font-mono text-[10px] uppercase text-slate-500">{s}</div>
                      <div className={cn("font-mono text-lg font-bold", d ? winColor(d.win_rate) : "text-slate-600")}>
                        {d ? `${d.win_rate}%` : "—"}
                      </div>
                      <div className="font-mono text-[10px] text-slate-500">{d ? `${d.trades} trades` : "no data"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="mb-2 font-mono text-xs font-bold tracking-widest text-slate-400">DAY OF WEEK</div>
              <div className="grid grid-cols-7 gap-1">
                {DAYS.map((d) => {
                  const v = stats.by_day[d];
                  return (
                    <div key={d} className="text-center">
                      <div className="font-mono text-[9px] text-slate-500">{d}</div>
                      <div className={cn(
                        "mt-1 rounded py-2 font-mono text-[11px] font-bold",
                        v ? (v.pnl >= 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300") : "bg-white/5 text-slate-600"
                      )}>
                        {v ? `${v.win_rate}%` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Hour-of-day analysis */}
          <div className="glass-card p-4">
            <div className="mb-2 font-mono text-xs font-bold tracking-widest text-slate-400">
              TIME OF DAY (IST) — win rate by hour
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: 24 }, (_, h) => {
                const v = stats.hourly[String(h)];
                return (
                  <div key={h} className="w-9 text-center" title={v ? `${v.trades} trades, ₹${v.pnl}` : "no trades"}>
                    <div className={cn(
                      "rounded py-1.5 font-mono text-[10px] font-bold",
                      v ? (v.win_rate >= 50 ? "bg-emerald-500/25 text-emerald-300" : "bg-red-500/25 text-red-300") : "bg-white/5 text-slate-700"
                    )}>
                      {v ? `${Math.round(v.win_rate)}` : "·"}
                    </div>
                    <div className="font-mono text-[8px] text-slate-600">{h}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Instrument breakdown + long/short */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="glass-card p-4">
              <div className="mb-2 font-mono text-xs font-bold tracking-widest text-slate-400">INSTRUMENT BREAKDOWN</div>
              <div className="space-y-1.5">
                {Object.entries(stats.by_instrument).map(([inst, d]) => (
                  <div key={inst} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5 font-mono text-xs">
                    <span className="font-bold text-slate-200">{inst}</span>
                    <div className="flex gap-4">
                      <span className={winColor(d.win_rate)}>{d.win_rate}% WR</span>
                      <span className="text-slate-400">{d.trades}T</span>
                      <span className={d.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>{formatCurrency(d.pnl)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-card p-4">
              <div className="mb-2 font-mono text-xs font-bold tracking-widest text-slate-400">DIRECTIONAL BIAS</div>
              <div className="grid grid-cols-2 gap-2">
                {["long", "short"].map((dir) => {
                  const d = stats.long_vs_short[dir];
                  return (
                    <div key={dir} className="rounded-lg bg-white/5 p-3 text-center">
                      <div className={cn("font-mono text-[10px] uppercase", dir === "long" ? "text-emerald-400" : "text-red-400")}>{dir}</div>
                      <div className={cn("mt-1 font-mono text-xl font-bold", d ? winColor(d.win_rate) : "text-slate-600")}>
                        {d ? `${d.win_rate}%` : "—"}
                      </div>
                      <div className="font-mono text-[10px] text-slate-500">{d ? `${d.trades} trades` : "no data"}</div>
                    </div>
                  );
                })}
              </div>
              {stats.after_two_losses_win_rate !== null && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-200">
                  After 2 consecutive losses: {stats.after_two_losses_win_rate}% win rate
                  {stats.after_two_losses_win_rate < stats.win_rate && " — cool-down recommended"}
                </div>
              )}
            </div>
          </div>

          {/* AI Insights */}
          <div>
            <div className="mb-2 font-mono text-xs font-bold tracking-widest text-slate-400">AI INSIGHTS (data-backed)</div>
            {insights.length === 0 ? (
              <div className="glass-card p-4 text-xs text-slate-500">No insights generated — re-run analyse.</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {insights.map((ins) => {
                  const applied = appliedRules.includes(ins.suggested_rule);
                  return (
                    <div key={ins.title} className="glass-card p-4">
                      <div className="font-mono text-sm font-bold text-slate-100">{ins.title}</div>
                      <div className="mt-1 font-mono text-[11px] text-blue-300">{ins.stat}</div>
                      <p className="mt-2 text-xs text-slate-300">{ins.explanation}</p>
                      <div className="mt-2 rounded-lg border border-purple-500/30 bg-purple-500/10 p-2 text-xs text-purple-200">
                        💡 {ins.suggested_rule}
                      </div>
                      <button
                        onClick={() => applyRule(ins)}
                        disabled={applied}
                        className={cn(
                          "mt-2 rounded-md px-3 py-1 font-mono text-[11px] font-bold",
                          applied ? "bg-emerald-600/30 text-emerald-300" : "bg-blue-600 text-white hover:bg-blue-500"
                        )}
                      >
                        {applied ? "✓ Applied to Risk Profile" : "Apply to Risk Profile"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300 font-mono">
            ℹ️ <strong>Note:</strong> Historical trades imported without SMC classification.
            AI system trades (from this system) will have full pattern data.
            Import provides session and instrument baseline data.
          </div>
        </>
      )}
    </div>
  );
}
