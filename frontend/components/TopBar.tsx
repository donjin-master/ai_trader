"use client";

import { useState } from "react";
import useSWR from "swr";
import { Bell, ChevronDown, Zap, Info, Bitcoin, X } from "lucide-react";
import { api, type Snapshot } from "@/lib/api";
import { ManualTradePanel } from "./ManualTradePanel";

const POLL = { refreshInterval: 15_000 };

export default function TopBar() {
  const { data: snap } = useSWR<Snapshot | null>("snap-btc", () => api.snapshot("BTCUSD"), POLL);
  const [pair] = useState("BTC/USDT");
  const [showQuickTrade, setShowQuickTrade] = useState(false);

  const price    = snap?.price ?? 0;
  const change   = snap?.change_24h_pct ?? 0;
  const high24h  = snap?.high_24h ?? 0;
  const low24h   = snap?.low_24h ?? 0;
  const vol24h   = snap?.volume_24h ? `$${(snap.volume_24h / 1e9).toFixed(2)}B` : "—";
  const funding  = snap?.funding_rate ?? 0;
  const fg       = snap?.fear_greed_index ?? 0;
  const fgLabel  = snap?.fear_greed_classification ?? "";
  const positive = change >= 0;

  return (
    <>
    <header
      style={{
        height: "var(--topbar-height)",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-subtle)",
        zIndex: 40,
      }}
      className="fixed inset-x-0 top-0 flex items-center px-4 gap-4"
    >
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0" style={{ width: "calc(var(--sidebar-width) - 16px)" }}>
        <div className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-bold text-white"
          style={{ background: "var(--accent-primary)", fontSize: "var(--text-sm)" }}>
          AI
        </div>
        <div>
          <div className="font-bold" style={{ fontSize: "var(--text-md)", color: "var(--text-primary)", lineHeight: 1.1 }}>TRADER</div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", lineHeight: 1 }}>v1.0.0</div>
        </div>
      </div>

      <div className="h-6 w-px" style={{ background: "var(--border-default)" }} />

      {/* Pair selector */}
      <button type="button" className="flex items-center gap-2 rounded-lg px-3 py-1.5 transition-all"
        style={{ background: "var(--bg-input)", border: "1px solid var(--border-default)" }}>
        <div className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: "#f7931a20" }}>
          <Bitcoin size={12} style={{ color: "#f7931a" }} />
        </div>
        <span className="font-semibold" style={{ fontSize: "var(--text-md)", color: "var(--text-primary)" }}>{pair}</span>
        <ChevronDown size={13} style={{ color: "var(--text-secondary)" }} />
      </button>

      {/* Price + change */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono font-bold" style={{ fontSize: "var(--text-2xl)", color: "var(--text-primary)" }}>
          {price > 0 ? price.toLocaleString("en-US", { minimumFractionDigits: 1 }) : "—"}
        </span>
        {price > 0 && (
          <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: positive ? "var(--color-bull)" : "var(--color-bear)" }}>
            {positive ? "+" : ""}{change.toFixed(2)}%
          </span>
        )}
      </div>

      <div className="h-6 w-px" style={{ background: "var(--border-default)" }} />

      {/* Stats strip */}
      <div className="hidden md:flex items-center gap-5 flex-1 overflow-hidden">
        <StatItem label="24h High" value={high24h > 0 ? high24h.toLocaleString("en-US") : "—"} />
        <StatItem label="24h Low"  value={low24h > 0  ? low24h.toLocaleString("en-US")  : "—"} />
        <StatItem label="24h Vol"  value={vol24h} />
        <StatItem
          label="Funding"
          value={snap ? `${funding >= 0 ? "+" : ""}${(funding * 100).toFixed(3)}%` : "—"}
          valueColor={funding >= 0 ? "var(--color-bull)" : "var(--color-bear)"}
        />
        {fg > 0 && (
          <div className="flex items-center gap-1">
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Fear&Greed:</span>
            <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>
              {fg}{" "}
              <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-ui)", fontWeight: 400 }}>({fgLabel})</span>
            </span>
            <Info size={11} style={{ color: "var(--text-muted)" }} />
          </div>
        )}
      </div>

      {/* Right actions */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <button type="button" onClick={() => setShowQuickTrade(true)}
          className="flex items-center gap-1.5 rounded-full px-4 py-1.5 font-semibold text-white transition-all hover:opacity-90"
          style={{ background: "var(--accent-primary)", fontSize: "var(--text-sm)" }}>
          <Zap size={14} /> Quick Trade
        </button>
        <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg transition-all"
          style={{ border: "1px solid var(--border-default)", color: "var(--text-secondary)" }}>
          <Bell size={15} />
        </button>
      </div>
    </header>

    {/* Quick Trade Modal */}
    {showQuickTrade && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
        onClick={(e) => { if (e.target === e.currentTarget) setShowQuickTrade(false); }}
      >
        <div
          className="relative w-full max-w-2xl mx-4 overflow-y-auto rounded-xl"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)", maxHeight: "90vh", boxShadow: "var(--shadow-panel)" }}
        >
          <button
            type="button"
            onClick={() => setShowQuickTrade(false)}
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg z-10"
            style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}
          >
            <X size={14} />
          </button>
          <ManualTradePanel currentPrice={price} onClose={() => setShowQuickTrade(false)} />
        </div>
      </div>
    )}
    </>
  );
}

function StatItem({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{label}:</span>
      <span className="font-mono font-semibold" style={{ fontSize: "var(--text-sm)", color: valueColor ?? "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  );
}
