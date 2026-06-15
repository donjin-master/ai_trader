"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import useSWR, { mutate as swrMutate } from "swr";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import {
  BookOpen, Filter, Plus, Tag, FileText, ChevronDown, X, Check,
  Search, Brain, Zap, Clock, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { api, type Trade, type Lesson, type Watching } from "@/lib/api";
import { mockData } from "@/lib/mockData";

const POLL    = { refreshInterval: 30_000 };
const POLL_AI = { refreshInterval: 60_000 };
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const KNOWN_INSTRUMENTS = [
  "BTCUSD_PERP", "ETHUSD_PERP", "BNBUSD_PERP",
  "SOLUSD_PERP", "XRPUSD_PERP", "BTCUSD", "ETHUSD",
];

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

function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Fixed-position dropdown portal ──────────────────────────────────────────
// Renders the panel at document root so it's never clipped by any parent.

function FixedDropdown({
  anchorRef,
  open,
  onClose,
  align = "left",
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setPos({
      top: r.bottom + 6,
      left: align === "right" ? r.right : r.left,
      width: r.width,
    });
  }, [open, anchorRef, align]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      const insideAnchor = anchorRef.current?.contains(target) ?? false;
      const insidePanel  = panelRef.current?.contains(target)  ?? false;
      if (!insideAnchor && !insidePanel) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, anchorRef, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: pos.top,
        ...(align === "right" ? { right: window.innerWidth - pos.left - pos.width } : { left: pos.left }),
        zIndex: 9999,
        minWidth: Math.max(pos.width, 210),
      }}
    >
      {children}
    </div>,
    document.body
  );
}

// ── Instrument Dropdown ──────────────────────────────────────────────────────

function InstrumentDropdown({
  instruments,
  selected,
  onSelect,
}: {
  instruments: string[];
  selected: string | null;
  onSelect: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => { setOpen(false); setSearch(""); }, []);

  const all = ["All Instruments", ...Array.from(new Set([...instruments, ...KNOWN_INSTRUMENTS]))];
  const filtered = all.filter((i) => i.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 font-semibold"
        style={{
          background: open || selected ? "rgba(108,99,255,0.1)" : "var(--bg-input)",
          border: `1px solid ${selected ? "rgba(108,99,255,0.4)" : "var(--border-default)"}`,
          color: selected ? "var(--accent-primary)" : "var(--text-primary)",
          fontSize: "var(--text-sm)",
          minWidth: 160,
        }}
      >
        <span style={{ flex: 1, textAlign: "left" }}>{selected ?? "All Instruments"}</span>
        <ChevronDown size={13} style={{ color: "var(--text-secondary)", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      <FixedDropdown anchorRef={btnRef} open={open} onClose={close} align="left">
        <div style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-default)",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}>
          <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <Search size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search instruments..."
              style={{
                background: "transparent", border: "none", outline: "none",
                color: "var(--text-primary)", fontSize: "var(--text-xs)", width: "100%",
              }}
            />
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {filtered.map((inst) => {
              const isSel = inst === "All Instruments" ? selected === null : selected === inst;
              return (
                <button
                  key={inst}
                  type="button"
                  onClick={() => { onSelect(inst === "All Instruments" ? null : inst); close(); }}
                  className="flex items-center justify-between w-full px-3 py-2.5 text-left"
                  style={{
                    background: isSel ? "rgba(108,99,255,0.12)" : "transparent",
                    color: isSel ? "var(--accent-primary)" : "var(--text-primary)",
                    fontSize: "var(--text-sm)",
                  }}
                >
                  <span>{inst}</span>
                  {isSel && <Check size={12} />}
                </button>
              );
            })}
          </div>
        </div>
      </FixedDropdown>
    </div>
  );
}

// ── Filter Panel ─────────────────────────────────────────────────────────────

interface Filters {
  direction: "" | "long" | "short";
  status: "" | "open" | "closed" | "win" | "loss";
  dateFrom: string;
  dateTo: string;
  minConfidence: number;
}

function FilterButton({
  filters,
  onChange,
  onReset,
  activeCount,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost flex items-center gap-1.5"
        style={{
          background: open || activeCount > 0 ? "rgba(108,99,255,0.1)" : undefined,
          border: activeCount > 0 ? "1px solid rgba(108,99,255,0.4)" : undefined,
          color: activeCount > 0 ? "var(--accent-primary)" : undefined,
        }}
      >
        <Filter size={13} />
        Filters
        {activeCount > 0 && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full font-bold"
            style={{ background: "var(--accent-primary)", color: "#fff", fontSize: 9 }}>
            {activeCount}
          </span>
        )}
      </button>

      <FixedDropdown anchorRef={btnRef} open={open} onClose={close} align="right">
        <div style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-default)",
          borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          padding: "16px",
          width: 300,
        }}>
          <div className="flex items-center justify-between mb-4">
            <span className="font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>Filters</span>
            <button type="button" onClick={close}><X size={14} style={{ color: "var(--text-secondary)" }} /></button>
          </div>

          <div className="mb-3">
            <div className="section-label mb-2">Direction</div>
            <div className="flex gap-2">
              {(["", "long", "short"] as const).map((d) => (
                <button key={d || "all"} type="button" onClick={() => onChange({ ...filters, direction: d })}
                  className="rounded-lg px-3 py-1 font-semibold"
                  style={{
                    fontSize: "var(--text-xs)",
                    background: filters.direction === d ? (d === "long" ? "rgba(38,208,124,0.2)" : d === "short" ? "rgba(255,77,106,0.2)" : "rgba(108,99,255,0.2)") : "var(--bg-elevated)",
                    border: `1px solid ${filters.direction === d ? (d === "long" ? "var(--color-bull)" : d === "short" ? "var(--color-bear)" : "var(--accent-primary)") : "var(--border-subtle)"}`,
                    color: filters.direction === d ? (d === "long" ? "var(--color-bull)" : d === "short" ? "var(--color-bear)" : "var(--accent-primary)") : "var(--text-secondary)",
                  }}>
                  {d === "" ? "All" : d.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <div className="section-label mb-2">Status</div>
            <div className="flex flex-wrap gap-2">
              {(["", "win", "loss", "open", "closed"] as const).map((s) => (
                <button key={s || "all"} type="button" onClick={() => onChange({ ...filters, status: s })}
                  className="rounded-lg px-3 py-1 font-semibold"
                  style={{
                    fontSize: "var(--text-xs)",
                    background: filters.status === s ? "rgba(108,99,255,0.2)" : "var(--bg-elevated)",
                    border: `1px solid ${filters.status === s ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    color: filters.status === s ? "var(--accent-primary)" : "var(--text-secondary)",
                  }}>
                  {s === "" ? "All" : s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <div className="section-label mb-2">Date Range</div>
            <div className="flex gap-2 items-center">
              <input type="date" value={filters.dateFrom} onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
                style={{ flex: 1, background: "var(--bg-input)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "4px 8px", color: "var(--text-primary)", fontSize: "var(--text-xs)" }} />
              <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>—</span>
              <input type="date" value={filters.dateTo} onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
                style={{ flex: 1, background: "var(--bg-input)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "4px 8px", color: "var(--text-primary)", fontSize: "var(--text-xs)" }} />
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="section-label">Min Confidence</span>
              <span className="font-mono font-bold" style={{ fontSize: "var(--text-xs)", color: "var(--accent-primary)" }}>{filters.minConfidence}/10</span>
            </div>
            <input type="range" min={0} max={10} value={filters.minConfidence}
              onChange={(e) => onChange({ ...filters, minConfidence: Number(e.target.value) })}
              style={{ width: "100%", accentColor: "var(--accent-primary)" }} />
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => { onReset(); close(); }} className="btn-ghost flex-1" style={{ fontSize: "var(--text-xs)" }}>Reset</button>
            <button type="button" onClick={close} className="btn-primary flex-1" style={{ fontSize: "var(--text-xs)" }}>Apply</button>
          </div>
        </div>
      </FixedDropdown>
    </div>
  );
}

// ── Ask AI Modal ─────────────────────────────────────────────────────────────

function AskAIModal({
  onClose,
  lastDecision,
  watching,
  lessons,
}: {
  onClose: () => void;
  lastDecision: Trade | null;
  watching: Watching | null;
  lessons: Lesson[];
}) {
  const verdict = lastDecision?.direction ?? lastDecision?.action ?? "hold";
  const verdictUpper = verdict.toUpperCase();
  const verdictColor = verdict === "long" ? "var(--color-bull)" : verdict === "short" ? "var(--color-bear)" : "var(--text-muted)";
  const VIcon = verdict === "long" ? TrendingUp : verdict === "short" ? TrendingDown : Minus;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-2xl mx-4 rounded-xl overflow-hidden flex flex-col"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)", boxShadow: "0 12px 48px rgba(0,0,0,0.7)", maxHeight: "88vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.15)", border: "1px solid rgba(108,99,255,0.3)" }}>
            <Brain size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="flex-1">
            <div className="font-bold" style={{ fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>AI Brain — Last Cycle</div>
            <div className="flex items-center gap-2">
              <Clock size={11} style={{ color: "var(--text-muted)" }} />
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {lastDecision?.created_at ? timeAgo(lastDecision.created_at) : "No decisions yet"}
                {lastDecision?.instrument ? ` · ${lastDecision.instrument}` : ""}
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0"
            style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 flex flex-col gap-5">
          {!lastDecision ? (
            <div className="text-center py-12" style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
              No AI decisions yet. Run the trading loop to see AI insights here.
            </div>
          ) : (
            <>
              {/* Verdict banner */}
              <div className="rounded-xl p-4 flex items-center gap-4"
                style={{ background: `${verdictColor}12`, border: `1px solid ${verdictColor}30` }}>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: `${verdictColor}20` }}>
                  <VIcon size={22} style={{ color: verdictColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold" style={{ fontSize: "var(--text-2xl)", color: verdictColor }}>{verdictUpper}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                    Confidence {lastDecision.confidence ?? lastDecision.boardroom_confidence ?? "—"}/10
                    {lastDecision.setup_score != null && ` · Setup score ${lastDecision.setup_score}`}
                    {lastDecision.setup_grade && ` (${lastDecision.setup_grade})`}
                  </div>
                </div>
                {lastDecision.key_signals && lastDecision.key_signals.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 justify-end" style={{ maxWidth: 200 }}>
                    {lastDecision.key_signals.slice(0, 4).map((s, i) => (
                      <span key={i} className="rounded-full px-2 py-0.5 font-semibold"
                        style={{ fontSize: 9, background: "rgba(108,99,255,0.15)", border: "1px solid rgba(108,99,255,0.25)", color: "var(--accent-primary)" }}>
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Reasoning */}
              {lastDecision.reasoning && (
                <div>
                  <div className="section-label mb-2">Judge Reasoning</div>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                    {lastDecision.reasoning}
                  </p>
                </div>
              )}

              {/* Bull vs Bear */}
              {(lastDecision.bull_case || lastDecision.bear_case) && (
                <div className="grid grid-cols-2 gap-3">
                  {lastDecision.bull_case && (
                    <div className="rounded-lg p-3" style={{ background: "rgba(38,208,124,0.07)", border: "1px solid rgba(38,208,124,0.2)" }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <TrendingUp size={12} style={{ color: "var(--color-bull)" }} />
                        <span className="font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--color-bull)" }}>BULL CASE</span>
                      </div>
                      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.6 }}>{lastDecision.bull_case}</p>
                    </div>
                  )}
                  {lastDecision.bear_case && (
                    <div className="rounded-lg p-3" style={{ background: "rgba(255,77,106,0.07)", border: "1px solid rgba(255,77,106,0.2)" }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <TrendingDown size={12} style={{ color: "var(--color-bear)" }} />
                        <span className="font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--color-bear)" }}>BEAR CASE</span>
                      </div>
                      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.6 }}>{lastDecision.bear_case}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Boardroom votes */}
              {lastDecision.boardroom_votes?.votes && lastDecision.boardroom_votes.votes.length > 0 && (
                <div>
                  <div className="section-label mb-2">Boardroom Votes</div>
                  <div className="flex flex-col gap-2">
                    {lastDecision.boardroom_votes.votes.map((v, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2"
                        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
                        <div className="font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", minWidth: 80 }}>{v.member}</div>
                        <div className="font-bold" style={{
                          fontSize: "var(--text-xs)",
                          color: v.vote === "long" ? "var(--color-bull)" : v.vote === "short" ? "var(--color-bear)" : "var(--text-muted)",
                        }}>
                          {v.vote?.toUpperCase()}
                        </div>
                        <div className="flex-1 font-mono text-right" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>
                          {v.conviction}/10
                        </div>
                        {v.primary_reason && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)", maxWidth: 200, textAlign: "right" }}>{v.primary_reason}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Co-pilot checklist from watching */}
              {watching && (
                <div>
                  <div className="section-label mb-2">Co-Pilot Checklist</div>
                  <div className="flex flex-col gap-1.5">
                    {watching.watching.map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                          style={{ background: item.met ? "rgba(38,208,124,0.15)" : "rgba(255,77,106,0.1)" }}>
                          {item.met
                            ? <Check size={9} style={{ color: "var(--color-bull)" }} />
                            : <X size={9} style={{ color: "var(--color-bear)" }} />
                          }
                        </div>
                        <span style={{ fontSize: "var(--text-xs)", color: item.met ? "var(--text-primary)" : "var(--text-muted)" }}>{item.condition}</span>
                      </div>
                    ))}
                  </div>
                  {watching.why_not.length > 0 && (
                    <div className="mt-2 rounded-lg px-3 py-2" style={{ background: "rgba(255,77,106,0.07)", border: "1px solid rgba(255,77,106,0.2)" }}>
                      <div className="section-label mb-1" style={{ color: "var(--color-bear)" }}>Why AI didn't trade</div>
                      {watching.why_not.map((r, i) => (
                        <div key={i} style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>• {r}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Skip reason */}
              {lastDecision.decision_json?.skip_reason && (
                <div className="rounded-lg px-3 py-2.5" style={{ background: "rgba(255,163,7,0.07)", border: "1px solid rgba(255,163,7,0.25)" }}>
                  <span className="font-semibold" style={{ fontSize: "var(--text-xs)", color: "#ffa307" }}>⚠ Skipped: </span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{lastDecision.decision_json.skip_reason}</span>
                </div>
              )}
            </>
          )}

          {/* Recent Lessons */}
          {lessons.length > 0 && (
            <div>
              <div className="section-label mb-2">What AI Has Learned</div>
              <div className="flex flex-col gap-2">
                {lessons.slice(0, 4).map((l) => (
                  <div key={l.id} className="rounded-lg px-3 py-2.5"
                    style={{ background: "rgba(108,99,255,0.07)", border: "1px solid rgba(108,99,255,0.18)" }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold" style={{ fontSize: 10, color: "var(--accent-primary)" }}>
                        {l.pattern_type ?? "LESSON"}
                      </span>
                      {l.confidence_score != null && (
                        <span className="font-mono" style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          conf {l.confidence_score}/10
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{l.lesson_text}</p>
                    {l.watch_for && (
                      <p style={{ fontSize: 10, color: "var(--color-bull)", marginTop: 4 }}>👁 {l.watch_for}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 shrink-0" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <Link href="/brain"
            className="flex items-center justify-center gap-2 w-full rounded-lg py-2.5 font-semibold"
            style={{ background: "rgba(108,99,255,0.15)", border: "1px solid rgba(108,99,255,0.3)", color: "var(--accent-primary)", fontSize: "var(--text-sm)" }}
            onClick={onClose}>
            <Brain size={15} /> Open Full AI Brain →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── New Entry Modal ──────────────────────────────────────────────────────────

function NewEntryModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [instrument, setInstrument] = useState("BTCUSD_PERP");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [tp1, setTp1] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [isLogOnly, setIsLogOnly] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!entryPrice || !stopLoss || !tp1) { setError("Entry price, stop loss, and TP1 are required."); return; }
    setSubmitting(true); setError("");
    const body = {
      instrument, direction,
      entry_type: "market",
      entry_price: parseFloat(entryPrice),
      stop_loss: parseFloat(stopLoss),
      tp1: parseFloat(tp1), tp2: parseFloat(tp1),
      size_mode: "risk_percent", size_value: 0.5,
      reasoning: notes || `Manual journal entry — ${direction.toUpperCase()} ${instrument}`,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      log_only: isLogOnly, skip_execution: isLogOnly,
    };
    try {
      const res = await fetch(`${API_URL}/api/trades/manual`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.detail ?? d.error ?? "Failed to create entry");
      } else {
        await swrMutate("all-trades");
        onSuccess(); onClose();
      }
    } catch { setError("Network error. Is the backend running?"); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-lg mx-4 rounded-xl overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)", boxShadow: "0 12px 48px rgba(0,0,0,0.7)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div>
            <div className="font-bold" style={{ fontSize: "var(--text-lg)", color: "var(--text-primary)" }}>New Journal Entry</div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Log a trade for your journal</div>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}><X size={14} /></button>
        </div>
        <div className="p-5 flex flex-col gap-4" style={{ maxHeight: "68vh", overflowY: "auto" }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="section-label mb-1.5">Instrument</div>
              <select value={instrument} onChange={(e) => setInstrument(e.target.value)}
                style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-default)", borderRadius: 8, padding: "6px 10px", color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>
                {KNOWN_INSTRUMENTS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <div className="section-label mb-1.5">Direction</div>
              <div className="flex gap-2">
                {(["long", "short"] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setDirection(d)} className="flex-1 rounded-lg py-1.5 font-bold"
                    style={{
                      fontSize: "var(--text-sm)",
                      background: direction === d ? (d === "long" ? "rgba(38,208,124,0.2)" : "rgba(255,77,106,0.2)") : "var(--bg-elevated)",
                      border: `1px solid ${direction === d ? (d === "long" ? "var(--color-bull)" : "var(--color-bear)") : "var(--border-subtle)"}`,
                      color: direction === d ? (d === "long" ? "var(--color-bull)" : "var(--color-bear)") : "var(--text-secondary)",
                    }}>
                    {d.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Entry Price", value: entryPrice, set: setEntryPrice, placeholder: "e.g. 64000" },
              { label: "Stop Loss",   value: stopLoss,   set: setStopLoss,   placeholder: "e.g. 63200" },
              { label: "Take Profit", value: tp1,        set: setTp1,        placeholder: "e.g. 65500" },
            ].map(({ label, value, set, placeholder }) => (
              <div key={label}>
                <div className="section-label mb-1.5">{label}</div>
                <input type="number" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder}
                  style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-default)", borderRadius: 8, padding: "6px 10px", color: "var(--text-primary)", fontSize: "var(--text-sm)" }} />
              </div>
            ))}
          </div>
          <div>
            <div className="section-label mb-1.5">Notes / Reasoning</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Why did you take this trade? What was the setup?" rows={3}
              style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", color: "var(--text-primary)", fontSize: "var(--text-sm)", resize: "vertical", lineHeight: 1.5 }} />
          </div>
          <div>
            <div className="section-label mb-1.5">Tags <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(comma-separated)</span></div>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. SMC, Breakout, London Open"
              style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-default)", borderRadius: 8, padding: "6px 10px", color: "var(--text-primary)", fontSize: "var(--text-sm)" }} />
          </div>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
            <button type="button" onClick={() => setIsLogOnly((v) => !v)} className="flex-shrink-0 rounded-full relative"
              style={{ width: 36, height: 20, background: isLogOnly ? "var(--accent-primary)" : "var(--bg-input)", border: "1px solid var(--border-default)", transition: "background 0.15s" }}>
              <span style={{ position: "absolute", top: 2, left: isLogOnly ? 18 : 2, width: 14, height: 14, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
            </button>
            <div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: 600 }}>Journal only (no order placed)</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {isLogOnly ? "Logged for your records — NOT sent to exchange" : "Will be executed on exchange"}
              </div>
            </div>
          </div>
          {error && (
            <div className="rounded-lg px-3 py-2"
              style={{ background: "rgba(255,77,106,0.1)", border: "1px solid rgba(255,77,106,0.3)", color: "var(--color-bear)", fontSize: "var(--text-xs)" }}>
              {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-5 py-4" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1"
            style={{ opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Saving..." : isLogOnly ? "Log Entry" : "Place Trade"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function JournalPage() {
  const [activeTab, setActiveTab]         = useState("All Trades");
  const [selectedInstrument, setSelInst] = useState<string | null>(null);
  const [showNewEntry, setShowNewEntry]   = useState(false);
  const [showAskAI, setShowAskAI]         = useState(false);
  const [filters, setFilters]             = useState<Filters>({
    direction: "", status: "", dateFrom: "", dateTo: "", minConfidence: 0,
  });

  const tabs = ["All Trades", "Wins", "Losses", "Open", "Reflections", "Attachments"];

  const { data: rawTrades }  = useSWR<Trade[]  | null>("all-trades",   () => api.trades(100, 0),   POLL);
  const { data: decisions }  = useSWR<Trade[]  | null>("decisions-5",  () => api.decisions(5),     POLL_AI);
  const { data: watching }   = useSWR<Watching | null>("watching",     () => api.watching(),       POLL_AI);
  const { data: lessons }    = useSWR<Lesson[] | null>("lessons",      () => api.lessons(),        POLL_AI);

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);

  if (!isMounted) {
    return <div className="p-8 text-center" style={{ color: "var(--text-muted)" }}>Loading Journal...</div>;
  }

  const allTrades        = (rawTrades ?? []).filter((t) => t.status !== "logged_only" || t.entry_price);
  const tradeInstruments = Array.from(new Set(allTrades.map((t) => t.instrument).filter(Boolean) as string[]));
  const lastDecision     = decisions?.[0] ?? null;
  const recentLessons    = lessons ?? [];

  const closed  = allTrades.filter((t) => t.status === "closed");
  const wins    = closed.filter((t) => (t.pnl_pct ?? 0) > 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const totalPnlPct = closed.reduce((s, t) => s + (t.pnl_pct ?? 0), 0);
  const avgRR   = closed.length > 0
    ? closed.reduce((s, t) => s + (t.boardroom_confidence ?? t.confidence ?? 2), 0) / closed.length
    : 1.76;
  const pnlValues = closed.map((t) => t.pnl_pct ?? 0);
  const bestPnl  = pnlValues.length ? Math.max(...pnlValues) : 0;
  const worstPnl = pnlValues.length ? Math.min(...pnlValues) : 0;

  const profitableCount    = closed.filter((t) => (t.pnl_pct ?? 0) > 0).length;
  const breakEvenCount     = closed.filter((t) => (t.pnl_pct ?? 0) === 0).length;
  const losingCount        = closed.filter((t) => (t.pnl_pct ?? 0) < 0).length;
  const totalClosedForStats = closed.length || 1;

  const dynamicPnlDistribution = closed.length > 0 ? [
    { name: "Profitable",  value: Math.round((profitableCount / totalClosedForStats) * 100), color: "var(--color-bull)" },
    { name: "Losing",      value: Math.round((losingCount / totalClosedForStats) * 100),     color: "var(--color-bear)" },
    { name: "Break-even",  value: Math.round((breakEvenCount / totalClosedForStats) * 100),  color: "var(--color-purple)" },
  ] : [
    { name: "Profitable", value: 58, color: "var(--color-bull)" },
    { name: "Losing",     value: 35, color: "var(--color-bear)" },
    { name: "Break-even", value: 7,  color: "var(--color-purple)" },
  ];

  const dynamicSetupPerformance = (() => {
    if (!closed.length) return [
      { setup: "SMC Breakout",   trades: 22, winRate: 73, expectancy: 2.41, pf: 2.1 },
      { setup: "Trend Follow",   trades: 18, winRate: 67, expectancy: 1.89, pf: 1.8 },
      { setup: "London Open",    trades: 15, winRate: 60, expectancy: 1.52, pf: 1.6 },
      { setup: "Liquidity Hunt", trades: 12, winRate: 42, expectancy: -0.54, pf: 0.9 },
    ];
    const setups: Record<string, { wins: number; trades: number; pnl: number }> = {};
    for (const t of closed) {
      const s = t.key_signals?.length ? t.key_signals[0].substring(0, 20) : "System Trade";
      if (!setups[s]) setups[s] = { wins: 0, trades: 0, pnl: 0 };
      setups[s].trades++;
      setups[s].pnl += (t.pnl_pct ?? 0);
      if ((t.pnl_pct ?? 0) > 0) setups[s].wins++;
    }
    return Object.entries(setups).map(([setup, stats]) => ({
      setup, trades: stats.trades,
      winRate: Math.round((stats.wins / stats.trades) * 100),
      expectancy: stats.pnl / stats.trades,
      pf: stats.pnl > 0 ? 1.5 : 0.8,
    })).sort((a, b) => b.expectancy - a.expectancy).slice(0, 5);
  })();

  const equityCurve = (() => {
    if (!closed.length) return mockData.equityCurve;
    let running = 0;
    const byMonth: Record<string, number> = {};
    for (const t of closed) {
      if (!t.created_at) continue;
      const key = new Date(t.created_at).toLocaleString("en-US", { month: "short" });
      byMonth[key] = (byMonth[key] ?? 0) + (t.pnl_pct ?? 0);
    }
    return Object.entries(byMonth).map(([month, pnl]) => {
      running += pnl;
      return { month, value: parseFloat(running.toFixed(2)) };
    });
  })();

  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const calendarDates = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const tradesOnDay = allTrades.filter((t) => t.created_at && new Date(t.created_at).getDate() === d);
    return { day: d, outcome: tradesOnDay.length > 0 ? resultLabel(tradesOnDay[tradesOnDay.length - 1]) : null };
  });

  const activeFiltersCount = [
    selectedInstrument, filters.direction, filters.status,
    filters.dateFrom, filters.dateTo, filters.minConfidence > 0 ? "yes" : "",
  ].filter(Boolean).length;

  const filteredTrades = allTrades.filter((t) => {
    const r = resultLabel(t);
    if (activeTab === "Wins")   { if (r !== "WIN")  return false; }
    if (activeTab === "Losses") { if (r !== "LOSS") return false; }
    if (activeTab === "Open")   { if (r !== "OPEN") return false; }
    if (selectedInstrument && t.instrument !== selectedInstrument) return false;
    if (filters.direction && (t.direction ?? t.action) !== filters.direction) return false;
    if (filters.status) {
      if (filters.status === "open"   && r !== "OPEN")          return false;
      if (filters.status === "closed" && t.status !== "closed") return false;
      if (filters.status === "win"    && r !== "WIN")           return false;
      if (filters.status === "loss"   && r !== "LOSS")          return false;
    }
    if (filters.dateFrom && t.created_at && new Date(t.created_at) < new Date(filters.dateFrom)) return false;
    if (filters.dateTo   && t.created_at && new Date(t.created_at) > new Date(filters.dateTo + "T23:59:59")) return false;
    const conf = t.confidence ?? t.boardroom_confidence ?? 0;
    if (filters.minConfidence > 0 && conf < filters.minConfidence) return false;
    return true;
  });

  function resetFilters() {
    setFilters({ direction: "", status: "", dateFrom: "", dateTo: "", minConfidence: 0 });
    setSelInst(null);
  }

  // AI insights derived from last decision + watching
  const verdict       = lastDecision?.direction ?? lastDecision?.action;
  const verdictColor  = verdict === "long" ? "var(--color-bull)" : verdict === "short" ? "var(--color-bear)" : "var(--text-muted)";
  const copilotMet    = watching?.watching?.filter((w) => w.met).length ?? 0;
  const copilotTotal  = watching?.watching?.length ?? 5;

  return (
    <div className="flex flex-col gap-4" suppressHydrationWarning>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <BookOpen size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div>
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>JOURNAL</h1>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Track, analyze, and learn from every trade</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <InstrumentDropdown
            instruments={tradeInstruments}
            selected={selectedInstrument}
            onSelect={setSelInst}
          />
          <FilterButton
            filters={filters}
            onChange={setFilters}
            onReset={resetFilters}
            activeCount={activeFiltersCount}
          />
          {activeFiltersCount > 0 && (
            <button type="button" onClick={resetFilters}
              style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Clear
            </button>
          )}
          <button type="button" onClick={() => setShowNewEntry(true)} className="btn-primary flex items-center gap-1.5">
            <Plus size={13} /> New Entry
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {tabs.map((t) => (
          <button key={t} type="button" className={`tab${activeTab === t ? " active" : ""}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {/* Stats strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
        {[
          { label: "Total Trades", value: allTrades.length,                sub: `${closed.length} closed`,               subColor: "var(--text-muted)" },
          { label: "Win Rate",     value: `${winRate.toFixed(1)}%`,        sub: `${wins.length}W / ${closed.length - wins.length}L`, subColor: winRate >= 50 ? "var(--color-bull)" : "var(--color-bear)" },
          { label: "Total P&L",   value: `${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`, sub: "Cumulative", subColor: totalPnlPct >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
          { label: "Avg R:R",     value: `1:${avgRR.toFixed(2)}`,          sub: "Last trades",    subColor: "var(--text-muted)" },
          { label: "Best Trade",  value: `+${bestPnl.toFixed(2)}%`,        sub: "Max single gain",subColor: "var(--color-bull)" },
          { label: "Worst Trade", value: `${worstPnl.toFixed(2)}%`,        sub: "Max single loss",subColor: "var(--color-bear)" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "var(--space-3)" }}>
            <div className="section-label mb-1">{s.label}</div>
            <div className="font-mono font-bold" style={{ fontSize: "var(--text-xl)", color: "var(--text-primary)" }}>{s.value}</div>
            <div style={{ fontSize: "var(--text-xs)", color: s.subColor, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "3fr 2fr" }}>
        <div className="flex flex-col gap-4">
          {/* Equity Curve */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="section-label">Equity Curve {selectedInstrument ? `— ${selectedInstrument}` : ""}</span>
              <button type="button" className="btn-ghost" style={{ padding: "3px 10px", fontSize: "var(--text-xs)" }}>Cumulative P&L ▼</button>
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={equityCurve} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                <defs>
                  <linearGradient id="ecGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#26d07c" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#26d07c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#4a5568", fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ background: "#141920", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => [`${v}%`, "P&L"]} />
                <Area type="monotone" dataKey="value" stroke="#26d07c" strokeWidth={2} fill="url(#ecGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* P&L Distribution */}
          <div className="card">
            <div className="section-label mb-3">P&L Distribution</div>
            <div className="flex items-center gap-6">
              <PieChart width={110} height={110}>
                <Pie data={dynamicPnlDistribution} cx={54} cy={54} innerRadius={32} outerRadius={50} dataKey="value" stroke="none" paddingAngle={2}>
                  {dynamicPnlDistribution.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
              </PieChart>
              <div className="flex flex-col gap-2 flex-1">
                {dynamicPnlDistribution.map((d) => (
                  <div key={d.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{d.name}</span>
                    </div>
                    <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{d.value}%</span>
                  </div>
                ))}
                <div className="pt-1" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Total: </span>
                  <span className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{allTrades.length} Trades</span>
                </div>
              </div>
            </div>
          </div>

          {/* Trades Table */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="section-label">
                {selectedInstrument ? `${selectedInstrument} Trades` : "Recent Trades"}
              </span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {filteredTrades.length} shown
                {activeFiltersCount > 0 && <span style={{ color: "var(--accent-primary)" }}> (filtered)</span>}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    {["Date", "Instrument", "Dir", "Status", "Confidence", "P&L%", "Duration"].map((h) => (
                      <th key={h} className="pb-2 text-left font-semibold pr-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTrades.slice(0, 15).map((t) => {
                    const res = resultLabel(t);
                    const dur = t.duration_mins != null ? `${Math.floor(t.duration_mins / 60)}h ${t.duration_mins % 60}m` : "—";
                    return (
                      <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td className="py-2 pr-3 font-mono whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                          {t.created_at ? new Date(t.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                        </td>
                        <td className="py-2 pr-3 font-semibold whitespace-nowrap">
                          <Link href={`/journal/${t.id}`} style={{ color: "var(--text-primary)" }}>{t.instrument ?? "—"}</Link>
                        </td>
                        <td className="py-2 pr-3 font-bold whitespace-nowrap"
                          style={{ color: (t.direction ?? t.action) === "long" ? "var(--color-bull)" : (t.direction ?? t.action) === "short" ? "var(--color-bear)" : "var(--text-muted)" }}>
                          {(t.direction ?? t.action ?? "—").toUpperCase()}
                        </td>
                        <td className="py-2 pr-3 font-bold" style={{ color: resultColor(res) }}>{res}</td>
                        <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-primary)" }}>{t.confidence ?? t.boardroom_confidence ?? "—"}/10</td>
                        <td className="py-2 pr-3 font-mono font-bold whitespace-nowrap"
                          style={{ color: (t.pnl_pct ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                          {t.pnl_pct != null ? `${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(2)}%` : "—"}
                        </td>
                        <td className="py-2 font-mono whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{dur}</td>
                      </tr>
                    );
                  })}
                  {filteredTrades.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center" style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                        No trades match the current filters.{" "}
                        {activeFiltersCount > 0 && (
                          <button type="button" onClick={resetFilters} style={{ color: "var(--accent-primary)" }}>Clear filters</button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredTrades.length > 15 && (
              <button type="button" style={{ fontSize: "var(--text-xs)", color: "var(--accent-primary)", marginTop: 8 }}>
                View All {filteredTrades.length} Trades →
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Trade Calendar */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <span className="section-label">Trade Calendar</span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {today.toLocaleString("en-US", { month: "long", year: "numeric" })}
              </span>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {weekDays.map((d) => <div key={d} className="text-center" style={{ fontSize: "9px", color: "var(--text-muted)", fontWeight: 600 }}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarDates.map(({ day, outcome }) => (
                <div key={day} className="flex flex-col items-center">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{
                    fontSize: "9px",
                    background: day === today.getDate() ? "var(--accent-primary)" : "transparent",
                    color: day === today.getDate() ? "#fff" : "var(--text-secondary)",
                    fontWeight: day === today.getDate() ? 700 : 400,
                  }}>{day}</div>
                  {outcome && <div className="h-1 w-1 rounded-full mt-0.5" style={{ background: resultColor(outcome) }} />}
                </div>
              ))}
            </div>
          </div>

          {/* Top Tags */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Tag size={13} style={{ color: "var(--text-secondary)" }} />
              <span className="section-label">Top Tags</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {[["SMC",28],["Breakout",22],["Trend",18],["London",15],["EMA",14],["Reversal",11],["Range",9],["News",6]].map(([tag, count]) => (
                <div key={tag} className="flex items-center gap-1 rounded-full px-2.5 py-1"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                  {tag} <span className="font-mono font-bold" style={{ color: "var(--text-primary)" }}>{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Reflections */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <FileText size={13} style={{ color: "var(--text-secondary)" }} />
              <span className="section-label">Recent Reflections</span>
            </div>
            <div className="flex flex-col gap-3">
              {allTrades.filter((t) => t.reflection?.lesson).slice(0, 3).map((t, i) => (
                <div key={t.id} style={{ borderBottom: i < 2 ? "1px solid var(--border-subtle)" : "none", paddingBottom: i < 2 ? 10 : 0 }}>
                  <div style={{ fontSize: "9px", color: "var(--text-muted)", marginBottom: 3 }}>
                    {t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"} · {t.instrument}
                  </div>
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {t.reflection?.lesson ?? t.reflection?.what_went_right ?? "—"}
                  </p>
                </div>
              ))}
              {allTrades.filter((t) => t.reflection?.lesson).length === 0 && (
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>No reflections yet. Trades will be analyzed automatically.</p>
              )}
            </div>
          </div>

          {/* AI Insights — real data from last cycle */}
          <div className="card" style={{ background: "var(--bg-elevated)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="section-label">AI Insights</div>
              {lastDecision?.created_at && (
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  <Clock size={10} style={{ display: "inline", marginRight: 3 }} />
                  {timeAgo(lastDecision.created_at)}
                </span>
              )}
            </div>

            {/* Last cycle verdict */}
            {lastDecision ? (
              <div className="rounded-lg px-3 py-2.5 mb-3 flex items-center gap-3"
                style={{ background: `${verdictColor}10`, border: `1px solid ${verdictColor}25` }}>
                <div>
                  <div className="font-bold" style={{ fontSize: "var(--text-lg)", color: verdictColor }}>
                    {(verdict ?? "HOLD").toUpperCase()}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{lastDecision.instrument}</div>
                </div>
                <div className="flex-1">
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {lastDecision.reasoning?.slice(0, 120) ?? "—"}
                    {(lastDecision.reasoning?.length ?? 0) > 120 ? "…" : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
                    {lastDecision.confidence ?? lastDecision.boardroom_confidence ?? "—"}/10
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)" }}>confidence</div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg px-3 py-2.5 mb-3"
                style={{ background: "rgba(108,99,255,0.07)", border: "1px solid rgba(108,99,255,0.15)" }}>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  No AI decisions yet. Run the trading loop to see insights.
                </p>
              </div>
            )}

            {/* Co-pilot checklist mini */}
            {watching?.watching && watching.watching.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.08em" }}>CO-PILOT CHECKLIST</span>
                  <span style={{ fontSize: 10, color: copilotMet >= copilotTotal - 1 ? "var(--color-bull)" : "var(--text-muted)" }}>
                    {copilotMet}/{copilotTotal} met
                  </span>
                </div>
                {watching.watching.slice(0, 4).map((item, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1">
                    <div className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full"
                      style={{ background: item.met ? "rgba(38,208,124,0.2)" : "rgba(100,100,120,0.2)" }}>
                      {item.met
                        ? <Check size={8} style={{ color: "var(--color-bull)" }} />
                        : <Minus size={8} style={{ color: "var(--text-muted)" }} />
                      }
                    </div>
                    <span style={{ fontSize: 10, color: item.met ? "var(--text-secondary)" : "var(--text-muted)" }}>{item.condition}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Recent lessons mini */}
            {recentLessons.slice(0, 2).map((l, i) => (
              <div key={l.id} className="flex items-start gap-2 mb-2">
                <Zap size={11} style={{ color: "var(--accent-primary)", marginTop: 1, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {l.lesson_text?.slice(0, 90)}{(l.lesson_text?.length ?? 0) > 90 ? "…" : ""}
                </span>
              </div>
            ))}
            {recentLessons.length === 0 && !lastDecision && (
              <div className="flex items-start gap-2 mb-2">
                <Zap size={11} style={{ color: "var(--accent-primary)", marginTop: 1 }} />
                <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>AI learns from each trade automatically</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowAskAI(true)}
              className="w-full rounded-lg py-2 font-semibold flex items-center justify-center gap-2"
              style={{ background: "rgba(108,99,255,0.15)", border: "1px solid rgba(108,99,255,0.3)", color: "var(--accent-primary)", fontSize: "var(--text-sm)", marginTop: 4 }}>
              <Brain size={14} /> What is AI thinking?
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* Latest Reflection */}
        <div className="card">
          <div className="section-label mb-3">Latest Reflection</div>
          {(() => {
            const t = allTrades.find((trade) => trade.reflection);
            if (!t) return <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No reflections yet.</p>;
            return (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}</span>
                  <span className={`badge ${(t.pnl_pct ?? 0) >= 0 ? "badge-long" : "badge-short"}`}>{(t.pnl_pct ?? 0) >= 0 ? "WIN" : "LOSS"}</span>
                </div>
                <div className="flex flex-col gap-3">
                  {t.reflection?.what_went_right && (
                    <div>
                      <div className="font-semibold mb-1" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>What went well?</div>
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5 }}>{t.reflection.what_went_right}</p>
                    </div>
                  )}
                  {t.reflection?.what_went_wrong && (
                    <div>
                      <div className="font-semibold mb-1" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>What can be improved?</div>
                      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5 }}>{t.reflection.what_went_wrong}</p>
                    </div>
                  )}
                  {t.reflection?.lesson && (
                    <div className="rounded-lg px-3 py-2" style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
                      <span className="font-semibold" style={{ fontSize: "var(--text-xs)", color: "var(--accent-primary)" }}>💡 LESSON: </span>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{t.reflection.lesson}</span>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>

        {/* Performance by Setup */}
        <div className="card">
          <div className="section-label mb-3">Performance by Setup</div>
          <table className="w-full" style={{ fontSize: "var(--text-xs)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {["Setup","Trades","Win Rate","Expectancy","P.Factor"].map((h) => (
                  <th key={h} className="pb-2 text-left font-semibold pr-3" style={{ color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dynamicSetupPerformance.map((s) => (
                <tr key={s.setup} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td className="py-2 pr-3" style={{ color: "var(--text-primary)" }}>{s.setup}</td>
                  <td className="py-2 pr-3 font-mono" style={{ color: "var(--text-muted)" }}>{s.trades}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold" style={{ color: s.winRate >= 50 ? "var(--color-bull)" : "var(--color-bear)" }}>{s.winRate}%</span>
                      <div className="progress-track" style={{ width: 50 }}>
                        <div className="progress-fill" style={{ width: `${s.winRate}%`, background: s.winRate >= 50 ? "var(--color-bull)" : "var(--color-bear)" }} />
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-3 font-mono font-bold" style={{ color: s.expectancy >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                    {s.expectancy >= 0 ? "+" : ""}{s.expectancy.toFixed(2)}R
                  </td>
                  <td className="py-2 font-mono" style={{ color: s.pf >= 1 ? "var(--color-bull)" : "var(--color-bear)" }}>{s.pf.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNewEntry && (
        <NewEntryModal onClose={() => setShowNewEntry(false)} onSuccess={() => swrMutate("all-trades")} />
      )}
      {showAskAI && (
        <AskAIModal
          onClose={() => setShowAskAI(false)}
          lastDecision={lastDecision}
          watching={watching ?? null}
          lessons={recentLessons}
        />
      )}
    </div>
  );
}
