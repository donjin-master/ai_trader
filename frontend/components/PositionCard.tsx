"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ManagedPositionState, Position, Trade } from "@/lib/api";
import { cn, formatPct, formatUsd, pnlColor } from "@/lib/utils";

function StageBar({ state, currentPrice }: { state: ManagedPositionState; currentPrice: number | null }) {
  // Visual scale from initial SL to TP3 (or TP2)
  const points = [
    { label: "SL", price: state.initial_sl, color: "bg-red-500" },
    { label: "Entry", price: state.entry_price, color: "bg-zinc-400" },
    { label: "TP1", price: state.tp1, color: state.tp1_hit ? "bg-green-500" : "bg-zinc-600" },
    { label: "TP2", price: state.tp2, color: "bg-blue-500" },
    ...(state.tp3 ? [{ label: "TP3", price: state.tp3, color: "bg-purple-500" }] : []),
  ];
  const prices = points.map((p) => p.price).concat(currentPrice ? [currentPrice] : []);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || 1;
  const pos = (price: number) => ((price - lo) / span) * 100;
  const isLong = state.direction === "long";

  return (
    <div className="relative mt-6 mb-7 h-2 rounded-full bg-zinc-800">
      {points.map((p) => (
        <div key={p.label} style={{ left: `${pos(p.price)}%` }} className="absolute -translate-x-1/2">
          <div className={cn("h-2 w-1 rounded", p.color)} />
          <div className="absolute top-3 -translate-x-1/2 whitespace-nowrap text-[10px] text-zinc-500">
            {p.label} {p.price.toLocaleString()}
          </div>
        </div>
      ))}
      {state.current_sl !== state.initial_sl && (
        <div
          style={{ left: `${pos(state.current_sl)}%` }}
          className="absolute -top-4 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-amber-400"
        >
          ⛓ trail {state.current_sl.toLocaleString()}
        </div>
      )}
      {currentPrice && (
        <div
          style={{ left: `${pos(currentPrice)}%` }}
          className={cn(
            "absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-zinc-950",
            isLong ? "bg-green-400" : "bg-red-400"
          )}
          title={`Current: ${currentPrice}`}
        />
      )}
    </div>
  );
}

export default function PositionCard({
  position,
  relatedTrade,
  managedState,
}: {
  position: Position;
  relatedTrade?: Trade;
  managedState?: ManagedPositionState;
}) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showBull, setShowBull] = useState(false);
  const [showBear, setShowBear] = useState(false);

  const direction = position.size > 0 ? "LONG" : "SHORT";
  const entry = parseFloat(position.entry_price);
  const mark = position.mark_price ? parseFloat(position.mark_price) : null;
  const pnlPct =
    mark && entry
      ? ((mark - entry) / entry) * 100 * (position.size > 0 ? 1 : -1)
      : null;

  const rrNow =
    managedState && mark
      ? Math.abs(mark - managedState.entry_price) /
        Math.abs(managedState.entry_price - managedState.initial_sl)
      : null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-bold">
          {position.product_symbol}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-bold",
            direction === "LONG" ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"
          )}
        >
          {direction}
        </span>
        {managedState && (
          <span className="flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-xs font-bold text-purple-300">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 pulse-dot" />
            MANAGED
          </span>
        )}
        <span className="text-sm text-zinc-400">Entry: {formatUsd(entry)}</span>
        {mark && <span className="text-sm text-zinc-400">Current: {formatUsd(mark)}</span>}
        {pnlPct !== null && (
          <span className={cn("text-sm font-bold", pnlColor(pnlPct))}>{formatPct(pnlPct)}</span>
        )}
      </div>

      {managedState && (
        <div className="mt-3 rounded-lg bg-zinc-900 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-zinc-500">
            Position Stages
          </div>
          <StageBar state={managedState} currentPrice={mark} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-400 md:grid-cols-3">
            <div>Initial SL: <span className="text-zinc-200">{managedState.initial_sl.toLocaleString()}</span> <span className="text-zinc-600">(sacred)</span></div>
            <div>Current SL: <span className={managedState.current_sl !== managedState.initial_sl ? "text-amber-400" : "text-zinc-200"}>{managedState.current_sl.toLocaleString()}</span></div>
            <div>TP1 {managedState.tp1_hit ? "✅" : "○"}: <span className="text-zinc-200">{managedState.tp1.toLocaleString()}</span></div>
            <div>TP2 ○: <span className="text-zinc-200">{managedState.tp2.toLocaleString()}</span> (1:{managedState.initial_rr_ratio.toFixed(0)}R)</div>
            {managedState.tp3 && <div>TP3 ○: <span className="text-zinc-200">{managedState.tp3.toLocaleString()}</span></div>}
            <div>Size: <span className="text-zinc-200">{managedState.current_size_contracts}/{managedState.initial_size_contracts}</span> contracts</div>
            {rrNow !== null && (
              <div>R:R now: <span className="font-bold text-green-400">1:{rrNow.toFixed(1)}</span>{rrNow >= 3 ? " 🔥" : ""}</div>
            )}
            <div>
              Risk:{" "}
              {managedState.breakeven_set ? (
                <span className="font-bold text-green-400">FREE TRADE (BE set)</span>
              ) : (
                <span className="text-zinc-200">-{managedState.initial_risk_pct.toFixed(2)}%</span>
              )}
            </div>
            <div>Trail: <span className="text-zinc-200">{managedState.trail_active ? `active @ ${managedState.trail_sl?.toLocaleString()}` : "waiting for TP1"}</span></div>
          </div>
        </div>
      )}

      {relatedTrade && (
        <div className="mt-3">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex items-center gap-1 py-2 text-xs font-semibold text-purple-400 hover:text-purple-300"
          >
            Why did AI enter?
            {showReasoning ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showReasoning && (
            <div className="mt-2 space-y-3 rounded-lg bg-zinc-900 p-3">
              <div className="flex flex-wrap gap-2">
                {(relatedTrade.key_signals ?? []).map((s) => (
                  <span key={s} className="rounded-full bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300">
                    {s}
                  </span>
                ))}
              </div>
              <p className="text-sm text-zinc-300">{relatedTrade.reasoning}</p>
              <button
                onClick={() => setShowBull(!showBull)}
                className="block py-1.5 text-xs font-semibold text-green-500"
              >
                🐂 Bull case {showBull ? "▲" : "▼"}
              </button>
              {showBull && <p className="text-xs text-zinc-400">{relatedTrade.bull_case}</p>}
              <button
                onClick={() => setShowBear(!showBear)}
                className="block py-1.5 text-xs font-semibold text-red-500"
              >
                🐻 Bear case {showBear ? "▲" : "▼"}
              </button>
              {showBear && <p className="text-xs text-zinc-400">{relatedTrade.bear_case}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
