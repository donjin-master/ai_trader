"use client";

import { cn } from "@/lib/utils";

type SystemState = "LIVE" | "MONITORING" | "PAUSED" | "KILLED";

export function deriveSystemState(
  mode: string | undefined,
  killSwitch: boolean | undefined
): SystemState {
  if (killSwitch) return "KILLED";
  if (mode === "FULL_AUTO" || mode === "SEMI_AUTO") return "LIVE";
  if (mode === "ADVISORY") return "MONITORING";
  return "PAUSED";
}

const styles: Record<SystemState, { dot: string; text: string; label: string }> = {
  LIVE: { dot: "bg-green-500 pulse-dot", text: "text-green-500", label: "LIVE" },
  MONITORING: { dot: "bg-blue-500", text: "text-blue-500", label: "MONITORING" },
  PAUSED: { dot: "bg-amber-500", text: "text-amber-500", label: "PAUSED" },
  KILLED: { dot: "bg-red-500", text: "text-red-500", label: "KILLED" },
};

export default function StatusBadge({ state }: { state: SystemState }) {
  const s = styles[state];
  return (
    <span className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-semibold">
      <span className={cn("h-2 w-2 rounded-full", s.dot)} />
      <span className={s.text}>{s.label}</span>
    </span>
  );
}
