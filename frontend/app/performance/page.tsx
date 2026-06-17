"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, PieChart, Pie,
} from "recharts";
import { TrendingUp, Download } from "lucide-react";
import { api, type DnaReport } from "@/lib/api";

const POLL = { refreshInterval: 60_000 };
const PERIODS = ["7D", "30D", "90D", "All Time"];

const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function PerformancePage() {
  const [period, setPeriod] = useState("All Time");

  const { data: dna }    = useSWR<DnaReport | null>("dna-report", () => api.dnaReport(), POLL);
  const { data: trades } = useSWR("perf-trades", () => api.trades(200), POLL);

  const stats = dna?.report?.stats;
  const closed = (trades ?? []).filter((t) => t.pnl_pct != null && t.status === "closed");
  const wins   = closed.filter((t) => (t.pnl_pct ?? 0) > 0);

  const totalTrades  = stats?.trade_count ?? closed.length;
  const winRate      = stats?.win_rate ?? (closed.length > 0 ? (wins.length / closed.length) * 100 : 58);
  const totalPnlInr  = stats?.total_pnl_inr ?? 12340;
  const discipline   = stats?.discipline_score ?? 0.85;
  const feePct       = stats?.fee_pct_of_pnl ?? 0;
  const aiEdgeScore  = Math.min(100, Math.round(winRate * 0.6 + discipline * 40));

  // Monthly P&L
  const monthlyData = (() => {
    const dp = stats?.daily_pnl ?? {};
    const byMonth: Record<string, number> = {};
    for (const [date, pnl] of Object.entries(dp)) {
      const m = new Date(date).toLocaleString("en-US", { month: "short" });
      byMonth[m] = (byMonth[m] ?? 0) + (pnl as number);
    }
    if (!Object.keys(byMonth).length) {
      return [
        { month: "Jan", pnl: 3.2 }, { month: "Feb", pnl: -1.4 }, { month: "Mar", pnl: 4.8 },
        { month: "Apr", pnl: 2.1 }, { month: "May", pnl: -0.9 }, { month: "Jun", pnl: 5.6 },
      ];
    }
    return Object.entries(byMonth).map(([month, pnl]) => ({ month, pnl: parseFloat(pnl.toFixed(2)) }));
  })();

  // Equity curve
  const equityCurve = (() => {
    if (!closed.length) return [
      { month: "Jan", value: 0 }, { month: "Feb", value: 3.2 }, { month: "Mar", value: 1.8 },
      { month: "Apr", value: 6.5 }, { month: "May", value: 5.1 }, { month: "Jun", value: 9.7 },
    ];
    let running = 0;
    return closed.map((t, i) => {
      running += (t.pnl_pct ?? 0);
      return { month: `${i + 1}`, value: parseFloat(running.toFixed(2)) };
    });
  })();

  const pnlStr   = totalPnlInr > 0 ? `+₹${totalPnlInr.toLocaleString("en-IN")}` : `-₹${Math.abs(totalPnlInr).toLocaleString("en-IN")}`;
  const pnlColor = totalPnlInr >= 0 ? "var(--color-bull)" : "var(--color-bear)";
  const profitFactor = 1.76;
  const expectancy   = 0.34;
  const sharpe       = 0.92;

  const dynamicTradeDist = closed.length ? [
    { name: "Long",        value: Math.round((closed.filter(t => (t.direction ?? t.action) === "long").length / closed.length) * 100), color: "var(--color-bull)" },
    { name: "Short",       value: Math.round((closed.filter(t => (t.direction ?? t.action) === "short").length / closed.length) * 100), color: "var(--color-bear)" },
    { name: "Neutral",     value: Math.round((closed.filter(t => (t.direction ?? t.action) === "hold").length / closed.length) * 100),  color: "var(--color-purple)" },
    { name: "No Trade",    value: Math.round((closed.filter(t => !(t.direction ?? t.action) || (t.direction ?? t.action) === "none").length / closed.length) * 100),  color: "var(--color-info)" },
  ] : [
    { name: "Long",        value: 0, color: "var(--color-bull)" },
    { name: "Short",       value: 0, color: "var(--color-bear)" },
    { name: "Neutral",     value: 0, color: "var(--color-purple)" },
    { name: "No Trade",    value: 0, color: "var(--color-info)" },
  ];

  const avgRRValue = closed.length ? (closed.reduce((s,t) => s + (t.confidence ?? t.boardroom_confidence ?? 2), 0) / closed.length).toFixed(1) : "2.4";
  const dynamicRiskRows = [
    { metric: "Risk / Reward Ratio", value: `1 : ${avgRRValue}` },
    { metric: "Avg Risk per Trade",  value: `${(feePct || 0.63).toFixed(2)}%` },
    { metric: "Largest Risk",        value: `${((feePct || 0.63) * 1.5).toFixed(2)}%` },
    { metric: "Kelly Optimal",       value: `${Math.round(winRate / 10)}.%` },
    { metric: "Actual Risk",         value: `${(feePct || 1.03).toFixed(2)}%` },
  ];

  const dynamicInsights = dna?.report?.insights && dna.report.insights.length > 0 ? dna.report.insights.slice(0, 5).map((ins, i) => ({
    icon: i === 0 ? "↑" : i === 1 ? "↓" : i === 2 ? "🎯" : i === 3 ? "↓" : "⭐",
    label: ins.title,
    title: ins.stat,
    stat1: ins.explanation,
    stat2: ins.suggested_rule,
    color: i % 2 === 0 ? "var(--color-bull)" : i === 1 ? "var(--color-bear)" : i === 2 ? "var(--color-purple)" : "var(--color-info)",
    bg: i % 2 === 0 ? "rgba(38,208,124,0.08)" : i === 1 ? "rgba(255,77,106,0.08)" : i === 2 ? "rgba(157,143,255,0.08)" : "rgba(77,166,255,0.08)"
  })) : [
    { icon: "⭐", label: "No Insights Yet", title: "Keep trading", stat1: "AI needs more data", stat2: "", color: "var(--color-info)", bg: "rgba(77,166,255,0.08)" }
  ];

  return (
    <div className="flex flex-col gap-4" suppressHydrationWarning>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <TrendingUp size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>PERFORMANCE</h1>
            <p className="hidden sm:block" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Deep analytics on your trading performance</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-lg p-1 overflow-x-auto" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
            {PERIODS.map((p) => (
              <button key={p} type="button" onClick={() => setPeriod(p)}
                className="rounded-md px-3 py-1.5 font-semibold transition-all shrink-0"
                style={{ fontSize: "var(--text-xs)", background: period === p ? "var(--accent-primary)" : "transparent", color: period === p ? "#fff" : "var(--text-secondary)" }}>
                {p}
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost flex items-center gap-1.5"><Download size={12} /> <span className="hidden sm:inline">Export Report</span></button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: "Total P&L",      value: pnlStr,                sub: "-14.1% max dd",  color: pnlColor },
          { label: "Win Rate",       value: `${winRate.toFixed(1)}%`, sub: "11L / 14W",   color: winRate >= 50 ? "var(--color-bull)" : "var(--color-bear)" },
          { label: "Profit Factor",  value: profitFactor.toFixed(2), sub: "Gross P/L ÷ Loss", color: "var(--text-primary)" },
          { label: "Expectancy",     value: `+${expectancy.toFixed(2)}R`, sub: "Per trade avg", color: "var(--color-bull)" },
          { label: "Sharpe Ratio",   value: sharpe.toFixed(2),     sub: "Risk-adjusted",  color: "var(--text-primary)" },
          { label: "Total Trades",   value: totalTrades,            sub: `${closed.length} closed`, color: "var(--text-primary)" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "var(--space-3)" }}>
            <div className="section-label mb-1">{s.label}</div>
            <div className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Equity curve + stats block + AI Edge Score */}
      <div className="grid grid-cols-1 md:grid-cols-[3fr_1fr_1fr] gap-4">
        {/* Equity curve */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="section-label">Equity Curve</span>
            <button type="button" className="btn-ghost" style={{ padding: "3px 10px", fontSize: "var(--text-xs)" }}>Cumulative P&L ▼</button>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={equityCurve} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <defs>
                <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#26d07c" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#26d07c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [`${v}%`, "P&L"]} />
              <Area type="monotone" dataKey="value" stroke="#26d07c" strokeWidth={2} fill="url(#perfGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Stats block */}
        <div className="card">
          <div className="section-label mb-3">Trade Statistics</div>
          <div className="flex flex-col gap-3">
            {[
              { label: "Avg Winner",    value: "+2.4R",   color: "var(--color-bull)" },
              { label: "Avg Loser",     value: "-1.0R",   color: "var(--color-bear)" },
              { label: "Max Drawdown",  value: "-4.7%",   color: "var(--color-bear)" },
              { label: "Best Day",      value: "+₹1,430", color: "var(--color-bull)" },
              { label: "Worst Day",     value: "-₹2,180", color: "var(--color-bear)" },
            ].map((s) => (
              <div key={s.label} className="flex justify-between items-center">
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{s.label}</span>
                <span className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI Edge Score gauge */}
        <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div className="section-label">AI Edge Score</div>
          <div className="relative" style={{ width: 140, height: 75 }}>
            <svg width="140" height="75" viewBox="0 0 140 75">
              <path d="M 10 70 A 60 60 0 0 1 130 70" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" strokeLinecap="round" />
              <path d="M 10 70 A 60 60 0 0 1 130 70" fill="none" stroke="url(#edgeGrad)" strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${(aiEdgeScore / 100) * 188} 188`} />
              <defs>
                <linearGradient id="edgeGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#ff4d6a" />
                  <stop offset="50%" stopColor="#f0b429" />
                  <stop offset="100%" stopColor="#26d07c" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center" style={{ paddingTop: 28 }}>
              <span className="font-mono font-bold" style={{ fontSize: "var(--text-3xl)", color: "var(--text-primary)" }}>{aiEdgeScore}</span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>/100</span>
            </div>
          </div>
          <div className="text-center">
            <div className="font-semibold" style={{ fontSize: "var(--text-sm)" }}>
              Your edge is <span style={{ color: "var(--color-bull)" }}>{aiEdgeScore >= 70 ? "Strong" : aiEdgeScore >= 50 ? "Developing" : "Early"}</span>
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 4 }}>Keep following your rules.</div>
          </div>
        </div>
      </div>

      {/* Trade Distribution + Risk Metrics + Monthly P&L */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Trade Distribution */}
        <div className="card">
          <div className="section-label mb-3">Trade Distribution</div>
          <div className="flex items-center gap-4">
            <PieChart width={110} height={110}>
              <Pie data={dynamicTradeDist} cx={55} cy={55} innerRadius={32} outerRadius={50} dataKey="value" stroke="none" paddingAngle={2}>
                {dynamicTradeDist.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
            </PieChart>
            <div className="flex flex-col gap-2 flex-1">
              {dynamicTradeDist.map((d) => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{d.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{Math.round(d.value * totalTrades / 100)}</span>
                    <span className="font-mono font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>{d.value}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Risk Metrics */}
        <div className="card">
          <div className="section-label mb-3">Risk Metrics</div>
          <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
            <tbody>
              {dynamicRiskRows.map((r) => (
                <tr key={r.metric} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td className="py-2 pr-4" style={{ color: "var(--text-secondary)" }}>{r.metric}</td>
                  <td className="py-2 font-mono font-bold text-right" style={{ color: "var(--text-primary)" }}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {/* Monthly P&L */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="section-label">Monthly Performance</span>
            <button type="button" className="btn-ghost" style={{ padding: "3px 10px", fontSize: "var(--text-xs)" }}>P&L % ▼</button>
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [`${v}%`, "P&L"]} />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {monthlyData.map((e: any, i: number) => <Cell key={i} fill={e.pnl >= 0 ? "var(--color-bull)" : "var(--color-bear)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Performance Insights strip */}
      <div className="flex flex-col sm:flex-row gap-3">
        {dynamicInsights.map((ins, i) => (
          <div key={i} className="flex-1 rounded-xl p-4" style={{ background: ins.bg, border: `1px solid ${ins.color}30` }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ background: ins.color + "20", fontSize: 14 }}>
                {ins.icon}
              </div>
              <span style={{ fontSize: "var(--text-xs)", color: ins.color, fontWeight: 700 }}>{ins.label}</span>
            </div>
            <div className="font-semibold mb-1" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{ins.title}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: "2px" }}>{ins.stat1}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{ins.stat2}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
