"use client";

import useSWR from "swr";
import { Layers } from "lucide-react";
import { api } from "@/lib/api";

const POLL = { refreshInterval: 5 * 60 * 1000 };

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
    <div className="card" style={{ animation: "pulse 1.5s ease-in-out infinite" }}>
      <div className="flex flex-col gap-3">
        <div style={{ height: 14, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", width: "33%" }} />
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 12, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)" }} />
          ))}
        </div>
        <div style={{ height: 32, background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)" }} />
      </div>
    </div>
  );
}

function PositionCard({ pos }: { pos: OptionsPosition }) {
  const isCall = pos.option_type === "CALL";
  const pnlPositive = pos.unrealized_pnl_pct >= 0;
  const typeColor = isCall ? "var(--color-bull)" : "var(--color-bear)";
  const typeBg = isCall ? "rgba(38,208,124,0.12)" : "rgba(255,77,106,0.12)";

  const expiryDate = new Date(pos.expiry).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });

  return (
    <div className="card flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold" style={{ color: "var(--text-primary)" }}>{pos.symbol}</span>
          <span className="rounded-full px-2 py-0.5 font-bold"
            style={{ fontSize: "var(--text-xs)", background: typeBg, color: typeColor }}>
            {pos.option_type}
          </span>
          {pos.dte <= 21 && (
            <span className="rounded-full px-2 py-0.5 font-bold"
              style={{ fontSize: "var(--text-xs)", background: "rgba(240,180,41,0.12)", color: "var(--color-neutral)" }}>
              ⚠ Close Soon — 21 DTE
            </span>
          )}
        </div>
        <span className="font-mono font-bold" style={{ fontSize: "var(--text-lg)", color: pnlPositive ? "var(--color-bull)" : "var(--color-bear)" }}>
          {pnlPositive ? "+" : ""}{pos.unrealized_pnl_pct.toFixed(2)}%
        </span>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
        {[
          { label: "Strike",  value: `₹${pos.strike_price.toLocaleString("en-IN")}` },
          { label: "Expiry",  value: expiryDate },
          { label: "DTE",     value: `${pos.dte}d`, color: pos.dte <= 21 ? "var(--color-neutral)" : undefined },
          { label: "Size",    value: String(pos.size) },
          { label: "Entry",   value: `₹${pos.entry_price.toLocaleString("en-IN")}` },
          { label: "Mark",    value: `₹${pos.mark_price.toLocaleString("en-IN")}` },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex justify-between">
            <span style={{ color: "var(--text-muted)" }}>{label}</span>
            <span style={{ color: color ?? "var(--text-secondary)", fontWeight: color ? 700 : 400 }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Management rules */}
      <div className="flex flex-wrap gap-2" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 8 }}>
        {["Close at 50% profit", "Close at 21 DTE", "Close at 2x credit"].map((rule) => (
          <span key={rule} className="rounded px-2 py-0.5"
            style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}>
            {rule}
          </span>
        ))}
      </div>
    </div>
  );
}

function IronCondorChart() {
  const width = 600, height = 60;
  const zones = [
    { label: "Long Put",    x: 0,   w: 80,  color: "var(--color-bear)" },
    { label: "SHORT PUT",   x: 80,  w: 110, color: "var(--color-neutral)" },
    { label: "PROFIT ZONE", x: 190, w: 220, color: "var(--color-bull)" },
    { label: "SHORT CALL",  x: 410, w: 110, color: "var(--color-neutral)" },
    { label: "Long Call",   x: 520, w: 80,  color: "var(--color-bear)" },
  ];
  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", maxWidth: 600 }}>
        {zones.map((z) => (
          <g key={z.label}>
            <rect x={z.x} y={16} width={z.w} height={24} fill={z.color} opacity={0.2} />
            <text x={z.x + z.w / 2} y={30} textAnchor="middle" dominantBaseline="middle"
              fill={z.color} fontSize={9} fontFamily="var(--font-mono)" fontWeight="bold">
              {z.label}
            </text>
          </g>
        ))}
        <line x1={300} y1={8} x2={300} y2={52} stroke="var(--accent-primary)" strokeWidth={2} strokeDasharray="3 2" />
        <text x={300} y={6} textAnchor="middle" fill="var(--accent-primary)" fontSize={8} fontFamily="var(--font-mono)">
          Current
        </text>
        <text x={4} y={56} fill="var(--text-muted)" fontSize={8} fontFamily="var(--font-mono)">← loss</text>
        <text x={width - 4} y={56} textAnchor="end" fill="var(--text-muted)" fontSize={8} fontFamily="var(--font-mono)">loss →</text>
      </svg>
    </div>
  );
}

export default function OptionsPage() {
  const { data: positions, isLoading } = useSWR<OptionsPosition[] | null>(
    "options-positions",
    () => api.optionsPositions() as Promise<OptionsPosition[] | null>,
    POLL,
  );

  return (
    <div className="flex flex-col gap-4" suppressHydrationWarning>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "rgba(108,99,255,0.1)", border: "1px solid rgba(108,99,255,0.25)" }}>
            <Layers size={18} style={{ color: "var(--accent-primary)" }} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>OPTIONS</h1>
            <p className="hidden sm:block" style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Live options book — refreshes every 5 minutes</p>
          </div>
        </div>
      </div>

      {/* Open Positions */}
      <div className="flex flex-col gap-3">
        <span className="section-label">Open Positions</span>
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : !positions || positions.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-16">
            <div style={{ fontSize: 40 }}>📭</div>
            <div style={{ fontSize: "var(--text-md)", color: "var(--text-muted)", textAlign: "center" }}>
              No open options positions<br />
              <span style={{ fontSize: "var(--text-sm)" }}>Positions will appear once the AI opens options trades</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {positions.map((pos) => (
              <PositionCard key={`${pos.symbol}-${pos.strike_price}-${pos.option_type}`} pos={pos} />
            ))}
          </div>
        )}
      </div>

      {/* Iron Condor Visualizer */}
      <div className="flex flex-col gap-3">
        <span className="section-label">Iron Condor Visualiser</span>
        <div className="card flex flex-col gap-3">
          <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            Profit/loss zones for active iron condors
          </p>
          <div style={{ textAlign: "center", paddingBlock: 8 }}>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 16 }}>
              No iron condors active
            </p>
            <div style={{ opacity: 0.3 }}>
              <IronCondorChart />
            </div>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 12 }}>
              Diagram shown as preview — will activate once a condor is opened
            </p>
          </div>
        </div>
      </div>

      {/* Management Rules */}
      <div className="card">
        <span className="section-label" style={{ display: "block", marginBottom: 12 }}>Management Rules</span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { rule: "Close at 50% profit", desc: "Take profit when premium decays to half",   color: "var(--color-bull)" },
            { rule: "Close at 21 DTE",     desc: "Exit before gamma risk accelerates",         color: "var(--color-neutral)" },
            { rule: "Close at 2x credit",  desc: "Max loss = 2× premium received",             color: "var(--color-bear)" },
          ].map(({ rule, desc, color }) => (
            <div key={rule}>
              <div className="font-mono font-bold" style={{ fontSize: "var(--text-xs)", color }}>{rule}</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
