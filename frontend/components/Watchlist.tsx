"use client";

import useSWR from "swr";
import { api, type Snapshot, type Watching } from "@/lib/api";
import { cn, formatPct, formatUsd, pnlColor } from "@/lib/utils";

// Primary instrument has live data on testnet; others are placeholders for the
// multi-instrument layout (the engine trades BTCUSD on testnet).
const INSTRUMENTS = [
  { symbol: "BTCUSD", label: "BTC/USD", live: true },
  { symbol: "ETHUSD", label: "ETH/USD", live: true },
];

function Row({
  symbol, label, selected, onSelect,
}: {
  symbol: string; label: string; selected: boolean; onSelect: () => void;
}) {
  const { data: snap } = useSWR<Snapshot | null>(
    `wl-snap-${symbol}`, () => api.snapshot(symbol), { refreshInterval: 30_000 }
  );
  const { data: watching } = useSWR<Watching | null>(
    symbol === "BTCUSD" ? "watching" : null, () => api.watching(), { refreshInterval: 30_000 }
  );
  const forming = (watching?.setup_score ?? 0) >= 6.5 && watching?.verdict === "HOLD";

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full border-l-2 px-3 py-2 text-left transition-colors",
        selected ? "border-l-blue-500 bg-white/5" : "border-l-transparent hover:bg-white/5",
        forming && "border-l-amber-500"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-200">
          <span className={cn("h-1.5 w-1.5 rounded-full", forming ? "bg-amber-400 pulse-dot" : "bg-blue-500")} />
          {label}
        </span>
        <span className="font-mono text-xs text-slate-300">{formatUsd(snap?.price)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between font-mono text-[10px]">
        <span className="text-slate-500">
          15M · {symbol === "BTCUSD" ? (watching?.verdict ?? "—") : "MONITORING"}
        </span>
        <span className={pnlColor(snap?.change_24h_pct)}>{formatPct(snap?.change_24h_pct)}</span>
      </div>
      {forming && (
        <div className="mt-0.5 font-mono text-[10px] text-amber-400">
          ⚡ SETUP FORMING · {watching?.setup_score}/10
        </div>
      )}
    </button>
  );
}

export default function Watchlist({
  selected, onSelect,
}: {
  selected: string; onSelect: (s: string) => void;
}) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-[var(--glass-border)] px-3 py-2 font-mono text-[10px] font-bold tracking-widest text-slate-400">
        WATCHLIST
      </div>
      <div className="divide-y divide-white/5">
        {INSTRUMENTS.map((i) => (
          <Row
            key={i.symbol}
            symbol={i.symbol}
            label={i.label}
            selected={selected === i.symbol}
            onSelect={() => onSelect(i.symbol)}
          />
        ))}
      </div>
    </div>
  );
}
