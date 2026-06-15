"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { PieChart, Pie, Cell } from "recharts";
import { ArrowLeft, Edit, X } from "lucide-react";
import { api, type Trade } from "@/lib/api";

const POLL = { refreshInterval: 30_000 };

function resultLabel(t: Trade): "WIN" | "LOSS" | "OPEN" | "HOLD" {
  if (t.status === "open" || t.status === "logged_only") return "OPEN";
  if (t.status === "hold") return "HOLD";
  if (t.pnl_pct != null) return t.pnl_pct >= 0 ? "WIN" : "LOSS";
  return "OPEN";
}

function resultColor(r: string) {
  if (r === "WIN")  return "var(--color-bull)";
  if (r === "LOSS") return "var(--color-bear)";
  if (r === "OPEN") return "var(--accent-primary)";
  return "var(--color-purple)";
}

const donutData = [
  { value: 63, color: "var(--color-bull)",   label: "TP1 Hit (63%)" },
  { value: 28, color: "var(--color-purple)", label: "Break-even (28%)" },
  { value: 9,  color: "var(--color-bear)",   label: "SL Hit (9%)" },
];

const journeySteps = [
  { label: "Signal\nGenerated", time: "21:30", done: true },
  { label: "Analysis\nComplete",  time: "21:40", done: true },
  { label: "Trade\nExecuted",     time: "21:44", done: true },
  { label: "TP1\nHit",            time: "–",     done: false, active: true },
  { label: "TP2\nHit",            time: "–",     done: false },
  { label: "Closed",             time: "–",     done: false },
];

export default function JournalDetailPage({ params }: { params: { id: string } }) {
  const [activeTab, setActiveTab] = useState("Overview");
  const tabs = ["Overview", "AI Analysis", "Chart", "Notes", "Reflection"];
  const { data: rawTrades } = useSWR<Trade[] | null>("all-trades", () => api.trades(100, 0), POLL);
  const trades = (rawTrades ?? []).filter((t) => t.status !== "logged_only" || t.entry_price);

  const selectedId = params.id;
  const selected = trades.find((t) => t.id === selectedId) ?? trades[0];

  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center" style={{ height: "calc(100vh - var(--topbar-height) - 48px)" }}>
        <p style={{ color: "var(--text-muted)" }}>Loading trade details...</p>
      </div>
    );
  }

  const result = resultLabel(selected);

  return (
    <div className="flex gap-3" style={{ height: "calc(100vh - var(--topbar-height) - 48px)" }}>
      {/* Left: trade list */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ width: 300, minWidth: 300, background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <span className="font-mono font-bold" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            50 TRADES
          </span>
          <span style={{ color: "var(--border-default)" }}>|</span>
          <button type="button" className="btn-ghost" style={{ padding: "2px 8px", fontSize: "9px" }}>Recent First ▼</button>
          <button type="button" className="ml-auto btn-ghost" style={{ padding: "2px 8px", fontSize: "9px" }}>Filter 🔧</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {trades.map((t) => {
            const isActive = t.id === selected.id;
            return (
              <Link
                key={t.id}
                href={`/journal/${t.id}`}
                style={{
                  display: "block",
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border-subtle)",
                  borderLeft: isActive ? "3px solid var(--accent-primary)" : "3px solid transparent",
                  background: isActive ? "var(--bg-elevated)" : "transparent",
                  textDecoration: "none",
                }}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-bold" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>
                    #{t.id.slice(0, 6)} {t.instrument}
                  </span>
                  <span
                    className="font-semibold"
                    style={{ fontSize: "9px", color: (t.direction ?? t.action) === "long" ? "var(--color-bull)" : (t.direction ?? t.action) === "short" ? "var(--color-bear)" : "var(--text-muted)" }}
                  >
                    {(t.direction ?? t.action ?? "").toUpperCase()}
                  </span>
                  <span
                    style={{
                      fontSize: "9px",
                      fontWeight: 700,
                      color: resultColor(resultLabel(t)),
                    }}
                  >
                    {resultLabel(t)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono" style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                    {t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold" style={{ fontSize: "var(--text-xs)", color: (t.pnl_pct ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                      {(t.pnl_pct ?? 0) >= 0 ? "+" : ""}{(t.pnl_pct ?? 0).toFixed(2)}%
                    </span>
                    <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>{t.confidence ?? t.boardroom_confidence ?? "—"}/10</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        <div className="flex items-center justify-center gap-2 p-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          {["Prev", "1", "2", "3", "4", "5", "Next"].map((p) => (
            <button
              key={p}
              type="button"
              className="rounded px-2 py-0.5"
              style={{ fontSize: "var(--text-xs)", color: p === "1" ? "var(--accent-primary)" : "var(--text-secondary)", background: p === "1" ? "rgba(108,99,255,0.15)" : "transparent" }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Right: detail */}
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <span className="font-bold" style={{ fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>
            TRADE #{selected.id.slice(0, 6)} {selected.instrument} {(selected.direction ?? selected.action ?? "").toUpperCase()}
          </span>
          <span className="badge" style={{ fontSize: "9px", background: resultColor(result), color: "#fff" }}>{result}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {selected.created_at ? new Date(selected.created_at).toLocaleString() : "—"}
            </span>
          </div>
        </div>

        <div className="tab-bar px-4">
          {tabs.map((t) => (
            <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Overview tab */}
          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            {/* Left block */}
            <div className="flex flex-col gap-3">
              <div className="card">
                <div className="section-label mb-2">Entry Price</div>
                <div className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>{selected.entry_price ?? "—"}</div>
              </div>
              <div className="card">
                <div className="section-label mb-2">Exit Price</div>
                <div className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>{selected.exit_price ?? "—"}</div>
              </div>
              <div className="card">
                <div className="section-label mb-2">P&L</div>
                <div className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: (selected.pnl_pct ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                  {(selected.pnl_pct ?? 0) >= 0 ? "+" : ""}{(selected.pnl_pct ?? 0).toFixed(2)}%
                </div>
              </div>
              <div className="card">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Position Size", value: `${(selected.size_pct ?? 0).toFixed(2)}%` },
                    { label: "Duration",      value: selected.duration_mins ? `${selected.duration_mins}m` : "—" },
                    { label: "AI Confidence", value: `${selected.confidence ?? selected.boardroom_confidence ?? "—"} / 10` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="section-label mb-1">{label}</div>
                      <div className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Center: Trade Levels */}
            <div className="flex flex-col gap-3">
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <span className="section-label">Trade Levels</span>
                  <button type="button" className="btn-ghost" style={{ padding: "3px 8px", fontSize: "var(--text-xs)" }}>
                    <Edit size={12} className="inline mr-1" /> Edit
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {[
                    { label: "Stop Loss", value: "63,697.0", pct: "-0.60%", color: "var(--color-bear)" },
                    { label: "TP 1",      value: "64,670.8", pct: "+0.92%", color: "var(--color-bull)" },
                    { label: "TP 2",      value: "65,255.0", pct: "+1.83%", color: "var(--color-bull)" },
                    { label: "R:R",       value: "1 : 3.0",  pct: null,     color: "var(--text-primary)" },
                  ].map((l) => (
                    <div key={l.label} className="flex items-center justify-between">
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{l.label}</span>
                      <div className="text-right">
                        <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: l.color }}>{l.value}</span>
                        {l.pct && <span className="font-mono ml-2" style={{ fontSize: "var(--text-xs)", color: l.color }}>{l.pct}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Probability */}
            <div className="flex flex-col gap-3">
              <div className="card">
                <div className="section-label mb-3">Probability Outcome</div>
                <div className="flex justify-center mb-3">
                  <PieChart width={100} height={100}>
                    <Pie data={donutData} cx={49} cy={49} innerRadius={30} outerRadius={46} dataKey="value" stroke="none" paddingAngle={2}>
                      {donutData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                  </PieChart>
                </div>
                <div className="flex flex-col gap-1.5">
                  {donutData.map((d) => (
                    <div key={d.label} className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{d.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <div className="section-label mb-1">Expectancy</div>
                  <div className="font-mono font-bold" style={{ fontSize: "var(--text-xl)", color: "var(--color-bull)" }}>+₹1,34,000</div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Reasoning & Boardroom */}
          <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="card">
              <div className="section-label mb-2">AI Reasoning & Signals</div>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", whiteSpace: "pre-wrap", marginBottom: 12, lineHeight: 1.5 }}>
                {selected.reasoning || "No reasoning recorded."}
              </p>
              {selected.key_signals && selected.key_signals.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {selected.key_signals.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span style={{ color: "var(--color-bull)", fontSize: "var(--text-xs)", marginTop: 2 }}>✅</span>
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <div className="section-label mb-2">Boardroom Tally</div>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", marginBottom: 12 }}>
                {selected.vote_tally || "N/A"}
              </p>
              {selected.boardroom && selected.boardroom.length > 0 && (
                <div className="flex flex-col gap-2">
                  {selected.boardroom.map((member: any, idx: number) => (
                    <div key={idx} className="rounded p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                      <div className="font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--accent-primary)" }}>{member.member}</div>
                      <div className="flex justify-between mt-1">
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{member.action?.toUpperCase()}</span>
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Conf: {member.confidence}/10</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* AI & Human Agreement */}
          <div className="card mt-4">
            <div className="section-label mb-2">AI & Human Agreement</div>
            <div className="flex items-center gap-3 mb-2">
              <div className="progress-track flex-1" style={{ height: 8 }}>
                <div className="progress-fill progress-fill-bull" style={{ width: "82%" }} />
              </div>
              <span className="font-mono font-bold" style={{ fontSize: "var(--text-xl)", color: "var(--color-bull)" }}>82%</span>
            </div>
            <div className="section-label mb-1">LESSON (Auto Generated)</div>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontStyle: "italic", lineHeight: 1.6 }}>
              Waiting for AI confirmation before entry would have increased this trade's win probability. The AI identified the liquidity sweep pattern 14 minutes before the entry, which aligned with the trader's observation.
            </p>
          </div>

          {/* Trade Journey timeline */}
          <div className="card mt-4">
            <div className="section-label mb-4">Trade Journey</div>
            <div className="flex items-start justify-between">
              {journeySteps.map((step, i) => (
                <div key={i} className="flex flex-col items-center" style={{ flex: 1 }}>
                  <div className="flex items-center w-full">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full font-bold shrink-0"
                      style={{
                        background: step.done ? "var(--color-bull)" : step.active ? "var(--accent-primary)" : "var(--bg-elevated)",
                        border: step.active ? "2px solid var(--accent-primary)" : "2px solid transparent",
                        color: step.done || step.active ? "#fff" : "var(--text-muted)",
                        fontSize: "var(--text-xs)",
                        boxShadow: step.active ? "var(--glow-accent)" : "none",
                      }}
                    >
                      {step.done ? "✓" : step.active ? "●" : "○"}
                    </div>
                    {i < journeySteps.length - 1 && (
                      <div className="flex-1 h-0.5" style={{ background: step.done ? "var(--color-bull)" : "var(--bg-elevated)" }} />
                    )}
                  </div>
                  <div className="mt-2 text-center">
                    <div style={{ fontSize: "9px", color: "var(--text-secondary)", fontWeight: 600, whiteSpace: "pre-line" }}>{step.label}</div>
                    <div className="font-mono mt-0.5" style={{ fontSize: "9px", color: "var(--text-muted)" }}>{step.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <Link href="/journal" className="flex items-center gap-1.5 btn-ghost" style={{ fontSize: "var(--text-sm)" }}>
            <ArrowLeft size={14} /> Back to Journal
          </Link>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost flex items-center gap-1.5">
              <Edit size={14} /> Edit Trade
            </button>
            <button type="button" className="btn-danger flex items-center gap-1.5">
              <X size={14} /> Close Trade
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
