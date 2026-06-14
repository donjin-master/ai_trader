"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import PositionCard from "@/components/PositionCard";
import Skeleton from "@/components/Skeleton";
import {
  api,
  type ManagedPositionState,
  type Position,
  type Status,
  type Trade,
  type Watching,
} from "@/lib/api";
import { cn, formatPct, pnlColor } from "@/lib/utils";

const LiveChart = dynamic(() => import("@/components/LiveChart"), { ssr: false });
const Watchlist = dynamic(() => import("@/components/Watchlist"), { ssr: false });

const POLL = { refreshInterval: 30_000 };

function Countdown({ seconds }: { seconds: number | null }) {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    setLeft(seconds ?? 0);
    if (seconds === null) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [seconds]);
  if (seconds === null) return <span>—</span>;
  return (
    <span className="font-mono">
      {Math.floor(left / 60)}m {String(left % 60).padStart(2, "0")}s
    </span>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

function ScanningState({ status, watching }: { status?: Status | null; watching?: Watching | null }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 p-6">
      <div className="scanline" />
      <div className="font-mono text-sm font-bold tracking-widest text-zinc-300">
        SCANNING · BTCUSD_PERP · 15M
      </div>
      <div className="mt-2 flex gap-6 font-mono text-xs text-zinc-500">
        <span>Last scan: {timeAgo(watching?.decided_at ?? null)}</span>
        <span>
          Next scan: <Countdown seconds={status?.next_decision_in_seconds ?? null} />
        </span>
      </div>
    </div>
  );
}

function CoPilotPanel({ watching, status }: { watching?: Watching | null; status?: Status | null }) {
  const verdict = watching?.verdict ?? "—";
  const verdictColor =
    verdict === "LONG" ? "text-green-400" : verdict === "SHORT" ? "text-red-400" : "text-zinc-300";
  const unmet = (watching?.watching ?? []).filter((w) => !w.met);

  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="font-mono text-xs font-bold tracking-widest text-indigo-300">
          CO-PILOT {watching?.vision_used && <span title="Vision AI used">👁</span>}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">
          Last: {timeAgo(watching?.decided_at ?? null)} ·{" "}
          <Countdown seconds={status?.next_decision_in_seconds ?? null} /> ▶
        </span>
      </div>
      <div className="space-y-3 p-3">
        <div className="verdict-fade">
          <span className="font-mono text-[10px] uppercase text-zinc-500">Verdict</span>
          <div className={cn("font-mono text-xl font-black", verdictColor)}>
            ◉ {verdict}
            {watching?.setup_score != null && (
              <span className="ml-2 text-xs font-bold text-zinc-500">
                setup {watching.setup_score}/10 {watching.setup_grade}
              </span>
            )}
          </div>
        </div>

        {(watching?.why_not?.length ?? 0) > 0 && verdict === "HOLD" && (
          <div>
            <div className="font-mono text-[10px] uppercase text-zinc-500">Why not trading</div>
            <ul className="mt-1 space-y-0.5">
              {watching!.why_not.map((reason) => (
                <li key={reason} className="text-xs text-zinc-300">
                  <span className="text-indigo-400">↳</span> {reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">Watching for</div>
          <ul className="mt-1 space-y-0.5">
            {(watching?.watching ?? []).map((item) => (
              <li key={item.condition} className="flex items-center gap-2 text-xs">
                <span className={item.met ? "text-green-400" : "text-red-400"}>
                  {item.met ? "✓" : "✗"}
                </span>
                <span className={item.met ? "text-zinc-300" : "text-zinc-400"}>
                  {item.condition}
                </span>
                {!item.met && <span className="text-[10px] text-amber-500">← needs this</span>}
              </li>
            ))}
          </ul>
        </div>

        {unmet.length > 0 && watching?.expected_direction && (
          <div className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1.5 text-xs text-indigo-200">
            When {unmet.length} more check{unmet.length > 1 ? "s" : ""} →{" "}
            expect {watching.expected_direction === "BULLISH" ? "LONG" : "SHORT"} setup
          </div>
        )}
      </div>
    </div>
  );
}

function TightBar({
  label, used, total, format, danger,
}: {
  label: string; used: number; total: number;
  format: (v: number) => string; danger?: boolean;
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const fill = pct >= 80 || danger ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="flex items-center gap-2 font-mono text-[11px]">
      <span className="w-24 shrink-0 text-zinc-500">{label}</span>
      <span className="w-28 shrink-0 text-zinc-300">
        {format(used)} / {format(total)}
      </span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
        <div className={cn("h-full", fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function LiveTradingRoom() {
  const [chartInstrument, setChartInstrument] = useState("BTCUSD");
  const { data: status } = useSWR<Status | null>("status", () => api.status(), POLL);
  const { data: positions } = useSWR<Position[] | null>(
    "positions", () => api.positions(), POLL
  );
  const { data: decisions } = useSWR<Trade[] | null>(
    "decisions", () => api.decisions(20), POLL
  );
  const { data: managed } = useSWR<ManagedPositionState[] | null>(
    "managed-positions", () => api.managedPositions(), POLL
  );
  const { data: watching } = useSWR<Watching | null>(
    "watching", () => api.watching(), POLL
  );

  const todays = (decisions ?? []).filter(
    (t) => t.created_at && new Date(t.created_at).toDateString() === new Date().toDateString()
  );
  const closed = todays.filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.pnl_pct ?? 0) >= 0).length;

  const risk = status?.risk;
  const drawdownUsed = Math.abs(Math.min(0, status?.daily_pnl ?? 0));

  return (
    <div className="space-y-3">
      {/* HERO: watchlist + live chart */}
      <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
        <div className="hidden lg:block">
          <Watchlist selected={chartInstrument} onSelect={setChartInstrument} />
        </div>
        <LiveChart instrument={chartInstrument} height={420} />
      </div>

      {/* MIDDLE: positions 60% | co-pilot 40% */}
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="panel h-full p-3">
            <div className="mb-2 font-mono text-xs font-bold tracking-widest text-zinc-400">
              OPEN POSITIONS
            </div>
            {positions === undefined ? (
              <Skeleton className="h-24" />
            ) : !positions || positions.length === 0 ? (
              <ScanningState status={status} watching={watching} />
            ) : (
              <div className="space-y-3">
                {positions.map((p) => (
                  <PositionCard
                    key={p.product_symbol}
                    position={p}
                    relatedTrade={(decisions ?? []).find(
                      (t) => t.instrument === p.product_symbol && t.status === "open"
                    )}
                    managedState={(managed ?? []).find(
                      (m) => m.instrument === p.product_symbol
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="lg:col-span-2">
          <CoPilotPanel watching={watching} status={status} />
        </div>
      </div>

      {/* BOTTOM: tight budget bars + summary + system */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel space-y-2 p-3">
          <div className="font-mono text-xs font-bold tracking-widest text-zinc-400">RISK USAGE</div>
          {risk ? (
            <>
              <TightBar
                label="Daily Budget"
                used={risk.daily_budget_used_inr}
                total={risk.daily_budget_inr}
                format={(v) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
              />
              <TightBar label="Trades" used={risk.trades_today} total={risk.max_trades_per_day ?? 0} format={(v) => `${v}`} />
              <TightBar label="Concurrent" used={status?.open_positions_count ?? 0} total={risk.max_concurrent_trades ?? 0} format={(v) => `${v}`} />
              <TightBar
                label="Drawdown"
                used={drawdownUsed}
                total={5}
                format={(v) => `${v.toFixed(1)}%`}
                danger={drawdownUsed >= 4}
              />
            </>
          ) : (
            <Skeleton className="h-16" />
          )}
        </div>

        <div className="panel p-3">
          <div className="font-mono text-xs font-bold tracking-widest text-zinc-400">TODAY</div>
          <div className="mt-1 font-mono text-sm text-zinc-300">
            Trades: {closed.length} · Wins: {wins} · Losses: {closed.length - wins}
          </div>
          <div className={cn("mt-1 font-mono text-3xl font-black", pnlColor(status?.daily_pnl))}>
            {status ? formatPct(status.daily_pnl) : "—"}
          </div>
        </div>

        <div className="panel p-3 font-mono text-xs">
          <div className="font-bold tracking-widest text-zinc-400">SYSTEM</div>
          <div className="mt-2 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-zinc-500">Mode</span>
              <span className="font-bold text-blue-400">{status?.mode ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Kill switch</span>
              <span className={status?.kill_switch ? "font-bold text-red-400" : "font-bold text-green-500"}>
                {status?.kill_switch ? "TRIGGERED" : "ARMED"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Consecutive losses</span>
              <span className="text-zinc-300">
                {risk?.consecutive_losses ?? 0} / {risk?.consecutive_loss_limit ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Min setup score</span>
              <span className="text-zinc-300">{risk?.min_setup_score ?? "—"}/10</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
