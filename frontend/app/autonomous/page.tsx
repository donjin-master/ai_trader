"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  Bot, Shield, CheckCircle, XCircle, Download, Settings, Pause, Power, Search,
} from "lucide-react";
import { api, type PatternStat, type RiskProfile, type Trade } from "@/lib/api";

const POLL = { refreshInterval: 15_000 };
const TABS = ["Overview", "Live Trades", "Strategies", "Automation Rules", "Logs"] as const;
type Tab = (typeof TABS)[number];

function pct(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

function inr(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}₹${Math.round(n).toLocaleString("en-IN")}`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const PATTERN_LABELS: Record<string, string> = {
  ob_fvg_sweep_confluence: "OB + FVG + Sweep Confluence",
  ob_fvg_confluence: "OB + FVG Confluence",
  liquidity_sweep_choch: "Liquidity Sweep → CHoCH",
  ob_after_sweep: "Order Block After Sweep",
  fvg_after_sweep: "FVG After Sweep",
  choch_entry: "CHoCH Entry",
  bos_continuation: "BOS Continuation",
  inducement_setup: "Inducement Setup",
  general_smc: "General SMC",
};

function NumberInput({ value, onChange, suffix, min, max, step }: {
  value: number; onChange: (v: number) => void; suffix?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number" value={value} min={min} max={max} step={step ?? 0.1}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          background: "var(--bg-input)", border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-md)", color: "var(--text-primary)",
          fontSize: "var(--text-sm)", padding: "6px 10px", outline: "none",
          width: 80, textAlign: "right",
        }}
      />
      {suffix && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{suffix}</span>}
    </div>
  );
}

export default function AutonomousPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [settingMode, setSettingMode] = useState(false);
  const [patternBusy, setPatternBusy] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState("");

  const { data: status }    = useSWR("status",     () => api.status(),           POLL);
  const { data: positions } = useSWR("positions",  () => api.positions(),        POLL);
  const { data: managed }   = useSWR("managed",    () => api.managedPositions(), POLL);
  const { data: trades }    = useSWR("auto-trades", () => api.trades(100),       POLL);
  const { data: decisions } = useSWR("auto-decisions", () => api.decisions(200), POLL);
  const { data: rawPatternStats, mutate: refreshPatterns } =
    useSWR<PatternStat[] | null>("patterns-stats-auto", () => api.patternStats(), POLL);
  const { data: riskProfile, mutate: refreshProfile } =
    useSWR<RiskProfile | null>("risk-profile-auto", () => api.riskProfile(), POLL);

  const patternStats = rawPatternStats ?? [];
  const decisionLog  = decisions ?? [];

  const mode       = status?.mode ?? "ADVISORY";
  const killSwitch = status?.kill_switch ?? false;
  const dailyPnlPct = status?.daily_pnl ?? 0;
  const totalCapital = status?.risk?.total_capital ?? 0;
  const dailyPnlInr  = (dailyPnlPct / 100) * totalCapital;
  const budgetUsed = status?.risk?.daily_budget_used_inr ?? 0;
  const budgetMax  = status?.risk?.daily_budget_inr ?? 0;
  const budgetPct  = budgetMax > 0 ? (budgetUsed / budgetMax) * 100 : 0;
  const consLosses = status?.risk?.consecutive_losses ?? 0;
  const consLimit  = status?.risk?.consecutive_loss_limit ?? 3;
  const nextSecs    = status?.next_decision_in_seconds ?? 0;
  const nextDecision = nextSecs > 0 ? `${Math.floor(nextSecs / 60)}m ${nextSecs % 60}s` : "—";

  const closedTrades = (trades ?? []).filter((t) => t.pnl_pct != null && t.status === "closed");
  const wins         = closedTrades.filter((t) => (t.pnl_pct ?? 0) > 0);
  const winRate      = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : null;
  const avgPnlPct    = closedTrades.length > 0
    ? closedTrades.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / closedTrades.length
    : null;

  // Equity curve — only from real closed trades, no synthetic data
  const equityData: { time: string; value: number }[] = (() => {
    if (!closedTrades.length) return [];
    let running = 100;
    return [...closedTrades].reverse().map((t, i) => {
      running += (t.pnl_pct ?? 0);
      return { time: `${i + 1}`, value: parseFloat(running.toFixed(2)) };
    });
  })();
  const netPnlPct = equityData.length ? equityData[equityData.length - 1].value - 100 : null;

  const statTiles = [
    { label: "Autonomous P&L (today)", value: inr(dailyPnlInr), color: dailyPnlInr >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
    { label: "Win Rate (all-time)",    value: winRate != null ? `${winRate.toFixed(1)}%` : "—", color: "var(--color-bull)" },
    { label: "Total Decisions",        value: decisionLog.length, color: "var(--text-primary)" },
    { label: "Avg P&L / Trade",        value: pct(avgPnlPct), color: (avgPnlPct ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
    { label: "Next Decision",          value: nextDecision, color: "var(--accent-primary)" },
    { label: "Consecutive Losses",     value: `${consLosses}/${consLimit}`, color: consLosses >= consLimit - 1 ? "var(--color-bear)" : "var(--text-primary)" },
  ];

  // AI Decision checklist — derived entirely from real status fields
  const decisionChecks = [
    { label: "Market Trend",      value: dailyPnlPct >= 0 ? "Bullish" : "Bearish",    pass: true },
    { label: "Risk Assessment",   value: budgetPct < 80 ? "Optimal" : "Elevated",     pass: budgetPct < 80 },
    { label: "Loss Control",      value: consLosses < consLimit ? "Safe" : "Alert",   pass: consLosses < consLimit },
    { label: "Execution Ready",   value: !killSwitch ? "Ready" : "Halted",            pass: !killSwitch },
  ];
  const allPass = decisionChecks.every((c) => c.pass);
  const passCount = decisionChecks.filter((c) => c.pass).length;
  const aiScore = ((passCount / decisionChecks.length) * 10).toFixed(1);
  const confidenceLabel = passCount === decisionChecks.length ? "High Confidence" : passCount >= decisionChecks.length / 2 ? "Medium Confidence" : "Low Confidence";

  const riskScore = Math.min(10, (budgetPct / 100) * 5 + (consLosses / Math.max(1, consLimit)) * 5);
  const riskLabel = riskScore <= 3 ? "Low Risk" : riskScore <= 6.5 ? "Medium Risk" : "High Risk";
  const riskColor = riskScore <= 3 ? "var(--color-bull)" : riskScore <= 6.5 ? "var(--color-neutral)" : "var(--color-bear)";

  const systemStatusItems = [
    { label: "Market Data Feed",         value: status ? "Active" : "Unavailable" },
    { label: "Boardroom Decision Engine", value: killSwitch ? "Halted" : "Active" },
    { label: "Risk Management",          value: budgetPct >= 100 ? "Breached" : "Active" },
    { label: "Trade Execution",          value: killSwitch ? "Halted" : "Active" },
    { label: "Position Monitoring",      value: managed !== undefined ? "Active" : "Unavailable" },
  ];

  const topStrategies = [...patternStats]
    .filter((p) => !p.untraded)
    .sort((a, b) => b.total_trades - a.total_trades)
    .slice(0, 3);

  const activityFeed = decisionLog.slice(0, 6);

  const handleKill = async () => {
    if (!killSwitch) {
      if (!confirm("Activate kill switch? This will stop all trading immediately.")) return;
      await api.kill();
    } else {
      await api.resume();
    }
  };

  const handleModeChange = async (newMode: string) => {
    setSettingMode(true);
    await api.setMode(newMode);
    setSettingMode(false);
  };

  const handleTogglePattern = async (p: PatternStat) => {
    setPatternBusy(p.pattern_type);
    await api.togglePattern(p.pattern_type, !p.enabled);
    await refreshPatterns();
    setPatternBusy(null);
  };

  const saveRule = async (updates: Partial<RiskProfile>) => {
    await api.updateRiskProfile(updates);
    await refreshProfile();
  };

  const handleExportLogs = () => {
    const blob = new Blob([JSON.stringify(decisionLog, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autonomous-logs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = decisionLog.filter((t) => {
    if (!logFilter.trim()) return true;
    const q = logFilter.toLowerCase();
    return (
      (t.instrument ?? "").toLowerCase().includes(q) ||
      (t.status ?? "").toLowerCase().includes(q) ||
      (t.reasoning ?? "").toLowerCase().includes(q) ||
      (t.decision_json?.skip_reason ?? "").toLowerCase().includes(q)
    );
  });

  function statusColor(status: string | null): string {
    if (status === "executed" || status === "closed" || status === "open") return "var(--color-bull)";
    if (status === "pending_approval") return "var(--color-neutral)";
    if (status === "skipped" || status === "logged_only") return "var(--text-muted)";
    return "var(--text-secondary)";
  }

  function detailFor(t: Trade): string {
    return t.decision_json?.skip_reason || t.reasoning || "—";
  }

  return (
    <div className="flex flex-col gap-4" suppressHydrationWarning>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <Bot size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>AUTONOMOUS TRADING</h1>
            <p className="hidden sm:block" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>AI-driven execution engine — live system control</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 rounded-full px-3 py-1"
            style={{ background: killSwitch ? "rgba(255,77,106,0.1)" : "rgba(38,208,124,0.1)", border: `1px solid ${killSwitch ? "rgba(255,77,106,0.3)" : "rgba(38,208,124,0.3)"}` }}>
            <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: killSwitch ? "var(--color-bear)" : "var(--color-bull)" }} />
            <span className="font-semibold" style={{ fontSize: "var(--text-xs)", color: killSwitch ? "var(--color-bear)" : "var(--color-bull)" }}>
              {killSwitch ? "System Halted" : "System Active"}
            </span>
          </div>
          <span className="hidden sm:inline" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Mode: {mode}</span>
          <button type="button" className="btn-ghost flex items-center gap-1.5" style={{ fontSize: "var(--text-xs)" }}
            disabled={settingMode} onClick={() => handleModeChange("ADVISORY")}>
            <Pause size={12} /> <span className="hidden sm:inline">Pause System</span>
          </button>
          <button type="button" className="btn-ghost flex items-center gap-1.5" style={{ fontSize: "var(--text-xs)" }} onClick={handleExportLogs}>
            <Download size={12} /> <span className="hidden sm:inline">Export Logs</span>
          </button>
          <Link href="/settings" className="btn-ghost" style={{ padding: "6px 8px" }}>
            <Settings size={14} style={{ color: "var(--text-secondary)" }} />
          </Link>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {activeTab === "Overview" && (
        <>
          {/* Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {statTiles.map((s) => (
              <div key={s.label} className="card" style={{ padding: "var(--space-3)" }}>
                <div className="section-label mb-1">{s.label}</div>
                <div className="font-mono font-bold" style={{ fontSize: "var(--text-xl)", color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-4">
            {/* Autonomous Performance chart */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label">Autonomous Performance</span>
              </div>
              {equityData.length === 0 ? (
                <div className="flex items-center justify-center" style={{ height: 160 }}>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No closed trades yet — equity curve will appear once trades close.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={equityData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
                    <Line type="monotone" dataKey="value" stroke="var(--color-bull)" strokeWidth={2} dot={false} name="Equity" />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div className="grid grid-cols-3 gap-2 mt-3" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 12 }}>
                {[
                  { label: "Starting Capital", value: totalCapital ? `₹${totalCapital.toLocaleString("en-IN")}` : "—", color: "var(--text-primary)" },
                  { label: "Net P&L (closed)", value: pct(netPnlPct), color: (netPnlPct ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                  { label: "Closed Trades",    value: closedTrades.length, color: "var(--text-primary)" },
                ].map((s) => (
                  <div key={s.label}>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.label}</div>
                    <div className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Decision Engine */}
            <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div className="section-label w-full">AI Decision Engine</div>
              <div className="relative" style={{ width: 120, height: 120 }}>
                <svg width="120" height="120" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(108,99,255,0.15)" strokeWidth="10" />
                  <circle cx="60" cy="60" r="50" fill="none" stroke="var(--accent-primary)" strokeWidth="10"
                    strokeDasharray={`${(parseFloat(aiScore) / 10) * 314} 314`} strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>{aiScore}</span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>/10</span>
                </div>
              </div>
              <div className="text-center">
                <div className="font-semibold" style={{ color: allPass ? "var(--color-bull)" : "var(--color-neutral)", fontSize: "var(--text-sm)" }}>{confidenceLabel}</div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Pre-Trade Checklist</div>
              </div>
              <div className="w-full flex flex-col gap-1.5">
                {decisionChecks.map((c) => (
                  <div key={c.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {c.pass ? <CheckCircle size={11} style={{ color: "var(--color-bull)" }} /> : <XCircle size={11} style={{ color: "var(--color-bear)" }} />}
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{c.label}</span>
                    </div>
                    <span className="font-semibold" style={{ fontSize: "var(--text-xs)", color: c.pass ? "var(--color-bull)" : "var(--color-bear)" }}>{c.value}</span>
                  </div>
                ))}
              </div>
              <div className="w-full rounded-lg py-2 text-center" style={{ background: allPass ? "rgba(38,208,124,0.1)" : "rgba(240,180,41,0.1)", border: `1px solid ${allPass ? "rgba(38,208,124,0.3)" : "rgba(240,180,41,0.3)"}` }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Overall Decision: </span>
                <span className="font-bold" style={{ fontSize: "var(--text-sm)", color: allPass ? "var(--color-bull)" : "var(--color-neutral)" }}>
                  {allPass ? "EXECUTE" : "WAIT"}
                </span>
              </div>
            </div>

            {/* System Status */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={13} style={{ color: "var(--text-secondary)" }} />
                <span className="section-label">System Status</span>
              </div>
              <div className="flex flex-col gap-2 mb-3">
                {systemStatusItems.map((s) => (
                  <div key={s.label} className="flex items-center justify-between">
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{s.label}</span>
                    <span className="font-semibold" style={{ fontSize: "var(--text-xs)", color: s.value === "Active" ? "var(--color-bull)" : "var(--color-bear)" }}>
                      {s.value === "Active" ? "● Active" : `⏸ ${s.value}`}
                    </span>
                  </div>
                ))}
              </div>
              <button type="button" style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)" }} onClick={() => setActiveTab("Logs")}>View System Logs →</button>

              <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 12, paddingTop: 12 }}>
                <div className="section-label mb-2">Mode Control</div>
                {(["ADVISORY", "SEMI_AUTO", "AUTONOMOUS"] as const).map((m) => (
                  <button key={m} type="button" disabled={settingMode}
                    onClick={() => handleModeChange(m)}
                    className="w-full flex items-center justify-between rounded-lg px-2.5 py-2 mb-1.5 transition-all"
                    style={{ background: mode === m ? "rgba(108,99,255,0.15)" : "var(--bg-elevated)", border: `1px solid ${mode === m ? "rgba(108,99,255,0.4)" : "var(--border-subtle)"}`, cursor: settingMode ? "not-allowed" : "pointer" }}>
                    <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: mode === m ? "var(--accent-primary)" : "var(--text-primary)" }}>{m}</span>
                    {mode === m && <span className="badge badge-long" style={{ fontSize: "9px" }}>ON</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Risk Management */}
            <div className="card">
              <div className="section-label mb-3">Risk Management</div>
              <div className="flex flex-col items-center mb-3">
                <div className="relative" style={{ width: 90, height: 90 }}>
                  <svg width="90" height="90" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(38,208,124,0.1)" strokeWidth="8" />
                    <circle cx="45" cy="45" r="38" fill="none" stroke={riskColor} strokeWidth="8"
                      strokeDasharray={`${(riskScore / 10) * 239} 239`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono font-bold" style={{ fontSize: "var(--text-lg)", color: riskColor }}>{riskScore.toFixed(1)}</span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{riskLabel}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2" style={{ fontSize: "var(--text-xs)" }}>
                {[
                  { label: "Daily Risk Budget",   value: budgetMax ? `₹${(budgetMax / 1000).toFixed(0)}K` : "—" },
                  { label: "Used Today",          value: `${budgetPct.toFixed(0)}%`, color: budgetPct > 80 ? "var(--color-bear)" : "var(--color-bull)" },
                  { label: "Consecutive Losses",  value: `${consLosses}/${consLimit}`, color: consLosses >= consLimit - 1 ? "var(--color-bear)" : "var(--text-primary)" },
                ].map((r) => (
                  <div key={r.label} className="flex justify-between">
                    <span style={{ color: "var(--text-secondary)" }}>{r.label}</span>
                    <span className="font-mono font-semibold" style={{ color: r.color ?? "var(--text-primary)" }}>{r.value}</span>
                  </div>
                ))}
                <div className="mt-1">
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.min(100, budgetPct)}%`, background: budgetPct > 80 ? "var(--color-bear)" : "var(--accent-primary)" }} /></div>
                </div>
              </div>
            </div>

            {/* Active Strategies summary */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label">Top Strategies</span>
                <button type="button" style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)" }} onClick={() => setActiveTab("Strategies")}>Manage →</button>
              </div>
              {topStrategies.length === 0 ? (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No trade history yet to evaluate patterns.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {topStrategies.map((p) => (
                    <div key={p.pattern_type} className="flex items-center justify-between rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                      <div>
                        <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-primary)" }}>{PATTERN_LABELS[p.pattern_type] ?? p.pattern_type}</div>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>{p.total_trades} trades</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold" style={{ fontSize: "var(--text-xs)", color: p.win_rate >= 50 ? "var(--color-bull)" : "var(--color-bear)" }}>{p.win_rate.toFixed(0)}%</div>
                        <span className="badge" style={{ fontSize: "9px", background: p.enabled ? "rgba(38,208,124,0.15)" : "rgba(255,255,255,0.06)", color: p.enabled ? "var(--color-bull)" : "var(--text-muted)" }}>
                          {p.enabled ? "Deployed" : "Not deployed"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Activity Feed */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label">Activity Feed</span>
                <button type="button" style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)" }} onClick={() => setActiveTab("Logs")}>View All →</button>
              </div>
              {activityFeed.length === 0 ? (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No decision activity yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {activityFeed.map((t, i) => (
                    <div key={t.id} className="flex items-start gap-2" style={{ borderBottom: i < activityFeed.length - 1 ? "1px solid var(--border-subtle)" : "none", paddingBottom: i < activityFeed.length - 1 ? 8 : 0 }}>
                      <div className="h-1.5 w-1.5 rounded-full mt-1.5 shrink-0" style={{ background: statusColor(t.status) }} />
                      <div>
                        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                          {t.instrument ?? "—"} — {(t.action ?? t.direction ?? "hold").toUpperCase()} ({detailFor(t)})
                        </p>
                        <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>{timeAgo(t.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === "Live Trades" && (
        <>
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="section-label">Current Positions</span>
                <span className="badge badge-open">{(positions ?? []).length} Active</span>
              </div>
            </div>
            {(positions ?? []).length === 0 ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No open positions.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    {["Pair","Side","Size","Entry","Mark","Unrealized P&L","SL","TP1"].map((h) => (
                      <th key={h} className="pb-2 text-left font-semibold pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(positions ?? []).map((p) => {
                    const mp = (managed ?? []).find((m) => m.instrument === p.product_symbol);
                    const pnl = parseFloat(p.unrealized_pnl ?? "0");
                    return (
                      <tr key={p.product_symbol} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td className="py-2 pr-4 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{p.product_symbol}</td>
                        <td className="py-2 pr-4 font-bold" style={{ color: p.size > 0 ? "var(--color-bull)" : "var(--color-bear)" }}>{p.size > 0 ? "LONG" : "SHORT"}</td>
                        <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-primary)" }}>{Math.abs(p.size)}</td>
                        <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-primary)" }}>{parseFloat(p.entry_price).toLocaleString()}</td>
                        <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-primary)" }}>{p.mark_price ? parseFloat(p.mark_price).toLocaleString() : "—"}</td>
                        <td className="py-2 pr-4 font-mono font-bold" style={{ color: pnl >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}</td>
                        <td className="py-2 pr-4 font-mono" style={{ color: "var(--color-bear)" }}>{mp?.current_sl?.toLocaleString() ?? "—"}</td>
                        <td className="py-2 font-mono" style={{ color: "var(--color-bull)" }}>{mp?.tp1?.toLocaleString() ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="section-label">Recent Autonomous Trades</span>
            </div>
            {(trades ?? []).filter((t) => t.action !== "hold").length === 0 ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No executed trades yet. System is in {mode} mode.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    {["Pair","Side","Entry","Exit","P&L","Time","Status"].map((h) => (
                      <th key={h} className="pb-2 text-left font-semibold pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(trades ?? []).filter((t) => t.action !== "hold").slice(0, 20).map((t) => (
                    <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td className="py-2 pr-4 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{t.instrument ?? "—"}</td>
                      <td className="py-2 pr-4 font-bold" style={{ color: (t.direction ?? t.action) === "long" ? "var(--color-bull)" : "var(--color-bear)" }}>
                        {(t.direction ?? t.action ?? "—").toUpperCase()}
                      </td>
                      <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-primary)" }}>{t.entry_price?.toLocaleString() ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-primary)" }}>{t.exit_price?.toLocaleString() ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono font-bold" style={{ color: (t.pnl_pct ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                        {t.pnl_pct != null ? pct(t.pnl_pct) : "—"}
                      </td>
                      <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-muted)" }}>
                        {t.created_at ? new Date(t.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="py-2"><span className="badge badge-neutral">{t.status ?? "—"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "Strategies" && (
        <div className="card">
          <div className="flex items-center justify-between mb-1">
            <span className="section-label">SMC Pattern Strategies</span>
          </div>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 12 }}>
            Each row is an SMC pattern type the boardroom can detect. Deploying a pattern restricts the AI to only trade on
            deployed patterns; with nothing deployed, all patterns are allowed (current default).
          </p>
          {patternStats.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No trade history yet to evaluate patterns.</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Pattern", "Win Rate", "Avg P&L", "Trades", "Status", "Deploy"].map((h) => (
                    <th key={h} className="pb-2 text-left font-semibold pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...patternStats].sort((a, b) => Number(a.untraded) - Number(b.untraded) || b.total_trades - a.total_trades).map((p) => (
                  <tr key={p.pattern_type} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td className="py-2 pr-4 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{PATTERN_LABELS[p.pattern_type] ?? p.pattern_type}</td>
                    <td className="py-2 pr-4 font-mono font-bold" style={{ color: p.untraded ? "var(--text-muted)" : p.win_rate >= 50 ? "var(--color-bull)" : "var(--color-bear)" }}>
                      {p.untraded ? "—" : `${p.win_rate.toFixed(0)}%`}
                    </td>
                    <td className="py-2 pr-4 font-mono font-bold" style={{ color: p.untraded ? "var(--text-muted)" : p.avg_pnl_pct >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                      {p.untraded ? "—" : pct(p.avg_pnl_pct)}
                    </td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-muted)" }}>{p.total_trades}</td>
                    <td className="py-2 pr-4">
                      <span style={{ fontWeight: 700, fontSize: "var(--text-xs)", color: p.enabled ? "var(--color-bull)" : "var(--text-muted)" }}>
                        {p.enabled ? "● Deployed" : "○ Not deployed"}
                      </span>
                    </td>
                    <td className="py-2">
                      <button type="button" disabled={patternBusy === p.pattern_type}
                        onClick={() => handleTogglePattern(p)}
                        className="btn-ghost flex items-center gap-1"
                        style={{ fontSize: "var(--text-xs)", padding: "4px 10px", color: p.enabled ? "var(--color-bear)" : "var(--color-bull)" }}>
                        <Power size={11} /> {patternBusy === p.pattern_type ? "…" : p.enabled ? "Undeploy" : "Deploy"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "Automation Rules" && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="section-label">Automation Rules</span>
            <Link href="/settings" style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)" }}>Full risk settings →</Link>
          </div>
          {!riskProfile ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Loading risk profile…</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Stop trading if daily loss exceeds", key: "daily_loss_limit_pct" as const, suffix: "%", min: 0.5, max: 20, step: 0.5 },
                { label: "Pause after consecutive losses",     key: "consecutive_loss_limit" as const, suffix: "trades", min: 1, max: 20, step: 1 },
                { label: "Minimum setup score to trade",        key: "min_setup_score" as const, suffix: "/10", min: 1, max: 10, step: 0.5 },
                { label: "Max trades per day",                  key: "max_trades_per_day" as const, suffix: "trades", min: 1, max: 50, step: 1 },
                { label: "Max concurrent open trades",          key: "max_concurrent_trades" as const, suffix: "trades", min: 1, max: 10, step: 1 },
                { label: "Minimum risk:reward ratio",           key: "min_rr_ratio" as const, suffix: "R", min: 0.5, max: 10, step: 0.1 },
              ].map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-2 rounded-lg p-3"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                  <div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{r.label}</div>
                    <span className="badge badge-long" style={{ fontSize: "9px", marginTop: 4, display: "inline-block" }}>Enforced in Python</span>
                  </div>
                  <NumberInput
                    value={riskProfile[r.key] as number}
                    onChange={(v) => saveRule({ [r.key]: v } as Partial<RiskProfile>)}
                    suffix={r.suffix} min={r.min} max={r.max} step={r.step}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "Logs" && (
        <div className="card">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <span className="section-label">Decision Logs</span>
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 w-full sm:w-auto" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
              <Search size={12} style={{ color: "var(--text-muted)" }} />
              <input
                value={logFilter} onChange={(e) => setLogFilter(e.target.value)}
                placeholder="Filter by instrument, status, reason…"
                style={{ background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: "var(--text-xs)", width: "100%", minWidth: 160 }}
                className="sm:w-[240px]"
              />
            </div>
          </div>
          {filteredLogs.length === 0 ? (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No decision logs match.</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Time", "Instrument", "Status", "Setup Score", "Detail"].map((h) => (
                    <th key={h} className="pb-2 text-left font-semibold pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLogs.slice(0, 150).map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{timeAgo(t.created_at)}</td>
                    <td className="py-2 pr-4 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{t.instrument ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className="font-semibold" style={{ color: statusColor(t.status) }}>{t.status ?? "—"}</span>
                    </td>
                    <td className="py-2 pr-4 font-mono" style={{ color: "var(--text-primary)" }}>{t.setup_score != null ? `${t.setup_score}/10` : "—"}</td>
                    <td className="py-2" style={{ color: "var(--text-secondary)", maxWidth: 480 }}>{detailFor(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {/* Kill switch — always visible regardless of tab */}
      <div className="card" style={{ border: `1px solid ${killSwitch ? "rgba(255,77,106,0.4)" : "rgba(38,208,124,0.2)"}` }}>
        <div className="section-label mb-3">Emergency Kill Switch</div>
        <button type="button" onClick={handleKill}
          className="w-full rounded-lg py-3 font-bold transition-all"
          style={{
            background: killSwitch ? "rgba(38,208,124,0.15)" : "rgba(255,77,106,0.15)",
            border: `1px solid ${killSwitch ? "rgba(38,208,124,0.4)" : "rgba(255,77,106,0.4)"}`,
            color: killSwitch ? "var(--color-bull)" : "var(--color-bear)",
            fontSize: "var(--text-md)",
          }}>
          {killSwitch ? "⚡ RESUME TRADING" : "🛑 KILL SWITCH — Stop All Trading"}
        </button>
      </div>
    </div>
  );
}
