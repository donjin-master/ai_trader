"use client";

import { useQuery } from "@tanstack/react-query";

interface OptionsPosition {
  symbol: string;
  option_type: "CALL" | "PUT";
  strike_price: number;
  expiry: string;
  dte: number;
  size: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl_pct: number;
}

function SkeletonCard() {
  return (
    <div className="border border-zinc-800 rounded-xl p-4 space-y-3 animate-pulse">
      <div className="h-4 bg-zinc-800 rounded w-1/3" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-3 bg-zinc-800 rounded" />
        <div className="h-3 bg-zinc-800 rounded" />
        <div className="h-3 bg-zinc-800 rounded" />
        <div className="h-3 bg-zinc-800 rounded" />
      </div>
      <div className="h-8 bg-zinc-800 rounded" />
    </div>
  );
}

function PnlBadge({ pct }: { pct: number }) {
  const isPositive = pct >= 0;
  return (
    <span className={`font-mono font-bold text-lg ${isPositive ? "text-green-400" : "text-red-400"}`}>
      {isPositive ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

function PositionCard({ pos }: { pos: OptionsPosition }) {
  const expiryDate = new Date(pos.expiry).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/50 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-semibold font-mono">{pos.symbol}</span>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              pos.option_type === "CALL"
                ? "bg-green-400/10 text-green-400"
                : "bg-red-400/10 text-red-400"
            }`}
          >
            {pos.option_type}
          </span>
          {pos.dte <= 21 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400">
              ⚠️ Close Soon — 21 DTE
            </span>
          )}
        </div>
        <PnlBadge pct={pos.unrealized_pnl_pct} />
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-xs">
        <div className="flex justify-between">
          <span className="text-zinc-400">Strike</span>
          <span className="text-zinc-300">₹{pos.strike_price.toLocaleString("en-IN")}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Expiry</span>
          <span className="text-zinc-300">{expiryDate}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">DTE</span>
          <span className={pos.dte <= 21 ? "text-amber-400 font-bold" : "text-zinc-300"}>
            {pos.dte}d
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Size</span>
          <span className="text-zinc-300">{pos.size}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Entry</span>
          <span className="text-zinc-300">₹{pos.entry_price.toLocaleString("en-IN")}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-400">Mark</span>
          <span className="text-zinc-300">₹{pos.mark_price.toLocaleString("en-IN")}</span>
        </div>
      </div>

      {/* Management rules footer */}
      <div className="border-t border-zinc-800 pt-2 flex flex-wrap gap-2">
        {["Close at 50% profit", "Close at 21 DTE", "Close at 2x credit"].map((rule) => (
          <span
            key={rule}
            className="text-[10px] font-mono text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded"
          >
            {rule}
          </span>
        ))}
      </div>
    </div>
  );
}

function IronCondorChart() {
  // Placeholder SVG horizontal bar — condors API returns empty for now
  const width = 600;
  const height = 60;
  const zones = [
    { label: "Long Put", x: 0, w: 80, color: "#ef4444" },
    { label: "SHORT PUT", x: 80, w: 110, color: "#f97316" },
    { label: "PROFIT ZONE", x: 190, w: 220, color: "#22c55e" },
    { label: "SHORT CALL", x: 410, w: 110, color: "#f97316" },
    { label: "Long Call", x: 520, w: 80, color: "#ef4444" },
  ];
  // Current price indicator at 50%
  const priceX = 300;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full max-w-2xl">
        {zones.map((z) => (
          <g key={z.label}>
            <rect x={z.x} y={16} width={z.w} height={24} fill={z.color} opacity={0.25} />
            <text
              x={z.x + z.w / 2}
              y={30}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={z.color}
              fontSize={9}
              fontFamily="monospace"
              fontWeight="bold"
            >
              {z.label}
            </text>
          </g>
        ))}
        {/* Current price line */}
        <line x1={priceX} y1={8} x2={priceX} y2={52} stroke="#a78bfa" strokeWidth={2} strokeDasharray="3 2" />
        <text x={priceX} y={6} textAnchor="middle" fill="#a78bfa" fontSize={8} fontFamily="monospace">
          Current
        </text>
        {/* Arrow labels */}
        <text x={4} y={56} fill="#71717a" fontSize={8} fontFamily="monospace">← loss</text>
        <text x={width - 4} y={56} textAnchor="end" fill="#71717a" fontSize={8} fontFamily="monospace">loss →</text>
      </svg>
    </div>
  );
}

export default function OptionsPage() {
  const { data: positions, isLoading } = useQuery<OptionsPosition[]>({
    queryKey: ["options-positions"],
    queryFn: () => fetch("/api/options/positions").then((r) => r.json()),
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-6 p-4 max-w-5xl mx-auto">
      {/* Page header */}
      <div>
        <h1 className="text-white text-2xl font-bold">Options Positions</h1>
        <p className="text-zinc-400 text-sm mt-1">Live options book — refreshes every 5 minutes</p>
      </div>

      {/* Positions section */}
      <section className="space-y-3">
        <h2 className="text-zinc-300 text-sm font-mono font-bold tracking-widest uppercase">
          Open Positions
        </h2>

        {isLoading ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : !positions || positions.length === 0 ? (
          <div className="border border-zinc-800 rounded-xl p-8 text-center bg-zinc-900/50">
            <div className="text-zinc-500 text-4xl mb-3">📭</div>
            <div className="text-zinc-400 font-mono text-sm">No open options positions</div>
            <div className="text-zinc-600 text-xs mt-1">
              Positions will appear here once the AI opens options trades
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {positions.map((pos) => (
              <PositionCard key={`${pos.symbol}-${pos.strike_price}-${pos.option_type}`} pos={pos} />
            ))}
          </div>
        )}
      </section>

      {/* Iron Condor section */}
      <section className="space-y-3">
        <h2 className="text-zinc-300 text-sm font-mono font-bold tracking-widest uppercase">
          Iron Condor Visualiser
        </h2>

        <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/50 space-y-4">
          <div className="text-zinc-500 text-xs font-mono mb-3">
            Profit/loss zones for active iron condors
          </div>

          {/* Condors are always empty for now — show empty state + static diagram */}
          <div className="text-center py-4">
            <div className="text-zinc-500 text-sm font-mono mb-4">No iron condors active</div>
            <div className="opacity-30">
              <IronCondorChart />
            </div>
            <div className="text-zinc-600 text-xs mt-3">
              Diagram shown as preview — will activate once a condor is opened
            </div>
          </div>
        </div>
      </section>

      {/* Management rules reference */}
      <section className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/50">
        <h2 className="text-zinc-300 text-sm font-mono font-bold tracking-widest uppercase mb-3">
          Management Rules
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { rule: "Close at 50% profit", desc: "Take profit when premium decays to half", color: "text-green-400" },
            { rule: "Close at 21 DTE", desc: "Exit before gamma risk accelerates", color: "text-amber-400" },
            { rule: "Close at 2x credit", desc: "Max loss = 2× premium received", color: "text-red-400" },
          ].map(({ rule, desc, color }) => (
            <div key={rule} className="space-y-1">
              <div className={`font-mono text-xs font-bold ${color}`}>{rule}</div>
              <div className="text-zinc-500 text-xs">{desc}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
