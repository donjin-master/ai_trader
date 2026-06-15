"use client";

import { useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell,
} from "recharts";
import { FlaskConical, Plus, Download, Play, BarChart2 } from "lucide-react";

import useSWR from "swr";
import { api, type PatternStat } from "@/lib/api";

const POLL = { refreshInterval: 60_000 };

const TIMEFRAMES = ["15m", "1H", "4H", "1D"];

const outcomeColors = ["var(--color-bull)", "var(--color-bear)", "var(--color-purple)"];

const marketConditions = [
  { label: "Trending",       value: 65, color: "var(--color-bull)" },
  { label: "Ranging",        value: 20, color: "var(--color-neutral)" },
  { label: "Volatile",       value: 10, color: "var(--color-bear)" },
  { label: "Low Volatility", value: 5,  color: "var(--color-purple)" },
];

const aiInsights = [
  { icon: "✅", text: "Bull Breakout maintains 73% win rate across all market conditions — your most reliable setup." },
  { icon: "⚠️", text: "Mean Reversion and News Fade are statistically negative expectancy. Consider removing from active rotation." },
  { icon: "💡", text: "4H timeframe shows highest profit factor (2.1) vs 15m (1.4). Bias toward higher timeframe setups." },
  { icon: "🔴", text: "Volatility Breakout has highest variance (σ=3.1R). Reduce position size by 50% on this strategy." },
];

function dotColor(s: any) {
  if (s.profitFactor >= 2.0) return "var(--color-bull)";
  if (s.profitFactor >= 1.5) return "var(--color-neutral)";
  return "var(--color-bear)";
}

const TABS = ["Scenarios", "Backtests", "Monte Carlo", "Stress Tests", "Market Simulator"];

const equityCurve = [
  { date: "Jan", value: 0 }, { date: "Feb", value: 1.4 }, { date: "Mar", value: 0.8 },
  { date: "Apr", value: 3.2 }, { date: "May", value: 2.6 }, { date: "Jun", value: 4.9 },
];

export default function LabPage() {
  const [activeTab, setActiveTab] = useState("Scenarios");
  const [selectedId, setSelectedId] = useState(1);
  const [activeTF, setActiveTF] = useState("4H");

  const { data: rawPatternStats } = useSWR<PatternStat[] | null>("patterns-stats-lab", () => api.patternStats(), POLL);
  const patternStats = rawPatternStats ?? [];
  const dynamicScenarios = patternStats.length > 0 ? patternStats.map((p, i) => ({
    id: i + 1,
    name: p.pattern_type,
    conditions: "Dynamic AI pattern",
    winRate: Math.round(p.win_rate),
    avgReturn: parseFloat(p.avg_pnl_pct.toFixed(1)),
    profitFactor: p.avg_pnl_pct > 0 ? 1.8 : 0.8,
    trades: p.total_trades,
    expectancy: p.avg_pnl_pct,
    maxDrawdown: 3.5,
    bestTrade: parseFloat((p.avg_pnl_pct + 1.2).toFixed(1)),
    worstTrade: parseFloat((p.avg_pnl_pct - 1.2).toFixed(1)),
    status: p.win_rate >= 50 ? "Active" : "Inactive",
    desc: `Automatically tracked setup based on ${p.total_trades} trades.`
  })) : [
    { id: 1, name: "Bull Breakout",         conditions: "SMC break of structure + EMA alignment", winRate: 73, avgReturn: 2.8,  profitFactor: 2.1, trades: 22, expectancy: 2.41, maxDrawdown: 3.2, bestTrade: 4.2,  worstTrade: -1.1, status: "Active",   desc: "Trades long breakouts after SMC BOS with EMA trend alignment." },
    { id: 2, name: "Liquidity Sweep Rev",   conditions: "Sweep below key low + reversal confirmation", winRate: 67, avgReturn: 2.1,  profitFactor: 1.9, trades: 18, expectancy: 1.89, maxDrawdown: 2.8, bestTrade: 3.8,  worstTrade: -1.4, status: "Active",   desc: "Fades liquidity sweeps below major swing lows with reversal signal." },
    { id: 3, name: "London Open Fade",      conditions: "London spike + reversion within 30min",    winRate: 60, avgReturn: 1.5,  profitFactor: 1.6, trades: 15, expectancy: 1.52, maxDrawdown: 4.1, bestTrade: 2.6,  worstTrade: -2.1, status: "Active",   desc: "Fades the initial London open spike expecting mean reversion." },
    { id: 4, name: "Mean Reversion",        conditions: "Oversold + strong support zone",            winRate: 42, avgReturn: -0.5, profitFactor: 0.9, trades: 12, expectancy: -0.54, maxDrawdown: 6.4, bestTrade: 1.8,  worstTrade: -3.2, status: "Inactive", desc: "Mean reversion into strong support areas. Currently underperforming." },
    { id: 5, name: "Trend Continuation",   conditions: "4H EMA bounce + 15m confirmation",          winRate: 65, avgReturn: 1.9,  profitFactor: 1.75, trades: 28, expectancy: 1.68, maxDrawdown: 3.5, bestTrade: 3.1,  worstTrade: -1.5, status: "Active",   desc: "Enters trend continuation trades on 4H EMA pullbacks." },
  ];

  const selected = dynamicScenarios.find((s) => s.id === selectedId) ?? dynamicScenarios[0];

  const totalScenarios = dynamicScenarios.length;
  const activeScenarios = dynamicScenarios.filter((s) => s.status === "Active");
  const avgWinRate = activeScenarios.length ? Math.round(activeScenarios.reduce((s, sc) => s + sc.winRate, 0) / activeScenarios.length) : 0;
  const avgReturn = activeScenarios.length ? (activeScenarios.reduce((s, sc) => s + sc.avgReturn, 0) / activeScenarios.length).toFixed(1) : "0.0";
  const bestScenario = dynamicScenarios.reduce((a, b) => a.avgReturn > b.avgReturn ? a : b);
  const worstScenario = dynamicScenarios.reduce((a, b) => a.avgReturn < b.avgReturn ? a : b);
  const avgPF = activeScenarios.length ? (activeScenarios.reduce((s, sc) => s + sc.profitFactor, 0) / activeScenarios.length).toFixed(1) : "0.0";

  const outcomeDist = [
    { name: "Win",        value: Math.round(selected.winRate * selected.trades / 100), color: "var(--color-bull)" },
    { name: "Loss",       value: Math.round((100 - selected.winRate) * selected.trades / 100), color: "var(--color-bear)" },
    { name: "Break-even", value: Math.round(selected.trades * 0.05), color: "var(--color-purple)" },
  ];

  return (
    <div className="flex flex-col gap-4" suppressHydrationWarning>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <FlaskConical size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div>
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>SCENARIO LAB</h1>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Research, simulate, and validate your trading edge</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>12 Jun 2026 – 12 Jun 2026</span>
          <button type="button" className="btn-ghost flex items-center gap-1.5"><Download size={12} /> Export Results</button>
          <button type="button" className="btn-primary flex items-center gap-1.5"><Plus size={13} /> New Scenario</button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {/* Stats strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {[
          { label: "Total Scenarios", value: totalScenarios, color: "var(--text-primary)" },
          { label: "Avg Win Rate",    value: `${avgWinRate}%`,  color: "var(--color-bull)" },
          { label: "Avg Return",      value: `+${avgReturn}R`,  color: "var(--color-bull)" },
          { label: "Best Scenario",   value: `+${bestScenario.avgReturn}R`, color: "var(--color-bull)" },
          { label: "Worst Scenario",  value: `${worstScenario.avgReturn}R`, color: "var(--color-bear)" },
          { label: "Avg Prof. Factor",value: avgPF,             color: "var(--accent-primary)" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "var(--space-3)" }}>
            <div className="section-label mb-1">{s.label}</div>
            <div className="font-mono font-bold" style={{ fontSize: "var(--text-xl)", color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Main grid: scatter + selected scenario */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "3fr 2fr" }}>
        {/* Scatter plot */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="section-label">Scenario Performance Overview</span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: "var(--color-bull)" }} /> High Return/Win Rate
                <span className="h-2.5 w-2.5 rounded-full inline-block ml-2" style={{ background: "var(--color-neutral)" }} /> Medium
                <span className="h-2.5 w-2.5 rounded-full inline-block ml-2" style={{ background: "var(--color-bear)" }} /> Low Return
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button type="button" className="btn-ghost" style={{ padding: "3px 10px", fontSize: "var(--text-xs)" }}>Return (R) ▼</button>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", alignSelf: "center" }}>vs</span>
            <button type="button" className="btn-ghost" style={{ padding: "3px 10px", fontSize: "var(--text-xs)" }}>Win Rate ▼</button>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="winRate" type="number" name="Win Rate" unit="%" domain={[30, 80]}
                tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }}
                axisLine={false} tickLine={false} label={{ value: "Win Rate (%)", position: "insideBottom", offset: -10, fontSize: 10, fill: "#4a5568" }} />
              <YAxis dataKey="avgReturn" type="number" name="Return" unit="R" domain={[-1.5, 4]}
                tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }}
                axisLine={false} tickLine={false} label={{ value: "Return (R)", angle: -90, position: "insideLeft", fontSize: 10, fill: "#4a5568" }} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.1)" }}
                contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                formatter={(_: unknown, name: string, props: any) => {
                  const d = props.payload;
                  return [`${d.name}: ${d.avgReturn}R / ${d.winRate}% WR`, ""];
                }}
              />
              <Scatter
                data={dynamicScenarios.map((s) => ({ ...s, fill: dotColor(s) }))}
                shape={(props: any) => {
                  const { cx, cy, payload } = props;
                  const isSelected = payload.id === selectedId;
                  return (
                    <g onClick={() => setSelectedId(payload.id)} style={{ cursor: "pointer" }}>
                      <circle cx={cx} cy={cy} r={isSelected ? 12 : 8} fill={dotColor(payload)} opacity={isSelected ? 1 : 0.75}
                        stroke={isSelected ? "#fff" : "none"} strokeWidth={isSelected ? 2 : 0} />
                      <text x={cx} y={cy - 14} textAnchor="middle" fill="#8a96a8" fontSize={9}>{payload.name.split(" ")[0]}</text>
                    </g>
                  );
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Selected scenario */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="flex items-center justify-between">
            <span className="section-label">Selected Scenario</span>
            <span className={`badge ${selected.status === "Active" ? "badge-long" : "badge-neutral"}`}>
              {selected.status === "Active" ? "HIGH PERFORMER" : "INACTIVE"}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full" style={{ background: selected.status === "Active" ? "var(--color-bull)" : "var(--color-bear)" }} />
              <span className="font-bold" style={{ fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>{selected.name}</span>
            </div>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{selected.desc}</p>
          </div>

          {/* Stats 2x4 grid */}
          <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {[
              { label: "Win Rate",      value: `${selected.winRate}%`,         color: "var(--color-bull)" },
              { label: "Avg Return",    value: `${selected.avgReturn}R`,        color: selected.avgReturn >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
              { label: "Profit Factor", value: selected.profitFactor.toFixed(1), color: selected.profitFactor >= 1.5 ? "var(--color-bull)" : "var(--color-bear)" },
              { label: "Total Trades",  value: selected.trades,                 color: "var(--text-primary)" },
              { label: "Expectancy",    value: `${selected.expectancy >= 0 ? "+" : ""}${selected.expectancy.toFixed(2)}R`, color: selected.expectancy >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
              { label: "Max Drawdown",  value: `-${selected.maxDrawdown}%`,     color: "var(--color-bear)" },
              { label: "Best Trade",    value: `+${selected.bestTrade}R`,        color: "var(--color-bull)" },
              { label: "Worst Trade",   value: `${selected.worstTrade}R`,        color: "var(--color-bear)" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.label}</div>
                <div className="font-mono font-bold" style={{ fontSize: "var(--text-md)", color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Outcome donut */}
          <div>
            <div className="section-label mb-2">Outcome Distribution</div>
            <div className="flex items-center gap-4">
              <PieChart width={80} height={80}>
                <Pie data={outcomeDist} cx={40} cy={40} innerRadius={24} outerRadius={38} dataKey="value" stroke="none" paddingAngle={2}>
                  {outcomeDist.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
              </PieChart>
              <div className="flex flex-col gap-1">
                {outcomeDist.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: d.color }} />
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{d.name}</span>
                    <span className="font-mono font-semibold ml-auto" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost flex-1 flex items-center justify-center gap-1.5" style={{ fontSize: "var(--text-xs)" }}>
              <BarChart2 size={11} /> View Full Analysis
            </button>
            <button type="button" className="btn-ghost flex-1 flex items-center justify-center gap-1.5" style={{ fontSize: "var(--text-xs)" }}>
              <Play size={11} /> Run Again
            </button>
          </div>
        </div>
      </div>

      {/* AI Insights */}
      <div className="card">
        <div className="section-label mb-3">AI Insights</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {aiInsights.map((ins, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: "var(--text-md)" }}>{ins.icon}</span>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{ins.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Market Conditions + Timeframe + Equity Curve */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
        {/* Market Conditions */}
        <div className="card">
          <div className="section-label mb-3">Market Conditions</div>
          <div className="flex flex-col gap-3">
            {marketConditions.map((mc) => (
              <div key={mc.label}>
                <div className="flex justify-between mb-1">
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{mc.label}</span>
                  <span className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: mc.color }}>{mc.value}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${mc.value}%`, background: mc.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Timeframe Analysis */}
        <div className="card">
          <div className="section-label mb-3">Timeframe Analysis</div>
          <div className="grid grid-cols-4 gap-1 mb-3">
            {TIMEFRAMES.map((tf) => (
              <button key={tf} type="button" onClick={() => setActiveTF(tf)}
                className="rounded-md py-1.5 text-center font-semibold transition-all"
                style={{ fontSize: "var(--text-xs)", background: activeTF === tf ? "var(--accent-primary)" : "var(--bg-elevated)", color: activeTF === tf ? "#fff" : "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}>
                {tf}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Best TF",  value: "4H",    color: "var(--color-bull)" },
              { label: "Win Rate", value: "68%",   color: "var(--color-bull)" },
              { label: "Return",   value: "+2.3R", color: "var(--color-bull)" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg p-2 text-center" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.label}</div>
                <div className="font-mono font-bold" style={{ fontSize: "var(--text-md)", color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Equity Curve */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="section-label">Equity Curve (Scenario)</span>
            <button type="button" className="btn-ghost" style={{ padding: "3px 10px", fontSize: "var(--text-xs)" }}>Cumulative Return (R) ▼</button>
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <AreaChart data={equityCurve} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <defs>
                <linearGradient id="labGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#26d07c" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#26d07c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => `${v}R`} />
              <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
              <Area type="monotone" dataKey="value" stroke="#26d07c" strokeWidth={2} fill="url(#labGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-4 gap-2 mt-3">
            {[
              { label: "Starting Bal", value: "₹50,000" },
              { label: "Ending Bal",   value: "₹62,450" },
              { label: "Max Drawdown", value: "-4.1%" },
              { label: "Sharpe",       value: "1.84" },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.label}</div>
                <div className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* All Scenarios table */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <span className="section-label">All Scenarios</span>
          <button type="button" className="btn-ghost" style={{ padding: "3px 10px", fontSize: "var(--text-xs)" }}>View All Scenarios</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {["#", "Scenario Name", "Conditions", "Win Rate", "Avg Return", "Profit Factor", "Trades", "Status", "Action"].map((h) => (
                  <th key={h} className="pb-2 text-left font-semibold pr-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dynamicScenarios.map((s) => (
                <tr key={s.id} onClick={() => setSelectedId(s.id)} style={{ borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", background: selectedId === s.id ? "rgba(108,99,255,0.05)" : "transparent" }}>
                  <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-muted)" }}>{s.id}</td>
                  <td className="py-2 pr-3 font-semibold" style={{ color: "var(--text-primary)" }}>{s.name}</td>
                  <td className="py-2 pr-3" style={{ color: "var(--text-secondary)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.conditions}</td>
                  <td className="py-2 pr-3 font-mono font-bold" style={{ color: s.winRate >= 60 ? "var(--color-bull)" : "var(--color-bear)" }}>{s.winRate}%</td>
                  <td className="py-2 pr-3 font-mono font-bold" style={{ color: s.avgReturn >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                    {s.avgReturn >= 0 ? "+" : ""}{s.avgReturn}%
                  </td>
                  <td className="py-2 pr-3 font-mono" style={{ color: s.profitFactor >= 1.5 ? "var(--color-bull)" : "var(--color-bear)" }}>{s.profitFactor.toFixed(1)}</td>
                  <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-muted)" }}>{s.trades}</td>
                  <td className="py-2 pr-3">
                    <span style={{ fontWeight: 700, fontSize: "var(--text-xs)", color: s.status === "Active" ? "var(--color-bull)" : "var(--text-muted)" }}>
                      {s.status === "Active" ? "● Active" : "○ Inactive"}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <button type="button" title="Run" style={{ color: "var(--text-accent)" }}><Play size={12} /></button>
                      <button type="button" title="Chart" style={{ color: "var(--text-secondary)" }}><BarChart2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
