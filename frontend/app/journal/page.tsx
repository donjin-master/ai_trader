"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import useSWR from "swr";
import Skeleton from "@/components/Skeleton";
import { API_BASE, api, type Trade } from "@/lib/api";
import { cn, formatDuration, formatPct, pnlColor } from "@/lib/utils";

const filters = ["All", "Won", "Lost", "Open"] as const;
type Filter = (typeof filters)[number];

const TABS = ["Entry Thesis", "Boardroom", "SMC", "📸 What AI Saw", "Reflection", "Counterfactuals"] as const;
type Tab = (typeof TABS)[number];

function matches(trade: Trade, filter: Filter): boolean {
  switch (filter) {
    case "All": return true;
    case "Won": return trade.status === "closed" && (trade.pnl_pct ?? 0) >= 0;
    case "Lost": return trade.status === "closed" && (trade.pnl_pct ?? 0) < 0;
    case "Open": return trade.status === "open" || trade.status === "pending_approval";
  }
}

function borderColor(trade: Trade): string {
  if (trade.status === "open" || trade.status === "pending_approval") return "border-l-amber-500";
  if (trade.status === "closed") return (trade.pnl_pct ?? 0) >= 0 ? "border-l-green-500" : "border-l-red-500";
  return "border-l-zinc-700";
}

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
  );
}

function JourneyTimeline({ trade }: { trade: Trade }) {
  const mgmt = trade.position_params?.management;
  const events: { time: string; icon: string; text: string }[] = [];
  if (trade.timestamp) {
    events.push({
      time: format(new Date(trade.timestamp), "HH:mm"),
      icon: "●",
      text: `Entry at ${trade.entry_price ?? "—"}`,
    });
  }
  for (const t of mgmt?.trail_history ?? []) {
    if (t.reason === "initial") continue;
    events.push({
      time: t.at ? format(new Date(t.at), "HH:mm") : "—",
      icon: t.reason === "breakeven_at_tp1" ? "◐" : "↑",
      text: t.reason === "breakeven_at_tp1"
        ? `TP1 hit — partial closed, SL → breakeven ${t.sl.toLocaleString()}`
        : `Trail → ${t.sl.toLocaleString()}`,
    });
  }
  if (trade.exit_price != null) {
    events.push({
      time: "—",
      icon: "●",
      text: `${mgmt?.trigger ?? trade.exit_trigger ?? "exit"} at ${trade.exit_price} (${formatPct(trade.pnl_pct)})`,
    });
  }
  if (events.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        Position Journey
      </div>
      <div className="space-y-0">
        {events.map((e, i) => (
          <div key={i} className="flex gap-3 text-xs">
            <span className="w-10 shrink-0 pt-0.5 text-right font-mono text-zinc-500">{e.time}</span>
            <div className="flex flex-col items-center">
              <span className={cn("font-mono", e.icon === "↑" ? "text-amber-400" : "text-blue-400")}>{e.icon}</span>
              {i < events.length - 1 && <span className="h-4 w-px bg-zinc-800" />}
            </div>
            <span className="pt-0.5 text-zinc-300">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({ trade }: { trade: Trade }) {
  const [tab, setTab] = useState<Tab>("Entry Thesis");
  const [chartUrl, setChartUrl] = useState<string | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const mgmt = trade.position_params?.management;

  const openChartTab = async () => {
    setTab("📸 What AI Saw");
    if (chartUrl || loadingChart) return;
    setLoadingChart(true);
    try {
      const response = await fetch(`${API_BASE}/api/decisions/${trade.id}/chart`);
      if (response.ok) {
        const blob = await response.blob();
        setChartUrl(URL.createObjectURL(blob));
      }
    } finally {
      setLoadingChart(false);
    }
  };

  return (
    <div className="panel p-4 max-h-[75vh] overflow-y-auto overflow-x-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-sm font-black">
          TRADE — {trade.instrument} {(trade.direction ?? "").toUpperCase()}
          {trade.setup_score != null && (
            <span className={cn(
              "ml-2 rounded px-1.5 py-0.5 text-[10px]",
              trade.setup_score >= 8 ? "bg-green-500/15 text-green-400"
                : trade.setup_score >= 6 ? "bg-amber-500/15 text-amber-400"
                : "bg-red-500/15 text-red-400"
            )}>
              {trade.setup_grade} {trade.setup_score}/10
            </span>
          )}
          {trade.vision_used && <span className="ml-2 text-indigo-400" title="Vision AI used">👁</span>}
        </h2>
        <span className={cn("font-mono text-lg font-black", pnlColor(trade.pnl_pct))}>
          {formatPct(trade.pnl_pct)}
        </span>
      </div>
      <div className="mt-1 border-b border-zinc-800 pb-3 font-mono text-xs text-zinc-500">
        {trade.created_at ? format(new Date(trade.created_at), "dd MMM yyyy, HH:mm") : "—"}
        {trade.duration_mins != null && ` · ${formatDuration(trade.duration_mins)}`}
        {trade.entry_price != null && ` · Entry ${trade.entry_price}`}
        {trade.exit_price != null && ` → Exit ${trade.exit_price}`}
        {mgmt?.rr_achieved_on_exit != null && (
          <span className="ml-1 text-green-500">· Final R:R 1:{mgmt.rr_achieved_on_exit.toFixed(1)}</span>
        )}
        <span className="ml-1 uppercase text-zinc-600">· {trade.status}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => (t === "📸 What AI Saw" ? openChartTab() : setTab(t))}
            className={cn(
              "rounded-md px-2 py-1 font-mono text-[11px] font-bold",
              tab === t ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3 text-sm">
        {tab === "Entry Thesis" && (
          <div>
            <div className="flex flex-wrap gap-1.5 pb-2">
              {(trade.key_signals ?? []).map((s) => (
                <span key={s} className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-300">{s}</span>
              ))}
            </div>
            <p className="text-zinc-300">{trade.reasoning ?? "—"}</p>
            <JourneyTimeline trade={trade} />
          </div>
        )}

        {tab === "Boardroom" && (
          <div className="space-y-4 text-xs">
            {trade.boardroom_votes?.votes?.length ? (
              <>
                <div>
                  <div className="mb-2 font-mono font-bold text-zinc-500 tracking-wider">ROUND 1 — INDEPENDENT VOTES</div>
                  <div className="rounded-lg bg-zinc-900/30 border border-zinc-800/50 p-1.5 divide-y divide-zinc-800/30">
                    {trade.boardroom_votes!.votes.map((v) => (
                      <BoardroomMemberRow key={v.member} v={v} />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 font-mono font-bold text-zinc-500 tracking-wider">ROUND 2 — DELIBERATION</div>
                  <div className="rounded-lg bg-zinc-900/30 border border-zinc-800/50 p-1.5 divide-y divide-zinc-800/30">
                    {trade.boardroom_votes!.deliberations.map((d) => (
                      <BoardroomDeliberationRow key={d.member} d={d} votes={trade.boardroom_votes!.votes} />
                    ))}
                  </div>
                </div>
                <div className="rounded bg-zinc-950 p-2 font-mono">
                  Tally: {Object.entries(trade.boardroom_votes!.vote_tally ?? {}).map(([v, n]) => `${n}× ${v}`).join(" | ")}
                  {trade.decision_json?.consensus_level && (
                    <span className="ml-2 font-bold uppercase text-blue-400">{trade.decision_json.consensus_level}</span>
                  )}
                </div>
                {trade.decision_json?.chair_reasoning && (
                  <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-2 text-indigo-200">
                    <b>Chair:</b> {trade.decision_json.chair_reasoning.slice(0, 400)}
                  </div>
                )}
              </>
            ) : <p className="text-zinc-500">No boardroom record for this decision.</p>}
          </div>
        )}

        {tab === "SMC" && (
          <div className="space-y-2 text-xs">
            {trade.smc_summary ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(trade.smc_summary.structures ?? {}).map(([tf, s]) => (
                    <span key={tf} className={cn(
                      "rounded-full px-2 py-0.5 font-mono font-bold uppercase",
                      s.trend === "BULLISH" ? "bg-green-500/15 text-green-400"
                        : s.trend === "BEARISH" ? "bg-red-500/15 text-red-400"
                        : "bg-zinc-700/40 text-zinc-400"
                    )}>{tf}: {s.trend}</span>
                  ))}
                  {trade.smc_summary.premium_discount && (
                    <span className="rounded-full bg-purple-500/15 px-2 py-0.5 font-mono font-bold text-purple-300">
                      {trade.smc_summary.premium_discount}
                    </span>
                  )}
                </div>
                {(trade.smc_summary.confluences_found ?? []).map((c) => (
                  <div key={c} className="text-green-400">✓ <span className="text-zinc-300">{c}</span></div>
                ))}
                {(trade.smc_summary.missing ?? []).map((m) => (
                  <div key={m} className="text-zinc-600">✗ <span className="text-zinc-500">{m}</span></div>
                ))}
                {trade.position_params?.calculation_detail && (
                  <div className="rounded bg-zinc-950 p-2 font-mono text-zinc-400">
                    {trade.position_params.calculation_detail}
                  </div>
                )}
              </>
            ) : <p className="text-zinc-500">No SMC analysis stored.</p>}
          </div>
        )}

        {tab === "📸 What AI Saw" && (
          <div className="space-y-2">
            {loadingChart && <Skeleton className="h-[360px] w-full" />}
            {!loadingChart && chartUrl && (
              <>
                <p className="font-mono text-xs text-zinc-400">
                  15M chart with AI annotations at the moment of decision
                  {trade.vision_used && (
                    <span className="ml-2 text-indigo-400">👁 Vision AI used for Chair decision</span>
                  )}
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={chartUrl} alt="Chart at decision time" className="w-full rounded-lg border border-zinc-800" />
                <p className="font-mono text-[10px] text-zinc-500">
                  Green/red dashes: Order Blocks · Dotted: FVGs · Blue/purple: Liquidity · White/red/green: Position levels
                </p>
              </>
            )}
            {!loadingChart && !chartUrl && (
              <p className="text-xs text-zinc-500">No chart stored for this decision (pre-vision upgrade or generation failed).</p>
            )}
          </div>
        )}

        {tab === "Reflection" && (
          trade.reflection ? (
            <div className="space-y-2 text-xs">
              <div>Thesis correct: {trade.reflection.thesis_correct ? "✅" : "❌"}</div>
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">Execution quality</span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full bg-blue-500" style={{ width: `${(trade.reflection.execution_quality ?? 0) * 10}%` }} />
                </div>
                <span className="font-mono">{trade.reflection.execution_quality}/10</span>
              </div>
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                {trade.reflection.lesson}
              </div>
              <div className="text-zinc-400">Watch for: {trade.reflection.watch_for}</div>
            </div>
          ) : <p className="text-xs text-zinc-500">Reflection runs when the position closes.</p>
        )}

        {tab === "Counterfactuals" && (
          trade.counterfactuals?.scenarios ? (
            <div className="text-xs">
              <table className="w-full text-left">
                <thead className="font-mono text-zinc-500">
                  <tr><th className="py-1">Scenario</th><th>Result</th><th>Better?</th></tr>
                </thead>
                <tbody>
                  {trade.counterfactuals.scenarios.map((s) => (
                    <tr key={s.name} className="border-t border-zinc-800">
                      <td className="py-1.5">{s.name.replace(/_/g, " ")}</td>
                      <td className={cn("font-mono", pnlColor(s.simulated_pnl_pct))}>{formatPct(s.simulated_pnl_pct)}</td>
                      <td>{s.outcome_better ? "✅" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {trade.counterfactuals.key_insight && (
                <div className="mt-2 rounded border border-purple-500/30 bg-purple-500/10 p-2 text-purple-200">
                  {trade.counterfactuals.key_insight}
                </div>
              )}
            </div>
          ) : <p className="text-xs text-zinc-500">Analysis pending (nightly Loop 3)…</p>
        )}
      </div>
    </div>
  );
}

export default function JournalPage() {
  const { data: trades } = useSWR<Trade[] | null>(
    "trades", () => api.trades(150), { refreshInterval: 30_000 }
  );
  const [filter, setFilter] = useState<Filter>("All");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (trades ?? []).filter((t) => matches(t, filter)),
    [trades, filter]
  );
  const selected = filtered.find((t) => t.id === selectedId) ?? filtered[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-mono text-sm font-black tracking-widest">
          TRADE JOURNAL <span className="font-normal text-zinc-500">{trades?.length ?? "…"} entries</span>
        </h1>
        <div className="flex gap-1">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 font-mono text-[11px] font-bold",
                filter === f ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {trades === undefined ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-80" />
          <Skeleton className="h-80 lg:col-span-2" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel p-6 text-sm text-zinc-500">No trades match this filter yet.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[35%_1fr]">
          <div className="panel max-h-[75vh] overflow-y-auto">
            {filtered.map((t, i) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b border-l-2 border-zinc-800/60 px-3 py-2 text-left hover:bg-zinc-800/40",
                  borderColor(t),
                  selected?.id === t.id && "bg-zinc-800/60"
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs font-bold text-zinc-200">
                    #{filtered.length - i} · {t.instrument} {(t.direction ?? "").toUpperCase()}
                  </div>
                  <div className="font-mono text-[10px] text-zinc-500">
                    {t.created_at ? format(new Date(t.created_at), "dd MMM HH:mm") : "—"} · {t.status}
                  </div>
                </div>
                <span className={cn("shrink-0 font-mono text-xs font-bold", pnlColor(t.pnl_pct))}>
                  {formatPct(t.pnl_pct)}
                </span>
              </button>
            ))}
          </div>
          {selected && <DetailPanel key={selected.id} trade={selected} />}
        </div>
      )}
    </div>
  );
}
