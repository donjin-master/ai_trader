"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";

type SizeMode = "risk_percent" | "usd_notional" | "base_lots" | "contracts";

interface ManualTradeForm {
  instrument: string;
  direction: "long" | "short";
  entryType: "market" | "limit";
  entryPrice: string;
  stopLoss: string;
  tp1: string;
  tp2: string;
  tp3: string;
  sizeMode: SizeMode;
  sizeValue: string;
  leverage: string;
}

interface AccountSummary {
  asset: string | null;
  available_margin: number;
  available_balance: number;
  total_balance: number;
  open_positions_count: number;
}

interface InstrumentDetails {
  instrument: string;
  product_id: number | null;
  contract_value: number;
  contract_unit_label: string;
  settling_asset: string | null;
  quoting_asset: string | null;
  tick_size: number;
  current_leverage: number | null;
  order_margin: number | null;
}

function formatMoney(value: number | null | undefined, asset?: string | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const prefix = asset === "INR" ? "Rs " : "$";
  return `${prefix}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

const SIZE_MODE_LABELS: Record<SizeMode, string> = {
  usd_notional: "USD Notional",
  base_lots: "Base Lots",
  contracts: "Contracts",
  risk_percent: "Risk %",
};

const LEVERAGE_PRESETS = [5, 10, 20, 50, 100];

export function ManualTradePanel({
  currentPrice,
  onClose,
}: {
  currentPrice: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ManualTradeForm>({
    instrument: "BTCUSD_PERP",
    direction: "long",
    entryType: "market",
    entryPrice: currentPrice > 0 ? currentPrice.toFixed(1) : "",
    stopLoss: "",
    tp1: "",
    tp2: "",
    tp3: "",
    sizeMode: "usd_notional",
    sizeValue: "100",
    leverage: "50",
  });
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rrRatio, setRrRatio] = useState<number | null>(null);
  const [riskPct, setRiskPct] = useState<number | null>(null);
  const [leverageTouched, setLeverageTouched] = useState(false);

  const { data: account, isLoading: accountLoading, error: accountError } = useQuery<AccountSummary>({
    queryKey: ["account-summary"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/account/summary`, {
        cache: "no-store",
        headers: { "x-api-secret": process.env.NEXT_PUBLIC_FRONTEND_API_SECRET || "" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.error || "Account summary unavailable");
      }
      return data as AccountSummary;
    },
    refetchInterval: 15000,
  });

  const { data: instrumentDetails } = useQuery<InstrumentDetails>({
    queryKey: ["instrument-details", form.instrument],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/instruments/${form.instrument}/details`, {
        cache: "no-store",
        headers: { "x-api-secret": process.env.NEXT_PUBLIC_FRONTEND_API_SECRET || "" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.error || "Instrument details unavailable");
      }
      return data as InstrumentDetails;
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (instrumentDetails?.current_leverage && !leverageTouched) {
      setForm((prev) => ({ ...prev, leverage: String(instrumentDetails.current_leverage) }));
    }
  }, [instrumentDetails?.current_leverage, leverageTouched]);

  const entry = useMemo(() => {
    const raw = form.entryType === "market" ? String(currentPrice) : form.entryPrice;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [currentPrice, form.entryPrice, form.entryType]);

  useEffect(() => {
    if (form.entryType === "market" && currentPrice > 0) {
      setForm((prev) => ({ ...prev, entryPrice: currentPrice.toFixed(1) }));
    }
  }, [currentPrice, form.entryType]);

  useEffect(() => {
    const sl = Number.parseFloat(form.stopLoss);
    if (!entry || !sl || sl <= 0) {
      setRiskPct(null);
      setRrRatio(null);
      return;
    }

    const risk = Math.abs(entry - sl);
    setRiskPct((risk / entry) * 100);

    const tp1Calc = form.direction === "long" ? entry + risk * 1.5 : entry - risk * 1.5;
    const tp2Calc = form.direction === "long" ? entry + risk * 3.0 : entry - risk * 3.0;
    setForm((prev) => ({
      ...prev,
      tp1: prev.tp1 ? prev.tp1 : tp1Calc.toFixed(1),
      tp2: prev.tp2 ? prev.tp2 : tp2Calc.toFixed(1),
    }));

    const tp2 = Number.parseFloat(form.tp2) || tp2Calc;
    const reward = Math.abs(tp2 - entry);
    setRrRatio(risk > 0 ? reward / risk : null);
  }, [entry, form.direction, form.stopLoss, form.tp2]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await fetch(`${API_BASE}/api/trades/manual`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-secret": process.env.NEXT_PUBLIC_FRONTEND_API_SECRET || "",
        },
        body: JSON.stringify({
          instrument: form.instrument,
          direction: form.direction,
          entry_type: form.entryType,
          entry_price: form.entryType === "limit" ? Number.parseFloat(form.entryPrice) : null,
          stop_loss: Number.parseFloat(form.stopLoss),
          tp1: Number.parseFloat(form.tp1),
          tp2: Number.parseFloat(form.tp2),
          tp3: form.tp3 ? Number.parseFloat(form.tp3) : null,
          size_mode: form.sizeMode,
          size_value: Number.parseFloat(form.sizeValue),
          size_pct: form.sizeMode === "risk_percent" ? Number.parseFloat(form.sizeValue) : null,
          leverage: Number.parseInt(form.leverage, 10),
          skip_confirm: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(`Manual trade endpoint not found on ${API_BASE}. Restart the backend server.`);
        }
        throw new Error(data.error || data.detail || "Trade placement failed");
      }
      return data as {
        message?: string;
        rr: number;
        contracts: number;
        base_size: number;
        notional_usd: number;
        risk_amount: number;
        estimated_margin: number | null;
        leverage: number | null;
      };
    },
    onSuccess: async (data) => {
      window.alert(
        `Trade placed. R:R 1:${data.rr}. Size ${data.contracts} contracts, notional $${data.notional_usd.toLocaleString()}, leverage ${data.leverage ?? "exchange default"}x. AI is now managing this position.`
      );
      await queryClient.invalidateQueries({ queryKey: ["live-state"] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
      setShowConfirm(false);
    },
  });

  const stopLoss = Number.parseFloat(form.stopLoss);
  const tp2 = Number.parseFloat(form.tp2);
  const sizeValue = Number.parseFloat(form.sizeValue);
  const leverage = Number.parseInt(form.leverage, 10);
  const availableMargin = account?.available_margin ?? 0;
  const contractValue = instrumentDetails?.contract_value ?? 1;
  const contractUnitLabel = instrumentDetails?.contract_unit_label ?? "base";
  const riskDistance = entry > 0 && stopLoss > 0 ? Math.abs(entry - stopLoss) : 0;
  const riskPerContract = riskDistance * contractValue;
  const estimatedContracts = (() => {
    if (!Number.isFinite(sizeValue) || sizeValue <= 0 || contractValue <= 0) return null;
    if (form.sizeMode === "contracts") return Math.max(1, Math.floor(sizeValue));
    if (form.sizeMode === "base_lots") return Math.max(1, Math.floor(sizeValue / contractValue));
    if (form.sizeMode === "usd_notional" && entry > 0) {
      return Math.max(1, Math.floor(sizeValue / (entry * contractValue)));
    }
    if (form.sizeMode === "risk_percent" && riskPerContract > 0) {
      const riskBudget = availableMargin * sizeValue / 100;
      return Math.max(1, Math.floor(riskBudget / riskPerContract));
    }
    return null;
  })();
  const estimatedBaseSize = estimatedContracts !== null ? estimatedContracts * contractValue : null;
  const estimatedNotional = estimatedBaseSize !== null && entry > 0 ? estimatedBaseSize * entry : null;
  const estimatedMargin = estimatedNotional !== null && Number.isFinite(leverage) && leverage > 0
    ? estimatedNotional / leverage
    : null;
  const riskAmount = form.sizeMode === "risk_percent" && Number.isFinite(sizeValue)
    ? availableMargin * sizeValue / 100
    : estimatedContracts !== null && riskPerContract > 0
      ? estimatedContracts * riskPerContract
      : 0;
  const marginFits = estimatedMargin === null || estimatedMargin <= availableMargin;
  const stopOnCorrectSide =
    entry > 0 && stopLoss > 0 && (form.direction === "long" ? stopLoss < entry : stopLoss > entry);
  const tp2OnCorrectSide =
    entry > 0 && tp2 > 0 && (form.direction === "long" ? tp2 > entry : tp2 < entry);
  const isValidRR = rrRatio !== null && rrRatio >= 3.0;
  const canSubmit =
    stopOnCorrectSide &&
    tp2OnCorrectSide &&
    isValidRR &&
    Number.isFinite(sizeValue) &&
    sizeValue > 0 &&
    Number.isFinite(leverage) &&
    leverage >= 1 &&
    leverage <= 100 &&
    availableMargin > 0 &&
    marginFits;

  return (
    <div className="panel space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-mono text-xs font-bold tracking-widest text-zinc-200">
            MANUAL TRADE ENTRY
          </h3>
          <p className="mt-1 text-xs text-zinc-500">You call the setup. AI manages the position.</p>
        </div>
        <button onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800">
          X
        </button>
      </div>

      <div className="grid gap-2 rounded border border-blue-500/20 bg-blue-500/5 p-3 sm:grid-cols-4">
        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">Available Margin</div>
          <div className="mt-1 font-mono text-sm font-bold text-blue-200">
            {accountLoading ? "Loading..." : formatMoney(account?.available_margin, account?.asset)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">Wallet Balance</div>
          <div className="mt-1 font-mono text-sm font-bold text-zinc-200">
            {accountLoading ? "Loading..." : formatMoney(account?.total_balance, account?.asset)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">Risk Amount</div>
          <div className="mt-1 font-mono text-sm font-bold text-amber-200">
            {formatMoney(riskAmount, account?.asset)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">Order Size</div>
          <div className="mt-1 font-mono text-sm font-bold text-green-200">
            {estimatedContracts ?? "-"} contracts
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">Base Lots</div>
          <div className="mt-1 font-mono text-sm font-bold text-green-200">
            {formatNumber(estimatedBaseSize, 6)} {contractUnitLabel}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">USD Notional</div>
          <div className="mt-1 font-mono text-sm font-bold text-blue-200">
            {formatMoney(estimatedNotional, "USD")}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">Est. Margin</div>
          <div className={cn("mt-1 font-mono text-sm font-bold", marginFits ? "text-amber-200" : "text-red-300")}>
            {formatMoney(estimatedMargin, account?.asset)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">Leverage</div>
          <div className="mt-1 font-mono text-sm font-bold text-purple-200">
            {Number.isFinite(leverage) ? `${leverage}x` : instrumentDetails?.current_leverage ? `${instrumentDetails.current_leverage}x` : "-"}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase text-zinc-500">Contract Value</div>
          <div className="mt-1 font-mono text-sm font-bold text-zinc-200">
            {formatNumber(contractValue, 6)} {contractUnitLabel}
          </div>
        </div>
        {accountError && (
          <div className="sm:col-span-4 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
            Could not load account data from {API_BASE}. Make sure the backend is running.
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-zinc-500">
          <span>Instrument</span>
          <select
            value={form.instrument}
            onChange={(e) => {
              setLeverageTouched(false);
              setForm((p) => ({ ...p, instrument: e.target.value }));
            }}
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-zinc-200"
          >
            <option value="BTCUSD_PERP">BTCUSD</option>
            <option value="ETHUSD_PERP">ETHUSD</option>
            <option value="SOLUSD_PERP">SOLUSD</option>
            <option value="XAUUSD_PERP">XAUUSD</option>
          </select>
        </label>

        <div className="space-y-1 text-xs text-zinc-500">
          <span>Direction</span>
          <div className="grid grid-cols-2 gap-1">
            {(["long", "short"] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => {
                  setForm((p) => ({ ...p, direction: dir, tp1: "", tp2: "" }));
                  setShowConfirm(false);
                }}
                className={cn(
                  "rounded border px-2 py-2 font-mono text-xs font-bold",
                  form.direction === dir
                    ? dir === "long"
                      ? "border-green-500 bg-green-500/10 text-green-400"
                      : "border-red-500 bg-red-500/10 text-red-400"
                    : "border-zinc-800 bg-zinc-950 text-zinc-500"
                )}
              >
                {dir === "long" ? "LONG" : "SHORT"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="space-y-1 text-xs text-zinc-500">
        <span>Entry</span>
        <div className="flex gap-2">
          <select
            value={form.entryType}
            onChange={(e) => setForm((p) => ({ ...p, entryType: e.target.value as "market" | "limit" }))}
            className="w-28 rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-zinc-200"
          >
            <option value="market">Market</option>
            <option value="limit">Limit</option>
          </select>
          {form.entryType === "limit" ? (
            <input
              type="number"
              value={form.entryPrice}
              onChange={(e) => setForm((p) => ({ ...p, entryPrice: e.target.value, tp1: "", tp2: "" }))}
              className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-zinc-200"
            />
          ) : (
            <div className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-zinc-400">
              ~${currentPrice ? currentPrice.toLocaleString() : "-"}
            </div>
          )}
        </div>
      </label>

      <label className="space-y-1 text-xs text-zinc-500">
        <span className="flex justify-between">
          <span>Stop Loss</span>
          {riskPct !== null && <span className="text-red-400">Risk {riskPct.toFixed(2)}%</span>}
        </span>
        <input
          type="number"
          value={form.stopLoss}
          onChange={(e) => setForm((p) => ({ ...p, stopLoss: e.target.value, tp1: "", tp2: "" }))}
          placeholder={
            form.direction === "long"
              ? `Below entry, e.g. ${(entry * 0.995).toFixed(1)}`
              : `Above entry, e.g. ${(entry * 1.005).toFixed(1)}`
          }
          className="w-full rounded border border-red-500/40 bg-zinc-950 px-2 py-2 font-mono text-zinc-200"
        />
      </label>

      <div className="grid gap-2 sm:grid-cols-3">
        {[
          ["tp1", "TP1 1.5R"],
          ["tp2", "TP2 min 3R"],
          ["tp3", "TP3 optional"],
        ].map(([key, label]) => (
          <label key={key} className="space-y-1 text-xs text-zinc-500">
            <span>{label}</span>
            <input
              type="number"
              value={form[key as keyof ManualTradeForm] as string}
              onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-zinc-200"
            />
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <div className="text-xs text-zinc-500">Position Size</div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {(Object.keys(SIZE_MODE_LABELS) as SizeMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setForm((p) => ({
                    ...p,
                    sizeMode: mode,
                    sizeValue:
                      mode === "usd_notional" ? "100" :
                      mode === "base_lots" ? String(contractValue) :
                      mode === "contracts" ? "1" : "1",
                  }));
                  setShowConfirm(false);
                }}
                className={cn(
                  "rounded border px-2 py-2 font-mono text-[11px] font-bold",
                  form.sizeMode === mode
                    ? "border-blue-500 bg-blue-500/10 text-blue-200"
                    : "border-zinc-800 bg-zinc-950 text-zinc-500"
                )}
              >
                {SIZE_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          <label className="block space-y-1 text-xs text-zinc-500">
            <span>
              {form.sizeMode === "usd_notional" && "USD notional to deploy"}
              {form.sizeMode === "base_lots" && `${contractUnitLabel} lots`}
              {form.sizeMode === "contracts" && "Delta contracts"}
              {form.sizeMode === "risk_percent" && "Risk % of available margin"}
            </span>
            <input
              type="number"
              value={form.sizeValue}
              min="0.000001"
              step={form.sizeMode === "contracts" ? "1" : "0.1"}
              onChange={(e) => setForm((p) => ({ ...p, sizeValue: e.target.value }))}
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-zinc-200"
            />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
            <span>Leverage</span>
            {instrumentDetails?.current_leverage && (
              <span className="font-mono text-zinc-400">Exchange now {instrumentDetails.current_leverage}x</span>
            )}
          </div>
          <div className="grid grid-cols-5 gap-1">
            {LEVERAGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setLeverageTouched(true);
                  setForm((p) => ({ ...p, leverage: String(preset) }));
                  setShowConfirm(false);
                }}
                className={cn(
                  "rounded border px-2 py-2 font-mono text-[11px] font-bold",
                  form.leverage === String(preset)
                    ? "border-purple-500 bg-purple-500/10 text-purple-200"
                    : "border-zinc-800 bg-zinc-950 text-zinc-500"
                )}
              >
                {preset}x
              </button>
            ))}
          </div>
          <label className="block space-y-1 text-xs text-zinc-500">
            <span>Custom leverage 1x-100x</span>
            <input
              type="number"
              value={form.leverage}
              min="1"
              max="100"
              step="1"
              onChange={(e) => {
                setLeverageTouched(true);
                setForm((p) => ({ ...p, leverage: e.target.value }));
              }}
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-zinc-200"
            />
          </label>
        </div>
      </div>

      <div
        className={cn(
          "rounded border px-3 py-2 font-mono text-xs",
          isValidRR ? "border-green-500/30 bg-green-500/10 text-green-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"
        )}
      >
        R:R {rrRatio !== null ? `1:${rrRatio.toFixed(2)}` : "-"} / minimum 1:3.0
      </div>

      {!marginFits && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Estimated margin {formatMoney(estimatedMargin, account?.asset)} is above available margin {formatMoney(availableMargin, account?.asset)} at {leverage}x.
        </div>
      )}

      {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

      {!showConfirm ? (
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => setShowConfirm(true)}
          className="w-full rounded bg-blue-500 px-3 py-2 font-mono text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          REVIEW MANUAL TRADE
        </button>
      ) : (
        <div className="space-y-2 rounded border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="text-xs text-amber-200">
            Confirm live order on {form.instrument}: {form.direction.toUpperCase()} {form.entryType.toUpperCase()}.
            {" "}Size {estimatedContracts ?? "-"} contracts / {formatMoney(estimatedNotional, "USD")} notional / {Number.isFinite(leverage) ? `${leverage}x` : "-"} leverage.
            {" "}Estimated margin {formatMoney(estimatedMargin, account?.asset)}, risk {formatMoney(riskAmount, account?.asset)}.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setShowConfirm(false)}
              className="rounded border border-zinc-700 px-3 py-2 font-mono text-xs text-zinc-300"
            >
              CANCEL
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="rounded bg-green-500 px-3 py-2 font-mono text-xs font-bold text-white disabled:opacity-60"
            >
              {mutation.isPending ? "PLACING..." : "PLACE TRADE"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
