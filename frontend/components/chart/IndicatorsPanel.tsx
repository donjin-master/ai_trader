"use client";

import { X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IndicatorConfig {
  id: string;
  type: "EMA" | "SMA" | "BB" | "RSI" | "MACD" | "ATR" | "VWAP" | "SMC_OB" | "SMC_FVG" | "SMC_LIQ" | "SMC_STRUCT";
  name: string;
  enabled: boolean;
  color: string;
  lineWidth: number;
  period?: number;
  period2?: number; // slow period for MACD, or stdDev for BB
  period3?: number; // signal period for MACD
}

interface IndicatorsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  configs: IndicatorConfig[];
  onUpdate: (configs: IndicatorConfig[]) => void;
}

const PRESET_COLORS = [
  "#ffffff", // White
  "#a855f7", // Purple
  "#eab308", // Yellow
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#f97316", // Orange
  "#ef4444", // Red
  "#10b981", // Emerald
];

export default function IndicatorsPanel({
  isOpen,
  onClose,
  configs,
  onUpdate,
}: IndicatorsPanelProps) {
  if (!isOpen) return null;

  const handleChange = (id: string, updates: Partial<IndicatorConfig>) => {
    const next = configs.map((c) => (c.id === id ? { ...c, ...updates } : c));
    onUpdate(next);
  };

  const trendConfigs = configs.filter((c) =>
    ["EMA", "SMA", "VWAP", "BB"].includes(c.type)
  );
  const oscillatorConfigs = configs.filter((c) =>
    ["RSI", "MACD", "ATR"].includes(c.type)
  );
  const aiConfigs = configs.filter((c) =>
    c.type.startsWith("SMC_")
  );

  return (
    <div className={cn(
      "absolute bottom-0 left-0 right-0 z-30 flex h-[350px] flex-col border-t border-zinc-800 bg-zinc-950/95 font-mono text-xs text-zinc-300 shadow-2xl backdrop-blur-md transition-all duration-300",
      isOpen ? "translate-y-0" : "translate-y-full"
    )}>
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-2 bg-black/40">
        <span className="font-bold text-zinc-100 flex items-center gap-1.5">
          📊 Indicators & AI Annotations
        </span>
        <button
          onClick={onClose}
          className="rounded-full p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Grid of Sections */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Section 1: Trend / Overlays */}
          <div>
            <div className="mb-2 font-bold text-blue-400 border-b border-zinc-900 pb-1">
              Trend & Momentum (Main Pane)
            </div>
            <div className="flex flex-col gap-2.5">
              {trendConfigs.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 bg-zinc-900/30 rounded p-1.5 border border-zinc-900/50">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) => handleChange(c.id, { enabled: e.target.checked })}
                      className="accent-blue-500 rounded cursor-pointer"
                    />
                    <span className="font-bold text-zinc-200">{c.name}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {c.period !== undefined && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-500">P</span>
                        <input
                          type="number"
                          value={c.period}
                          onChange={(e) => handleChange(c.id, { period: parseInt(e.target.value) || 1 })}
                          className="w-10 rounded border border-zinc-800 bg-black/40 px-1 py-0.5 text-center text-[10px]"
                          min="1"
                        />
                      </div>
                    )}
                    {c.period2 !== undefined && c.type === "BB" && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-500">Dev</span>
                        <input
                          type="number"
                          value={c.period2}
                          onChange={(e) => handleChange(c.id, { period2: parseFloat(e.target.value) || 0.1 })}
                          className="w-10 rounded border border-zinc-800 bg-black/40 px-1 py-0.5 text-center text-[10px]"
                          min="0.1"
                          step="0.1"
                        />
                      </div>
                    )}
                    <select
                      value={c.color}
                      onChange={(e) => handleChange(c.id, { color: e.target.value })}
                      className="rounded border border-zinc-800 bg-black/40 text-[10px] py-0.5 px-1"
                    >
                      {PRESET_COLORS.map((col) => (
                        <option key={col} value={col} style={{ backgroundColor: "#1c1d24", color: col }}>
                          ⬤
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Oscillators */}
          <div>
            <div className="mb-2 font-bold text-amber-400 border-b border-zinc-900 pb-1">
              Oscillators (Sub-panes)
            </div>
            <div className="flex flex-col gap-2.5">
              {oscillatorConfigs.map((c) => (
                <div key={c.id} className="flex flex-col gap-1.5 bg-zinc-900/30 rounded p-2 border border-zinc-900/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={c.enabled}
                        onChange={(e) => handleChange(c.id, { enabled: e.target.checked })}
                        className="accent-amber-500 rounded cursor-pointer"
                      />
                      <span className="font-bold text-zinc-200">{c.name}</span>
                    </div>
                    <select
                      value={c.color}
                      onChange={(e) => handleChange(c.id, { color: e.target.value })}
                      className="rounded border border-zinc-800 bg-black/40 text-[10px] py-0.5 px-1"
                    >
                      {PRESET_COLORS.map((col) => (
                        <option key={col} value={col} style={{ backgroundColor: "#1c1d24", color: col }}>
                          ⬤
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Settings depending on Oscillator */}
                  <div className="flex items-center gap-3 pt-1 border-t border-zinc-900/40 mt-1">
                    {c.type === "RSI" && c.period !== undefined && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-500">Period</span>
                        <input
                          type="number"
                          value={c.period}
                          onChange={(e) => handleChange(c.id, { period: parseInt(e.target.value) || 1 })}
                          className="w-12 rounded border border-zinc-800 bg-black/40 px-1 py-0.5 text-center text-[10px]"
                          min="1"
                        />
                      </div>
                    )}
                    {c.type === "ATR" && c.period !== undefined && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-500">Period</span>
                        <input
                          type="number"
                          value={c.period}
                          onChange={(e) => handleChange(c.id, { period: parseInt(e.target.value) || 1 })}
                          className="w-12 rounded border border-zinc-800 bg-black/40 px-1 py-0.5 text-center text-[10px]"
                          min="1"
                        />
                      </div>
                    )}
                    {c.type === "MACD" && c.period !== undefined && c.period2 !== undefined && c.period3 !== undefined && (
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-zinc-500">Fast</span>
                          <input
                            type="number"
                            value={c.period}
                            onChange={(e) => handleChange(c.id, { period: parseInt(e.target.value) || 1 })}
                            className="w-10 rounded border border-zinc-800 bg-black/40 px-1 py-0.5 text-center text-[9px]"
                            min="1"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-zinc-500">Slow</span>
                          <input
                            type="number"
                            value={c.period2}
                            onChange={(e) => handleChange(c.id, { period2: parseInt(e.target.value) || 1 })}
                            className="w-10 rounded border border-zinc-800 bg-black/40 px-1 py-0.5 text-center text-[9px]"
                            min="1"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] text-zinc-500">Sig</span>
                          <input
                            type="number"
                            value={c.period3}
                            onChange={(e) => handleChange(c.id, { period3: parseInt(e.target.value) || 1 })}
                            className="w-10 rounded border border-zinc-800 bg-black/40 px-1 py-0.5 text-center text-[9px]"
                            min="1"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: AI / SMC Overlays */}
          <div>
            <div className="mb-2 font-bold text-purple-400 border-b border-zinc-900 pb-1">
              AI Smart Market Structure (SMC)
            </div>
            <div className="flex flex-col gap-2.5">
              {aiConfigs.map((c) => (
                <div key={c.id} className="flex items-center justify-between bg-zinc-900/30 rounded p-1.5 border border-zinc-900/50">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) => handleChange(c.id, { enabled: e.target.checked })}
                      className="accent-purple-500 rounded cursor-pointer"
                    />
                    <span className="font-bold text-zinc-200">{c.name}</span>
                  </div>
                  <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[9px] text-purple-300 border border-purple-500/10">
                    AI Active
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="border-t border-zinc-900 px-4 py-2.5 bg-black/35 flex items-center justify-end">
        <button
          onClick={onClose}
          className="flex items-center gap-1 rounded bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-500 transition-colors"
        >
          <Check className="h-3.5 w-3.5" /> Apply & Close
        </button>
      </div>
    </div>
  );
}
