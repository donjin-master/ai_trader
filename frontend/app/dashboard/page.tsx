"use client";

import { useState, useEffect } from "react";
import useSWR, { mutate as swrMutate } from "swr";
import {
  PieChart, Pie, Cell,
} from "recharts";
import { Info, Shield } from "lucide-react";
import { api, API_HEADERS, type Snapshot, type Status, type Watching, type Position, type ManagedPositionState, type KeyLevels } from "@/lib/api";
import { mockData } from "@/lib/mockData";
import TVChart from "@/components/TVChart";
import { useInstrument } from "@/lib/instrument";

const POLL = { refreshInterval: 15_000 };

// ── Donut chart ───────────────────────────────────────────────────────────────
function DonutChart({ data, size = 100 }: { data: { value: number; color: string; label: string }[]; size?: number }) {
  return (
    <PieChart width={size} height={size}>
      <Pie data={data} cx={size / 2 - 1} cy={size / 2 - 1} innerRadius={size * 0.3} outerRadius={size * 0.46}
        dataKey="value" stroke="none" paddingAngle={2}>
        {data.map((e, i) => <Cell key={i} fill={e.color} />)}
      </Pie>
    </PieChart>
  );
}

function ProgressBar({ pct, color = "var(--color-bear)" }: { pct: number; color?: string }) {
  return (
    <div className="progress-track mt-1">
      <div className="progress-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

function ConvictionBar({ value, max = 10 }: { value: number; max?: number }) {
  return (
    <div className="progress-track" style={{ height: 6 }}>
      <div className="progress-fill progress-fill-bull" style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}


function TradeSlider({ entry, sl, tp1, tp2, current }: { entry: number; sl: number; tp1: number; tp2: number; current: number }) {
  const padding = Math.abs(tp2 - sl) * 0.08;
  const rangeMin = Math.min(sl, tp2) - padding;
  const rangeMax = Math.max(sl, tp2) + padding;
  const range = rangeMax - rangeMin || 1;
  // Returns clamped percentage string
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - rangeMin) / range) * 100))}%`;
  // For labels: clamp so text doesn't overflow left/right edges
  const labelLeft = (v: number) => {
    const raw = ((v - rangeMin) / range) * 100;
    return `${Math.max(4, Math.min(96, raw))}%`;
  };
  const isBullish = tp2 > entry;
  return (
    <div className="relative mt-3" style={{ height: 36, overflow: "visible" }}>
      {/* Track */}
      <div className="absolute" style={{ left: 0, right: 0, top: "40%", height: 5, marginTop: -2.5, background: "var(--bg-elevated)", borderRadius: "var(--radius-full)" }} />
      {/* Profit zone (entry → tp2) */}
      <div className="absolute" style={{
        left: isBullish ? pct(entry) : pct(tp2),
        right: isBullish ? `${100 - parseFloat(pct(tp2))}%` : `${100 - parseFloat(pct(entry))}%`,
        top: "40%", height: 5, marginTop: -2.5,
        background: "var(--color-bull)", borderRadius: "var(--radius-full)", opacity: 0.6,
      }} />
      {/* Loss zone (sl → entry) */}
      <div className="absolute" style={{
        left: isBullish ? pct(sl) : pct(entry),
        right: isBullish ? `${100 - parseFloat(pct(entry))}%` : `${100 - parseFloat(pct(sl))}%`,
        top: "40%", height: 5, marginTop: -2.5,
        background: "var(--color-bear)", borderRadius: "var(--radius-full)", opacity: 0.5,
      }} />
      {/* Current price dot */}
      <div className="absolute" style={{ left: pct(current), top: "40%", transform: "translate(-50%, -50%)", width: 11, height: 11, borderRadius: "50%", background: "white", border: "2px solid var(--text-muted)", zIndex: 2 }} />
      {/* Labels — clamped so they never overflow */}
      {([
        { l: "SL",    v: sl,    c: "var(--color-bear)" },
        { l: "ENTRY", v: entry, c: "var(--text-muted)" },
        { l: "TP1",   v: tp1,   c: "var(--color-bull)" },
        { l: "TP2",   v: tp2,   c: "var(--color-bull)" },
      ] as const).map(({ l, v, c }) => (
        <div key={l} className="absolute" style={{ top: 18, left: labelLeft(v), transform: "translateX(-50%)", fontSize: 9, color: c, fontFamily: "JetBrains Mono", whiteSpace: "nowrap" }}>{l}</div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { instrument } = useInstrument();
  const { data: snap }      = useSWR<Snapshot | null>("snap-btc",  () => api.snapshot("BTCUSD"),  POLL);
  const { data: status }    = useSWR<Status | null>("status",      () => api.status(),             POLL);
  const { data: watching }  = useSWR<Watching | null>("watching",  () => api.watching(),           POLL);
  const { data: positions } = useSWR<Position[] | null>("positions", () => api.positions(),        POLL);
  const { data: managed }   = useSWR<ManagedPositionState[] | null>("managed", () => api.managedPositions(), POLL);
  const { data: keyLvl }    = useSWR<KeyLevels | null>("key-levels-btc", () => api.keyLevels("BTCUSD"), POLL);
  const [isMounted, setIsMounted] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  useEffect(() => setIsMounted(true), []);

  async function handleClosePosition() {
    const instrument = openPos?.product_symbol ?? "BTCUSD_PERP";
    setClosing(true);
    setCloseError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/close/${instrument}`, {
        method: "POST",
        headers: API_HEADERS,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `Failed (${res.status})`);
      // Refresh positions & managed positions
      await Promise.all([swrMutate("positions"), swrMutate("managed"), swrMutate("status")]);
      setCloseConfirm(false);
    } catch (err: any) {
      setCloseError(err.message ?? "Close failed");
    } finally {
      setClosing(false);
    }
  }

  const { aiSetup, watchlist, upcomingEvents } = mockData;

  if (!isMounted) {
    return <div className="p-8 text-center" style={{ color: "var(--text-muted)" }}>Loading Dashboard...</div>;
  }

  const currentPrice = snap?.price ?? mockData.btc.price;
  const realLevels = keyLvl?.chart_levels ?? [];

  const resistance2 = realLevels.find((l) => l.type === "resistance" && (l.distance_pct ?? 0) > 1)?.price ?? mockData.keyLevels.resistance2;
  const resistance1 = realLevels.find((l) => l.type === "resistance" && (l.distance_pct ?? 0) <= 1)?.price ?? mockData.keyLevels.resistance1;
  const pivot       = keyLvl?.prev_day_high ? (keyLvl.prev_day_high + keyLvl.prev_day_low + currentPrice) / 3 : mockData.keyLevels.pivot;
  const support1    = realLevels.find((l) => l.type === "support"    && (l.distance_pct ?? 0) <= 1)?.price ?? mockData.keyLevels.support1;
  const support2    = realLevels.find((l) => l.type === "support"    && (l.distance_pct ?? 0) > 1)?.price  ?? mockData.keyLevels.support2;

  const openPos   = (positions ?? [])[0];
  const managedPos = managed?.find((m) => m.instrument === openPos?.product_symbol);

  // Real entry: managed > openPos.entry_price > mock
  const entry   = managedPos?.entry_price   ?? (openPos?.entry_price  ? parseFloat(openPos.entry_price)  : mockData.openPosition.entry);
  const markPx  = openPos?.mark_price        ? parseFloat(openPos.mark_price)  : currentPrice;
  const sl      = managedPos?.current_sl    ?? mockData.openPosition.sl;
  const tp1     = managedPos?.tp1           ?? mockData.openPosition.tp1;
  const tp2     = managedPos?.tp2           ?? mockData.openPosition.tp2;
  const posSize = managedPos?.current_size_contracts ?? openPos?.size ?? mockData.openPosition.size;

  // unrealized_pnl from Delta is USD (e.g. "-105.50"), NOT a percentage
  const pnlUsd  = openPos?.unrealized_pnl ? parseFloat(openPos.unrealized_pnl) : null;
  // P&L % relative to entry for colour/display
  const pnlPct  = pnlUsd !== null
    ? (entry > 0 ? ((markPx - entry) / entry) * 100 * (openPos!.size > 0 ? 1 : -1) : 0)
    : mockData.openPosition.pnlPct;
  const roe     = managedPos?.initial_risk_pct != null
    ? (pnlPct / mockData.openPosition.roe) * managedPos.initial_risk_pct // approximate
    : pnlPct;

  const risk = status?.risk;
  const dailyUsed  = risk?.daily_budget_used_inr ?? mockData.riskBudget.dailyUsed;
  const dailyMax   = risk?.daily_budget_inr       ?? mockData.riskBudget.dailyMax;
  const weeklyUsed = mockData.riskBudget.weeklyUsed;
  const weeklyMax  = mockData.riskBudget.weeklyMax;
  const drawdown   = Math.abs(Math.min(0, status?.daily_pnl ?? 0));

  const effectiveWatchlist = watchlist.map((w) => {
    if (w.pair === "BTC/USDT" && watching?.verdict) {
      return { ...w, dir: watching.verdict === "LONG" ? "LONG" : watching.verdict === "SHORT" ? "SHORT" : "NEUTRAL" };
    }
    return w;
  });

  const conviction = watching?.setup_score ?? aiSetup.conviction;
  const direction  = watching?.verdict === "LONG" ? "LONG" : watching?.verdict === "SHORT" ? "SHORT" : aiSetup.direction;

  const prob = aiSetup.probability;
  const donutData = [
    { value: prob.tp1,       color: "var(--color-bull)",    label: `TP1 Hit (${prob.tp1}%)` },
    { value: prob.breakeven, color: "var(--color-purple)",  label: `Break-even (${prob.breakeven}%)` },
    { value: prob.slHit,     color: "var(--color-bear)",    label: `SL Hit (${prob.slHit}%)` },
  ];

  return (
    <>
    <div className="flex gap-3" style={{ height: "calc(100vh - var(--topbar-height) - 48px)" }}>
      {/* ── LEFT PANEL ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 overflow-y-auto" style={{ width: 250, minWidth: 250 }}>
        {/* Market Narrative */}
        <div className="card">
          <div className="section-label mb-2">Market Narrative</div>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full" style={{
                background: direction === "LONG" ? "var(--color-bull)" : direction === "SHORT" ? "var(--color-bear)" : "var(--color-neutral)"
              }} />
              <span className="font-semibold" style={{
                fontSize: "var(--text-sm)",
                color: direction === "LONG" ? "var(--color-bull)" : direction === "SHORT" ? "var(--color-bear)" : "var(--color-neutral)"
              }}>
                {direction === "LONG" ? "Bullish Bias" : direction === "SHORT" ? "Bearish Bias" : "Neutral / Hold"}
              </span>
            </div>
            <span className="ml-auto" suppressHydrationWarning style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {watching?.decided_at ? new Date(watching.decided_at).toLocaleTimeString() : "—"}
            </span>
          </div>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {(watching?.why_not ?? []).length > 0
              ? watching!.why_not[0]
              : snap?.market_regime
                ? `Market regime: ${snap.market_regime.toUpperCase()}. Price at ${currentPrice > 0 ? currentPrice.toLocaleString("en-US") : "—"}.`
                : "BTC reclaiming key area with volume expansion. Monitoring for high-probability setups."}
          </p>
          {(direction === "LONG" || direction === "SHORT") && (
            <p className="mt-1.5" style={{ fontSize: "var(--text-sm)", color: "var(--color-bull)" }}>
              Bias: Look for {direction === "LONG" ? "long" : "short"} entries on pullbacks.
            </p>
          )}
        </div>

        {/* Key Levels */}
        <div className="card">
          <div className="section-label mb-2">Key Levels</div>
          <div className="flex flex-col gap-1.5">
            {[
              { label: "Resistance 2", value: resistance2, color: "var(--color-bear)" },
              { label: "Resistance 1", value: resistance1, color: "var(--color-bear)" },
              { label: "Pivot",        value: pivot,       color: "var(--text-primary)" },
              { label: "Support 1",    value: support1,    color: "var(--color-bull)" },
              { label: "Support 2",    value: support2,    color: "var(--color-bull)" },
            ].map((l) => (
              <div key={l.label} className="flex items-center justify-between">
                <span style={{ fontSize: "var(--text-sm)", color: l.color }}>{l.label}</span>
                <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
                  {l.value > 0 ? l.value.toLocaleString("en-US", { minimumFractionDigits: 1 }) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Events */}
        <div className="card">
          <div className="section-label mb-2">Upcoming Events</div>
          <div className="flex flex-col gap-2">
            {upcomingEvents.map((e) => (
              <div key={e.name} className="flex items-start gap-2">
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>🕐</span>
                <div className="flex-1 min-w-0">
                  <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{e.time}</span>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 1 }}>{e.name}</div>
                </div>
                <span style={{ fontSize: "9px", fontWeight: 700, color: e.impact === "high" ? "var(--color-bear)" : "var(--color-neutral)" }}>
                  {e.impact.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setShowCalendar(true)} style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)", marginTop: 8 }}>View Calendar →</button>
        </div>

        {/* System Status */}
        {status && (
          <div className="card" style={{ padding: "var(--space-3)" }}>
            <div className="section-label mb-2">System Status</div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between">
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Mode</span>
                <span className="font-mono font-bold" style={{ fontSize: "var(--text-xs)", color: "var(--accent-primary)" }}>{status.mode}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Daily P&L</span>
                <span className="font-mono font-bold" style={{ fontSize: "var(--text-xs)", color: (status.daily_pnl ?? 0) >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                  {((status.daily_pnl ?? 0) >= 0 ? "+" : "")}{(status.daily_pnl ?? 0).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Open Positions</span>
                <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>{status.open_positions_count}</span>
              </div>
              {status.next_decision_in_seconds != null && (
                <div className="flex justify-between">
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Next Decision</span>
                  <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    {Math.floor(status.next_decision_in_seconds / 60)}m {status.next_decision_in_seconds % 60}s
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── CENTER ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 flex-1 min-w-0 overflow-hidden">
        {instrument.symbol !== "BTCUSD" && (
          <div className="rounded-lg px-3 py-1.5" style={{ background: "rgba(255,184,77,0.08)", border: "1px solid rgba(255,184,77,0.25)" }}>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--color-neutral)" }}>
              Viewing {instrument.label} chart — AI decisions, key levels &amp; positions below are for BTCUSD (the engine's active instrument).
            </span>
          </div>
        )}
        <TVChart key={instrument.tvSymbol} symbol={instrument.tvSymbol} height={instrument.symbol !== "BTCUSD" ? 400 : 440} interval="15" />

        {/* Bottom strip */}
        <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          {/* Open Position */}
          <div className="card" style={{ padding: "var(--space-3)" }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="section-label">Open Position</span>
              {openPos ? (
                <>
                  <span className={`badge ${openPos.size > 0 ? "badge-long" : "badge-short"}`}>{openPos.size > 0 ? "LONG" : "SHORT"}</span>
                  {managedPos && <span className="badge badge-managed">+ MANAGED</span>}
                </>
              ) : (
                <span className="badge badge-neutral" style={{ fontSize: "9px" }}>NO POSITION</span>
              )}
            </div>
            {openPos ? (
              <>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2">
                  {[
                    { label: "Entry",   value: entry.toLocaleString("en-US", { minimumFractionDigits: 1 }),        color: "var(--text-primary)" },
                    { label: "Current", value: markPx.toLocaleString("en-US", { minimumFractionDigits: 1 }),       color: "var(--text-primary)" },
                    { label: "P&L (USD)", value: pnlUsd !== null ? `${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)}` : `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`,
                      color: (pnlUsd ?? pnlPct) >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                    { label: "Size",    value: `${posSize} contracts`,                                             color: "var(--text-primary)" },
                  ].map((r) => (
                    <div key={r.label}>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{r.label}</div>
                      <div className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: r.color }}>{r.value}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-4 gap-1 mb-3">
                  {[
                    { label: "ROE",  value: `${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%`, color: roe >= 0 ? "var(--color-bull)" : "var(--color-bear)" },
                    { label: "SL",   value: sl.toLocaleString("en-US"),                 color: "var(--color-bear)" },
                    { label: "TP 1", value: tp1.toLocaleString("en-US"),                color: "var(--color-bull)" },
                    { label: "TP 2", value: tp2.toLocaleString("en-US"),                color: "var(--color-bull)" },
                  ].map((r) => (
                    <div key={r.label}>
                      <div style={{ fontSize: "9px", color: "var(--text-secondary)" }}>{r.label}</div>
                      <div className="font-mono" style={{ fontSize: "9px", color: r.color, fontWeight: 600 }}>{r.value}</div>
                    </div>
                  ))}
                </div>
                <TradeSlider entry={entry} sl={sl} tp1={tp1} tp2={tp2} current={currentPrice} />

                {closeError && (
                  <div className="mt-2 rounded px-2 py-1" style={{ background: "rgba(255,77,106,0.1)", border: "1px solid rgba(255,77,106,0.3)", fontSize: "var(--text-xs)", color: "var(--color-bear)" }}>
                    {closeError}
                  </div>
                )}

                {!closeConfirm ? (
                  <button
                    type="button"
                    onClick={() => setCloseConfirm(true)}
                    className="btn-danger mt-3"
                    style={{ width: "100%", textAlign: "center" }}
                  >
                    Close Position
                  </button>
                ) : (
                  <div className="mt-3 rounded-lg p-2" style={{ background: "rgba(255,77,106,0.08)", border: "1px solid rgba(255,77,106,0.3)" }}>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginBottom: 6, textAlign: "center" }}>
                      Close {openPos.size > 0 ? "LONG" : "SHORT"} at market? This cannot be undone.
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setCloseConfirm(false); setCloseError(null); }}
                        style={{ flex: 1, padding: "6px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", fontSize: "var(--text-xs)", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={closing}
                        onClick={handleClosePosition}
                        style={{ flex: 1, padding: "6px", borderRadius: "var(--radius-md)", background: "var(--color-bear)", color: "#fff", fontSize: "var(--text-xs)", fontWeight: 700, cursor: closing ? "not-allowed" : "pointer", opacity: closing ? 0.7 : 1 }}
                      >
                        {closing ? "Closing…" : "Confirm Close"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>No open positions</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 4 }}>
                    {watching?.verdict && watching.verdict !== "hold"
                      ? `AI verdict: ${watching.verdict} (score: ${watching.setup_score}/10)`
                      : "AI monitoring for setups..."}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AI Watchlist */}
          <div className="card" style={{ padding: "var(--space-3)" }}>
            <div className="flex items-center gap-1 mb-2">
              <span className="section-label">AI Watchlist</span>
              <Info size={11} style={{ color: "var(--text-muted)" }} />
            </div>
            <div className="flex flex-col gap-2">
              {effectiveWatchlist.map((w) => (
                <div key={w.pair} className="flex items-center justify-between">
                  <span className="font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", minWidth: 80 }}>{w.pair}</span>
                  <span className={`badge badge-${w.dir.toLowerCase()}`} style={{ fontSize: "9px" }}>{w.dir}</span>
                  <span className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: w.dir === "LONG" ? "var(--color-bull)" : w.dir === "SHORT" ? "var(--color-bear)" : "var(--color-neutral)" }}>
                    {w.score}/10
                  </span>
                  <span className="font-mono" style={{ fontSize: "var(--text-sm)", color: w.change >= 0 ? "var(--color-bull)" : "var(--color-bear)" }}>
                    {w.change >= 0 ? "+" : ""}{w.change.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
            <button type="button" style={{ fontSize: "var(--text-xs)", color: "var(--text-accent)", marginTop: 8 }}>View Full Watchlist →</button>
          </div>

          {/* Risk Budget */}
          <div className="card" style={{ padding: "var(--space-3)" }}>
            <div className="flex items-center gap-1 mb-2">
              <span className="section-label">Risk Budget</span>
              <Info size={11} style={{ color: "var(--text-muted)" }} />
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <div className="flex justify-between">
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Daily</span>
                  <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>
                    ₹{dailyUsed.toLocaleString("en-IN", { maximumFractionDigits: 0 })} / ₹{dailyMax.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <ProgressBar pct={dailyMax > 0 ? (dailyUsed / dailyMax) * 100 : 0} />
              </div>
              <div>
                <div className="flex justify-between">
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Weekly</span>
                  <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>
                    ₹{weeklyUsed.toLocaleString("en-IN")} / ₹{weeklyMax.toLocaleString("en-IN")}
                  </span>
                </div>
                <ProgressBar pct={(weeklyUsed / weeklyMax) * 100} />
              </div>
              <div>
                <div className="flex justify-between">
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Drawdown</span>
                  <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-primary)" }}>
                    {drawdown.toFixed(1)}% / 5.0%
                  </span>
                </div>
                <ProgressBar pct={(drawdown / 5) * 100} />
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3">
              <Shield size={12} style={{ color: "var(--color-bull)" }} />
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                {status?.kill_switch ? "⚠️ Kill switch triggered" : "Within safe risk limits. Good to trade."}
              </span>
            </div>
            {risk && (
              <div className="mt-2" style={{ fontSize: "9px", color: "var(--text-muted)" }}>
                Trades today: {risk.trades_today} / {risk.max_trades_per_day ?? "—"} ·
                Consecutive losses: {risk.consecutive_losses}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL: AI Trade Setup ─────────────────────────────────────── */}
      <div className="flex flex-col overflow-y-auto"
        style={{ width: 280, minWidth: 280, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", fontWeight: 700, letterSpacing: "0.08em" }}>AI TRADE SETUP</span>
            <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>#{aiSetup.id}</span>
          </div>
          <span className="badge badge-active" style={{ fontSize: "9px" }}>{status?.mode ?? "ADVISORY"}</span>
        </div>

        <div className="h-px mb-3" style={{ background: "var(--border-subtle)" }} />

        {/* Conviction */}
        <div className="mb-3">
          <div className="section-label mb-1">AI Conviction</div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>{conviction.toFixed(1)}</span>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}> / 10</span>
            <span className="ml-auto font-semibold" style={{ fontSize: "var(--text-sm)", color: conviction >= 7 ? "var(--color-bull)" : conviction >= 5 ? "var(--color-neutral)" : "var(--color-bear)" }}>
              {conviction >= 7 ? "Strong" : conviction >= 5 ? "Moderate" : "Weak"}
            </span>
          </div>
          <ConvictionBar value={conviction} />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="section-label mb-1">Direction</div>
            <span className="font-bold" style={{ color: direction === "LONG" ? "var(--color-bull)" : direction === "SHORT" ? "var(--color-bear)" : "var(--color-neutral)", fontSize: "var(--text-md)" }}>
              {direction.toUpperCase()}
            </span>
          </div>
          <div>
            <div className="section-label mb-1">Timeframe</div>
            <span className="font-bold" style={{ color: "var(--text-primary)", fontSize: "var(--text-md)" }}>{aiSetup.timeframe}</span>
          </div>
        </div>

        <div className="h-px mb-3" style={{ background: "var(--border-subtle)" }} />

        {/* AI Rationale */}
        <div className="mb-3">
          <div className="section-label mb-1.5">AI Rationale</div>
          <div className="flex flex-col gap-1">
            {(watching?.watching ?? []).length > 0 ? (
              (watching!.watching).map((w) => (
                <div key={w.condition} className="flex items-start gap-1.5">
                  <span style={{ color: w.met ? "var(--color-bull)" : "var(--color-bear)", fontSize: "var(--text-sm)" }}>{w.met ? "✅" : "❌"}</span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{w.condition}</span>
                </div>
              ))
            ) : (
              <>
                {aiSetup.rationale.pros.map((p) => (
                  <div key={p} className="flex items-start gap-1.5">
                    <span style={{ color: "var(--color-bull)", fontSize: "var(--text-sm)" }}>✅</span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{p}</span>
                  </div>
                ))}
                {aiSetup.rationale.cons.map((c) => (
                  <div key={c} className="flex items-start gap-1.5">
                    <span style={{ fontSize: "var(--text-sm)" }}>❌</span>
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.5 }}>{c}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="h-px mb-3" style={{ background: "var(--border-subtle)" }} />

        {/* Invalidation */}
        <div className="mb-3">
          <div className="section-label mb-1">Invalidation</div>
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {aiSetup.invalidation}
          </p>
        </div>

        <div className="h-px mb-3" style={{ background: "var(--border-subtle)" }} />

        {/* Trade Levels */}
        <div className="mb-3">
          <div className="section-label mb-1.5">Trade Levels</div>
          <div className="flex flex-col gap-1">
            {[
              { label: "Entry",     value: aiSetup.levels.entry, delta: null,     color: "var(--text-primary)" },
              { label: "Stop Loss", value: aiSetup.levels.sl,    delta: "-0.60%", color: "var(--color-bear)" },
              { label: "TP 1",      value: aiSetup.levels.tp1,   delta: "+0.92%", color: "var(--color-bull)" },
              { label: "TP 2",      value: aiSetup.levels.tp2,   delta: "+1.83%", color: "var(--color-bull)" },
            ].map((l) => (
              <div key={l.label} className="flex items-center justify-between">
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", minWidth: 70 }}>{l.label}</span>
                <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: l.color }}>
                  {l.value.toLocaleString("en-US", { minimumFractionDigits: 1 })}
                </span>
                {l.delta && <span className="font-mono" style={{ fontSize: "var(--text-xs)", color: l.color }}>{l.delta}</span>}
              </div>
            ))}
            <div className="flex items-center justify-between mt-1">
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Risk/Reward</span>
              <span className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{aiSetup.rrr}</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Position Size</span>
              <span className="font-mono" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{aiSetup.posSize} USDT</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Expected Value</span>
              <span className="font-mono font-bold" style={{ fontSize: "var(--text-sm)", color: "var(--color-bull)" }}>
                +₹{aiSetup.expectedValue.toLocaleString("en-IN")}
              </span>
            </div>
          </div>
        </div>

        <div className="h-px mb-3" style={{ background: "var(--border-subtle)" }} />

        {/* Probability */}
        <div className="mb-2">
          <div className="section-label mb-2">Probability Outcome</div>
          <div className="flex items-center gap-3">
            <DonutChart data={donutData} size={80} />
            <div className="flex flex-col gap-1.5">
              {donutData.map((d) => (
                <div key={d.label} className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Calendar Modal */}
    {showCalendar && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
        onClick={(e) => { if (e.target === e.currentTarget) setShowCalendar(false); }}
      >
        <div
          className="w-full max-w-md mx-4 rounded-xl overflow-hidden"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-panel)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <div>
              <div className="section-label">Economic Calendar</div>
              <div className="font-mono font-bold mt-0.5" style={{ fontSize: "var(--text-md)", color: "var(--text-primary)" }}>
                Today's Events
              </div>
            </div>
            <button type="button" onClick={() => setShowCalendar(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: "var(--bg-hover)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
              ✕
            </button>
          </div>

          {/* Events list */}
          <div className="flex flex-col gap-0">
            {upcomingEvents.map((e, i) => (
              <div key={e.name}
                className="flex items-start gap-4 px-5 py-4"
                style={{ borderBottom: i < upcomingEvents.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                {/* Impact bar */}
                <div className="flex flex-col items-center gap-1 pt-0.5">
                  <div className="h-2 w-2 rounded-full" style={{ background: e.impact === "high" ? "var(--color-bear)" : "var(--color-neutral)" }} />
                  <div className="h-full w-px" style={{ background: "var(--border-subtle)", minHeight: 32 }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{e.time}</span>
                    <span style={{
                      fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
                      color: e.impact === "high" ? "var(--color-bear)" : "var(--color-neutral)"
                    }}>
                      {e.impact.toUpperCase()} IMPACT
                    </span>
                  </div>
                  <div className="font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{e.name}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>
                    {e.impact === "high"
                      ? "High volatility expected. Consider reducing position size."
                      : "Moderate impact. Monitor price action around this time."}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
            <div className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-bear)" }} />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>High impact</span>
            <div className="h-1.5 w-1.5 rounded-full ml-3" style={{ background: "var(--color-neutral)" }} />
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Medium impact</span>
            <span className="ml-auto" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Avoid trading 30m before/after high-impact events</span>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
