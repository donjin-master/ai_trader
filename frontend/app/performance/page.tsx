"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { format } from "date-fns";
import useSWR from "swr";
import MetricCard from "@/components/MetricCard";
import Skeleton from "@/components/Skeleton";
import { api, type Trade } from "@/lib/api";
import { cn, formatPct, pnlColor } from "@/lib/utils";

const Charts = {
  EquityCurve: dynamic(
    () => import("@/components/PerformanceCharts").then((m) => m.EquityCurve),
    { ssr: false }
  ),
  WinLossByDay: dynamic(
    () => import("@/components/PerformanceCharts").then((m) => m.WinLossByDay),
    { ssr: false }
  ),
  ConfidenceScatter: dynamic(
    () => import("@/components/PerformanceCharts").then((m) => m.ConfidenceScatter),
    { ssr: false }
  ),
  RegretTrend: dynamic(
    () => import("@/components/PerformanceCharts").then((m) => m.RegretTrend),
    { ssr: false }
  ),
  CalibrationChart: dynamic(
    () => import("@/components/PerformanceCharts").then((m) => m.CalibrationChart),
    { ssr: false }
  ),
};

const ranges = ["7D", "30D", "All Time"] as const;
type Range = (typeof ranges)[number];

export default function PerformancePage() {
  const { data: trades } = useSWR<Trade[] | null>(
    "trades", () => api.trades(500), { refreshInterval: 30_000 }
  );
  const { data: calibrationData } = useSWR(
    "calibration", () => api.calibration(), { refreshInterval: 60_000 }
  );
  const { data: patternStats } = useSWR<any[] | null>(
    "pattern-stats", () => api.patternStats(), { refreshInterval: 60_000 }
  );
  const [range, setRange] = useState<Range>("All Time");

  const closed = useMemo(() => {
    const cutoff =
      range === "7D"
        ? Date.now() - 7 * 86400_000
        : range === "30D"
          ? Date.now() - 30 * 86400_000
          : 0;
    return (trades ?? [])
      .filter((t) => t.status === "closed" && t.pnl_pct !== null)
      .filter((t) => !cutoff || (t.created_at && new Date(t.created_at).getTime() > cutoff))
      .sort(
        (a, b) =>
          new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
      );
  }, [trades, range]);

  const totalPnl = closed.reduce((sum, t) => sum + (t.pnl_pct ?? 0), 0);
  const wins = closed.filter((t) => (t.pnl_pct ?? 0) >= 0).length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;

  const sharpe = useMemo(() => {
    if (closed.length < 2) return null;
    const returns = closed.map((t) => t.pnl_pct ?? 0);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    return std ? +(mean / std).toFixed(2) : null;
  }, [closed]);

  const equity = useMemo(() => {
    let cum = 0;
    return closed.map((t) => {
      cum += t.pnl_pct ?? 0;
      return {
        date: t.created_at ? format(new Date(t.created_at), "dd MMM") : "—",
        cumulative: +cum.toFixed(2),
      };
    });
  }, [closed]);

  const byDay = useMemo(() => {
    const days: Record<string, { wins: number; losses: number }> = {};
    for (const t of closed) {
      const day = t.created_at ? format(new Date(t.created_at), "dd MMM") : "—";
      days[day] ??= { wins: 0, losses: 0 };
      if ((t.pnl_pct ?? 0) >= 0) days[day].wins += 1;
      else days[day].losses += 1;
    }
    return Object.entries(days).map(([date, v]) => ({ date, ...v }));
  }, [closed]);

  const scatter = closed
    .filter((t) => t.confidence !== null)
    .map((t) => ({ confidence: t.confidence!, pnl_pct: t.pnl_pct! }));

  const { avgRegret, regretTrend } = useMemo(() => {
    const points: { date: string; regret: number }[] = [];
    for (const t of closed) {
      const scenarios = t.counterfactuals?.scenarios;
      if (!scenarios?.length) continue;
      const best = Math.max(...scenarios.map((s) => s.simulated_pnl_pct), t.pnl_pct ?? 0);
      const regret = +(best - (t.pnl_pct ?? 0)).toFixed(2);
      points.push({
        date: t.created_at ? format(new Date(t.created_at), "dd MMM") : "—",
        regret,
      });
    }
    const avg = points.length
      ? +(points.reduce((a, p) => a + p.regret, 0) / points.length).toFixed(2)
      : null;
    return { avgRegret: avg, regretTrend: points };
  }, [closed]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Performance</h1>
        <div className="flex gap-2">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-semibold",
                range === r
                  ? "bg-zinc-100 text-zinc-900"
                  : "border border-zinc-800 text-zinc-400 hover:bg-zinc-900"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {trades === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total P&L"
              value={formatPct(totalPnl)}
              valueClass={pnlColor(totalPnl)}
              sub="cumulative % across closed trades"
            />
            <MetricCard label="Win Rate" value={`${winRate.toFixed(0)}%`} />
            <MetricCard label="Sharpe Ratio" value={sharpe === null ? "—" : `${sharpe}`} />
            <MetricCard label="Total Trades" value={`${closed.length}`} />
          </div>

          <div className="card">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-400">
              Equity Curve
            </h2>
            {equity.length ? (
              <Charts.EquityCurve data={equity} />
            ) : (
              <p className="text-sm text-zinc-500">No closed trades in this range yet.</p>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-400">
                Win / Loss by Day
              </h2>
              {byDay.length ? (
                <Charts.WinLossByDay data={byDay} />
              ) : (
                <p className="text-sm text-zinc-500">No data yet.</p>
              )}
            </div>
            <div className="card">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-400">
                Confidence vs Outcome
              </h2>
              {scatter.length ? (
                <Charts.ConfidenceScatter data={scatter} />
              ) : (
                <p className="text-sm text-zinc-500">No data yet.</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <h2
                className="mb-1 text-sm font-bold uppercase tracking-wide text-zinc-400"
                title="Average % left on the table vs the best counterfactual scenario"
              >
                Regret Score
              </h2>
              <p className="mb-3 text-xs text-zinc-500">
                Avg % left on the table vs the optimal counterfactual scenario
              </p>
              <div className={cn("text-3xl font-black mb-2", avgRegret === null ? "text-zinc-600" : "text-amber-400")}>
                {avgRegret === null ? "—" : `${avgRegret}%`}
              </div>
              {regretTrend.length > 1 && <Charts.RegretTrend data={regretTrend} />}
            </div>

            <div className="card">
              <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-zinc-400">
                Confidence Calibration
              </h2>
              <p className="mb-3 text-xs text-zinc-500">
                Win rate achieved for each boardroom confidence bucket
              </p>
              {calibrationData?.rows?.length ? (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Status:</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold font-mono border",
                        calibrationData.calibrated === true
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : calibrationData.calibrated === false
                          ? "bg-red-500/10 text-red-400 border-red-500/20"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                      )}
                    >
                      {calibrationData.calibrated === true
                        ? "CALIBRATED (≥ 55% WR on High Conviction)"
                        : calibrationData.calibrated === false
                        ? "UNDER-CALIBRATED (< 55% WR)"
                        : `CALIBRATING (Awaiting trades)`}
                    </span>
                  </div>
                  <Charts.CalibrationChart data={calibrationData.rows} />
                </>
              ) : (
                <p className="text-sm text-zinc-500">No calibration data available yet.</p>
              )}
            </div>
          </div>

          <div className="card">
            <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-zinc-400">
              SMC Pattern Performance
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              Actual performance metrics grouped by SMC pattern type, instrument, and session (minimum 10 trades per pattern)
            </p>
            {patternStats === undefined ? (
              <Skeleton className="h-20" />
            ) : !patternStats || patternStats.length === 0 ? (
              <p className="text-xs text-zinc-500 py-2">
                Awaiting pattern statistics (minimum 10 trades per pattern required).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="border-b border-zinc-800 text-[10px] uppercase text-zinc-500">
                    <tr>
                      <th className="py-2 px-3">Pattern Type</th>
                      <th className="py-2 px-3">Instrument</th>
                      <th className="py-2 px-3">Session</th>
                      <th className="py-2 px-3 text-center">Sample Size</th>
                      <th className="py-2 px-3 text-center">Win Rate</th>
                      <th className="py-2 px-3 text-center">Avg R:R</th>
                      <th className="py-2 px-3 text-center">Expectancy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patternStats.map((s, idx) => (
                      <tr key={idx} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="py-2 px-3 text-zinc-200 font-bold">{s.pattern_type}</td>
                        <td className="py-2 px-3 text-zinc-400">{s.instrument}</td>
                        <td className="py-2 px-3 text-zinc-400">{s.session.toUpperCase()}</td>
                        <td className="py-2 px-3 text-center text-zinc-300">{s.sample_size}</td>
                        <td className={cn("py-2 px-3 text-center font-bold", s.win_rate_pct >= 50 ? "text-emerald-400" : "text-red-400")}>
                          {s.win_rate_pct}%
                        </td>
                        <td className="py-2 px-3 text-center text-zinc-300">{s.avg_rr}R</td>
                        <td className={cn("py-2 px-3 text-center font-bold", s.expectancy >= 0 ? "text-emerald-400" : "text-red-400")}>
                          {s.expectancy >= 0 ? "+" : ""}{s.expectancy}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
