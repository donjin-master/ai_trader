"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, X, Loader2, Save } from "lucide-react";
import { api, type Trade, type ManagedPositionState } from "@/lib/api";

const POLL = { refreshInterval: 30_000 };
const TABS = ["Overview", "AI Analysis", "Chart", "Notes", "Reflection"] as const;
type Tab = (typeof TABS)[number];
const PAGE_SIZE = 10;

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
function pct(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function JournalDetailPage({ params }: { params: { id: string } }) {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [sortDesc, setSortDesc] = useState(true);
  const [page, setPage] = useState(0);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [chartUrl, setChartUrl] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [closing, setClosing] = useState(false);

  const { data: rawTrades } = useSWR<Trade[] | null>("all-trades", () => api.trades(100, 0), POLL);
  const { data: managed } = useSWR<ManagedPositionState[] | null>("managed-journal", () => api.managedPositions(), POLL);
  const allTrades = (rawTrades ?? []).filter((t) => t.status !== "logged_only" || t.entry_price);
  const trades = sortDesc ? allTrades : [...allTrades].reverse();

  const routeId = params.id;
  const listMatch = trades.find((t) => t.id === routeId);
  const fallbackId = listMatch ? routeId : trades[0]?.id;

  const { data: fullDetail, mutate: refreshDetail } = useSWR<Trade | null>(
    fallbackId ? `decision-${fallbackId}` : null,
    () => api.decision(fallbackId as string),
    POLL
  );

  const selected = fullDetail ?? listMatch ?? trades[0];

  useEffect(() => {
    setNotesDraft(selected?.notes ?? "");
    setNotesSaved(false);
  }, [selected?.id, selected?.notes]);

  useEffect(() => {
    let url: string | null = null;
    if (activeTab === "Chart" && selected?.has_chart && selected.id) {
      setChartLoading(true);
      api.decisionChartBlobUrl(selected.id).then((u) => {
        url = u;
        setChartUrl(u);
        setChartLoading(false);
      });
    } else {
      setChartUrl(null);
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [activeTab, selected?.id, selected?.has_chart]);

  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center" style={{ height: "calc(100vh - var(--topbar-height) - 48px)" }}>
        <p style={{ color: "var(--text-muted)" }}>Loading trade details...</p>
      </div>
    );
  }

  const result = resultLabel(selected);
  const isClosed = selected.status === "closed";
  const isOpen = selected.status === "open";
  const managedPos = managed?.find((m) => m.instrument === selected.instrument);
  const management = selected.position_params?.management;
  const voteTally = selected.boardroom_votes?.vote_tally;
  const consensusPct = (() => {
    if (!voteTally) return null;
    const counts = Object.values(voteTally);
    const total = counts.reduce((s, c) => s + c, 0);
    if (!total) return null;
    return Math.round((Math.max(...counts) / total) * 100);
  })();

  const handleSaveNotes = async () => {
    setNotesSaving(true);
    await api.updateTradeNotes(selected.id, notesDraft);
    await refreshDetail();
    setNotesSaving(false);
    setNotesSaved(true);
  };

  const handleRunReflection = async () => {
    setReflecting(true);
    await api.runReflection(selected.id);
    await refreshDetail();
    setReflecting(false);
  };

  const handleClose = async () => {
    if (!selected.instrument) return;
    if (!confirm(`Close the open ${selected.instrument} position now?`)) return;
    setClosing(true);
    await api.closePosition(selected.instrument);
    await refreshDetail();
    setClosing(false);
  };

  const pageTrades = trades.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));

  return (
    <div className="flex flex-col md:flex-row gap-3 md:h-[calc(100vh-var(--topbar-height)-48px)]">
      {/* Left: trade list (hidden on mobile — use the Journal page list or the Back link below instead) */}
      <div className="hidden md:flex flex-col overflow-hidden md:w-[300px] md:min-w-[300px]" style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <span className="font-mono font-bold" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            {trades.length} TRADES
          </span>
          <span style={{ color: "var(--border-default)" }}>|</span>
          <button type="button" className="btn-ghost" style={{ padding: "2px 8px", fontSize: "9px" }} onClick={() => { setSortDesc((s) => !s); setPage(0); }}>
            {sortDesc ? "Recent First ▼" : "Oldest First ▲"}
          </button>
          <Link href="/journal" className="ml-auto btn-ghost" style={{ padding: "2px 8px", fontSize: "9px" }}>Filters →</Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          {pageTrades.map((t) => {
            const isActive = t.id === selected.id;
            return (
              <Link key={t.id} href={`/journal/${t.id}`} style={{
                display: "block", padding: "10px 12px", borderBottom: "1px solid var(--border-subtle)",
                borderLeft: isActive ? "3px solid var(--accent-primary)" : "3px solid transparent",
                background: isActive ? "var(--bg-elevated)" : "transparent", textDecoration: "none",
              }}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-bold" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>
                    #{t.id.slice(0, 6)} {t.instrument}
                  </span>
                  <span className="font-semibold" style={{ fontSize: "9px", color: (t.direction ?? t.action) === "long" ? "var(--color-bull)" : (t.direction ?? t.action) === "short" ? "var(--color-bear)" : "var(--text-muted)" }}>
                    {(t.direction ?? t.action ?? "").toUpperCase()}
                  </span>
                  <span style={{ fontSize: "9px", fontWeight: 700, color: resultColor(resultLabel(t)) }}>{resultLabel(t)}</span>
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
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded px-2 py-0.5" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", opacity: page === 0 ? 0.4 : 1 }}>Prev</button>
          {Array.from({ length: totalPages }, (_, i) => i).slice(Math.max(0, page - 2), page + 3).map((p) => (
            <button key={p} type="button" onClick={() => setPage(p)} className="rounded px-2 py-0.5"
              style={{ fontSize: "var(--text-xs)", color: p === page ? "var(--accent-primary)" : "var(--text-secondary)", background: p === page ? "rgba(108,99,255,0.15)" : "transparent" }}>
              {p + 1}
            </button>
          ))}
          <button type="button" disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="rounded px-2 py-0.5" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Next</button>
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex flex-col flex-1 w-full overflow-hidden" style={{ background: "var(--bg-surface)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)" }}>
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
          {TABS.map((t) => (
            <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "Overview" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                      {pct(selected.pnl_pct)}
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

                {/* Center: Trade Levels — real, priority-ordered by what's actually recorded */}
                <div className="flex flex-col gap-3">
                  <div className="card">
                    <div className="section-label mb-3">Trade Levels</div>
                    {managedPos ? (
                      <div className="flex flex-col gap-2">
                        {[
                          { label: "Stop Loss", value: managedPos.current_sl, color: "var(--color-bear)" },
                          { label: "TP 1",      value: managedPos.tp1,        color: "var(--color-bull)" },
                          { label: "TP 2",      value: managedPos.tp2,        color: "var(--color-bull)" },
                          ...(managedPos.tp3 != null ? [{ label: "TP 3", value: managedPos.tp3, color: "var(--color-bull)" }] : []),
                        ].map((l) => (
                          <div key={l.label} className="flex items-center justify-between">
                            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{l.label}</span>
                            <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: l.color }}>{l.value?.toLocaleString() ?? "—"}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>R:R Planned</span>
                          <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>1 : {managedPos.initial_rr_ratio?.toFixed(1) ?? "—"}</span>
                        </div>
                        <p style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: 4 }}>Live position — managed by the AI.</p>
                      </div>
                    ) : management ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>R:R Planned</span>
                          <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
                            {management.initial_rr_planned != null ? `1 : ${management.initial_rr_planned.toFixed(1)}` : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>R:R Achieved on Exit</span>
                          <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: (management.rr_achieved_on_exit ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                            {management.rr_achieved_on_exit != null ? `${management.rr_achieved_on_exit.toFixed(2)}R` : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>TP1 Hit</span>
                          <span style={{ fontSize: "var(--text-sm)", color: management.tp1_hit ? "var(--color-bull)" : "var(--text-muted)" }}>{management.tp1_hit ? "✓ Yes" : "✗ No"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Breakeven Set</span>
                          <span style={{ fontSize: "var(--text-sm)", color: management.breakeven_set ? "var(--color-bull)" : "var(--text-muted)" }}>{management.breakeven_set ? "✓ Yes" : "✗ No"}</span>
                        </div>
                      </div>
                    ) : selected.decision_json?.bull_full || selected.decision_json?.bear_full ? (
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Planned offsets recorded in the boardroom decision, but this trade was never actively managed.</p>
                    ) : (
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No trade-level data recorded for this entry.</p>
                    )}
                  </div>
                </div>

                {/* Right: Setup Score + Scenario Simulation (replaces fabricated probability donut) */}
                <div className="flex flex-col gap-3">
                  <div className="card">
                    <div className="section-label mb-3">Setup Score</div>
                    <div className="flex items-center gap-3">
                      <div className="relative" style={{ width: 70, height: 70 }}>
                        <svg width="70" height="70" style={{ transform: "rotate(-90deg)" }}>
                          <circle cx="35" cy="35" r="29" fill="none" stroke="rgba(108,99,255,0.15)" strokeWidth="7" />
                          <circle cx="35" cy="35" r="29" fill="none" stroke="var(--accent-primary)" strokeWidth="7"
                            strokeDasharray={`${((selected.setup_score ?? 0) / 10) * 182} 182`} strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center font-mono font-bold" style={{ fontSize: "var(--text-md)", color: "var(--text-primary)" }}>
                          {selected.setup_score != null ? selected.setup_score.toFixed(1) : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="font-bold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{selected.setup_grade ?? "—"}</div>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Grade at entry</div>
                      </div>
                    </div>
                  </div>
                  <div className="card flex-1">
                    <div className="section-label mb-2">Scenario Simulation</div>
                    {selected.scenario_simulation?.simulated ? (
                      <div className="flex flex-col gap-2" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                        {selected.scenario_simulation.scenario_a_description && <p><b style={{ color: "var(--color-bull)" }}>A:</b> {selected.scenario_simulation.scenario_a_description}</p>}
                        {selected.scenario_simulation.scenario_b_description && <p><b style={{ color: "var(--color-neutral)" }}>B:</b> {selected.scenario_simulation.scenario_b_description}</p>}
                        {selected.scenario_simulation.scenario_c_description && <p><b style={{ color: "var(--color-bear)" }}>C:</b> {selected.scenario_simulation.scenario_c_description}</p>}
                        {selected.scenario_simulation.simulation_verdict && (
                          <p className="mt-1" style={{ color: "var(--text-primary)", fontWeight: 600 }}>Verdict: {selected.scenario_simulation.simulation_verdict}</p>
                        )}
                        {selected.scenario_simulation.biggest_risk && <p style={{ color: "var(--color-bear)" }}>Biggest risk: {selected.scenario_simulation.biggest_risk}</p>}
                      </div>
                    ) : (
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No scenario simulation recorded for this trade.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Boardroom Consensus + Lesson Learned (real) */}
              <div className="card mt-4">
                <div className="section-label mb-2">Boardroom Consensus</div>
                {consensusPct != null ? (
                  <div className="flex items-center gap-3 mb-3">
                    <div className="progress-track flex-1" style={{ height: 8 }}>
                      <div className="progress-fill progress-fill-bull" style={{ width: `${consensusPct}%` }} />
                    </div>
                    <span className="font-mono font-bold" style={{ fontSize: "var(--text-xl)", color: "var(--color-bull)" }}>{consensusPct}%</span>
                  </div>
                ) : (
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: 12 }}>No boardroom vote tally recorded.</p>
                )}
                {selected.decision_json?.consensus_level && (
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: 12 }}>Consensus level: {selected.decision_json.consensus_level}</p>
                )}
                <div className="section-label mb-1">Lesson Learned</div>
                {selected.reflection?.lesson ? (
                  <>
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontStyle: "italic", lineHeight: 1.6 }}>{selected.reflection.lesson}</p>
                    {selected.reflection.watch_for && (
                      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 6 }}>Watch for: {selected.reflection.watch_for}</p>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Reflection not yet run for this trade.</p>
                    {isClosed && (
                      <button type="button" disabled={reflecting} onClick={handleRunReflection} className="btn-ghost flex items-center gap-1.5" style={{ fontSize: "var(--text-xs)" }}>
                        {reflecting ? <Loader2 size={11} className="animate-spin" /> : null} Run Reflection Now
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Trade Journey — built from real management trail_history */}
              <div className="card mt-4">
                <div className="section-label mb-4">Trade Journey</div>
                {management?.trail_history && management.trail_history.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-bull)" }} />
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Logged</span>
                      <span className="font-mono ml-auto" style={{ fontSize: "9px", color: "var(--text-muted)" }}>{fmtTime(selected.created_at)}</span>
                    </div>
                    {management.trail_history.map((h, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: "var(--accent-primary)" }} />
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{h.reason} (SL → {h.sl})</span>
                        <span className="font-mono ml-auto" style={{ fontSize: "9px", color: "var(--text-muted)" }}>{fmtTime(h.at)}</span>
                      </div>
                    ))}
                    {isClosed && (
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: "var(--color-bear)" }} />
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Closed ({selected.exit_trigger ?? "unknown"})</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                    Logged — no position-management events recorded{isOpen ? " yet" : ""}.
                  </p>
                )}
              </div>
            </>
          )}

          {activeTab === "AI Analysis" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  {selected.decision_json?.chair_reasoning && (
                    <>
                      <div className="section-label mt-3 mb-1">Chair Reasoning</div>
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{selected.decision_json.chair_reasoning}</p>
                    </>
                  )}
                  {selected.decision_json?.why_over_alternative && (
                    <>
                      <div className="section-label mt-3 mb-1">Why This Over The Alternative</div>
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{selected.decision_json.why_over_alternative}</p>
                    </>
                  )}
                </div>
                <div className="card">
                  <div className="section-label mb-2">Boardroom Votes</div>
                  {selected.boardroom_votes?.votes && selected.boardroom_votes.votes.length > 0 ? (
                    <div className="flex flex-col gap-2 mb-3">
                      {selected.boardroom_votes.votes.map((member, idx) => (
                        <div key={idx} className="rounded p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                          <div className="font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--accent-primary)" }}>{member.member}{member.model ? ` (${member.model})` : ""}</div>
                          <div className="flex justify-between mt-1">
                            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{member.vote?.toUpperCase()}</span>
                            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Conf: {member.conviction}/10</span>
                          </div>
                          {member.primary_reason && <p style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: 4 }}>{member.primary_reason}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: 12 }}>No boardroom vote record.</p>
                  )}
                  {selected.boardroom_votes?.deliberations && selected.boardroom_votes.deliberations.length > 0 && (
                    <>
                      <div className="section-label mb-2">Deliberation (vote changes during debate)</div>
                      <div className="flex flex-col gap-2">
                        {selected.boardroom_votes.deliberations.map((d, idx) => (
                          <div key={idx} className="rounded p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                            <div className="font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>{d.member}</div>
                            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                              {d.original_vote && d.original_vote !== d.final_vote ? `${d.original_vote.toUpperCase()} → ${d.final_vote.toUpperCase()}` : d.final_vote.toUpperCase()} (conf {d.final_conviction}/10)
                            </p>
                            {d.reasoning && <p style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: 4 }}>{d.reasoning}</p>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {selected.smc_summary && (
                <div className="card">
                  <div className="section-label mb-2">SMC Structure</div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(100px,1fr))" }}>
                    {Object.entries(selected.smc_summary.structures ?? {}).map(([tf, s]) => (
                      <div key={tf} className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                        <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>{tf}</div>
                        <div className="font-semibold" style={{ fontSize: "var(--text-xs)", color: s.trend === "BULLISH" ? "var(--color-bull)" : s.trend === "BEARISH" ? "var(--color-bear)" : "var(--text-secondary)" }}>{s.trend ?? "—"}</div>
                      </div>
                    ))}
                  </div>
                  {selected.smc_summary.premium_discount && (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 8 }}>Zone: {selected.smc_summary.premium_discount}</p>
                  )}
                  {selected.smc_summary.confluences_found && selected.smc_summary.confluences_found.length > 0 && (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--color-bull)", marginTop: 4 }}>Confluences: {selected.smc_summary.confluences_found.join(", ")}</p>
                  )}
                  {selected.smc_summary.missing && selected.smc_summary.missing.length > 0 && (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 4 }}>Missing: {selected.smc_summary.missing.join(", ")}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "Chart" && (
            <div className="card flex items-center justify-center" style={{ minHeight: 320 }}>
              {!selected.has_chart ? (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No chart was captured for this decision.</p>
              ) : chartLoading ? (
                <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
              ) : chartUrl ? (
                <img src={chartUrl} alt="Chart at entry" style={{ maxWidth: "100%", borderRadius: "var(--radius-md)" }} />
              ) : (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Could not load chart image.</p>
              )}
            </div>
          )}

          {activeTab === "Notes" && (
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <span className="section-label">Notes</span>
                <button type="button" disabled={notesSaving} onClick={handleSaveNotes} className="btn-primary flex items-center gap-1.5" style={{ fontSize: "var(--text-xs)", padding: "5px 12px" }}>
                  {notesSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} {notesSaving ? "Saving…" : "Save Notes"}
                </button>
              </div>
              <textarea
                value={notesDraft}
                onChange={(e) => { setNotesDraft(e.target.value); setNotesSaved(false); }}
                placeholder="Write your own notes about this trade…"
                rows={10}
                style={{
                  width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontSize: "var(--text-sm)",
                  padding: 12, outline: "none", resize: "vertical", lineHeight: 1.5,
                }}
              />
              {notesSaved && <p style={{ fontSize: "var(--text-xs)", color: "var(--color-bull)", marginTop: 6 }}>Saved.</p>}
            </div>
          )}

          {activeTab === "Reflection" && (
            <div className="flex flex-col gap-4">
              {!selected.reflection ? (
                <div className="card flex items-center gap-3">
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>This trade hasn't been reflected on yet.</p>
                  {isClosed && (
                    <button type="button" disabled={reflecting} onClick={handleRunReflection} className="btn-primary flex items-center gap-1.5" style={{ fontSize: "var(--text-xs)" }}>
                      {reflecting ? <Loader2 size={11} className="animate-spin" /> : null} Run Reflection Now
                    </button>
                  )}
                </div>
              ) : (
                <div className="card">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                    {[
                      { label: "Thesis Correct", value: selected.reflection.thesis_correct === true ? "Yes" : selected.reflection.thesis_correct === false ? "No" : "—" },
                      { label: "Execution Quality", value: selected.reflection.execution_quality != null ? `${selected.reflection.execution_quality}/10` : "—" },
                      { label: "Luck Factor", value: selected.reflection.luck_factor != null ? `${selected.reflection.luck_factor}/10` : "—" },
                    ].map((s) => (
                      <div key={s.label} className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{s.label}</div>
                        <div className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  {selected.reflection.what_went_right && (
                    <><div className="section-label mb-1">What Went Right</div><p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 10 }}>{selected.reflection.what_went_right}</p></>
                  )}
                  {selected.reflection.what_went_wrong && (
                    <><div className="section-label mb-1">What Went Wrong</div><p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginBottom: 10 }}>{selected.reflection.what_went_wrong}</p></>
                  )}
                  {selected.reflection.lesson && (
                    <><div className="section-label mb-1">Lesson</div><p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", fontStyle: "italic", marginBottom: 10 }}>{selected.reflection.lesson}</p></>
                  )}
                  {selected.reflection.would_take_again != null && (
                    <p style={{ fontSize: "var(--text-xs)", color: selected.reflection.would_take_again ? "var(--color-bull)" : "var(--color-bear)" }}>
                      Would take this trade again: {selected.reflection.would_take_again ? "Yes" : "No"}
                    </p>
                  )}
                </div>
              )}

              {selected.counterfactuals && (
                <div className="card">
                  <div className="section-label mb-2">Counterfactuals</div>
                  {selected.counterfactuals.key_insight && (
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", marginBottom: 10 }}>{selected.counterfactuals.key_insight}</p>
                  )}
                  {selected.counterfactuals.scenarios && selected.counterfactuals.scenarios.length > 0 && (
                    <div className="overflow-x-auto">
                    <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
                      <thead><tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>{["Scenario", "Simulated P&L", "Better?", "Leading Indicator"].map((h) => <th key={h} className="pb-2 text-left font-semibold pr-3" style={{ color: "var(--text-secondary)" }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {selected.counterfactuals.scenarios.map((s, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td className="py-1.5 pr-3 font-semibold" style={{ color: "var(--text-primary)" }}>{s.name}</td>
                            <td className="py-1.5 pr-3 font-mono" style={{ color: s.simulated_pnl_pct >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>{pct(s.simulated_pnl_pct)}</td>
                            <td className="py-1.5 pr-3" style={{ color: s.outcome_better ? "var(--color-bull)" : "var(--text-muted)" }}>{s.outcome_better ? "Yes" : "No"}</td>
                            <td className="py-1.5 pr-3" style={{ color: "var(--text-secondary)" }}>{s.leading_indicator}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <Link href="/journal" className="flex items-center gap-1.5 btn-ghost" style={{ fontSize: "var(--text-sm)" }}>
            <ArrowLeft size={14} /> Back to Journal
          </Link>
          {isOpen && (
            <button type="button" disabled={closing} onClick={handleClose} className="btn-danger flex items-center gap-1.5">
              {closing ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Close Trade
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
