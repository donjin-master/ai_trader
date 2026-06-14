"use client";

import useSWR from "swr";
import KillSwitchButton from "@/components/KillSwitchButton";
import { api, type Snapshot, type Status } from "@/lib/api";
import { cn, formatPct, formatUsd, pnlColor } from "@/lib/utils";

const POLL = { refreshInterval: 30_000 };

function StatePill({ status }: { status: Status | null | undefined }) {
  const killed = status?.kill_switch;
  const mode = status?.mode ?? "—";
  const state = killed
    ? { label: "KILLED", dot: "bg-red-500", text: "text-red-400" }
    : mode === "ADVISORY"
      ? { label: "MONITORING", dot: "bg-blue-500 pulse-dot", text: "text-blue-400" }
      : { label: "LIVE", dot: "bg-green-500 pulse-dot", text: "text-green-400" };
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[10px] font-bold", state.text)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
        {state.label}
      </span>
      <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[10px] font-bold text-zinc-300">
        {mode}
      </span>
      <span
        className={cn(
          "rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[10px] font-bold",
          killed ? "text-red-400" : "text-green-500"
        )}
      >
        {killed ? "TRIGGERED" : "ARMED"}
      </span>
    </div>
  );
}

export default function TopBar() {
  const { data: status, mutate } = useSWR<Status | null>("status", () => api.status(), POLL);
  const { data: snapshot } = useSWR<Snapshot | null>(
    "snapshot", () => api.snapshot("BTCUSD"), POLL
  );

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 backdrop-blur-xl md:px-4">
      <div className="flex items-center gap-3">
        <div className="leading-none">
          <span className="font-mono text-sm font-black tracking-tight">AI TRADER</span>
          <div className="text-[9px] font-mono text-zinc-500">v1.0 · TESTNET</div>
        </div>
        <div className="hidden sm:block">
          <StatePill status={status} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right font-mono leading-none">
          <span className="text-base font-bold md:text-lg">{formatUsd(snapshot?.price)}</span>{" "}
          <span className={cn("text-xs font-semibold", pnlColor(snapshot?.change_24h_pct))}>
            {formatPct(snapshot?.change_24h_pct)}
          </span>
        </div>
        <KillSwitchButton onKilled={() => mutate()} />
      </div>
    </header>
  );
}
