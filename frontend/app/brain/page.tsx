"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import useSWR from "swr";
import Skeleton from "@/components/Skeleton";
import { api, type Lesson, type Trade } from "@/lib/api";
import { cn, formatPct } from "@/lib/utils";

const SCENARIOS = [
  "opposite_direction",
  "delayed_entry_30min",
  "double_hold_time",
  "half_position_size",
  "tighter_stop_loss",
] as const;

function deltaColor(delta: number): string {
  if (delta > 0.5) return "bg-green-500/50";
  if (delta > 0.1) return "bg-green-500/25";
  if (delta < -0.5) return "bg-red-500/40";
  if (delta < -0.1) return "bg-red-500/20";
  return "bg-zinc-800";
}

export default function BrainPage() {
  const { data: lessons, mutate: mutateLessons } = useSWR<Lesson[] | null>(
    "lessons", () => api.lessons(), { refreshInterval: 30_000 }
  );
  const { data: trades } = useSWR<Trade[] | null>(
    "trades", () => api.trades(150), { refreshInterval: 30_000 }
  );
  const [patternFilter, setPatternFilter] = useState<string>("All");

  const handleQualityChange = async (id: string, newQuality: number) => {
    if (!lessons) return;
    const updated = lessons.map((l) => (l.id === id ? { ...l, quality_score: newQuality } : l));
    mutateLessons(updated, false);
    await api.updateLessonQuality(id, newQuality);
    mutateLessons();
  };

  const filteredLessons = useMemo(() => {
    if (!lessons) return [];
    if (patternFilter === "All") return lessons;
    return lessons.filter((l) => (l.pattern_type ?? "").toLowerCase().includes(patternFilter.toLowerCase()));
  }, [lessons, patternFilter]);

  const cfTrades = useMemo(
    () => (trades ?? []).filter((t) => t.counterfactuals?.scenarios?.length),
    [trades]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-sm font-black tracking-widest">AI BRAIN</h1>
        <p className="text-xs text-zinc-500">What the system has learned</p>
      </div>

      {/* Section 1: Pattern Library */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold tracking-widest text-zinc-400">
            PATTERN LIBRARY
          </h2>
          <div className="flex gap-1">
            {["All", "Reflection", "Entry", "Exit"].map((f) => (
              <button
                key={f}
                onClick={() => setPatternFilter(f)}
                className={cn(
                  "rounded-md px-2 py-0.5 font-mono text-[10px] font-bold",
                  patternFilter === f ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {lessons === undefined ? (
          <Skeleton className="h-24" />
        ) : filteredLessons.length === 0 ? (
          <div className="panel p-4 text-xs text-zinc-500">
            No lessons yet — they appear after trades close and Loop 2 reflects.
          </div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 font-mono text-[10px] uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Pattern</th>
                  <th className="hidden px-3 py-2 md:table-cell">Watch For</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Conf</th>
                  <th className="px-3 py-2">Quality</th>
                </tr>
              </thead>
              <tbody>
                {filteredLessons.map((l) => (
                  <tr key={l.id} className="border-b border-zinc-800/50 align-top hover:bg-zinc-800/30">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-500">
                      {l.created_at ? format(new Date(l.created_at), "dd MMM") : "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-200">{l.lesson_text}</td>
                    <td className="hidden px-3 py-2 text-amber-300/80 md:table-cell">{l.watch_for}</td>
                    <td className="px-3 py-2 font-mono text-zinc-500">{l.pattern_type ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">{l.confidence_score ?? "—"}</td>
                    <td className="px-3 py-1 text-zinc-200">
                      <select
                        value={l.quality_score ?? 3}
                        onChange={(e) => handleQualityChange(l.id, parseInt(e.target.value))}
                        className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-xs text-zinc-300 font-mono focus:outline-none focus:border-zinc-700 cursor-pointer"
                      >
                        {[1, 2, 3, 4, 5].map((q) => (
                          <option key={q} value={q}>
                            {q} ★
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 2: Counterfactual Matrix */}
      <section>
        <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-zinc-400">
          COUNTERFACTUAL MATRIX
          <span className="ml-2 font-normal normal-case text-zinc-600">
            (greener cell = that alternative would have done better)
          </span>
        </h2>
        {cfTrades.length === 0 ? (
          <div className="panel p-4 text-xs text-zinc-500">
            Appears after the nightly Loop 3 run (2am IST) analyses closed trades.
          </div>
        ) : (
          <div className="panel overflow-x-auto p-3">
            <table className="w-full text-center text-[10px]">
              <thead className="font-mono uppercase text-zinc-500">
                <tr>
                  <th className="px-2 py-1 text-left">Trade</th>
                  {SCENARIOS.map((s) => (
                    <th key={s} className="px-2 py-1">{s.replace(/_/g, " ")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cfTrades.map((t) => {
                  const actual = t.pnl_pct ?? 0;
                  return (
                    <tr key={t.id}>
                      <td className="px-2 py-1 text-left font-mono text-zinc-400">
                        {t.created_at ? format(new Date(t.created_at), "dd MMM") : "—"} {(t.direction ?? "").toUpperCase()} ({formatPct(actual)})
                      </td>
                      {SCENARIOS.map((name) => {
                        const scenario = t.counterfactuals!.scenarios!.find((s) => s.name === name);
                        const delta = scenario ? scenario.simulated_pnl_pct - actual : 0;
                        return (
                          <td key={name} className="p-0.5">
                            <div
                              className={cn("rounded px-1 py-1.5 font-mono", deltaColor(delta))}
                              title={scenario ? `${formatPct(scenario.simulated_pnl_pct)} (${delta >= 0 ? "+" : ""}${delta.toFixed(2)} vs actual) — ${scenario.leading_indicator}` : "n/a"}
                            >
                              {scenario ? formatPct(scenario.simulated_pnl_pct, false) : "—"}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 3: Learning feed */}
      <section>
        <h2 className="mb-2 font-mono text-xs font-bold tracking-widest text-zinc-400">
          WHAT THE AI IS LEARNING
        </h2>
        {lessons?.length ? (
          <div className="space-y-1.5">
            {lessons.slice(0, 8).map((l) => (
              <div key={l.id} className="panel px-3 py-2 text-xs">
                <span className="font-mono text-zinc-500">
                  {l.created_at ? format(new Date(l.created_at), "dd MMM") : "—"} —{" "}
                </span>
                <span className="text-zinc-300">Learned: {l.lesson_text}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel p-4 text-xs text-zinc-500">Nothing yet — feed populates as trades close.</div>
        )}
      </section>
    </div>
  );
}
