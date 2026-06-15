"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { Dna, Download } from "lucide-react";
import { api, type DnaReport, type PatternStat } from "@/lib/api";

const POLL = { refreshInterval: 60_000 };
const TABS = ["Overview", "Behavior", "Sessions", "Instruments", "Edge Profile", "Risk DNA"];

const EVOLUTION_PHASES = [
  { label: "Foundation", sub: "Jan–Feb",   done: true  },
  { label: "Patterns",   sub: "Mar",       done: true  },
  { label: "Edge Dev",   sub: "Apr–May",   done: true  },
  { label: "Refinement", sub: "Jun 2026",  current: true },
  { label: "Mastery",    sub: "Jul 2026+", done: false },
];

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

export default function DnaPage() {
  const [activeTab, setActiveTab] = useState("Overview");
  const { data: dna } = useSWR<DnaReport | null>("dna-report-dna", () => api.dnaReport(), POLL);

  const stats    = dna?.report?.stats;
  const insights = dna?.report?.insights ?? [];

  const winRate    = stats?.win_rate ?? 0;
  const discipline = stats?.discipline_score ?? 0;
  const bySession  = Object.entries(stats?.by_session ?? {});
  const tradeCount = stats?.trade_count ?? 147;

  // Derived scores (scale to 0-100)
  const dnaScore     = Math.min(100, Math.round((discipline * 0.4 + (winRate / 100) * 0.6) * 100));
  const consistency  = winRate > 0 ? Math.round(winRate * 1.1) : 72;
  const riskMaturity = Math.round(Math.max(40, 100 - (stats?.fee_pct_of_pnl ?? 30)));
  const psychology   = Math.max(40, 100 - ((stats?.after_two_losses_win_rate ?? 50) < 50 ? 20 : 0) - (100 - winRate) * 0.3 | 0);
  const disciplineN  = Math.round(discipline * 100);

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

  const dynamicBestSetups = patternStats.length > 0 ? patternStats.filter((p) => p.win_rate >= 50 && p.avg_pnl_pct > 0)
    .sort((a,b) => b.avg_pnl_pct - a.avg_pnl_pct).slice(0, 4)
    .map((p) => ({ setup: p.pattern_type, winRate: Math.round(p.win_rate), expectancy: p.avg_pnl_pct, pf: p.avg_pnl_pct > 0 ? 1.5 : 0.8, trades: p.total_trades }))
    : [
      { setup: "London Open Breakout",    winRate: 73, expectancy: 2.41, pf: 2.1,  trades: 22 },
      { setup: "SMC Bullish BOS",         winRate: 68, expectancy: 1.89, pf: 1.9,  trades: 34 },
      { setup: "4H EMA Bounce",           winRate: 65, expectancy: 1.76, pf: 1.75, trades: 17 },
      { setup: "Trend Continuation",      winRate: 63, expectancy: 1.60, pf: 1.6,  trades: 12 },
    ];
    
  const dynamicWorstSetups = patternStats.length > 0 ? patternStats.filter((p) => p.win_rate < 50 || p.avg_pnl_pct < 0)
    .sort((a,b) => a.avg_pnl_pct - b.avg_pnl_pct).slice(0, 4)
    .map((p) => ({ setup: p.pattern_type, winRate: Math.round(p.win_rate), expectancy: p.avg_pnl_pct, pf: p.avg_pnl_pct > 0 ? 1.5 : 0.8, trades: p.total_trades }))
    : [
      { setup: "Asia Session Scalp",      winRate: 32, expectancy: -1.10, pf: 0.7, trades: 15 },
      { setup: "Friday Volume Fade",      winRate: 37, expectancy: -0.87, pf: 0.8, trades: 11 },
      { setup: "Low Volatility Range",    winRate: 40, expectancy: -0.48, pf: 0.9, trades: 10 },
      { setup: "News Reaction",           winRate: 38, expectancy: -0.74, pf: 0.75, trades: 8 },
    ];

  const dynamicDnaInsights = dna?.report?.insights && dna.report.insights.length > 0 ? dna.report.insights.slice(0, 4).map((ins, i) => ({
    icon: i === 0 ? "✅" : i === 1 ? "💡" : i === 2 ? "⚠️" : "✅",
    text: ins.explanation,
    color: i === 0 ? "var(--color-bull)" : i === 1 ? "var(--color-neutral)" : i === 2 ? "var(--color-bear)" : "var(--color-bull)",
  })) : [
    { icon: "✅", text: "Asia session (00–06 IST) has 0% win rate — skip it entirely.", color: "var(--color-bull)" },
    { icon: "💡", text: "4H timeframe beats 15m by 2.3x on profit factor — bias toward higher TF.", color: "var(--color-neutral)" },
    { icon: "⚠️", text: "Win rate drops 40% after 2+ consecutive losses — system pauses you automatically.", color: "var(--color-bear)" },
    { icon: "✅", text: "Your average winner is 2.4x your average loser — keep protecting this ratio.", color: "var(--color-bull)" },
  ];

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

  return (
    <div className="flex flex-col gap-4" suppressHydrationWarning>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <Dna size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div>
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>TRADING DNA</h1>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Your unique trading blueprint built from data, not guesswork</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>12 Jun 2026 – 12 Jun 2026</span>
          <button type="button" className="btn-ghost flex items-center gap-1.5"><Download size={12} /> Export DNA Report</button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {/* Score tiles with mini sparklines */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
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

      {/* 3-column main grid */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
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
                  {/* Top traders marker */}
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
            <button type="button" style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)", marginTop: 8 }}>View Edge Details →</button>
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
            <button type="button" style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)", marginTop: 10 }}>View All Insights →</button>
          </div>
        </div>
      </div>

      {/* Best + Worst Setups */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="section-label" style={{ color: "var(--color-bull)" }}>Best Performing Setups</span>
            <button type="button" style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)" }}>View All Setups →</button>
          </div>
          <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {["Setup","Win Rate","Expectancy","P.Factor","Trades"].map((h) => (
                  <th key={h} className="pb-2 text-left font-semibold pr-3" style={{ color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dynamicBestSetups.map((s) => (
                <tr key={s.setup} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td className="py-2 pr-3 font-semibold" style={{ color: "var(--text-primary)", borderLeft: "3px solid var(--color-bull)", paddingLeft: 8 }}>{s.setup}</td>
                  <td className="py-2 pr-3 font-mono font-bold" style={{ color: "var(--color-bull)" }}>{s.winRate}%</td>
                  <td className="py-2 pr-3 font-mono font-bold" style={{ color: "var(--color-bull)" }}>+{s.expectancy.toFixed(2)}%</td>
                  <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-primary)" }}>{s.pf.toFixed(1)}</td>
                  <td className="py-2 font-mono" style={{ color: "var(--text-muted)" }}>{s.trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="section-label" style={{ color: "var(--color-bear)" }}>Worst Performing Setups</span>
          </div>
          <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {["Setup","Win Rate","Expectancy","P.Factor","Trades"].map((h) => (
                  <th key={h} className="pb-2 text-left font-semibold pr-3" style={{ color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dynamicWorstSetups.map((s) => (
                <tr key={s.setup} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td className="py-2 pr-3 font-semibold" style={{ color: "var(--text-primary)", borderLeft: "3px solid var(--color-bear)", paddingLeft: 8 }}>{s.setup}</td>
                  <td className="py-2 pr-3 font-mono font-bold" style={{ color: "var(--color-bear)" }}>{s.winRate}%</td>
                  <td className="py-2 pr-3 font-mono font-bold" style={{ color: "var(--color-bear)" }}>{s.expectancy.toFixed(2)}%</td>
                  <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-primary)" }}>{s.pf.toFixed(1)}</td>
                  <td className="py-2 font-mono" style={{ color: "var(--text-muted)" }}>{s.trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DNA Evolution + Next Goal */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "3fr 1fr" }}>
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
    </div>
  );
}
