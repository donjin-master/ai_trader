"use client";

import { useState } from "react";
import { format } from "date-fns";
import type { Trade } from "@/lib/api";
import { cn, formatDuration, formatPct, pnlColor } from "@/lib/utils";

// Stars component removed to show score out of 10 instead

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-zinc-800 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full py-2 text-left text-sm font-semibold text-zinc-300 hover:text-zinc-100"
      >
        {title} {open ? "▲" : "▼"}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function outcomeOf(trade: Trade): "WIN" | "LOSS" | "OPEN" | "HOLD" {
  if (trade.action === "hold" || trade.status === "logged_only") return "HOLD";
  if (trade.status === "open" || trade.status === "pending_approval") return "OPEN";
  if ((trade.pnl_pct ?? 0) >= 0) return "WIN";
  return "LOSS";
}

const outcomeStyles: Record<string, string> = {
  WIN: "bg-green-500/15 text-green-500",
  LOSS: "bg-red-500/15 text-red-500",
  OPEN: "bg-blue-500/15 text-blue-500",
  HOLD: "bg-zinc-700/40 text-zinc-400",
};

const scenarioLabels: Record<string, string> = {
  opposite_direction: "Opposite direction",
  delayed_entry_30min: "Delayed entry 30min",
  double_hold_time: "Double hold time",
  half_position_size: "Half position size",
  tighter_stop_loss: "Tighter stop loss",
};

function getMemberRoleAndModel(member: string, model: string | undefined): { role: string; modelName: string } {
  const m = member.toLowerCase();
  
  // Determine Role
  let role = "Analyst";
  if (m.includes("technical") || m === "haiku") {
    role = "Technical";
  } else if (m.includes("risk") || m === "gemini") {
    role = "Risk";
  } else if (m.includes("momentum") || m.includes("monent") || m === "gpt") {
    role = "Momentum";
  }
  
  // Determine Model Name
  let modelName = "";
  if (model) {
    const ml = model.toLowerCase();
    if (ml.includes("sonnet")) modelName = "Claude 3.5 Sonnet";
    else if (ml.includes("haiku")) modelName = "Claude Haiku";
    else if (ml.includes("gpt-5")) modelName = "GPT-5";
    else if (ml.includes("gpt-4")) modelName = "GPT-4";
    else if (ml.includes("gpt")) modelName = "GPT";
    else if (ml.includes("gemini-3.5")) modelName = "Gemini 3.5 Flash";
    else if (ml.includes("gemini")) modelName = "Gemini";
    else modelName = model;
  } else {
    // Fallback if model is not present in data (infer from member name)
    if (m.includes("claude")) {
      modelName = "Claude 3.5 Sonnet";
    } else if (m === "haiku") {
      modelName = "Claude Haiku";
    } else if (m === "gpt") {
      modelName = "GPT-5";
    } else if (m === "gemini") {
      modelName = "Gemini 3.5 Flash";
    } else {
      modelName = "Claude"; // Default fallback
    }
  }
  
  return { role, modelName };
}

function BoardroomMemberRow({ v }: { v: any }) {
  const [open, setOpen] = useState(false);
  const { role, modelName } = getMemberRoleAndModel(v.member, v.model);
  return (
    <div className="py-2 first:pt-1 last:pb-1">
      <div 
        onClick={() => setOpen(!open)}
        className="flex items-start gap-2 cursor-pointer hover:bg-zinc-800/30 p-1.5 rounded transition-colors"
      >
        <span className="text-zinc-500 text-[10px] mt-0.5 shrink-0">{open ? "▼" : "▶"}</span>
        <div className="flex flex-col gap-0.5 shrink-0 w-36">
          <span className="font-mono font-bold text-zinc-200 text-xs capitalize">{role}</span>
          <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded w-fit">{modelName}</span>
        </div>
        <span className={cn(
          "rounded px-2 py-0.5 font-bold text-[10px] tracking-wide uppercase shrink-0",
          v.vote.includes("LONG") ? "bg-green-500/15 text-green-400"
            : v.vote.includes("SHORT") ? "bg-red-500/15 text-red-400"
            : "bg-zinc-800 text-zinc-400"
        )}>{v.vote}</span>
        <span className="bg-amber-500/10 text-amber-400 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0">
          {Math.round(v.conviction || 0)}/10
        </span>
        <span className="text-zinc-500 text-xs flex-1 min-w-0 overflow-hidden line-clamp-2">
          {v.primary_reason}
        </span>
      </div>
      {open && (
        <div className="mt-2 ml-6 pl-4 border-l-2 border-zinc-800 space-y-2 text-zinc-300 pb-1.5">
          <div>
            <span className="font-semibold text-zinc-400 block mb-0.5 text-[10px] uppercase tracking-wider">Primary Signal / Reason:</span>
            <p className="text-zinc-200 text-xs leading-relaxed">{v.primary_reason}</p>
          </div>
          {v.biggest_risk && (
            <div>
              <span className="font-semibold text-red-400/80 block mb-0.5 text-[10px] uppercase tracking-wider">Biggest Risk:</span>
              <p className="text-zinc-200 text-xs leading-relaxed">{v.biggest_risk}</p>
            </div>
          )}
          {v.key_signals && v.key_signals.length > 0 && (
            <div>
              <span className="font-semibold text-blue-400/80 block mb-0.5 text-[10px] uppercase tracking-wider">Key Signals:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {v.key_signals.map((sig: string) => (
                  <span key={sig} className="bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded text-[10px] font-mono">{sig}</span>
                ))}
              </div>
            </div>
          )}
          {(v.suggested_entry_offset_pct !== 0 || v.suggested_sl_offset_pct !== 0 || v.suggested_tp_offset_pct !== 0) && (
            <div className="flex gap-4 text-[10px] font-mono text-zinc-500 pt-1">
              <span>Suggested Entry: {v.suggested_entry_offset_pct}%</span>
              <span>SL Offset: {v.suggested_sl_offset_pct}%</span>
              <span>TP Offset: {v.suggested_tp_offset_pct}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BoardroomDeliberationRow({ d, votes }: { d: any; votes?: any[] }) {
  const [open, setOpen] = useState(false);
  const vote = votes?.find(v => v.member === d.member);
  const { role, modelName } = getMemberRoleAndModel(d.member, d.model || vote?.model);
  return (
    <div className="py-2 first:pt-1 last:pb-1">
      <div 
        onClick={() => setOpen(!open)}
        className="flex items-start gap-2 cursor-pointer hover:bg-zinc-800/30 p-1.5 rounded transition-colors"
      >
        <span className="text-zinc-500 text-[10px] mt-0.5 shrink-0">{open ? "▼" : "▶"}</span>
        <div className="flex flex-col gap-0.5 shrink-0 w-36">
          <span className="font-mono font-bold text-zinc-200 text-xs capitalize">{role}</span>
          <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded w-fit">{modelName}</span>
        </div>
        <span className="font-bold text-zinc-300 text-xs shrink-0">
          {d.original_vote !== d.final_vote ? `${d.original_vote} → ${d.final_vote}` : d.final_vote}
        </span>
        <span className={cn(
          "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0",
          d.original_vote !== d.final_vote ? "bg-amber-500/15 text-amber-400" : "bg-zinc-800 text-zinc-500"
        )}>
          {d.original_vote !== d.final_vote ? "Updated" : "Held"}
        </span>
        <span className="text-zinc-500 text-xs flex-1 min-w-0 overflow-hidden line-clamp-2">
          {d.reasoning}
        </span>
      </div>
      {open && d.reasoning && (
        <div className="mt-2 ml-6 pl-4 border-l-2 border-zinc-800 text-zinc-300 pb-1.5">
          <span className="font-semibold text-zinc-400 block mb-0.5 text-[10px] uppercase tracking-wider">Deliberation Rationale:</span>
          <p className="text-zinc-200 text-xs leading-relaxed">{d.reasoning}</p>
        </div>
      )}
    </div>
  );}

export default function TradeCard({ trade, index }: { trade: Trade; index: number }) {
  const outcome = outcomeOf(trade);
  const bull = trade.decision_json?.bull_full;
  const bear = trade.decision_json?.bear_full;

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-bold text-zinc-400">
            #{index}
          </span>
          <span className="font-semibold">{trade.instrument}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold",
              trade.direction === "long"
                ? "bg-green-500/15 text-green-500"
                : trade.direction === "short"
                  ? "bg-red-500/15 text-red-500"
                  : "bg-zinc-700/40 text-zinc-400"
            )}
          >
            {(trade.direction ?? "—").toUpperCase()}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", outcomeStyles[outcome])}>
            {outcome}
          </span>
          {trade.setup_score != null && (
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-black",
                trade.setup_score >= 8
                  ? "bg-green-500/15 text-green-400"
                  : trade.setup_score >= 6
                    ? "bg-amber-500/15 text-amber-400"
                    : "bg-red-500/15 text-red-400"
              )}
              title={`Setup score ${trade.setup_score}/10`}
            >
              {trade.setup_grade ?? (trade.setup_score >= 8 ? "A" : trade.setup_score >= 6 ? "B" : "C")}{" "}
              {trade.setup_score}/10
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-right">
          <span className={cn("text-xl font-bold", pnlColor(trade.pnl_pct))}>
            {formatPct(trade.pnl_pct)}
          </span>
          <span className="text-xs text-zinc-500">{formatDuration(trade.duration_mins)}</span>
          <span className="text-xs text-zinc-500">
            {trade.created_at ? format(new Date(trade.created_at), "dd MMM HH:mm") : "—"}
          </span>
        </div>
      </div>

      <Section title="Entry Thesis">
        <div className="flex flex-wrap gap-2 pb-2">
          {(trade.key_signals ?? []).map((s) => (
            <span key={s} className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300">
              {s}
            </span>
          ))}
        </div>
        <p className="text-sm text-zinc-300">{trade.reasoning ?? "—"}</p>
      </Section>

      <Section title="🐂 Bull Case / 🐻 Bear Case">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-green-500/5 p-3">
            <div className="text-xs font-bold text-green-500">
              🐂 BULL {bull?.conviction !== undefined && (
                <span className="ml-1 text-zinc-400">({bull.conviction}/10)</span>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-300">
              {bull?.entry_rationale ?? trade.bull_case ?? "—"}
            </p>
          </div>
          <div className="rounded-lg bg-red-500/5 p-3">
            <div className="text-xs font-bold text-red-500">
              🐻 BEAR {bear?.conviction !== undefined && (
                <span className="ml-1 text-zinc-400">({bear.conviction}/10)</span>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-300">
              {bear?.entry_rationale ?? trade.bear_case ?? "—"}
            </p>
          </div>
        </div>
      </Section>

      <Section title="⚖️ Judge Verdict">
        <p className="text-sm text-zinc-300">
          {trade.decision_json?.why_over_alternative ?? trade.reasoning ?? "—"}
        </p>
        <div className="mt-2 text-xs text-zinc-400">
          Confidence:{" "}
          <span
            className={cn(
              "font-bold",
              (trade.confidence ?? 0) >= 7 ? "text-green-500" : (trade.confidence ?? 0) >= 6 ? "text-amber-500" : "text-red-500"
            )}
          >
            {trade.confidence ?? "—"}/10
          </span>
        </div>
      </Section>

      {trade.boardroom_votes?.votes?.length ? (
        <Section title="🏛️ Boardroom">
          <div className="space-y-4 text-xs">
            <div>
              <div className="mb-2 font-bold text-zinc-400">Round 1 — Independent Votes</div>
              <div className="rounded-lg bg-zinc-900/30 border border-zinc-800/50 p-1.5 divide-y divide-zinc-800/30">
                {trade.boardroom_votes!.votes.map((v) => (
                  <BoardroomMemberRow key={v.member} v={v} />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 font-bold text-zinc-400">Round 2 — After Deliberation</div>
              <div className="rounded-lg bg-zinc-900/30 border border-zinc-800/50 p-1.5 divide-y divide-zinc-800/30">
                {trade.boardroom_votes!.deliberations.map((d) => (
                  <BoardroomDeliberationRow key={d.member} d={d} votes={trade.boardroom_votes!.votes} />
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-zinc-950 p-2">
              Tally:{" "}
              {Object.entries(trade.boardroom_votes!.vote_tally ?? {})
                .map(([v, n]) => `${n}× ${v}`)
                .join(" | ")}
              {trade.decision_json?.consensus_level && (
                <span className="ml-2 font-bold uppercase text-blue-400">
                  {trade.decision_json.consensus_level}
                </span>
              )}
            </div>
            {trade.decision_json?.chair_reasoning && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-2 text-blue-200">
                <b>Chair:</b> {trade.decision_json.chair_reasoning.slice(0, 300)}
              </div>
            )}
          </div>
        </Section>
      ) : null}

      {trade.smc_summary && (
        <Section title="📐 SMC Analysis">
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap gap-2">
              {Object.entries(trade.smc_summary.structures ?? {}).map(([tf, s]) => (
                <span
                  key={tf}
                  className={cn(
                    "rounded-full px-2 py-0.5 font-bold uppercase",
                    s.trend === "BULLISH"
                      ? "bg-green-500/15 text-green-400"
                      : s.trend === "BEARISH"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-zinc-700/40 text-zinc-400"
                  )}
                >
                  {tf}: {s.trend}
                </span>
              ))}
              {trade.smc_summary.premium_discount && (
                <span className="rounded-full bg-purple-500/15 px-2 py-0.5 font-bold text-purple-300">
                  {trade.smc_summary.premium_discount}
                </span>
              )}
            </div>
            {(trade.smc_summary.confluences_found ?? []).length > 0 && (
              <div>
                <div className="font-bold text-green-400">Confluences present:</div>
                {(trade.smc_summary.confluences_found ?? []).map((c) => (
                  <div key={c} className="text-zinc-300">✓ {c}</div>
                ))}
              </div>
            )}
            {(trade.smc_summary.missing ?? []).length > 0 && (
              <div>
                <div className="font-bold text-zinc-500">Missing:</div>
                {(trade.smc_summary.missing ?? []).map((m) => (
                  <div key={m} className="text-zinc-500">✗ {m}</div>
                ))}
              </div>
            )}
            {trade.position_params?.calculation_detail && (
              <div className="rounded-lg bg-zinc-950 p-2 font-mono text-zinc-400">
                {trade.position_params.calculation_detail}
              </div>
            )}
          </div>
        </Section>
      )}

      {trade.position_params?.management && (
        <Section title="🛠 Position Management Summary">
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-zinc-300 md:grid-cols-3">
              <div>Exit trigger: <span className="font-bold text-zinc-100">{trade.position_params.management.trigger}</span></div>
              <div>TP1 partial: {trade.position_params.management.tp1_hit ? "✅ banked" : "✗ not reached"}</div>
              <div>Breakeven: {trade.position_params.management.breakeven_set ? "✅ set" : "✗"}</div>
              <div>Planned R:R: 1:{trade.position_params.management.initial_rr_planned?.toFixed(1)}</div>
              <div>
                Achieved R:R:{" "}
                <span className={cn("font-bold", (trade.position_params.management.rr_achieved_on_exit ?? 0) >= 1 ? "text-green-400" : "text-red-400")}>
                  1:{trade.position_params.management.rr_achieved_on_exit?.toFixed(1)}
                </span>
              </div>
              <div>Trail updates: {trade.position_params.management.trail_updates}</div>
            </div>
            {(trade.position_params.management.trail_history ?? []).length > 1 && (
              <div className="rounded-lg bg-zinc-950 p-2 font-mono text-zinc-400">
                Trail history:{" "}
                {(trade.position_params.management.trail_history ?? [])
                  .map((t) => t.sl.toLocaleString())
                  .join(" → ")}
              </div>
            )}
          </div>
        </Section>
      )}

      {trade.reflection && (
        <Section title="📝 Reflection">
          <div className="space-y-2 text-sm">
            <div>
              Thesis correct: {trade.reflection.thesis_correct ? "✅" : "❌"}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Execution quality</span>
              <div className="h-2 w-32 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${(trade.reflection.execution_quality ?? 0) * 10}%` }}
                />
              </div>
              <span className="text-xs">{trade.reflection.execution_quality}/10</span>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
              {trade.reflection.lesson}
            </div>
            <div className="text-xs text-zinc-400">Watch for: {trade.reflection.watch_for}</div>
          </div>
        </Section>
      )}

      <Section title="🔄 Counterfactuals">
        {trade.counterfactuals?.scenarios ? (
          <div>
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1">Scenario</th>
                  <th>Result</th>
                  <th>Better?</th>
                  <th className="hidden md:table-cell">Leading Indicator</th>
                </tr>
              </thead>
              <tbody>
                {trade.counterfactuals.scenarios.map((s) => (
                  <tr key={s.name} className="border-t border-zinc-800">
                    <td className="py-1.5">{scenarioLabels[s.name] ?? s.name}</td>
                    <td className={pnlColor(s.simulated_pnl_pct)}>{formatPct(s.simulated_pnl_pct)}</td>
                    <td>{s.outcome_better ? "✅" : "—"}</td>
                    <td className="hidden text-zinc-400 md:table-cell">{s.leading_indicator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trade.counterfactuals.key_insight && (
              <div className="mt-2 rounded-lg border border-purple-500/30 bg-purple-500/10 p-2 text-xs text-purple-200">
                {trade.counterfactuals.key_insight}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Analysis pending...</p>
        )}
      </Section>
    </div>
  );
}
