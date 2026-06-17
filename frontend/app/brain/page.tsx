"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import {
  Brain, RefreshCw, Download, CheckCircle, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, Minus, Clock, Zap, AlertTriangle,
} from "lucide-react";
import { api, type Lesson, type PatternStat, type Trade } from "@/lib/api";

const POLL    = { refreshInterval: 60_000 };
const POLL_DX = { refreshInterval: 30_000 };
const TABS = ["Decisions", "Learnings", "Patterns", "Rules", "All"];

function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// Confidence/score → visual progress bar (replaces hard-to-read ASCII block bars)
function ConfidenceBar({ value, max = 10, color }: { value: number; max?: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2" style={{ minWidth: 90 }}>
      <div className="progress-track flex-1" style={{ height: 5 }}>
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color }}>
        {value}/{max}
      </span>
    </div>
  );
}

function Sparkline({ positive = true }: { positive?: boolean }) {
  const pts = positive ? [2,5,4,8,6,10,9,12,11,15] : [15,11,12,9,10,6,8,4,5,2];
  const w = 80, h = 28, max = Math.max(...pts), min = Math.min(...pts), range = max - min || 1;
  const xStep = w / (pts.length - 1);
  const scaleY = (v: number) => h - ((v - min) / range) * (h - 4) - 2;
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${i * xStep},${scaleY(v)}`).join(" ");
  const color = positive ? "#26d07c" : "#ff4d6a";
  return (
    <svg width={w} height={h}>
      <defs>
        <linearGradient id={`bg-${positive}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${(pts.length - 1) * xStep},${h} L0,${h} Z`} fill={`url(#bg-${positive})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Decision Feed Card ───────────────────────────────────────────────────────

function DecisionCard({ d }: { d: Trade }) {
  const [expanded, setExpanded] = useState(false);

  const action    = d.direction ?? d.action ?? "hold";
  const isLong    = action === "long";
  const isShort   = action === "short";
  const isSkipped = d.status === "skipped" || d.status === "logged_only";
  const isTraded  = d.status === "open" || d.status === "closed" || d.status === "executed";

  const accentColor = isLong ? "var(--color-bull)" : isShort ? "var(--color-bear)" : "var(--text-muted)";
  const accentBg    = isLong ? "rgba(38,208,124,0.10)" : isShort ? "rgba(255,77,106,0.10)" : "rgba(100,100,120,0.10)";
  const VIcon       = isLong ? TrendingUp : isShort ? TrendingDown : Minus;

  const skipReason   = d.decision_json?.skip_reason;
  const voteTally    = d.decision_json?.vote_tally;
  const votes        = d.boardroom_votes?.votes ?? [];
  const confidence   = d.confidence ?? d.boardroom_confidence;
  const isMathDecision = (d.reasoning ?? "").includes("Boardroom LLM bypassed");

  return (
    <div className="rounded-xl overflow-hidden transition-colors"
      style={{ border: `1px solid ${accentColor}30`, background: "var(--bg-card)" }}>

      {/* Row 1 — main summary */}
      <div className="flex items-start gap-3.5 px-5 py-4">
        {/* verdict icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg mt-0.5"
          style={{ background: accentBg, border: `1px solid ${accentColor}35` }}>
          <VIcon size={18} style={{ color: accentColor }} />
        </div>

        <div className="flex-1 min-w-0">
          {/* top line */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-bold tracking-wide" style={{ fontSize: "var(--text-lg)", color: accentColor }}>
              {action.toUpperCase()}
            </span>
            <span style={{ fontSize: "var(--text-base)", color: "var(--text-primary)", fontWeight: 600 }}>
              {d.instrument ?? "—"}
            </span>
            {isTraded && (
              <span className="badge badge-high">Traded</span>
            )}
            {isSkipped && skipReason && (
              <span className="badge badge-medium">Skipped</span>
            )}
            {isMathDecision && (
              <span className="badge" style={{ background: "rgba(77,166,255,0.15)", color: "var(--color-info)" }}>
                Rule-Based
              </span>
            )}
          </div>

          {/* meta row */}
          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            <span className="flex items-center gap-1.5" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              <Clock size={12} />
              {fmtDate(d.created_at)} {fmtTime(d.created_at)} · {timeAgo(d.created_at)}
            </span>
            {d.setup_score != null && (
              <span className="font-mono" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                Setup score {d.setup_score}{d.setup_grade ? ` (${d.setup_grade})` : ""}
              </span>
            )}
            {voteTally && (
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                Board: {voteTally}
              </span>
            )}
          </div>

          {/* confidence bar */}
          {confidence != null && (
            <div className="mt-2.5">
              <ConfidenceBar value={confidence} color={accentColor} />
            </div>
          )}

          {/* reasoning preview */}
          {d.reasoning && (
            <p className="mt-3" style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {expanded ? d.reasoning : (d.reasoning.length > 180 ? d.reasoning.slice(0, 180) + "…" : d.reasoning)}
            </p>
          )}

          {/* skip reason */}
          {skipReason && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg px-3 py-2"
              style={{ background: "rgba(240,180,41,0.08)", border: "1px solid rgba(240,180,41,0.2)" }}>
              <AlertTriangle size={13} style={{ color: "var(--color-neutral)", flexShrink: 0 }} />
              <span style={{ fontSize: "var(--text-sm)", color: "var(--color-neutral)" }}>{skipReason}</span>
            </div>
          )}

          {/* key signals */}
          {d.key_signals && d.key_signals.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {d.key_signals.slice(0, expanded ? 20 : 4).map((s, i) => (
                <span key={i} className="rounded-full px-2.5 py-1"
                  style={{ fontSize: "var(--text-xs)", fontWeight: 500, background: "rgba(108,99,255,0.12)", border: "1px solid rgba(108,99,255,0.25)", color: "var(--accent-primary)" }}>
                  {s}
                </span>
              ))}
              {!expanded && (d.key_signals.length > 4) && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", alignSelf: "center" }}>+{d.key_signals.length - 4} more</span>
              )}
            </div>
          )}
        </div>

        {/* expand toggle */}
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg mt-0.5 transition-colors"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-5 pb-5 flex flex-col gap-4"
          style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 16 }}>

          {/* Bull vs Bear */}
          {(d.bull_case || d.bear_case) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {d.bull_case && (
                <div className="rounded-lg p-3.5" style={{ background: "rgba(38,208,124,0.06)", border: "1px solid rgba(38,208,124,0.2)" }}>
                  <div className="font-bold mb-1.5" style={{ fontSize: "var(--text-xs)", letterSpacing: "0.06em", color: "var(--color-bull)" }}>▲ BULL CASE</div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>{d.bull_case}</p>
                </div>
              )}
              {d.bear_case && (
                <div className="rounded-lg p-3.5" style={{ background: "rgba(255,77,106,0.06)", border: "1px solid rgba(255,77,106,0.2)" }}>
                  <div className="font-bold mb-1.5" style={{ fontSize: "var(--text-xs)", letterSpacing: "0.06em", color: "var(--color-bear)" }}>▼ BEAR CASE</div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>{d.bear_case}</p>
                </div>
              )}
            </div>
          )}

          {/* Boardroom votes */}
          {votes.length > 0 && (
            <div>
              <div className="section-label mb-2">Boardroom Votes</div>
              <div className="flex flex-col gap-2">
                {votes.map((v, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg px-3.5 py-2.5"
                    style={{ background: "var(--bg-elevated)" }}>
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", minWidth: 84, fontWeight: 500 }}>{v.member}</span>
                    <span className="font-bold" style={{
                      fontSize: "var(--text-sm)",
                      color: v.vote === "long" ? "var(--color-bull)" : v.vote === "short" ? "var(--color-bear)" : "var(--text-muted)",
                    }}>
                      {(v.vote ?? "—").toUpperCase()}
                    </span>
                    <span className="font-mono flex-1 text-right" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
                      {v.conviction}/10
                    </span>
                    {v.primary_reason && (
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", maxWidth: 220, textAlign: "right" }}>{v.primary_reason}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chair reasoning */}
          {d.decision_json?.chair_reasoning && (
            <div>
              <div className="section-label mb-1.5">Chair Reasoning</div>
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.65 }}>
                {d.decision_json.chair_reasoning}
              </p>
            </div>
          )}

          {/* Market regime */}
          {d.market_snapshot?.market_regime && (
            <div className="flex items-center gap-2">
              <span className="section-label">Regime:</span>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>
                {d.market_snapshot.market_regime}
              </span>
            </div>
          )}

          {/* Trade outcome if closed */}
          {d.status === "closed" && d.pnl_pct != null && (
            <div className="rounded-lg px-3.5 py-2.5 flex items-center gap-3"
              style={{
                background: d.pnl_pct >= 0 ? "rgba(38,208,124,0.08)" : "rgba(255,77,106,0.08)",
                border: `1px solid ${d.pnl_pct >= 0 ? "rgba(38,208,124,0.25)" : "rgba(255,77,106,0.25)"}`,
              }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Outcome:</span>
              <span className="font-mono font-bold" style={{ fontSize: "var(--text-md)", color: d.pnl_pct >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                {d.pnl_pct >= 0 ? "+" : ""}{d.pnl_pct.toFixed(2)}%
              </span>
              {d.exit_trigger && (
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>via {d.exit_trigger.replace(/_/g, " ")}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function BrainPage() {
  const [activeTab, setActiveTab] = useState("Decisions");
  const [decisionLimit, setDecisionLimit] = useState(20);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: lessons,      mutate: refreshLessons  } = useSWR<Lesson[]      | null>("lessons",       () => api.lessons(),                POLL);
  const { data: trades,       mutate: refreshTrades    } = useSWR<Trade[]       | null>("brain-trades",  () => api.trades(50),               POLL);
  const { data: rawPatternStats, mutate: refreshPatterns } = useSWR<PatternStat[] | null>("patterns-stats",() => api.patternStats(),           POLL);
  const { data: decisions,    mutate: refreshDecisions, isValidating: decisionsLoading } = useSWR<Trade[] | null>(
    ["decisions", decisionLimit],
    () => api.decisions(decisionLimit),
    POLL_DX,
  );

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const realLessons     = mounted ? (lessons ?? []) : [];
  const sortedLessons   = [...realLessons].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const patternStats    = mounted ? (rawPatternStats ?? []) : [];
  const decisionFeed    = mounted ? (decisions ?? []) : [];
  const safeTrades      = mounted ? (trades ?? []) : [];

  const winPatterns = patternStats
    .filter((p) => (p.win_rate ?? 0) >= 50 && (p.avg_pnl_pct ?? 0) > 0)
    .sort((a, b) => (b.avg_pnl_pct ?? 0) - (a.avg_pnl_pct ?? 0))
    .slice(0, 5)
    .map((p, i) => ({ rank: i + 1, pattern: p.pattern_type, winRate: Math.round(p.win_rate ?? 0), trades: p.total_trades, expectancy: Number(p.avg_pnl_pct ?? 0) }));
  const losePatterns = patternStats
    .filter((p) => (p.win_rate ?? 0) < 50 || (p.avg_pnl_pct ?? 0) < 0)
    .sort((a, b) => (a.avg_pnl_pct ?? 0) - (b.avg_pnl_pct ?? 0))
    .slice(0, 5)
    .map((p, i) => ({ rank: i + 1, pattern: p.pattern_type, winRate: Math.round(p.win_rate ?? 0), trades: p.total_trades, expectancy: Number(p.avg_pnl_pct ?? 0) }));

  const computedRules = sortedLessons.filter(l => (l.quality_score ?? 0) >= 4).slice(0, 5).map(l => ({
    title: l.lesson_text ?? "Unnamed Rule",
    impact: `Score: ${l.quality_score}/5`,
    badge: (l.quality_score ?? 0) === 5 ? "HIGH" : "MEDIUM",
    tested: l.source_trade_id ? 1 : 0,
    improvement: l.confidence_score ?? 0,
  }));

  const totalTrades = safeTrades.length;
  const goodLessons = realLessons.filter((l) => (l.quality_score ?? 0) >= 3).length;
  const avgQual = realLessons.length
    ? realLessons.reduce((s, l) => s + (l.quality_score ?? 0), 0) / realLessons.length
    : 3.65;
  const brainConf  = Math.min(100, Math.round(avgQual * 20));
  const weeklyDelta = `+${realLessons.filter((l) => {
    const d = new Date(l.created_at ?? "");
    return Date.now() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length} this week`;

  const topInsights = sortedLessons.length >= 3 ? sortedLessons.slice(0, 3) : null;
  const staticInsights = [
    { n: 1, color: "var(--color-bull)", border: "rgba(38,208,124,0.25)", bg: "rgba(38,208,124,0.06)", icon: "▲",
      title: "No insights found yet", sub: "Take more trades so the AI can analyze your patterns." },
  ];

  // Decision feed stats
  const totalDecisions = decisionFeed.length;
  const tradedCount    = decisionFeed.filter((d) => d.status === "open" || d.status === "closed" || d.status === "executed").length;
  const holdCount      = decisionFeed.filter((d) => (d.direction ?? d.action) === "hold" || d.status === "skipped" || d.status === "logged_only").length;
  const longCount      = decisionFeed.filter((d) => (d.direction ?? d.action) === "long").length;
  const shortCount     = decisionFeed.filter((d) => (d.direction ?? d.action) === "short").length;

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await Promise.all([refreshDecisions(), refreshLessons(), refreshTrades(), refreshPatterns()]);
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleExport() {
    const exportRows = activeTab === "Learnings" ? sortedLessons
      : activeTab === "Patterns" ? patternStats
      : activeTab === "Rules" ? computedRules
      : decisionFeed;
    const blob = new Blob([JSON.stringify(exportRows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-brain-${activeTab.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const refreshing = isRefreshing || decisionsLoading;

  return (
    <div className="flex flex-col gap-4" suppressHydrationWarning>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <Brain size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>AI BRAIN</h1>
            <p className="hidden sm:block" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Every decision the AI made, and what it learned</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={handleRefresh} disabled={refreshing}
            className="btn-ghost flex items-center gap-1.5"
            style={{ opacity: refreshing ? 0.7 : 1, cursor: refreshing ? "default" : "pointer" }}>
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
          </button>
          <button type="button" onClick={handleExport} className="btn-ghost flex items-center gap-1.5">
            <Download size={12} /> <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>
            {t}
            {t === "Decisions" && decisionFeed.length > 0 && (
              <span className="ml-1.5 rounded-full px-1.5 py-0.5 font-mono"
                style={{ fontSize: 9, background: "rgba(108,99,255,0.2)", color: "var(--accent-primary)" }}>
                {decisionFeed.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── DECISIONS TAB ──────────────────────────────────────────────── */}
      {activeTab === "Decisions" && (
        <div className="flex flex-col gap-4">
          {/* Mini stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[
              { label: "Total Cycles",  value: totalDecisions,                  color: "var(--text-primary)" },
              { label: "Traded",        value: tradedCount,                     color: "var(--color-bull)" },
              { label: "LONG signals",  value: longCount,                       color: "var(--color-bull)" },
              { label: "SHORT signals", value: shortCount,                      color: "var(--color-bear)" },
              { label: "Hold / Skip",   value: holdCount,                       color: "var(--text-muted)" },
            ].map((s) => (
              <div key={s.label} className="card" style={{ padding: "var(--space-3)" }}>
                <div className="section-label mb-1">{s.label}</div>
                <div className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Decision feed */}
          {decisionFeed.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 py-16">
              <Brain size={36} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
              <div style={{ fontSize: "var(--text-md)", color: "var(--text-muted)", textAlign: "center" }}>
                No AI decisions recorded yet.<br />
                <span style={{ fontSize: "var(--text-sm)" }}>Start the trading loop to see the AI's thinking here.</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {decisionFeed.map((d) => (
                <DecisionCard key={d.id} d={d} />
              ))}
              {decisionFeed.length >= decisionLimit && (
                <button
                  type="button"
                  onClick={() => setDecisionLimit((v) => v + 20)}
                  className="btn-ghost w-full py-3"
                  style={{ fontSize: "var(--text-sm)" }}>
                  Load 20 more decisions ↓
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── LEARNINGS TAB ─────────────────────────────────────────────── */}
      {(activeTab === "Learnings" || activeTab === "All") && (
        <div className="flex flex-col gap-4">
          {/* Top 3 insight cards + brain confidence */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex flex-col sm:flex-row gap-4 flex-1">
              {(topInsights ? topInsights.map((l, i) => ({
                n: i + 1,
                color: i === 1 ? "var(--color-bear)" : "var(--color-bull)",
                border: i === 1 ? "rgba(255,77,106,0.25)" : i === 2 ? "rgba(108,99,255,0.25)" : "rgba(38,208,124,0.25)",
                bg: i === 1 ? "rgba(255,77,106,0.06)" : i === 2 ? "rgba(108,99,255,0.06)" : "rgba(38,208,124,0.06)",
                icon: i === 1 ? "▼" : "▲",
                title: l.lesson_text ?? "",
                sub: l.watch_for ?? `Quality: ${l.quality_score}/5 · Pattern: ${l.pattern_type}`,
              })) : staticInsights).map((ins) => (
                <div key={ins.n} className="card flex-1" style={{ border: `1px solid ${ins.border}`, background: ins.bg }}>
                  <div className="section-label mb-2">AI LEARNED THIS WEEK</div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                      style={{ background: ins.color + "20", border: `1px solid ${ins.color}40` }}>
                      <span style={{ color: ins.color, fontSize: 14, fontWeight: 700 }}>{ins.icon}</span>
                    </div>
                    <div>
                      <div className="font-mono font-bold" style={{ fontSize: "var(--text-3xl)", color: ins.color, lineHeight: 1 }}>{ins.n}</div>
                    </div>
                  </div>
                  <p className="mt-2 font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5 }}>
                    {ins.title.length > 80 ? ins.title.slice(0, 80) + "…" : ins.title}
                  </p>
                  <p className="mt-1" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.4 }}>{ins.sub}</p>
                </div>
              ))}
            </div>
            <div className="card w-full md:w-[200px] md:shrink-0">
              <div className="section-label mb-2">Brain Confidence Score</div>
              <div className="font-mono font-bold" style={{ fontSize: "var(--text-hero)", color: "var(--text-primary)", lineHeight: 1 }}>{brainConf}</div>
              <div style={{ fontSize: "var(--text-md)", color: "var(--text-secondary)", fontWeight: 400 }}>/ 100</div>
              <div className="mt-1 font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--color-bull)" }}>{weeklyDelta}</div>
              <div className="mt-3"><Sparkline positive /></div>
              <div className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{realLessons.length} lessons · {totalTrades} decisions</div>
            </div>
          </div>

          {/* What the AI Is Learning */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="section-label">What the AI Is Learning</span>
            </div>
            <div className="flex flex-col gap-3">
              {sortedLessons.map((l) => (
                <div key={l.id} className="flex items-start gap-3" style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: 10 }}>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", minWidth: 52 }}>
                    {l.created_at ? new Date(l.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                  </span>
                  <CheckCircle size={13} style={{ color: "var(--color-bull)", flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      <span className="font-semibold" style={{ color: "var(--text-accent)" }}>Learned: </span>
                      {l.lesson_text}
                    </p>
                    {l.watch_for && (
                      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 4 }}>👁 Watch: {l.watch_for}</p>
                    )}
                  </div>
                </div>
              ))}
              {sortedLessons.length === 0 && (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>Learnings appear after the AI analyses closed trades.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── PATTERNS TAB ──────────────────────────────────────────────── */}
      {(activeTab === "Patterns" || activeTab === "All") && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="section-label" style={{ color: "var(--color-bull)" }}>Top Winning Patterns</span>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["#","Pattern","Win Rate","Trades","Expectancy"].map((h) => (
                    <th key={h} className="pb-2 text-left font-semibold pr-3" style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {winPatterns.length > 0 ? winPatterns.map((p) => (
                  <tr key={p.rank} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-muted)" }}>{p.rank}</td>
                    <td className="py-2 pr-3" style={{ color: "var(--text-primary)", fontWeight: 500 }}>{p.pattern}</td>
                    <td className="py-2 pr-3 font-mono font-bold" style={{ color: "var(--color-bull)" }}>{p.winRate}%</td>
                    <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-muted)" }}>{p.trades}</td>
                    <td className="py-2 font-mono font-bold" style={{ color: "var(--color-bull)" }}>+{p.expectancy.toFixed(2)}%</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="py-4 text-center" style={{ color: "var(--text-muted)" }}>No winning patterns yet.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="section-label" style={{ color: "var(--color-bear)" }}>Top Losing Patterns</span>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["#","Pattern","Win Rate","Trades","Expectancy"].map((h) => (
                    <th key={h} className="pb-2 text-left font-semibold pr-3" style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {losePatterns.length > 0 ? losePatterns.map((p) => (
                  <tr key={p.rank} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-muted)" }}>{p.rank}</td>
                    <td className="py-2 pr-3" style={{ color: "var(--text-primary)", fontWeight: 500 }}>{p.pattern}</td>
                    <td className="py-2 pr-3 font-mono font-bold" style={{ color: "var(--color-bear)" }}>{p.winRate}%</td>
                    <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-muted)" }}>{p.trades}</td>
                    <td className="py-2 font-mono font-bold" style={{ color: "var(--color-bear)" }}>{p.expectancy.toFixed(2)}%</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="py-4 text-center" style={{ color: "var(--text-muted)" }}>No losing patterns yet.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* ── RULES TAB ─────────────────────────────────────────────────── */}
      {(activeTab === "Rules" || activeTab === "All") && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="section-label">AI Recommended Rules</span>
          </div>
          <div className="flex flex-col gap-3">
            {computedRules.length > 0 ? computedRules.map((r, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg px-4 py-3"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <div className="flex items-center gap-3">
                  <CheckCircle size={15} style={{ color: "var(--color-bull)", flexShrink: 0 }} />
                  <div>
                    <div className="font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{r.title}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>
                      <span className="font-mono font-bold" style={{ color: "var(--text-muted)" }}>{r.impact}</span>
                    </div>
                  </div>
                </div>
                <span className={`badge ${r.badge === "HIGH" ? "badge-long" : "badge-neutral"}`}>{r.badge}</span>
              </div>
            )) : (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No high-quality rules yet (need quality_score ≥ 4).</p>
            )}
            {sortedLessons.slice(0, 3).map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-lg px-4 py-3"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                <Zap size={15} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                <div className="flex-1">
                  <div className="font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
                    {(l.lesson_text ?? "").slice(0, 100)}
                  </div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>
                    AI extracted · Quality: {l.quality_score ?? "—"}/5
                  </div>
                </div>
                <span className="badge badge-neutral">AI</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── COUNTERFACTUAL (shown in All tab) ─────────────────────────── */}
      {activeTab === "All" && (
        <div className="card">
          <div className="section-label mb-3">Counterfactual Matrix</div>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  {["Scenario Tested","Simulated P&L","Better?","Leading Indicator","Explanation"].map((h) => (
                    <th key={h} className="pb-2 text-left font-semibold pr-4 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {safeTrades.length > 0 ? (
                  (() => {
                    const cfs = safeTrades.filter((t) => t.counterfactuals?.scenarios).flatMap((t) => t.counterfactuals!.scenarios!);
                    return cfs.slice(0, 5).map((cf, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td className="py-2 pr-3 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{cf.name}</td>
                        <td className="py-2 pr-3 font-mono font-bold" style={{ color: cf.simulated_pnl_pct >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                          {cf.simulated_pnl_pct >= 0 ? "+" : ""}{cf.simulated_pnl_pct.toFixed(2)}%
                        </td>
                        <td className="py-2 pr-3 font-bold" style={{ color: cf.outcome_better ? "var(--color-bull)" : "var(--color-bear)" }}>
                          {cf.outcome_better ? "✓ Yes" : "✗ No"}
                        </td>
                        <td className="py-2 pr-3" style={{ color: "var(--text-secondary)" }}>{cf.leading_indicator}</td>
                        <td className="py-2" style={{ color: "var(--text-muted)" }}>{cf.explanation?.slice(0, 80)}</td>
                      </tr>
                    ));
                  })()
                ) : (
                  <tr><td colSpan={5} className="py-4 text-center" style={{ color: "var(--text-muted)" }}>No counterfactuals recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
