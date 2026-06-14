"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import Skeleton from "@/components/Skeleton";
import { api, type RiskProfile } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";

const MODES = [
  { id: "ADVISORY", label: "ADVISORY", desc: "Monitor only — all trades need your approval" },
  { id: "SEMI_AUTO", label: "SEMI_AUTO", desc: "Auto-execute within budget, alert for the rest" },
  { id: "AUTONOMOUS", label: "AUTONOMOUS", desc: "Fully automatic within your rules" },
  { id: "SCHEDULED", label: "SCHEDULED", desc: "Only trade during your set windows" },
] as const;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-400">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-zinc-300">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function NumInput({
  value, onChange, step = 1, min, max, suffix,
}: {
  value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; suffix?: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-24 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-sm"
      />
      {suffix && <span className="text-xs text-zinc-500">{suffix}</span>}
    </span>
  );
}

function SliderInput({
  value, onChange, min, max, step, suffix,
}: {
  value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; suffix?: string;
}) {
  return (
    <span className="flex w-44 items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-blue-500"
      />
      <span className="w-12 text-right text-xs font-mono text-zinc-200">
        {value}{suffix}
      </span>
    </span>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        "h-6 w-11 rounded-full transition-colors",
        value ? "bg-blue-600" : "bg-zinc-700"
      )}
    >
      <span
        className={cn(
          "block h-5 w-5 rounded-full bg-white transition-transform",
          value ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export default function SettingsPage() {
  const { data: serverProfile, mutate } = useSWR<RiskProfile | null>(
    "risk-profile", () => api.riskProfile()
  );
  const [profile, setProfile] = useState<RiskProfile | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (serverProfile && !profile) setProfile(serverProfile);
  }, [serverProfile, profile]);

  const save = useCallback(
    (updates: Partial<RiskProfile>) => {
      setProfile((p) => (p ? { ...p, ...updates } : p));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const result = await api.updateRiskProfile(updates);
        if (result) {
          setToast("Saved");
          mutate(result, { revalidate: false });
        } else {
          setToast("Save failed");
        }
        setTimeout(() => setToast(null), 2000);
      }, 500);
    },
    [mutate]
  );

  const changeMode = async (mode: string) => {
    setConfirmMode(null);
    const result = await api.setMode(mode);
    if (result) {
      setProfile((p) => (p ? { ...p, mode: mode as RiskProfile["mode"] } : p));
      setToast(`Mode: ${mode}`);
      setTimeout(() => setToast(null), 2000);
    }
  };

  const reset = async () => {
    const result = await api.resetRiskProfile();
    if (result) {
      setProfile(result);
      mutate(result, { revalidate: false });
      setToast("Reset to defaults");
      setTimeout(() => setToast(null), 2000);
    }
  };

  if (!profile) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Risk Control Panel</h1>
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const dailyBudgetInr = (profile.total_capital * profile.daily_budget_pct) / 100;
  const weeklyBudgetInr = (profile.total_capital * profile.weekly_budget_pct) / 100;
  const exampleSize = Math.min(
    profile.risk_per_trade_pct / 0.5,
    profile.max_position_size_pct
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Risk Control Panel</h1>
        {toast && (
          <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold text-green-400">
            {toast}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT COLUMN */}
        <div className="space-y-4">
          <Card title="Execution Mode">
            <div className="grid gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => m.id !== profile.mode && setConfirmMode(m.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    profile.mode === m.id
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-zinc-800 hover:bg-zinc-800/50"
                  )}
                >
                  <div className={cn(
                    "font-bold",
                    profile.mode === m.id ? "text-blue-400" : "text-zinc-200"
                  )}>
                    {m.label}
                  </div>
                  <div className="text-xs text-zinc-500">{m.desc}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card title="Trading Sessions (IST)">
            <Row label="Start time">
              <input
                type="time"
                value={profile.trade_start_time.slice(0, 5)}
                onChange={(e) => save({ trade_start_time: e.target.value })}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </Row>
            <Row label="End time">
              <input
                type="time"
                value={profile.trade_end_time.slice(0, 5)}
                onChange={(e) => save({ trade_end_time: e.target.value })}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
              />
            </Row>
            <Row label="Avoid weekends">
              <Toggle
                value={profile.avoid_weekends}
                onChange={(v) => save({ avoid_weekends: v })}
              />
            </Row>
            <div className="text-sm">
              <div className="mb-1 text-zinc-300">Blackout windows</div>
              <div className="space-y-1">
                {profile.blackout_windows.map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="rounded-md bg-zinc-800 px-2 py-1 font-mono text-xs">{w}</span>
                    <button
                      onClick={() =>
                        save({
                          blackout_windows: profile.blackout_windows.filter((_, j) => j !== i),
                        })
                      }
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      remove
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const w = prompt("Window (HH:MM-HH:MM IST):", "12:00-12:30");
                    if (w && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(w)) {
                      save({ blackout_windows: [...profile.blackout_windows, w] });
                    }
                  }}
                  className="text-xs font-semibold text-blue-400 hover:text-blue-300"
                >
                  + add window
                </button>
              </div>
            </div>
          </Card>

          <Card title="Today's Allowance Preview">
            <div className="space-y-1 text-sm text-zinc-300">
              <div>• Up to <b>{profile.max_trades_per_day}</b> trades/day, <b>{profile.max_concurrent_trades}</b> concurrent</div>
              <div>• Risk up to <b>{formatCurrency(dailyBudgetInr)}</b> today ({profile.daily_budget_pct}% of capital)</div>
              <div>• Weekly budget: <b>{formatCurrency(weeklyBudgetInr)}</b></div>
              <div>• Setup threshold: <b>{profile.min_setup_score}/10</b></div>
              <div>• Example: at {profile.risk_per_trade_pct}% risk with SL 0.5% away = {exampleSize.toFixed(1)}% position</div>
            </div>
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-4">
          <Card title="Capital & Budget">
            <Row label="Total Capital">
              <NumInput value={profile.total_capital} step={1000} min={100}
                onChange={(v) => save({ total_capital: v })} suffix="₹" />
            </Row>
            <Row label={`Daily Budget (${formatCurrency(dailyBudgetInr)})`}>
              <SliderInput value={profile.daily_budget_pct} min={1} max={50} step={0.5}
                suffix="%" onChange={(v) => save({ daily_budget_pct: v })} />
            </Row>
            <Row label={`Weekly Budget (${formatCurrency(weeklyBudgetInr)})`}>
              <SliderInput value={profile.weekly_budget_pct} min={2} max={60} step={1}
                suffix="%" onChange={(v) => save({ weekly_budget_pct: v })} />
            </Row>
            <Row label="Daily Loss Limit">
              <SliderInput value={profile.daily_loss_limit_pct} min={0.5} max={10} step={0.5}
                suffix="%" onChange={(v) => save({ daily_loss_limit_pct: v })} />
            </Row>
            <Row label="Consecutive Loss Limit">
              <NumInput value={profile.consecutive_loss_limit} min={1} max={20}
                onChange={(v) => save({ consecutive_loss_limit: v })} suffix="trades" />
            </Row>
          </Card>

          <Card title="Position Sizing">
            <Row label="Risk per Trade">
              <SliderInput value={profile.risk_per_trade_pct} min={0.1} max={3} step={0.1}
                suffix="%" onChange={(v) => save({ risk_per_trade_pct: v })} />
            </Row>
            <Row label="Sizing Mode">
              <div className="flex gap-1">
                {(["FIXED", "DYNAMIC", "KELLY"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => save({ sizing_mode: m })}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold",
                      profile.sizing_mode === m
                        ? "bg-blue-600 text-white"
                        : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Max Position Size">
              <SliderInput value={profile.max_position_size_pct} min={0.5} max={5} step={0.5}
                suffix="%" onChange={(v) => save({ max_position_size_pct: v })} />
            </Row>
          </Card>

          <Card title="Trade Frequency">
            <Row label="Max Trades / Day">
              <NumInput value={profile.max_trades_per_day} min={1} max={50}
                onChange={(v) => save({ max_trades_per_day: v })} />
            </Row>
            <Row label="Max Trades / Week">
              <NumInput value={profile.max_trades_per_week} min={1} max={200}
                onChange={(v) => save({ max_trades_per_week: v })} />
            </Row>
            <Row label="Max Concurrent">
              <NumInput value={profile.max_concurrent_trades} min={1} max={10}
                onChange={(v) => save({ max_concurrent_trades: v })} />
            </Row>
            <Row label={`Min Setup Score (${profile.min_setup_score <= 6 ? "Relaxed" : profile.min_setup_score <= 7.5 ? "Balanced" : "Strict"})`}>
              <SliderInput value={profile.min_setup_score} min={5} max={10} step={0.5}
                onChange={(v) => save({ min_setup_score: v })} />
            </Row>
          </Card>

          <Card title="Boardroom Rules">
            <Row label="Min Votes Required">
              <div className="flex gap-1">
                {[2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => save({ min_boardroom_votes: n })}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold",
                      profile.min_boardroom_votes === n
                        ? "bg-blue-600 text-white"
                        : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    )}
                  >
                    {n === 3 ? "3 of 3 (unanimous)" : "2 of 3"}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Min Avg Conviction">
              <SliderInput value={profile.min_avg_conviction} min={5} max={9} step={0.5}
                onChange={(v) => save({ min_avg_conviction: v })} />
            </Row>
            <Row label="Allow Chair Override">
              <Toggle
                value={profile.allow_chair_override}
                onChange={(v) => save({ allow_chair_override: v })}
              />
            </Row>
            <Row label="Vision AI (Chart Reading)">
              <div className="flex gap-1">
                {([["OFF", "Off"], ["CHAIR_ONLY", "Chair Only ★"], ["ALL_MEMBERS", "All Members"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => save({ vision_mode: value })}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold",
                      profile.vision_mode === value
                        ? "bg-indigo-600 text-white"
                        : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Row>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              {profile.vision_mode === "OFF" && "Cheapest. Board uses text analysis only — charts still stored as visual memory."}
              {profile.vision_mode === "CHAIR_ONLY" && "Chair sees annotated 15M+1H charts before the final decision. ~₹900/mo extra."}
              {profile.vision_mode === "ALL_MEMBERS" && "Every board member sees charts. ~₹3,500/mo extra (needs GPT/Gemini keys for full effect)."}
            </p>
          </Card>

          <Card title="Position Management">
            <Row label="Trail Method">
              <div className="flex gap-1">
                {(["STRUCTURE", "ATR"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => save({ trail_method: m })}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold",
                      profile.trail_method === m
                        ? "bg-blue-600 text-white"
                        : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    )}
                  >
                    {m === "STRUCTURE" ? "Structure-based" : "ATR-based"}
                  </button>
                ))}
              </div>
            </Row>
            {profile.trail_method === "ATR" && (
              <Row label="ATR Multiplier">
                <SliderInput value={profile.atr_trail_multiplier} min={1} max={3} step={0.25}
                  onChange={(v) => save({ atr_trail_multiplier: v })} />
              </Row>
            )}
            <Row label="Partial Exit at TP1">
              <SliderInput value={profile.tp1_exit_pct} min={20} max={60} step={5}
                suffix="%" onChange={(v) => save({ tp1_exit_pct: v })} />
            </Row>
            <Row label="TP1 Trigger (R multiple)">
              <SliderInput value={profile.tp1_rr_trigger} min={0.5} max={3} step={0.25}
                onChange={(v) => save({ tp1_rr_trigger: v })} />
            </Row>
            <Row label="Breakeven Trigger (R)">
              <SliderInput value={profile.breakeven_at_rr} min={0} max={3} step={0.5}
                onChange={(v) => save({ breakeven_at_rr: v })} />
            </Row>
            <Row label="AI Trade Assessment">
              <Toggle
                value={profile.allow_position_assessment}
                onChange={(v) => save({ allow_position_assessment: v })}
              />
            </Row>
          </Card>

          <Card title="Quality Filters">
            <Row label="Minimum R:R to Enter">
              <div className="flex gap-1">
                {[2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => save({ min_rr_ratio: n })}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold",
                      profile.min_rr_ratio === n
                        ? "bg-blue-600 text-white"
                        : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    )}
                  >
                    1:{n}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Maximum R:R Cap">
              <div className="flex gap-1">
                {[null, 5, 10, 20].map((n) => (
                  <button
                    key={String(n)}
                    onClick={() => save({ max_rr_cap: n })}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold",
                      profile.max_rr_cap === n
                        ? "bg-blue-600 text-white"
                        : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    )}
                  >
                    {n === null ? "None ★" : `1:${n}`}
                  </button>
                ))}
              </div>
            </Row>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Your AI sets a minimum entry threshold. Once in a trade, the trail
              follows market structure with <b className="text-zinc-300">no ceiling</b>.
              A 1:3 entry becoming 1:15 is the goal, not the exception. Only set a
              cap if you have a specific reason to take full profit at a target.
            </p>
            <Row label="Min Confluences">
              <SliderInput value={profile.require_confluence} min={1} max={7} step={1}
                onChange={(v) => save({ require_confluence: v })} />
            </Row>
            <Row label="Approval Timeout">
              <NumInput value={profile.approval_timeout_mins} min={1} max={120}
                onChange={(v) => save({ approval_timeout_mins: v })} suffix="min" />
            </Row>
          </Card>

          <Card title="Order State Machine">
            <Row label="Stale Order Cancel (candles)">
              <NumInput value={profile.stale_order_candles} min={1} max={20}
                onChange={(v) => save({ stale_order_candles: v })} suffix="candles" />
            </Row>
            <Row label="Preferred Entry Mode">
              <div className="flex gap-1">
                {([["limit_preferred", "Limit"], ["market_allowed", "Market OK"], ["limit_only", "Limit Only"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => save({ preferred_entry_mode: value })}
                    className={cn(
                      "rounded-md px-2 py-1 text-xs font-bold",
                      profile.preferred_entry_mode === value
                        ? "bg-blue-600 text-white"
                        : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Row>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              The boardroom only runs when an instrument is in WATCHING state — no
              re-runs while an order is pending or a position is open. Stale limit
              orders auto-cancel after this many candles.
            </p>
          </Card>

          <Card title="F&O Options">
            <Row label="Options Enabled">
              <Toggle
                value={profile.options_enabled}
                onChange={(v) => save({ options_enabled: v })}
              />
            </Row>
            <Row label="Max Options Loss">
              <SliderInput value={profile.max_options_loss_pct} min={0.1} max={3} step={0.1}
                suffix="%" onChange={(v) => save({ max_options_loss_pct: v })} />
            </Row>
            <Row label="Preferred DTE Min">
              <NumInput value={profile.preferred_dte_min} min={0} max={60}
                onChange={(v) => save({ preferred_dte_min: v })} suffix="days" />
            </Row>
            <Row label="Preferred DTE Max">
              <NumInput value={profile.preferred_dte_max} min={1} max={90}
                onChange={(v) => save({ preferred_dte_max: v })} suffix="days" />
            </Row>
            <p className="text-[11px] leading-relaxed text-zinc-500">
              When enabled, the Chair sees the IV regime and can prefer options. The
              strategy selector picks structure (long call, spreads, condor) from
              direction + IV. Options execution UI ships in V1.3 — suggestions are
              logged + sent to Telegram for now.
            </p>
          </Card>

          <button
            onClick={reset}
            className="text-xs text-zinc-500 underline hover:text-zinc-300"
          >
            Reset to defaults
          </button>
        </div>
      </div>

      {confirmMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-sm w-full">
            <h3 className="text-lg font-bold">Switch to {confirmMode} mode?</h3>
            <p className="mt-2 text-sm text-zinc-400">
              {MODES.find((m) => m.id === confirmMode)?.desc}
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => changeMode(confirmMode)}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmMode(null)}
                className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 font-semibold text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
