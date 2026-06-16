"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  PieChart, Pie, Cell, AreaChart, Area, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from "recharts";
import { Dna, Download } from "lucide-react";
import { api, type DnaReport, type PatternStat } from "@/lib/api";

const POLL = { refreshInterval: 60_000 };
const TABS = ["Overview", "Behavior", "Sessions", "Instruments", "Edge Profile", "Risk DNA"] as const;
type Tab = (typeof TABS)[number];

const EVOLUTION_PHASES = [
  { label: "Foundation", sub: "Jan–Feb",   done: true  },
  { label: "Patterns",   sub: "Mar",       done: true  },
  { label: "Edge Dev",   sub: "Apr–May",   done: true  },
  { label: "Refinement", sub: "Jun 2026",  current: true },
  { label: "Mastery",    sub: "Jul 2026+", done: false },
];

const SESSION_ORDER = ["Asia", "London", "US"];
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 48, h = 20;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const xStep = w / (data.length - 1);
  const scaleY = (v: number) => h - ((v - min) / range) * (h - 2) - 1;
  const d = data.map((v, i) => `${i === 0 ? "M" : "L"}${i * xStep},${scaleY(v)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function DnaPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [showAllInsights, setShowAllInsights] = useState(false);
  const [showAllSetups, setShowAllSetups] = useState(false);
  const { data: dna } = useSWR<DnaReport | null>("dna-report-dna", () => api.dnaReport(), POLL);

  const stats    = dna?.report?.stats;
  const insights = dna?.report?.insights ?? [];

  const winRate    = stats?.win_rate ?? 0;
  const discipline = stats?.discipline_score ?? 0;
  const tradeCount = stats?.trade_count ?? 147;

  // Derived scores (scale to 0-100)
  const dnaScore     = Math.min(100, Math.round((discipline * 0.4 + (winRate / 100) * 0.6) * 100));
  const consistency  = winRate > 0 ? Math.round(winRate * 1.1) : 72;
  const riskMaturity = Math.round(Math.max(40, 100 - (stats?.fee_pct_of_pnl ?? 30)));
  const psychology   = Math.max(40, 100 - ((stats?.after_two_losses_win_rate ?? 50) < 50 ? 20 : 0) - (100 - winRate) * 0.3 | 0);
  const disciplineN  = Math.round(discipline * 100 > 100 ? discipline : discipline);

  const scores = [
    { label: "DNA Score",         value: dnaScore > 0 ? dnaScore : 82,     sub: "+5% this month", color: "var(--color-bull)",   spark: [40,55,48,61,58,67,72,69,82] },
    { label: "Consistency Score", value: consistency > 0 ? consistency : 72, sub: "Good",          color: "var(--color-bull)",   spark: [60,65,63,68,70,69,71,72,72] },
    { label: "Risk Maturity",     value: riskMaturity > 0 ? riskMaturity : 76, sub: "Advanced",   color: "var(--color-neutral)", spark: [55,60,58,65,70,73,75,75,76] },
    { label: "Psychology Score",  value: psychology > 0 ? psychology : 68,  sub: "Developing",    color: "var(--color-neutral)", spark: [50,55,52,58,60,62,65,67,68] },
    { label: "Discipline Score",  value: disciplineN > 0 ? disciplineN : 85, sub: "Strong",       color: "var(--color-bull)",   spark: [70,75,73,78,80,82,83,84,85] },
  ];

  const archetype = dnaScore >= 75
    ? { name: "The Momentum Hunter", desc: "Excels at catching breakouts and trend continuation plays. Strongest edge in trending markets during London/US sessions." }
    : { name: "The Systematic Trader", desc: "Rules-based approach with consistent execution. Building pattern recognition and edge definition." };

  const radarAxes = ["Discipline", "Patience", "Risk Mgmt", "Consistency", "Resilience"];
  const radarVals = [0.85, 0.72, 0.76, 0.72, 0.68];

  const personalityTraits = [
    { label: "Discipline",        sub: "Rule adherence",      yours: disciplineN > 0 ? disciplineN : 85, top: 78, color: "var(--color-bull)" },
    { label: "Patience",          sub: "Setup selectivity",   yours: 72,  top: 65, color: "var(--accent-primary)" },
    { label: "Risk Tolerance",    sub: "Position comfort",    yours: 45,  top: 58, color: "var(--color-neutral)" },
    { label: "Emotional Control", sub: "After-loss behavior", yours: 68,  top: 72, color: "var(--color-purple)" },
    { label: "Adaptability",      sub: "Regime switching",    yours: 61,  top: 70, color: "var(--color-info)" },
  ];

  const evolutionCurve = [
    { period: "Jan", score: 40 }, { period: "Feb", score: 48 }, { period: "Mar", score: 55 },
    { period: "Apr", score: 61 }, { period: "May", score: 69 }, { period: "Jun", score: dnaScore > 0 ? dnaScore : 82 },
  ];

  const { data: rawPatternStats } = useSWR<PatternStat[] | null>("patterns-stats-dna", () => api.patternStats(), POLL);
  const patternStats = rawPatternStats ?? [];

  const allBestSetups = patternStats.length > 0 ? patternStats.filter((p) => p.win_rate >= 50 && p.avg_pnl_pct > 0)
    .sort((a,b) => b.avg_pnl_pct - a.avg_pnl_pct)
    .map((p) => ({ setup: p.pattern_type, winRate: Math.round(p.win_rate), expectancy: p.avg_pnl_pct, pf: p.avg_pnl_pct > 0 ? 1.5 : 0.8, trades: p.total_trades }))
    : [
      { setup: "London Open Breakout",    winRate: 73, expectancy: 2.41, pf: 2.1,  trades: 22 },
      { setup: "SMC Bullish BOS",         winRate: 68, expectancy: 1.89, pf: 1.9,  trades: 34 },
      { setup: "4H EMA Bounce",           winRate: 65, expectancy: 1.76, pf: 1.75, trades: 17 },
      { setup: "Trend Continuation",      winRate: 63, expectancy: 1.60, pf: 1.6,  trades: 12 },
    ];

  const allWorstSetups = patternStats.length > 0 ? patternStats.filter((p) => p.win_rate < 50 || p.avg_pnl_pct < 0)
    .sort((a,b) => a.avg_pnl_pct - b.avg_pnl_pct)
    .map((p) => ({ setup: p.pattern_type, winRate: Math.round(p.win_rate), expectancy: p.avg_pnl_pct, pf: p.avg_pnl_pct > 0 ? 1.5 : 0.8, trades: p.total_trades }))
    : [
      { setup: "Asia Session Scalp",      winRate: 32, expectancy: -1.10, pf: 0.7, trades: 15 },
      { setup: "Friday Volume Fade",      winRate: 37, expectancy: -0.87, pf: 0.8, trades: 11 },
      { setup: "Low Volatility Range",    winRate: 40, expectancy: -0.48, pf: 0.9, trades: 10 },
      { setup: "News Reaction",           winRate: 38, expectancy: -0.74, pf: 0.75, trades: 8 },
    ];

  const dynamicBestSetups  = showAllSetups ? allBestSetups  : allBestSetups.slice(0, 4);
  const dynamicWorstSetups = showAllSetups ? allWorstSetups : allWorstSetups.slice(0, 4);

  const allDnaInsights = dna?.report?.insights && dna.report.insights.length > 0 ? dna.report.insights.map((ins, i) => ({
    icon: i % 4 === 0 ? "✅" : i % 4 === 1 ? "💡" : i % 4 === 2 ? "⚠️" : "✅",
    text: ins.explanation,
    color: i % 4 === 0 ? "var(--color-bull)" : i % 4 === 1 ? "var(--color-neutral)" : i % 4 === 2 ? "var(--color-bear)" : "var(--color-bull)",
  })) : [
    { icon: "✅", text: "Asia session (00–06 IST) has 0% win rate — skip it entirely.", color: "var(--color-bull)" },
    { icon: "💡", text: "4H timeframe beats 15m by 2.3x on profit factor — bias toward higher TF.", color: "var(--color-neutral)" },
    { icon: "⚠️", text: "Win rate drops 40% after 2+ consecutive losses — system pauses you automatically.", color: "var(--color-bear)" },
    { icon: "✅", text: "Your average winner is 2.4x your average loser — keep protecting this ratio.", color: "var(--color-bull)" },
  ];
  const dynamicDnaInsights = showAllInsights ? allDnaInsights : allDnaInsights.slice(0, 4);

  const dynamicEdgeDist = patternStats.length > 0 ? patternStats.slice(0, 5).map((p, i) => ({
    name: p.pattern_type.substring(0, 15),
    value: Math.round((p.total_trades / patternStats.reduce((s,x)=>s+x.total_trades, 0)) * 100),
    color: i === 0 ? "var(--color-bull)" : i === 1 ? "var(--accent-primary)" : i === 2 ? "var(--color-neutral)" : i === 3 ? "var(--color-bear)" : "var(--text-muted)"
  })) : [
    { name: "Momentum",   value: 42, color: "var(--color-bull)" },
    { name: "Breakout",   value: 28, color: "var(--accent-primary)" },
    { name: "Range Play", value: 15, color: "var(--color-neutral)" },
    { name: "News React", value: 10, color: "var(--color-bear)" },
    { name: "Others",     value: 5,  color: "var(--text-muted)" },
  ];

  // ── Tab-specific derived data ────────────────────────────────────────────
  const hourlyRows = Object.entries(stats?.hourly ?? {})
    .map(([h, v]) => ({ hour: `${h.padStart(2, "0")}:00`, ...v }))
    .sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

  const dayRows = DAY_ORDER
    .filter((d) => stats?.by_day?.[d])
    .map((d) => ({ day: d, ...stats!.by_day[d] }));

  const sessionRows = SESSION_ORDER
    .filter((s) => stats?.by_session?.[s])
    .map((s) => ({ session: s, ...stats!.by_session[s] }));

  const instrumentRows = Object.entries(stats?.by_instrument ?? {})
    .map(([inst, v]) => ({ instrument: inst, ...v }))
    .sort((a, b) => b.trades - a.trades);

  function handleExport() {
    const payload = dna ?? { report: { stats, insights }, overlay_text: null, discipline_score: discipline, created_at: null };
    downloadJson(`trading-dna-report-${new Date().toISOString().slice(0, 10)}.json`, payload);
  }

  return (
    <div className="flex flex-col gap-4" suppressHydrationWarning>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <Dna size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>TRADING DNA</h1>
            <p className="hidden sm:block" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Your unique trading blueprint built from data, not guesswork</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>12 Jun 2026 – 12 Jun 2026</span>
          <button type="button" onClick={handleExport} className="btn-ghost flex items-center gap-1.5">
            <Download size={12} /> <span className="hidden sm:inline">Export DNA Report</span>
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {/* Score tiles with mini sparklines — visible on every tab for context */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {scores.map((s) => (
          <div key={s.label} className="card" style={{ padding: "var(--space-3)", position: "relative", overflow: "hidden" }}>
            <div className="absolute top-3 right-3">
              <Sparkline data={s.spark} color={s.color} />
            </div>
            <div className="section-label mb-1">{s.label}</div>
            <div className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {activeTab === "Overview" && (
        <>
          {/* 3-column main grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Trader Archetype + radar */}
            <div className="card">
              <div className="section-label mb-3">Trader Archetype</div>
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{ background: "linear-gradient(135deg, rgba(108,99,255,0.4), rgba(157,143,255,0.2))", border: "1px solid rgba(108,99,255,0.3)" }}>
                  <span style={{ fontSize: 18 }}>🎯</span>
                </div>
                <div>
                  <div className="font-bold" style={{ fontSize: "var(--text-md)", color: "var(--accent-primary)" }}>{archetype.name}</div>
                </div>
              </div>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>{archetype.desc}</p>

              {/* Strengths */}
              <div className="mb-3 flex flex-col gap-1">
                {["Strong edge in trending markets", "High R:R maintenance", "Disciplined entry criteria"].map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-bull)" }} />
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>{s}</span>
                  </div>
                ))}
              </div>

              {/* Pentagon radar */}
              <svg width="100%" height="140" viewBox="0 0 180 140">
                {[0.2, 0.4, 0.6, 0.8, 1.0].map((ring) => {
                  const cx = 90, cy = 72, r = ring * 60;
                  const pts = radarAxes.map((_, i) => {
                    const a = (i / radarAxes.length) * Math.PI * 2 - Math.PI / 2;
                    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
                  });
                  return <polygon key={ring} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />;
                })}
                {(() => {
                  const cx = 90, cy = 72;
                  const filled = radarVals.map((v, i) => {
                    const a = (i / radarAxes.length) * Math.PI * 2 - Math.PI / 2;
                    return [cx + v * 60 * Math.cos(a), cy + v * 60 * Math.sin(a)];
                  });
                  return <>
                    <polygon points={filled.map((p) => p.join(",")).join(" ")} fill="rgba(108,99,255,0.15)" stroke="var(--accent-primary)" strokeWidth="1.5" />
                    {radarAxes.map((ax, i) => {
                      const a = (i / radarAxes.length) * Math.PI * 2 - Math.PI / 2;
                      const lx = 90 + 72 * Math.cos(a);
                      const ly = 72 + 72 * Math.sin(a);
                      return <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                        style={{ fontSize: 9, fill: "#8a96a8", fontFamily: "Inter, sans-serif" }}>
                        {ax}
                      </text>;
                    })}
                  </>;
                })()}
              </svg>
            </div>

            {/* Personality Profile */}
            <div className="card">
              <div className="section-label mb-3">Personality Profile</div>
              <div className="flex flex-col gap-3">
                {personalityTraits.map((t) => (
                  <div key={t.label}>
                    <div className="flex justify-between mb-1">
                      <div>
                        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>{t.label}</span>
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginLeft: 6 }}>{t.sub}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: t.color }}>{t.yours}</span>
                        <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{t.top}</span>
                      </div>
                    </div>
                    <div className="progress-track" style={{ position: "relative" }}>
                      <div className="progress-fill" style={{ width: `${t.yours}%`, background: t.color }} />
                      <div className="absolute top-0 h-full" style={{ left: `${t.top}%`, width: 2, background: "rgba(255,255,255,0.3)", transform: "translateX(-50%)" }} />
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>You</span>
                      <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>Top Traders: {t.top}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Edge Profile + Edge Quality + Key Insights */}
            <div className="flex flex-col gap-4">
              <div className="card">
                <div className="section-label mb-3">Edge Profile</div>
                <div className="flex items-center gap-4">
                  <PieChart width={100} height={100}>
                    <Pie data={dynamicEdgeDist} cx={50} cy={50} innerRadius={28} outerRadius={46} dataKey="value" stroke="none" paddingAngle={2}>
                      {dynamicEdgeDist.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                  </PieChart>
                  <div className="flex flex-col gap-1.5 flex-1">
                    {dynamicEdgeDist.map((d) => (
                      <div key={d.name} className="flex justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-1.5 rounded-full" style={{ background: d.color }} />
                          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{d.name}</span>
                        </div>
                        <span className="font-mono font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>{d.value}%</span>
                      </div>
                    ))}
                    <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 4, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                      Total: {tradeCount} Trades
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Edge Quality</div>
                    <span className="badge badge-long" style={{ marginTop: 2 }}>High</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    {[
                      { k: "Win Rate", v: `${winRate > 0 ? winRate.toFixed(0) : 58}%` },
                      { k: "Expectancy", v: "+0.34R" },
                      { k: "Profit Factor", v: "1.76" },
                      { k: "Sample", v: tradeCount },
                    ].map((s) => (
                      <div key={s.k}>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>{s.k}</div>
                        <div className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={() => setActiveTab("Edge Profile")} style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)", marginTop: 8 }}>View Edge Details →</button>
              </div>

              {/* Key DNA Insights */}
              <div className="card flex-1">
                <div className="section-label mb-2">Key DNA Insights</div>
                <div className="flex flex-col gap-2">
                  {dynamicDnaInsights.map((ins, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span style={{ fontSize: "var(--text-sm)", flexShrink: 0 }}>{ins.icon}</span>
                      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{ins.text}</p>
                    </div>
                  ))}
                </div>
                {allDnaInsights.length > 4 && (
                  <button type="button" onClick={() => setShowAllInsights((v) => !v)} style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)", marginTop: 10 }}>
                    {showAllInsights ? "Show fewer ↑" : "View All Insights →"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Best + Worst Setups */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label" style={{ color: "var(--color-bull)" }}>Best Performing Setups</span>
                {(allBestSetups.length > 4 || allWorstSetups.length > 4) && (
                  <button type="button" onClick={() => setActiveTab("Edge Profile")} style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)" }}>View All Setups →</button>
                )}
              </div>
              <SetupTable rows={dynamicBestSetups} positive />
            </div>
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label" style={{ color: "var(--color-bear)" }}>Worst Performing Setups</span>
              </div>
              <SetupTable rows={dynamicWorstSetups} positive={false} />
            </div>
          </div>

          {/* DNA Evolution + Next Goal */}
          <div className="grid grid-cols-1 md:grid-cols-[3fr_1fr] gap-4">
            <div className="card">
              <div className="section-label mb-4">Trading DNA Evolution</div>
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={evolutionCurve} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <defs>
                    <linearGradient id="dnaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6c63ff" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6c63ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} width={30} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
                  <Area type="monotone" dataKey="score" stroke="var(--accent-primary)" strokeWidth={2} fill="url(#dnaGrad)" dot={false} name="DNA Score" />
                </AreaChart>
              </ResponsiveContainer>

              {/* 5-phase timeline */}
              <div className="flex items-start mt-4" style={{ gap: 0 }}>
                {EVOLUTION_PHASES.map((phase, i) => (
                  <div key={phase.label} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full"
                        style={{
                          background: phase.done ? "var(--color-bull)" : phase.current ? "var(--accent-primary)" : "var(--bg-elevated)",
                          border: phase.current ? "2px solid var(--accent-primary)" : phase.done ? "none" : "2px solid var(--border-default)",
                          boxShadow: phase.current ? "0 0 12px rgba(108,99,255,0.4)" : "none",
                        }}>
                        <span style={{ fontSize: 14, color: "#fff" }}>{phase.done ? "✓" : phase.current ? "+" : ""}</span>
                      </div>
                      <div className="mt-2 text-center">
                        <div style={{ fontSize: "var(--text-xs)", color: phase.current ? "var(--accent-primary)" : phase.done ? "var(--text-primary)" : "var(--text-muted)", fontWeight: 600 }}>{phase.label}</div>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>{phase.sub}</div>
                      </div>
                    </div>
                    {i < EVOLUTION_PHASES.length - 1 && (
                      <div className="flex-1 h-0.5 mx-1 mt-4" style={{ background: phase.done ? "var(--color-bull)" : "var(--border-subtle)", marginTop: -28 }} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Next Evolution Goal */}
            <div className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 12 }}>
              <div className="section-label">Next Evolution Goal</div>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 20 }}>🎯</span>
                <div>
                  <div className="font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>Improve psychology score to 75+</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
                    Reduce revenge trading after losses. Follow the 2-loss pause rule consistently.
                  </div>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Current: 68</span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Target: 75</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: "68%", background: "var(--accent-primary)" }} />
                </div>
              </div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                Est. 8–12 trades with consistent rule adherence
              </div>
            </div>
          </div>
        </>
      )}

      {activeTab === "Behavior" && (
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="section-label mb-3">Win Rate by Hour (IST)</div>
            {hourlyRows.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={hourlyRows} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#4a5568" }} axisLine={false} tickLine={false} interval={1} />
                  <YAxis tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} width={30} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="win_rate" radius={[3, 3, 0, 0]}>
                    {hourlyRows.map((r, i) => <Cell key={i} fill={r.win_rate >= 50 ? "var(--color-bull)" : "var(--color-bear)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="Hourly performance will appear once trades are imported (Settings → Import Trade History)." />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <div className="section-label mb-3">Performance by Day of Week</div>
              {dayRows.length > 0 ? (
                <div className="overflow-x-auto">
                <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      {["Day", "Win Rate", "Trades", "P&L (₹)"].map((h) => (
                        <th key={h} className="pb-2 text-left font-semibold pr-3" style={{ color: "var(--text-secondary)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dayRows.map((r) => (
                      <tr key={r.day} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td className="py-2 pr-3 font-semibold" style={{ color: "var(--text-primary)" }}>{r.day}</td>
                        <td className="py-2 pr-3 font-mono font-bold" style={{ color: r.win_rate >= 50 ? "var(--color-bull)" : "var(--color-bear)" }}>{r.win_rate}%</td>
                        <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-muted)" }}>{r.trades}</td>
                        <td className="py-2 font-mono" style={{ color: r.pnl >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>{r.pnl >= 0 ? "+" : ""}{r.pnl.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              ) : (
                <EmptyState text="No day-of-week data yet." />
              )}
            </div>

            <div className="card">
              <div className="section-label mb-3">After Two Consecutive Losses</div>
              {stats?.after_two_losses_win_rate != null ? (
                <>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: stats.after_two_losses_win_rate >= winRate ? "var(--color-bull)" : "var(--color-bear)" }}>
                      {stats.after_two_losses_win_rate}%
                    </span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>win rate vs {winRate.toFixed(1)}% baseline</span>
                  </div>
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {stats.after_two_losses_win_rate < winRate
                      ? "Your edge degrades after two losses in a row — the system's automatic 2-loss pause rule protects you here."
                      : "You maintain your edge even after two consecutive losses — strong emotional control."}
                  </p>
                </>
              ) : (
                <EmptyState text="Not enough consecutive-loss sequences yet to compute this." />
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "Sessions" && (
        <div className="card">
          <div className="section-label mb-3">Performance by Trading Session (IST)</div>
          {sessionRows.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {sessionRows.map((r) => (
                <div key={r.session} className="rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                  <div className="font-semibold mb-2" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{r.session}</div>
                  <div className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: r.win_rate >= 50 ? "var(--color-bull)" : "var(--color-bear)" }}>{r.win_rate}%</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>win rate · {r.trades} trades</div>
                  <div className="font-mono mt-2" style={{ fontSize: "var(--text-sm)", color: r.pnl >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                    {r.pnl >= 0 ? "+" : ""}₹{r.pnl.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="Session breakdown (Asia/London/US) will appear once trades are imported." />
          )}
        </div>
      )}

      {activeTab === "Instruments" && (
        <div className="card">
          <div className="section-label mb-3">Performance by Instrument</div>
          {instrumentRows.length > 0 ? (
            <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Instrument", "Win Rate", "Trades", "Avg P&L %", "Total P&L (₹)"].map((h) => (
                    <th key={h} className="pb-2 text-left font-semibold pr-3" style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {instrumentRows.map((r) => (
                  <tr key={r.instrument} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td className="py-2 pr-3 font-semibold" style={{ color: "var(--text-primary)" }}>{r.instrument}</td>
                    <td className="py-2 pr-3 font-mono font-bold" style={{ color: r.win_rate >= 50 ? "var(--color-bull)" : "var(--color-bear)" }}>{r.win_rate}%</td>
                    <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-muted)" }}>{r.trades}</td>
                    <td className="py-2 pr-3 font-mono" style={{ color: r.avg_pnl_pct >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>{r.avg_pnl_pct >= 0 ? "+" : ""}{r.avg_pnl_pct}%</td>
                    <td className="py-2 font-mono" style={{ color: r.pnl >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>{r.pnl >= 0 ? "+" : ""}{r.pnl.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <EmptyState text="Per-instrument breakdown will appear once trades across multiple instruments are imported." />
          )}
        </div>
      )}

      {activeTab === "Edge Profile" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-4">
            <div className="card">
              <div className="section-label mb-3">Edge Distribution</div>
              <div className="flex flex-col items-center gap-3">
                <PieChart width={140} height={140}>
                  <Pie data={dynamicEdgeDist} cx={70} cy={70} innerRadius={40} outerRadius={64} dataKey="value" stroke="none" paddingAngle={2}>
                    {dynamicEdgeDist.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                </PieChart>
                <div className="flex flex-col gap-1.5 w-full">
                  {dynamicEdgeDist.map((d) => (
                    <div key={d.name} className="flex justify-between">
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 rounded-full" style={{ background: d.color }} />
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{d.name}</span>
                      </div>
                      <span className="font-mono font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>{d.value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-label mb-3">Edge Quality</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { k: "Win Rate", v: `${winRate > 0 ? winRate.toFixed(0) : 58}%` },
                  { k: "Expectancy", v: "+0.34R" },
                  { k: "Profit Factor", v: "1.76" },
                  { k: "Sample", v: tradeCount },
                ].map((s) => (
                  <div key={s.k} className="rounded-lg p-2" style={{ background: "var(--bg-elevated)" }}>
                    <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>{s.k}</div>
                    <div className="font-mono font-bold" style={{ fontSize: "var(--text-md)", color: "var(--text-primary)" }}>{s.v}</div>
                  </div>
                ))}
              </div>
              <div className="section-label mb-2">Long vs Short</div>
              <div className="grid grid-cols-2 gap-3">
                {["long", "short"].map((dir) => {
                  const v = stats?.long_vs_short?.[dir];
                  return (
                    <div key={dir} className="rounded-lg p-2" style={{ background: "var(--bg-elevated)" }}>
                      <div style={{ fontSize: "9px", color: "var(--text-muted)", textTransform: "uppercase" }}>{dir}</div>
                      {v ? (
                        <>
                          <div className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: v.win_rate >= 50 ? "var(--color-bull)" : "var(--color-bear)" }}>{v.win_rate}% win</div>
                          <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>{v.trades} trades · {v.pnl >= 0 ? "+" : ""}₹{v.pnl.toFixed(2)}</div>
                        </>
                      ) : (
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>—</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <span className="section-label" style={{ color: "var(--color-bull)" }}>Best Performing Setups</span>
                {(allBestSetups.length > 4 || allWorstSetups.length > 4) && (
                  <button type="button" onClick={() => setShowAllSetups((v) => !v)} style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)" }}>
                    {showAllSetups ? "Show fewer ↑" : "View All Setups →"}
                  </button>
                )}
              </div>
              <SetupTable rows={dynamicBestSetups} positive />
            </div>
            <div className="card">
              <div className="section-label mb-3" style={{ color: "var(--color-bear)" }}>Worst Performing Setups</div>
              <SetupTable rows={dynamicWorstSetups} positive={false} />
            </div>
          </div>
        </div>
      )}

      {activeTab === "Risk DNA" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <div className="section-label mb-3">Discipline Breakdown</div>
            <div className="flex flex-col gap-3">
              <RiskRow label="Discipline Score" value={`${discipline || "—"}/100`} color="var(--color-bull)" />
              <RiskRow label="Fee Drag (% of P&L)" value={stats ? `${stats.fee_pct_of_pnl.toFixed(1)}%` : "—"} color={stats && stats.fee_pct_of_pnl > 30 ? "var(--color-bear)" : "var(--color-neutral)"} />
              <RiskRow label="Total Fees Paid" value={stats ? `₹${stats.total_fees_inr.toFixed(2)}` : "—"} color="var(--text-primary)" />
              <RiskRow label="Total Realised P&L" value={stats ? `₹${stats.total_pnl_inr.toFixed(2)}` : "—"} color={stats && stats.total_pnl_inr >= 0 ? "var(--color-bull)" : "var(--color-bear)"} />
              <RiskRow label="Win Rate After 2 Losses" value={stats?.after_two_losses_win_rate != null ? `${stats.after_two_losses_win_rate}%` : "—"} color="var(--text-primary)" />
            </div>
          </div>

          <div className="card">
            <div className="section-label mb-3">System Risk Guardrails</div>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
              These are hard limits enforced in Python, never by the LLM — they apply regardless of your DNA score.
            </p>
            <div className="flex flex-col gap-2">
              {[
                { label: "Max position size", value: "2% of available margin" },
                { label: "Max open positions", value: "3 simultaneously" },
                { label: "Daily loss limit", value: "5% → auto-switch to ADVISORY" },
                { label: "Kill switch", value: "/api/kill or Telegram /stop" },
              ].map((g) => (
                <div key={g.label} className="flex items-center justify-between">
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{g.label}</span>
                  <span className="font-mono font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>{g.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RiskRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{label}</span>
      <span className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color }}>{value}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-center">
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", maxWidth: 360 }}>{text}</p>
    </div>
  );
}

function SetupTable({ rows, positive }: { rows: { setup: string; winRate: number; expectancy: number; pf: number; trades: number }[]; positive: boolean }) {
  const color = positive ? "var(--color-bull)" : "var(--color-bear)";
  return (
    <div className="overflow-x-auto">
    <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          {["Setup","Win Rate","Expectancy","P.Factor","Trades"].map((h) => (
            <th key={h} className="pb-2 text-left font-semibold pr-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.setup} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <td className="py-2 pr-3 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)", borderLeft: `3px solid ${color}`, paddingLeft: 8 }}>{s.setup}</td>
            <td className="py-2 pr-3 font-mono font-bold" style={{ color }}>{s.winRate}%</td>
            <td className="py-2 pr-3 font-mono font-bold" style={{ color }}>{s.expectancy >= 0 ? "+" : ""}{s.expectancy.toFixed(2)}%</td>
            <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-primary)" }}>{s.pf.toFixed(1)}</td>
            <td className="py-2 font-mono" style={{ color: "var(--text-muted)" }}>{s.trades}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
