"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ScatterChart, Scatter, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import { FlaskConical, Download, Play, Loader2 } from "lucide-react";
import {
  api, type PatternStat, type RiskProfile, type LabBacktest, type LabReplay, type LabSimulate,
  type SmcBacktestResult, type LabMonteCarlo, type LabStressTest, type SmcBacktestStats,
} from "@/lib/api";

const POLL = { refreshInterval: 60_000 };
const TABS = ["Scenarios", "Backtests", "Monte Carlo", "Stress Tests", "Market Simulator"] as const;
type Tab = (typeof TABS)[number];

const INSTRUMENTS = ["BTCUSD", "ETHUSD", "SOLUSD"];
const LAB_TIMEFRAMES = ["15m", "1h", "4h", "1D"];
const PREBUILT_RULES: Record<string, string> = {
  no_morning: "No trades before 11:30am IST",
  max_2_per_day: "Maximum 2 trades per day",
  no_mondays: "No Monday trades",
  no_weekend: "No weekend trades",
  longs_only: "Long trades only",
  shorts_only: "Short trades only",
  cooldown_2h: "2-hour cool-down after a loss",
};

function pct(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}
function inr(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}₹${Math.round(n).toLocaleString("en-IN")}`;
}

function NumberInput({ value, onChange, suffix, min, max, step }: {
  value: number; onChange: (v: number) => void; suffix?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number" value={value} min={min} max={max} step={step ?? 0.1}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          background: "var(--bg-input)", border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-md)", color: "var(--text-primary)",
          fontSize: "var(--text-xs)", padding: "5px 8px", outline: "none", width: 76, textAlign: "right",
        }}
      />
      {suffix && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{suffix}</span>}
    </div>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date" value={value} onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--bg-input)", border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)", color: "var(--text-primary)",
        fontSize: "var(--text-xs)", padding: "5px 8px", outline: "none",
      }}
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--bg-input)", border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)", color: "var(--text-primary)",
        fontSize: "var(--text-xs)", padding: "5px 8px", outline: "none",
      }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", display: "block", marginBottom: 4 }}>{children}</label>;
}

function RunButton({ onClick, loading, label = "Run" }: { onClick: () => void; loading: boolean; label?: string }) {
  return (
    <button type="button" disabled={loading} onClick={onClick}
      className="btn-primary flex items-center gap-1.5" style={{ fontSize: "var(--text-xs)", padding: "6px 14px" }}>
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {loading ? "Running…" : label}
    </button>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "rgba(255,77,106,0.08)", border: "1px solid rgba(255,77,106,0.25)" }}>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--color-bear)" }}>{message}</p>
    </div>
  );
}

function StatGrid({ items }: { items: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
      {items.map((s) => (
        <div key={s.label} className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.label}</div>
          <div className="font-mono font-bold" style={{ fontSize: "var(--text-md)", color: s.color ?? "var(--text-primary)" }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function statsRow(stats: SmcBacktestStats) {
  return [
    { label: "Win Rate", value: `${stats.win_rate_pct.toFixed(1)}%`, color: stats.win_rate_pct >= 50 ? "var(--color-bull)" : "var(--color-bear)" },
    { label: "Avg RR", value: `${stats.avg_rr.toFixed(2)}R` },
    { label: "Max Drawdown", value: `-${stats.max_drawdown_pct.toFixed(1)}%`, color: "var(--color-bear)" },
    { label: "Total Return", value: pct(stats.total_return_pct), color: stats.total_return_pct >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
    { label: "Sharpe", value: stats.sharpe_ratio.toFixed(2) },
    { label: "Expectancy", value: `${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(2)}R`, color: stats.expectancy >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
    { label: "Trades", value: String(stats.total_trades) },
  ];
}

export default function LabPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Scenarios");
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);

  const { data: rawPatternStats } = useSWR<PatternStat[] | null>("patterns-stats-lab", () => api.patternStats(), POLL);
  const patternStats = (rawPatternStats ?? []).filter((p) => !p.untraded);
  const { data: riskProfile } = useSWR<RiskProfile | null>("risk-profile-lab", () => api.riskProfile(), POLL);

  const selected = patternStats.find((p) => p.pattern_type === selectedPattern) ?? patternStats[0];

  // ---- Backtests tab state ----
  const [ruleKey, setRuleKey] = useState("no_morning");
  const [customRule, setCustomRule] = useState("");
  const [ruleDateFrom, setRuleDateFrom] = useState("");
  const [ruleDateTo, setRuleDateTo] = useState("");
  const [ruleResult, setRuleResult] = useState<LabBacktest | null>(null);
  const [ruleLoading, setRuleLoading] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const runRuleBacktest = async () => {
    setRuleLoading(true); setRuleError(null);
    const rule = ruleKey === "custom" ? customRule.trim() : ruleKey;
    if (!rule) { setRuleError("Enter a custom rule first."); setRuleLoading(false); return; }
    const res = await api.labBacktest(rule, ruleDateFrom || undefined, ruleDateTo || undefined);
    if (!res) setRuleError("Request failed.");
    else if (res.error) setRuleError(res.error);
    else setRuleResult(res);
    setRuleLoading(false);
  };

  const [smcInstrument, setSmcInstrument] = useState("BTCUSD");
  const [smcTimeframe, setSmcTimeframe] = useState("15m");
  const [smcDateFrom, setSmcDateFrom] = useState("");
  const [smcDateTo, setSmcDateTo] = useState("");
  const [smcTrainEnd, setSmcTrainEnd] = useState("");
  const [smcMinScore, setSmcMinScore] = useState(7.0);
  const [smcMinRr, setSmcMinRr] = useState(3.0);
  const [smcRiskPct, setSmcRiskPct] = useState(1.0);
  const [smcCapital, setSmcCapital] = useState(50000);
  const [smcResult, setSmcResult] = useState<SmcBacktestResult | null>(null);
  const [smcLoading, setSmcLoading] = useState(false);
  const [smcError, setSmcError] = useState<string | null>(null);

  const runSmcBacktest = async () => {
    if (!smcDateFrom || !smcDateTo) { setSmcError("Pick a date range first."); return; }
    setSmcLoading(true); setSmcError(null);
    const res = await api.smcBacktest({
      instrument: smcInstrument, timeframe: smcTimeframe, date_from: smcDateFrom, date_to: smcDateTo,
      min_setup_score: smcMinScore, min_rr: smcMinRr, risk_per_trade_pct: smcRiskPct,
      starting_capital: smcCapital, train_end: smcTrainEnd || undefined,
    });
    if (!res) setSmcError("Request failed.");
    else if (res.error) setSmcError(res.error);
    else setSmcResult(res);
    setSmcLoading(false);
  };

  // ---- Market Simulator tab state ----
  const [repInstrument, setRepInstrument] = useState("BTCUSD");
  const [repDateFrom, setRepDateFrom] = useState("");
  const [repDateTo, setRepDateTo] = useState("");
  const [repMinScore, setRepMinScore] = useState(7.0);
  const [repResult, setRepResult] = useState<LabReplay | null>(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repError, setRepError] = useState<string | null>(null);

  const runReplay = async () => {
    if (!repDateFrom || !repDateTo) { setRepError("Pick a date range first."); return; }
    setRepLoading(true); setRepError(null);
    const res = await api.labReplay(repInstrument, repDateFrom, repDateTo, repMinScore);
    if (!res) setRepError("Request failed.");
    else if (res.error) setRepError(res.error);
    else setRepResult(res);
    setRepLoading(false);
  };

  const [simInterval, setSimInterval] = useState(60);
  const [simRr, setSimRr] = useState(riskProfile?.min_rr_ratio ?? 3.0);
  const [simSlPct, setSimSlPct] = useState(0.5);
  const [simRiskPct, setSimRiskPct] = useState(riskProfile?.risk_per_trade_pct ?? 1.0);
  const [simResult, setSimResult] = useState<LabSimulate | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const runSimulate = async () => {
    if (!repDateFrom || !repDateTo) { setSimError("Pick a date range above first."); return; }
    setSimLoading(true); setSimError(null);
    const res = await api.labSimulate(
      { instrument: repInstrument, min_setup_score: repMinScore, scan_interval_minutes: simInterval, rr: simRr, sl_pct: simSlPct, risk_per_trade_pct: simRiskPct },
      repDateFrom, repDateTo
    );
    if (!res) setSimError("Request failed.");
    else if (res.error) setSimError(res.error);
    else setSimResult(res);
    setSimLoading(false);
  };

  // ---- Monte Carlo tab state ----
  const [mcDateFrom, setMcDateFrom] = useState("");
  const [mcDateTo, setMcDateTo] = useState("");
  const [mcSimulations, setMcSimulations] = useState(1000);
  const [mcResult, setMcResult] = useState<LabMonteCarlo | null>(null);
  const [mcLoading, setMcLoading] = useState(false);
  const [mcError, setMcError] = useState<string | null>(null);

  const runMonteCarlo = async () => {
    setMcLoading(true); setMcError(null);
    const res = await api.labMonteCarlo(mcDateFrom || undefined, mcDateTo || undefined, mcSimulations);
    if (!res) setMcError("Request failed.");
    else if (res.error) setMcError(res.error);
    else setMcResult(res);
    setMcLoading(false);
  };

  // ---- Stress Tests tab state ----
  const [stInstrument, setStInstrument] = useState("BTCUSD");
  const [stTimeframe, setStTimeframe] = useState("15m");
  const [stDateFrom, setStDateFrom] = useState("");
  const [stDateTo, setStDateTo] = useState("");
  const [stMinScore, setStMinScore] = useState(7.0);
  const [stMinRr, setStMinRr] = useState(3.0);
  const [stRiskPct, setStRiskPct] = useState(1.0);
  const [stCapital, setStCapital] = useState(50000);
  const [stResult, setStResult] = useState<LabStressTest | null>(null);
  const [stLoading, setStLoading] = useState(false);
  const [stError, setStError] = useState<string | null>(null);

  const runStressTest = async () => {
    if (!stDateFrom || !stDateTo) { setStError("Pick a date range first."); return; }
    setStLoading(true); setStError(null);
    const res = await api.labStressTest({
      instrument: stInstrument, timeframe: stTimeframe, date_from: stDateFrom, date_to: stDateTo,
      min_setup_score: stMinScore, min_rr: stMinRr, risk_per_trade_pct: stRiskPct, starting_capital: stCapital,
    });
    if (!res) setStError("Request failed.");
    else if (res.error) setStError(res.error);
    else setStResult(res);
    setStLoading(false);
  };

  const exportableResult = () => {
    if (activeTab === "Scenarios") return patternStats;
    if (activeTab === "Backtests") return { rule: ruleResult, smc: smcResult };
    if (activeTab === "Monte Carlo") return mcResult;
    if (activeTab === "Stress Tests") return stResult;
    return { replay: repResult, simulate: simResult };
  };
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(exportableResult(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `lab-${activeTab.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4" suppressHydrationWarning>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <FlaskConical size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>SCENARIO LAB</h1>
            <p className="hidden sm:block" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Research, backtest, and stress-test your trading edge on real data</p>
          </div>
        </div>
        <button type="button" className="btn-ghost flex items-center gap-1.5 shrink-0" onClick={handleExport}><Download size={12} /> <span className="hidden sm:inline">Export Results</span></button>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {activeTab === "Scenarios" && (
        <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-4">
          <div className="card">
            <div className="section-label mb-3">SMC Pattern Performance (real trade history)</div>
            {patternStats.length === 0 ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No closed trades tagged with a pattern yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="win_rate" type="number" name="Win Rate" unit="%" domain={[0, 100]}
                    tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }}
                    axisLine={false} tickLine={false} label={{ value: "Win Rate (%)", position: "insideBottom", offset: -10, fontSize: 10, fill: "#4a5568" }} />
                  <YAxis dataKey="avg_pnl_pct" type="number" name="Avg P&L" unit="%"
                    tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }}
                    axisLine={false} tickLine={false} label={{ value: "Avg P&L (%)", angle: -90, position: "insideLeft", fontSize: 10, fill: "#4a5568" }} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.1)" }}
                    contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                    formatter={(_: unknown, __: string, props: any) => {
                      const d = props.payload;
                      return [`${d.pattern_type}: ${pct(d.avg_pnl_pct)} / ${(d.win_rate ?? 0).toFixed(0)}% WR (${d.total_trades} trades)`, ""];
                    }}
                  />
                  <Scatter
                    data={patternStats}
                    shape={(props: any) => {
                      const { cx, cy, payload } = props;
                      const isSelected = payload.pattern_type === selected?.pattern_type;
                      const color = payload.win_rate >= 60 ? "var(--color-bull)" : payload.win_rate >= 45 ? "var(--color-neutral)" : "var(--color-bear)";
                      return (
                        <g onClick={() => setSelectedPattern(payload.pattern_type)} style={{ cursor: "pointer" }}>
                          <circle cx={cx} cy={cy} r={isSelected ? 12 : 8} fill={color} opacity={isSelected ? 1 : 0.75}
                            stroke={isSelected ? "#fff" : "none"} strokeWidth={isSelected ? 2 : 0} />
                        </g>
                      );
                    }}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span className="section-label">Selected Pattern</span>
            {!selected ? (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Select a pattern from the chart.</p>
            ) : (
              <>
                <div className="font-bold" style={{ fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>{selected.pattern_type}</div>
                <StatGrid items={[
                  { label: "Win Rate", value: `${(selected.win_rate ?? 0).toFixed(1)}%`, color: (selected.win_rate ?? 0) >= 50 ? "var(--color-bull)" : "var(--color-bear)" },
                  { label: "Avg P&L", value: pct(selected.avg_pnl_pct), color: (selected.avg_pnl_pct ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                  { label: "Total Trades", value: String(selected.total_trades) },
                  { label: "Avg Confidence", value: selected.avg_confidence != null ? `${selected.avg_confidence.toFixed(1)}/10` : "—" },
                  { label: "Deployed", value: selected.enabled ? "Yes" : "No", color: selected.enabled ? "var(--color-bull)" : "var(--text-muted)" },
                ]} />
                <div>
                  <div className="section-label mb-2">Outcome Distribution</div>
                  <div className="flex items-center gap-4">
                    <PieChart width={80} height={80}>
                      <Pie data={[
                        { name: "Win", value: Math.round((selected.win_rate ?? 0) * selected.total_trades / 100), color: "var(--color-bull)" },
                        { name: "Loss", value: selected.total_trades - Math.round((selected.win_rate ?? 0) * selected.total_trades / 100), color: "var(--color-bear)" },
                      ]} cx={40} cy={40} innerRadius={24} outerRadius={38} dataKey="value" stroke="none" paddingAngle={2}>
                        {[{ color: "var(--color-bull)" }, { color: "var(--color-bear)" }].map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                    </PieChart>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-bull)" }} /><span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Win</span></div>
                      <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-bear)" }} /><span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Loss</span></div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === "Backtests" && (
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="section-label mb-3">Rule Backtest — apply a behavioral rule to your imported trade history</div>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div>
                <FieldLabel>Rule</FieldLabel>
                <Select value={ruleKey} onChange={setRuleKey} options={[
                  ...Object.entries(PREBUILT_RULES).map(([k, v]) => ({ value: k, label: v })),
                  { value: "custom", label: "Custom rule (AI-interpreted)…" },
                ]} />
              </div>
              {ruleKey === "custom" && (
                <div style={{ flex: 1, minWidth: 240 }}>
                  <FieldLabel>Describe the rule in plain English</FieldLabel>
                  <input value={customRule} onChange={(e) => setCustomRule(e.target.value)} placeholder="e.g. no trades on red CPI days"
                    style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontSize: "var(--text-xs)", padding: "5px 8px", outline: "none" }} />
                </div>
              )}
              <div><FieldLabel>From</FieldLabel><DateInput value={ruleDateFrom} onChange={setRuleDateFrom} /></div>
              <div><FieldLabel>To</FieldLabel><DateInput value={ruleDateTo} onChange={setRuleDateTo} /></div>
              <RunButton onClick={runRuleBacktest} loading={ruleLoading} />
            </div>
            {ruleError && <ErrorBox message={ruleError} />}
            {ruleResult && !ruleError && (
              <div className="flex flex-col gap-3 mt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                    <div className="section-label mb-2">Without Rule</div>
                    <StatGrid items={[
                      { label: "Trades", value: String(ruleResult.original.trades) },
                      { label: "P&L", value: inr(ruleResult.original.pnl_inr), color: ruleResult.original.pnl_inr >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                      { label: "Win Rate", value: `${ruleResult.original.win_rate.toFixed(1)}%` },
                    ]} />
                  </div>
                  <div className="rounded-lg p-3" style={{ background: "rgba(108,99,255,0.06)", border: "1px solid rgba(108,99,255,0.25)" }}>
                    <div className="section-label mb-2">With Rule</div>
                    <StatGrid items={[
                      { label: "Trades", value: String(ruleResult.with_rule.trades) },
                      { label: "P&L", value: inr(ruleResult.with_rule.pnl_inr), color: ruleResult.with_rule.pnl_inr >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                      { label: "Win Rate", value: `${ruleResult.with_rule.win_rate.toFixed(1)}%` },
                    ]} />
                  </div>
                </div>
                <p style={{ fontSize: "var(--text-xs)", color: ruleResult.pnl_improvement_inr >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                  {ruleResult.trades_removed} trades removed · {inr(ruleResult.pnl_improvement_inr)} P&L change · {pct(ruleResult.win_rate_change)} win-rate change
                </p>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={ruleResult.curve.dates.map((d, i) => ({ date: d, original: ruleResult.curve.original[i], with_rule: ruleResult.curve.with_rule[i] }))}>
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#4a5568" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} width={50} />
                    <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="original" stroke="#4a5568" strokeWidth={1.5} dot={false} name="Original" />
                    <Line type="monotone" dataKey="with_rule" stroke="var(--color-bull)" strokeWidth={2} dot={false} name="With Rule" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="card">
            <div className="section-label mb-3">SMC Engine Backtest — replay the boardroom's pattern engine over real candles</div>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div><FieldLabel>Instrument</FieldLabel><Select value={smcInstrument} onChange={setSmcInstrument} options={INSTRUMENTS.map((i) => ({ value: i, label: i }))} /></div>
              <div><FieldLabel>Timeframe</FieldLabel><Select value={smcTimeframe} onChange={setSmcTimeframe} options={LAB_TIMEFRAMES.map((t) => ({ value: t, label: t }))} /></div>
              <div><FieldLabel>From</FieldLabel><DateInput value={smcDateFrom} onChange={setSmcDateFrom} /></div>
              <div><FieldLabel>To</FieldLabel><DateInput value={smcDateTo} onChange={setSmcDateTo} /></div>
              <div><FieldLabel>Train/test split</FieldLabel><DateInput value={smcTrainEnd} onChange={setSmcTrainEnd} /></div>
              <div><FieldLabel>Min Score</FieldLabel><NumberInput value={smcMinScore} onChange={setSmcMinScore} min={1} max={10} step={0.5} /></div>
              <div><FieldLabel>Min RR</FieldLabel><NumberInput value={smcMinRr} onChange={setSmcMinRr} min={0.5} max={10} step={0.5} suffix="R" /></div>
              <div><FieldLabel>Risk/Trade</FieldLabel><NumberInput value={smcRiskPct} onChange={setSmcRiskPct} min={0.1} max={5} step={0.1} suffix="%" /></div>
              <div><FieldLabel>Capital</FieldLabel><NumberInput value={smcCapital} onChange={setSmcCapital} min={1000} max={10000000} step={1000} suffix="₹" /></div>
              <RunButton onClick={runSmcBacktest} loading={smcLoading} />
            </div>
            {smcError && <ErrorBox message={smcError} />}
            {smcResult && !smcError && (
              <div className="flex flex-col gap-3 mt-2">
                {smcResult.train_stats && smcResult.test_stats ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                      <div className="section-label mb-2">Train</div>
                      <StatGrid items={statsRow(smcResult.train_stats)} />
                    </div>
                    <div className="rounded-lg p-3" style={{ background: "rgba(108,99,255,0.06)", border: "1px solid rgba(108,99,255,0.25)" }}>
                      <div className="section-label mb-2">Test (out-of-sample)</div>
                      <StatGrid items={statsRow(smcResult.test_stats)} />
                    </div>
                  </div>
                ) : (
                  <StatGrid items={statsRow(smcResult.stats)} />
                )}
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={smcResult.stats.equity_curve.map((p, i) => ({ idx: i, equity: p.equity }))}>
                    <XAxis dataKey="idx" tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
                    <Line type="monotone" dataKey="equity" stroke="var(--color-bull)" strokeWidth={2} dot={false} name="Equity" />
                  </LineChart>
                </ResponsiveContainer>
                <p style={{ fontSize: "9px", color: "var(--text-muted)" }}>{smcResult.disclaimer}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "Monte Carlo" && (
        <div className="card">
          <div className="section-label mb-3">Monte Carlo — bootstrap-resample your real trade history to estimate risk of ruin</div>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div><FieldLabel>From (optional)</FieldLabel><DateInput value={mcDateFrom} onChange={setMcDateFrom} /></div>
            <div><FieldLabel>To (optional)</FieldLabel><DateInput value={mcDateTo} onChange={setMcDateTo} /></div>
            <div><FieldLabel>Simulations</FieldLabel><NumberInput value={mcSimulations} onChange={setMcSimulations} min={100} max={5000} step={100} /></div>
            <RunButton onClick={runMonteCarlo} loading={mcLoading} />
          </div>
          {mcError && <ErrorBox message={mcError} />}
          {mcResult && !mcError && (
            <div className="flex flex-col gap-4 mt-2">
              <StatGrid items={[
                { label: "Trades Used", value: String(mcResult.trades_used) },
                { label: "Probability of Ruin", value: `${(mcResult.probability_of_ruin * 100).toFixed(1)}%`, color: mcResult.probability_of_ruin > 0.1 ? "var(--color-bear)" : "var(--color-bull)" },
                { label: "Median Return", value: pct(mcResult.final_return_pct.p50), color: mcResult.final_return_pct.p50 >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                { label: "5th %ile Return", value: pct(mcResult.final_return_pct.p5), color: "var(--color-bear)" },
                { label: "95th %ile Return", value: pct(mcResult.final_return_pct.p95), color: "var(--color-bull)" },
                { label: "Median Max Drawdown", value: `-${mcResult.max_drawdown_pct.p50.toFixed(1)}%`, color: "var(--color-bear)" },
                { label: "95th %ile Drawdown", value: `-${mcResult.max_drawdown_pct.p95.toFixed(1)}%`, color: "var(--color-bear)" },
              ]} />
              <div>
                <div className="section-label mb-2">Equity Fan Chart (5th / 50th / 95th percentile across {mcResult.simulations} simulated paths)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={mcResult.fan_chart}>
                    <XAxis dataKey="checkpoint" tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} label={{ value: "Trades", position: "insideBottom", offset: -5, fontSize: 10, fill: "#4a5568" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#4a5568" }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="p95" stroke="var(--color-bull)" strokeWidth={1} strokeDasharray="4 4" dot={false} name="95th %ile" />
                    <Line type="monotone" dataKey="p50" stroke="var(--accent-primary)" strokeWidth={2} dot={false} name="Median" />
                    <Line type="monotone" dataKey="p5" stroke="var(--color-bear)" strokeWidth={1} strokeDasharray="4 4" dot={false} name="5th %ile" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p style={{ fontSize: "9px", color: "var(--text-muted)" }}>{mcResult.disclaimer}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "Stress Tests" && (
        <div className="card">
          <div className="section-label mb-3">Stress Test — how the SMC backtest degrades under adverse conditions</div>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div><FieldLabel>Instrument</FieldLabel><Select value={stInstrument} onChange={setStInstrument} options={INSTRUMENTS.map((i) => ({ value: i, label: i }))} /></div>
            <div><FieldLabel>Timeframe</FieldLabel><Select value={stTimeframe} onChange={setStTimeframe} options={LAB_TIMEFRAMES.map((t) => ({ value: t, label: t }))} /></div>
            <div><FieldLabel>From</FieldLabel><DateInput value={stDateFrom} onChange={setStDateFrom} /></div>
            <div><FieldLabel>To</FieldLabel><DateInput value={stDateTo} onChange={setStDateTo} /></div>
            <div><FieldLabel>Min Score</FieldLabel><NumberInput value={stMinScore} onChange={setStMinScore} min={1} max={10} step={0.5} /></div>
            <div><FieldLabel>Min RR</FieldLabel><NumberInput value={stMinRr} onChange={setStMinRr} min={0.5} max={10} step={0.5} suffix="R" /></div>
            <div><FieldLabel>Risk/Trade</FieldLabel><NumberInput value={stRiskPct} onChange={setStRiskPct} min={0.1} max={5} step={0.1} suffix="%" /></div>
            <div><FieldLabel>Capital</FieldLabel><NumberInput value={stCapital} onChange={setStCapital} min={1000} max={10000000} step={1000} suffix="₹" /></div>
            <RunButton onClick={runStressTest} loading={stLoading} />
          </div>
          {stError && <ErrorBox message={stError} />}
          {stResult && !stError && (
            <div className="overflow-x-auto mt-2">
              <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    {["Scenario", "Win Rate", "Avg RR", "Max Drawdown", "Total Return", "Expectancy"].map((h) => (
                      <th key={h} className="pb-2 text-left font-semibold pr-4" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Base", stats: stResult.base },
                    { label: "Added Slippage (−0.1R)", stats: stResult.scenarios.added_slippage },
                    { label: "Win-Rate Shock (bottom 20% wins flipped)", stats: stResult.scenarios.win_rate_shock },
                    { label: "Doubled Risk/Trade", stats: stResult.scenarios.doubled_risk },
                  ].map((row, i) => (
                    <tr key={row.label} style={{ borderBottom: "1px solid var(--border-subtle)", background: i === 0 ? "rgba(108,99,255,0.05)" : "transparent" }}>
                      <td className="py-2 pr-4 font-semibold" style={{ color: "var(--text-primary)" }}>{row.label}</td>
                      <td className="py-2 pr-4 font-mono font-bold" style={{ color: row.stats.win_rate_pct >= stResult.base.win_rate_pct ? "var(--color-bull)" : "var(--color-bear)" }}>{row.stats.win_rate_pct.toFixed(1)}%</td>
                      <td className="py-2 pr-4 font-mono">{row.stats.avg_rr.toFixed(2)}R</td>
                      <td className="py-2 pr-4 font-mono font-bold" style={{ color: row.stats.max_drawdown_pct <= stResult.base.max_drawdown_pct ? "var(--color-bull)" : "var(--color-bear)" }}>-{row.stats.max_drawdown_pct.toFixed(1)}%</td>
                      <td className="py-2 pr-4 font-mono font-bold" style={{ color: row.stats.total_return_pct >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>{pct(row.stats.total_return_pct)}</td>
                      <td className="py-2 font-mono" style={{ color: row.stats.expectancy >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>{row.stats.expectancy >= 0 ? "+" : ""}{row.stats.expectancy.toFixed(2)}R</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: 8 }}>{stResult.disclaimer}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "Market Simulator" && (
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="section-label mb-3">Market Replay — what would the SMC engine have flagged? (deterministic, no LLM)</div>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div><FieldLabel>Instrument</FieldLabel><Select value={repInstrument} onChange={setRepInstrument} options={INSTRUMENTS.map((i) => ({ value: i, label: i }))} /></div>
              <div><FieldLabel>From</FieldLabel><DateInput value={repDateFrom} onChange={setRepDateFrom} /></div>
              <div><FieldLabel>To</FieldLabel><DateInput value={repDateTo} onChange={setRepDateTo} /></div>
              <div><FieldLabel>Min Score</FieldLabel><NumberInput value={repMinScore} onChange={setRepMinScore} min={1} max={10} step={0.5} /></div>
              <RunButton onClick={runReplay} loading={repLoading} />
            </div>
            {repError && <ErrorBox message={repError} />}
            {repResult && !repError && (
              <div className="flex flex-col gap-3 mt-2">
                <StatGrid items={[
                  { label: "Signals Found", value: String(repResult.signals_found) },
                  { label: "Wins", value: String(repResult.wins), color: "var(--color-bull)" },
                  { label: "Losses", value: String(repResult.losses), color: "var(--color-bear)" },
                  { label: "Total R", value: `${repResult.total_r >= 0 ? "+" : ""}${repResult.total_r}R`, color: repResult.total_r >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                ]} />
                {repResult.decisions.length > 0 && (
                  <div className="overflow-x-auto">
                  <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
                    <thead><tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>{["Time", "Direction", "Score", "Outcome", "R"].map((h) => <th key={h} className="pb-2 text-left font-semibold pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {repResult.decisions.slice(0, 30).map((d, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                          <td className="py-1.5 pr-4 font-mono whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{d.time}</td>
                          <td className="py-1.5 pr-4 font-bold" style={{ color: d.direction === "long" ? "var(--color-bull)" : "var(--color-bear)" }}>{d.direction.toUpperCase()}</td>
                          <td className="py-1.5 pr-4 font-mono">{d.score}/10</td>
                          <td className="py-1.5 pr-4">{d.outcome ?? "—"}</td>
                          <td className="py-1.5 font-mono" style={{ color: (d.r_multiple ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>{d.r_multiple != null ? `${d.r_multiple >= 0 ? "+" : ""}${d.r_multiple}R` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="section-label mb-3">Custom Strategy Simulation — replay with a custom risk config (uses date range above)</div>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div><FieldLabel>Scan Interval</FieldLabel><NumberInput value={simInterval} onChange={setSimInterval} min={5} max={240} step={5} suffix="min" /></div>
              <div><FieldLabel>RR</FieldLabel><NumberInput value={simRr} onChange={setSimRr} min={0.5} max={10} step={0.5} suffix="R" /></div>
              <div><FieldLabel>SL</FieldLabel><NumberInput value={simSlPct} onChange={setSimSlPct} min={0.1} max={5} step={0.1} suffix="%" /></div>
              <div><FieldLabel>Risk/Trade</FieldLabel><NumberInput value={simRiskPct} onChange={setSimRiskPct} min={0.1} max={5} step={0.1} suffix="%" /></div>
              <RunButton onClick={runSimulate} loading={simLoading} />
            </div>
            {simError && <ErrorBox message={simError} />}
            {simResult && !simError && (
              <div className="flex flex-col gap-3 mt-2">
                <StatGrid items={[
                  { label: "Trades Taken", value: String(simResult.trades_taken) },
                  { label: "Win Rate", value: simResult.win_rate != null ? `${simResult.win_rate.toFixed(1)}%` : "—" },
                  { label: "Simulated P&L", value: inr(simResult.simulated_pnl_inr), color: simResult.simulated_pnl_inr >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                  { label: "Total R", value: `${simResult.total_r >= 0 ? "+" : ""}${simResult.total_r}R`, color: simResult.total_r >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                ]} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
