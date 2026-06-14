"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
} from "lightweight-charts";
import {
  DrawingManager,
  TrendLine,
  HorizontalLine,
  VerticalLine,
  Ray,
  ExtendedLine,
  Arrow,
  ParallelChannel,
  FibRetracement,
  Rectangle,
  Circle,
  Triangle,
  TextAnnotation,
  getToolRegistry,
} from "lightweight-charts-drawing";
import type { Anchor } from "lightweight-charts-drawing";
import useSWR from "swr";
import { API_BASE, WS_BASE, api, type Candle, type ManagedPositionState, type Snapshot } from "@/lib/api";
import { ema, sma, rsi, bollinger, atr, vwap, macd } from "@/lib/indicators";
import { cn, formatPct, formatUsd } from "@/lib/utils";

import DrawingToolbar, { DrawingToolType } from "./chart/DrawingToolbar";
import DrawingContextMenu from "./chart/DrawingContextMenu";
import IndicatorsPanel, { IndicatorConfig } from "./chart/IndicatorsPanel";

const TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1D", "1W"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

interface SmcLevel {
  price: number;
  color: string;
  title: string;
  style: LineStyle;
}

function extractLevels(
  smc: Record<string, any> | null,
  managed: ManagedPositionState | undefined,
  timeframe: Timeframe,
  configs: IndicatorConfig[]
): SmcLevel[] {
  const levels: SmcLevel[] = [];
  const showObs = configs.find(c => c.id === "obs")?.enabled ?? true;
  const showFvgs = configs.find(c => c.id === "fvgs")?.enabled ?? true;
  const showLiq = configs.find(c => c.id === "liq")?.enabled ?? true;

  if (smc) {
    if (showObs) {
      for (const ob of (smc.order_blocks?.[timeframe] ?? []).slice(0, 3)) {
        if (ob.mitigated) continue;
        const color = ob.type === "BULLISH" ? "rgba(34,197,94,0.55)" : "rgba(239,68,68,0.55)";
        levels.push({ price: ob.high, color, title: `OB ${ob.type === "BULLISH" ? "▲" : "▼"}`, style: LineStyle.Dashed });
        levels.push({ price: ob.low, color, title: "", style: LineStyle.Dashed });
      }
    }
    if (showFvgs) {
      for (const fvg of (smc.fvgs?.[timeframe] ?? []).slice(0, 3)) {
        if (fvg.filled) continue;
        const color = fvg.type === "BULLISH" ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)";
        levels.push({ price: fvg.top, color, title: "FVG", style: LineStyle.Dotted });
        levels.push({ price: fvg.bottom, color, title: "", style: LineStyle.Dotted });
      }
    }
    if (showLiq) {
      const liq = smc.liquidity?.["1h"] ?? {};
      for (const l of (liq.buy_side_liquidity ?? []).slice(0, 2))
        levels.push({ price: l.price, color: "rgba(59,130,246,0.5)", title: "Liq", style: LineStyle.Dotted });
      for (const l of (liq.sell_side_liquidity ?? []).slice(0, 2))
        levels.push({ price: l.price, color: "rgba(168,85,247,0.5)", title: "Liq", style: LineStyle.Dotted });
    }
  }
  if (managed) {
    levels.push({ price: managed.entry_price, color: "#f8fafc", title: "ENTRY", style: LineStyle.Dashed });
    levels.push({ price: managed.current_sl, color: "#ef4444", title: "SL", style: LineStyle.Dashed });
    levels.push({ price: managed.tp1, color: "#f59e0b", title: `TP1${managed.tp1_hit ? " ✓" : ""}`, style: LineStyle.Dashed });
    levels.push({ price: managed.tp2, color: "#10b981", title: "TP2", style: LineStyle.Dashed });
    if (managed.tp3) levels.push({ price: managed.tp3, color: "#4ade80", title: "TP3", style: LineStyle.Solid });
    if (managed.trail_active && managed.trail_sl)
      levels.push({ price: managed.trail_sl, color: "#fb923c", title: "TRAIL", style: LineStyle.Solid });
  }
  return levels;
}

interface OhlcInfo {
  time: string;
  o: number; h: number; l: number; c: number; v: number; up: boolean;
}

// ── Funding countdown helper ──────────────────────────────────────────────────
function useFundingCountdown() {
  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const interval = 8 * 3600 * 1000;
      const nextFunding = Math.ceil(now / interval) * interval;
      const diff = nextFunding - now;
      const h = Math.floor(diff / 3600_000);
      const m = Math.floor((diff % 3600_000) / 60_000);
      setCountdown(`${String(h).padStart(2, "0")}h:${String(m).padStart(2, "0")}m`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return countdown;
}

// ── 24h Stats Bar Component (GOAL 1 & 2) ──────────────────────────────────────
function StatsBar({ instrument }: { instrument: string }) {
  const { data: snap } = useSWR<Snapshot | null>(
    `snapshot-${instrument}`,
    () => api.snapshot(instrument),
    { refreshInterval: 30_000 }
  );
  const countdown = useFundingCountdown();
  if (!snap) return null;

  const changePct = snap.change_24h_pct ?? 0;
  const funding = snap.funding_rate ?? 0;
  const fundingHigh = Math.abs(funding) > 0.0005;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--glass-border)] px-3 py-1.5 font-mono text-[11px] bg-black/20">
      <span className={changePct >= 0 ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
        24h {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
      </span>
      <span className="text-slate-700">|</span>
      <span className="text-slate-300">High {snap.high_24h ? formatUsd(snap.high_24h) : formatUsd(snap.best_ask ?? 0)}</span>
      <span className="text-slate-300">Low {snap.low_24h ? formatUsd(snap.low_24h) : formatUsd(snap.best_bid ?? 0)}</span>
      <span className="text-slate-700">|</span>
      <span className="text-slate-300">Volume {snap.volume_24h ? `$${(snap.volume_24h / 1e6).toFixed(1)}M` : "—"}</span>
      <span className="text-slate-700">|</span>
      <span className="text-slate-300">OI {snap.open_interest ? `$${(snap.open_interest / 1e6).toFixed(1)}M` : "—"}</span>
      <span className="text-slate-700">|</span>
      <span className={fundingHigh ? "text-amber-400" : funding < 0 ? "text-emerald-400" : "text-slate-400"}>
        Funding {(funding * 100).toFixed(4)}%
      </span>
      <span className="text-slate-500">| {countdown}</span>
      {snap.fear_greed_index != null && (
        <>
          <span className="text-slate-700">|</span>
          <span className="text-slate-300">Fear&Greed {snap.fear_greed_index} ({snap.fear_greed_classification})</span>
        </>
      )}
    </div>
  );
}

// ── Replay Types ─────────────────────────────────────────────────────────────
interface MarkedEntry {
  time: number;
  price: number;
  direction: "long" | "short";
}

const DEFAULT_INDICATOR_CONFIGS: IndicatorConfig[] = [
  { id: "ema20", type: "EMA", name: "EMA 20", enabled: true, color: "#ffffff", lineWidth: 1, period: 20 },
  { id: "ema50", type: "EMA", name: "EMA 50", enabled: true, color: "rgba(124,58,237,0.8)", lineWidth: 1, period: 50 },
  { id: "ema200", type: "EMA", name: "EMA 200", enabled: false, color: "#eab308", lineWidth: 1, period: 200 },
  { id: "sma200", type: "SMA", name: "SMA 200", enabled: false, color: "#eab308", lineWidth: 1, period: 200 },
  { id: "vwap", type: "VWAP", name: "VWAP", enabled: false, color: "#06b6d4", lineWidth: 1 },
  { id: "bb", type: "BB", name: "Bollinger Bands", enabled: false, color: "#3b82f6", lineWidth: 1, period: 20, period2: 2.0 },
  { id: "rsi", type: "RSI", name: "RSI 14", enabled: false, color: "#f97316", lineWidth: 1, period: 14 },
  { id: "macd", type: "MACD", name: "MACD", enabled: false, color: "#3b82f6", lineWidth: 1, period: 12, period2: 26, period3: 9 },
  { id: "atr", type: "ATR", name: "ATR 14", enabled: false, color: "#ef4444", lineWidth: 1, period: 14 },
  { id: "obs", type: "SMC_OB", name: "Order Blocks", enabled: true, color: "", lineWidth: 1 },
  { id: "fvgs", type: "SMC_FVG", name: "Fair Value Gaps", enabled: true, color: "", lineWidth: 1 },
  { id: "liq", type: "SMC_LIQ", name: "Liquidity Levels", enabled: true, color: "", lineWidth: 1 },
  { id: "struct", type: "SMC_STRUCT", name: "Market Structure (BOS/CHoCH)", enabled: true, color: "", lineWidth: 1 },
];

const DRAWING_CLASS_MAP: Record<string, any> = {
  "trend-line": TrendLine,
  "horizontal-line": HorizontalLine,
  "vertical-line": VerticalLine,
  "ray": Ray,
  "extended-line": ExtendedLine,
  "arrow": Arrow,
  "parallel-channel": ParallelChannel,
  "fib-retracement": FibRetracement,
  "rectangle": Rectangle,
  "circle": Circle,
  "triangle": Triangle,
  "text-annotation": TextAnnotation,
};

const TOOL_TO_LIBRARY_MAP: Record<DrawingToolType, string | null> = {
  cursor: null,
  trendline: "trend-line",
  horizontal: "horizontal-line",
  vertical: "vertical-line",
  ray: "ray",
  extended: "extended-line",
  arrow: "arrow",
  channel: "parallel-channel",
  fibonacci: "fib-retracement",
  rectangle: "rectangle",
  circle: "circle",
  triangle: "triangle",
  text: "text-annotation",
};

export default function LiveChart({
  instrument = "BTCUSD",
  height = 420,
}: {
  instrument?: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  
  // Replay markers ref
  const replayMarkersRef = useRef<any>(null);
  
  // Drawing refs
  const drawingManagerRef = useRef<DrawingManager | null>(null);
  const drawingIdMapRef = useRef<Record<string, string>>({}); // maps drawing.id -> db id (uuid)
  
  // Indicators panel + series refs
  const indicatorSeriesRef = useRef<ISeriesApi<"Line" | "Histogram">[]>([]);
  const [indicatorConfigs, setIndicatorConfigs] = useState<IndicatorConfig[]>(DEFAULT_INDICATOR_CONFIGS);
  const [showIndicatorsPanel, setShowIndicatorsPanel] = useState(false);
  const [activeDrawingTool, setActiveDrawingTool] = useState<DrawingToolType>("cursor");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; drawing: any } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);
  // tracks anchors being placed for the active drawing tool
  const pendingDrawingRef = useRef<{ toolType: string; anchors: Anchor[]; requiredAnchors: number } | null>(null);

  // Sub-pane containers and chart refs
  const rsiContainerRef = useRef<HTMLDivElement | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const macdContainerRef = useRef<HTMLDivElement | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const macdMacdSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const atrContainerRef = useRef<HTMLDivElement | null>(null);
  const atrChartRef = useRef<IChartApi | null>(null);
  const atrSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const priceLinesRef = useRef<IPriceLine[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const [candleVersion, setCandleVersion] = useState(0);
  const isLoadingMoreRef = useRef(false);

  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [mode, setMode] = useState<"interactive" | "ai_view">("interactive");
  const [isLoading, setIsLoading] = useState(true);
  const [aiViewKey, setAiViewKey] = useState(0);
  const [ohlc, setOhlc] = useState<OhlcInfo | null>(null);
  const [keyLevels, setKeyLevels] = useState<any[]>([]);

  // ── Replay state ─────────────────────────────────────────────────────────
  const [replayMode, setReplayMode] = useState(false);
  const [replayDate, setReplayDate] = useState("");
  const [replayCursor, setReplayCursor] = useState(0);
  const [replayCandles, setReplayCandles] = useState<Candle[]>([]);
  const [replayAnalysis, setReplayAnalysis] = useState<Record<string, any> | null>(null);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [markedEntries, setMarkedEntries] = useState<MarkedEntry[]>([]);
  const [showReplayPicker, setShowReplayPicker] = useState(false);
  const replayTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load persisted indicators config and timeframe on mount / instrument changes
  useEffect(() => {
    const savedTf = localStorage.getItem(`tf-${instrument}`);
    if (savedTf && TIMEFRAMES.includes(savedTf as Timeframe)) setTimeframe(savedTf as Timeframe);
  }, [instrument]);

  useEffect(() => {
    localStorage.setItem(`tf-${instrument}`, timeframe);
  }, [instrument, timeframe]);

  // Load persisted indicator configurations for this instrument + timeframe
  useEffect(() => {
    const key = `indicators_${instrument}_${timeframe}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        setIndicatorConfigs(JSON.parse(saved));
      } catch (err) {
        setIndicatorConfigs(DEFAULT_INDICATOR_CONFIGS);
      }
    } else {
      setIndicatorConfigs(DEFAULT_INDICATOR_CONFIGS);
    }
  }, [instrument, timeframe]);

  const handleIndicatorsUpdate = (newConfigs: IndicatorConfig[]) => {
    setIndicatorConfigs(newConfigs);
    const key = `indicators_${instrument}_${timeframe}`;
    localStorage.setItem(key, JSON.stringify(newConfigs));
  };

  const annotationsOn = indicatorConfigs.some(c => c.type.startsWith("SMC_") && c.enabled);
  const { data: smc } = useSWR<Record<string, any> | null>(
    annotationsOn && mode === "interactive" && !replayMode ? `smc-${instrument}` : null,
    () => api.smc(instrument),
    { refreshInterval: 120_000 }
  );
  const { data: managed } = useSWR<ManagedPositionState[] | null>(
    "managed-positions", () => api.managedPositions(), { refreshInterval: 30_000 }
  );
  const managedState = (managed ?? []).find((m) => m.instrument === instrument);

  // Fetch key levels on instrument changes (Goal 4)
  useEffect(() => {
    if (mode !== "interactive" || replayMode) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/key-levels/${instrument}`);
        if (res.ok) {
          const data = await res.json();
          setKeyLevels(data.chart_levels || []);
        }
      } catch (err) {
        console.error("Failed to fetch key levels:", err);
      }
    })();
  }, [instrument, mode, replayMode]);

  // ── Chart lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "interactive" || !containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontFamily: "var(--font-mono), monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#3b82f6", width: 1, style: LineStyle.Dotted },
        horzLine: { color: "#3b82f6", width: 1, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.08)",
        scaleMargins: { top: 0.08, bottom: 0.15 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        minBarSpacing: 3,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#ef4444",
      wickUpColor: "#16a34a", wickDownColor: "#b91c1c", borderVisible: false,
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: "#ffffff",
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dashed,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    // Initialize DrawingManager
    const manager = new DrawingManager();
    manager.attach(chart, candles, containerRef.current);
    drawingManagerRef.current = manager;

    // Drawing placement: collect anchors on click, create drawing when complete
    const drawingClickHandler = (param: any) => {
      const pending = pendingDrawingRef.current;
      if (!pending || !param.point || !param.time) return;
      const price = candles.coordinateToPrice(param.point.y);
      if (price === null) return;
      pending.anchors.push({ time: param.time as any, price });
      if (pending.anchors.length >= pending.requiredAnchors) {
        const id = `dwg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const drawing = getToolRegistry().createDrawing(
          pending.toolType, id, pending.anchors,
          { lineColor: "#3b82f6", lineWidth: 1 }
        );
        if (drawing) manager.addDrawing(drawing);
        pendingDrawingRef.current = null;
        setActiveDrawingTool("cursor");
        manager.setActiveTool(null);
        if (containerRef.current) containerRef.current.style.cursor = "default";
      }
    };
    chart.subscribeClick(drawingClickHandler);

    // Crosshair move subscription for permanent OHLC legend
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time) {
        // Fallback to the latest candle if mouse is not on chart
        const arr = candlesRef.current;
        if (arr.length) {
          const last = arr[arr.length - 1];
          setOhlc({
            time: new Date(last.time * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }),
            o: last.open, h: last.high, l: last.low, c: last.close,
            v: last.volume, up: last.close >= last.open,
          });
        }
        return;
      }
      const data = param.seriesData.get(candles) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      const vol = param.seriesData.get(volume) as { value: number } | undefined;
      if (data) {
        const date = new Date((param.time as number) * 1000);
        setOhlc({
          time: date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }),
          o: data.open, h: data.high, l: data.low, c: data.close,
          v: vol?.value ?? 0, up: data.close >= data.open,
        });
      }
    });

    // Handle right click on drawings
    const container = containerRef.current;
    const handleContextMenu = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = manager.hitTest({ x, y });
      if (hit) {
        e.preventDefault();
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          drawing: hit,
        });
      }
    };
    container.addEventListener("contextmenu", handleContextMenu);

    chartRef.current = chart;
    candleSeriesRef.current = candles;
    volumeSeriesRef.current = volume;

    const observer = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      container.removeEventListener("contextmenu", handleContextMenu);
      chart.unsubscribeClick(drawingClickHandler);
      manager.detach();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      drawingManagerRef.current = null;
      drawingIdMapRef.current = {};
      pendingDrawingRef.current = null;
    };
  }, [mode, height]);

  // Set drawing tool helper
  const handleToolSelect = (tool: DrawingToolType) => {
    setActiveDrawingTool(tool);
    pendingDrawingRef.current = null; // cancel any in-progress placement
    const toolKey = TOOL_TO_LIBRARY_MAP[tool];
    if (drawingManagerRef.current) {
      drawingManagerRef.current.setActiveTool(toolKey);
      if (!toolKey) drawingManagerRef.current.deselectAll();
    }
    if (containerRef.current) {
      containerRef.current.style.cursor = toolKey ? "crosshair" : "default";
    }
    if (toolKey) {
      const toolDef = getToolRegistry().get(toolKey);
      if (toolDef) {
        pendingDrawingRef.current = { toolType: toolKey, anchors: [], requiredAnchors: toolDef.requiredAnchors };
      }
    }
  };

  const handleResetChart = () => {
    chartRef.current?.timeScale().fitContent();
  };

  const handleFullscreen = () => {
    const el = chartWrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const handleClearAllDrawings = async () => {
    if (drawingManagerRef.current) {
      drawingManagerRef.current.clearAll();
      drawingIdMapRef.current = {};
      try {
        await fetch(`${API_BASE}/api/drawings/${instrument}/${timeframe}/all`, {
          method: "DELETE",
        });
      } catch (err) {
        console.error("Failed to clear drawings:", err);
      }
    }
  };

  const handleDrawingUpdate = (
    drawingId: string,
    updates: {
      style?: { lineColor?: string; lineWidth?: number; lineDash?: number[] };
      options?: { locked?: boolean };
    }
  ) => {
    const manager = drawingManagerRef.current;
    if (!manager) return;
    const drawing = manager.getDrawing(drawingId);
    if (!drawing) return;

    if (updates.style) {
      drawing.updateStyle(updates.style);
    }
    if (updates.options) {
      drawing.updateOptions(updates.options);
    }
    drawing.requestUpdate();

    const dbId = drawingIdMapRef.current[drawingId];
    if (dbId) {
      fetch(`${API_BASE}/api/drawings/${dbId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style: drawing.style,
          locked: drawing.options?.locked || false,
        }),
      }).catch((err) => console.error("Failed to update drawing in DB:", err));
    }
  };

  const handleDrawingDelete = (drawingId: string) => {
    if (drawingManagerRef.current) {
      drawingManagerRef.current.removeDrawing(drawingId);
    }
  };

  // Sync drawings with backend database (Goal 2)
  useEffect(() => {
    const manager = drawingManagerRef.current;
    if (!manager) return;

    const unsubAdded = manager.on("drawing:added", async (event) => {
      const drawing = event.drawing;
      if (!drawing || !drawing.isValid()) return;
      if (drawingIdMapRef.current[drawing.id]) return;

      const payload = {
        drawing_type: drawing.type,
        points: drawing.anchors,
        style: drawing.style,
        locked: drawing.options?.locked || false,
      };

      try {
        const res = await fetch(`${API_BASE}/api/drawings/${instrument}/${timeframe}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const saved = await res.json();
          drawingIdMapRef.current[drawing.id] = saved.id;
        }
      } catch (err) {
        console.error("Failed to save drawing:", err);
      }
    });

    const unsubUpdated = manager.on("drawing:updated", async (event) => {
      const drawing = event.drawing;
      if (!drawing) return;
      const dbId = drawingIdMapRef.current[drawing.id];
      if (!dbId) return;

      const payload = {
        points: drawing.anchors,
        style: drawing.style,
        locked: drawing.options?.locked || false,
      };

      try {
        await fetch(`${API_BASE}/api/drawings/${dbId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.error("Failed to update drawing:", err);
      }
    });

    const unsubRemoved = manager.on("drawing:removed", async (event) => {
      const drawing = event.drawing;
      if (!drawing) return;
      const dbId = drawingIdMapRef.current[drawing.id];
      if (!dbId) return;

      try {
        await fetch(`${API_BASE}/api/drawings/${dbId}`, {
          method: "DELETE",
        });
        delete drawingIdMapRef.current[drawing.id];
      } catch (err) {
        console.error("Failed to delete drawing:", err);
      }
    });

    return () => {
      unsubAdded();
      unsubUpdated();
      unsubRemoved();
    };
  }, [instrument, timeframe, isLoading]);

  // Sync loaded drawings when changing timeframe or instrument
  useEffect(() => {
    const manager = drawingManagerRef.current;
    if (mode !== "interactive" || !manager || isLoading) return;

    manager.clearAll();
    drawingIdMapRef.current = {};

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/drawings/${instrument}/${timeframe}`);
        if (!res.ok) return;
        const savedDrawings = await res.json();
        for (const d of savedDrawings) {
          const DrawingClass = DRAWING_CLASS_MAP[d.drawing_type];
          if (DrawingClass) {
            const drawing = new DrawingClass(
              d.id,
              d.points,
              d.style,
              { locked: d.locked }
            );
            manager.addDrawing(drawing);
            drawingIdMapRef.current[drawing.id] = d.id;
          }
        }
      } catch (err) {
        console.error("Failed to restore drawings:", err);
      }
    })();
  }, [instrument, timeframe, mode, isLoading]);

  // ── Helper to set candle + volume data ──────────────────────────────────────
  const applyAllData = useCallback((candles: Candle[]) => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    const candleData = candles.map((c) => ({
      time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    const volData = candles.map((c) => ({
      time: c.time as UTCTimestamp, value: c.volume,
      color: c.close >= c.open ? "rgba(16,185,129,0.4)" : "rgba(185,28,28,0.4)",
    }));
    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volData);
  }, []);

  // Apply chart scaling options on timeframe/instrument change (Goal 1 Task 4)
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        rightPriceScale: {
          scaleMargins: { top: 0.08, bottom: 0.15 },
        },
        timeScale: {
          rightOffset: 8,
          barSpacing: 8,
          minBarSpacing: 3,
          fixLeftEdge: false,
          fixRightEdge: false,
          lockVisibleTimeRangeOnResize: true,
        },
      });
    }
  }, [instrument, timeframe]);

  // ── Historical candles + WebSocket updates (NON-REPLAY) ────────────────────
  useEffect(() => {
    if (mode !== "interactive" || replayMode) return;
    let cancelled = false;
    setIsLoading(true);

    const applyCandle = (c: Candle) => {
      candleSeriesRef.current?.update({
        time: c.time as UTCTimestamp,
        open: c.open, high: c.high, low: c.low, close: c.close,
      });
      volumeSeriesRef.current?.update({
        time: c.time as UTCTimestamp, value: c.volume,
        color: c.close >= c.open ? "rgba(16,185,129,0.4)" : "rgba(185,28,28,0.4)",
      });
    };

    (async () => {
      const candles = await api.candles(instrument, timeframe, 500);
      if (cancelled || !candles) return;
      candlesRef.current = candles;
      applyAllData(candles);

      // Default OHLC legend value
      if (candles.length) {
        const last = candles[candles.length - 1];
        setOhlc({
          time: new Date(last.time * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }),
          o: last.open, h: last.high, l: last.low, c: last.close,
          v: last.volume, up: last.close >= last.open,
        });
      }

      chartRef.current?.timeScale().fitContent();
      setIsLoading(false);
    })();

    // Scroll-back: fetch older candles when near left edge (Goal 1 Task 3)
    const chart = chartRef.current;
    let rangeHandler: (() => void) | null = null;
    if (chart) {
      rangeHandler = () => {
        const range = chart.timeScale().getVisibleLogicalRange();
        if (!range || range.from > 10 || isLoadingMoreRef.current) return;
        isLoadingMoreRef.current = true;
        const arr = candlesRef.current;
        if (!arr.length) { isLoadingMoreRef.current = false; return; }
        const oldest = arr[0].time;
        api.candles(instrument, timeframe, 200, oldest).then((older) => {
          if (older && older.length > 0) {
            const existing = new Set(arr.map((c) => c.time));
            const fresh = older.filter((c) => !existing.has(c.time));
            if (fresh.length > 0) {
              const merged = [...fresh, ...arr];
              candlesRef.current = merged;
              applyAllData(merged);
            }
          }
          isLoadingMoreRef.current = false;
        }).catch(() => { isLoadingMoreRef.current = false; });
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler);
    }

    const ws = new WebSocket(`${WS_BASE}/ws/candles/${instrument}?timeframe=${timeframe}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "new_candle" || msg.type === "update_candle") {
          applyCandle(msg.candle);
          const arr = candlesRef.current;
          if (arr.length && arr[arr.length - 1].time === msg.candle.time) arr[arr.length - 1] = msg.candle;
          else arr.push(msg.candle);
          
          setCandleVersion(v => v + 1);

          // Update default OHLC legend to latest candle if crosshair is idle
          setOhlc({
            time: new Date(msg.candle.time * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }),
            o: msg.candle.open, h: msg.candle.high, l: msg.candle.low, c: msg.candle.close,
            v: msg.candle.volume, up: msg.candle.close >= msg.candle.open,
          });
        }
      } catch {
        /* ignore */
      }
    };

    return () => {
      cancelled = true;
      ws.close();
      if (chart && rangeHandler) {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler);
      }
    };
  }, [mode, instrument, timeframe, replayMode, applyAllData]);

  // ── Render dynamic trend overlay indicators (Goal 3) ─────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (mode !== "interactive" || !chart || isLoading) return;

    for (const s of indicatorSeriesRef.current) {
      try {
        chart.removeSeries(s);
      } catch {}
    }
    indicatorSeriesRef.current = [];

    const activeCandles = replayMode ? replayCandles.slice(0, replayCursor + 1) : candlesRef.current;
    if (!activeCandles.length) return;

    indicatorConfigs.forEach((c) => {
      if (!c.enabled) return;

      if (c.type === "EMA") {
        const data = ema(activeCandles, c.period || 20);
        if (data.length) {
          const s = chart.addSeries(LineSeries, {
            color: c.color,
            lineWidth: c.lineWidth as any,
            priceLineVisible: false,
            lastValueVisible: true,
            title: c.name,
          });
          s.setData(data.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
          indicatorSeriesRef.current.push(s);
        }
      } else if (c.type === "SMA") {
        const data = sma(activeCandles, c.period || 200);
        if (data.length) {
          const s = chart.addSeries(LineSeries, {
            color: c.color,
            lineWidth: c.lineWidth as any,
            priceLineVisible: false,
            lastValueVisible: true,
            title: c.name,
          });
          s.setData(data.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
          indicatorSeriesRef.current.push(s);
        }
      } else if (c.type === "VWAP") {
        const data = vwap(activeCandles);
        if (data.length) {
          const s = chart.addSeries(LineSeries, {
            color: c.color,
            lineWidth: c.lineWidth as any,
            priceLineVisible: false,
            lastValueVisible: true,
            title: c.name,
          });
          s.setData(data.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
          indicatorSeriesRef.current.push(s);
        }
      } else if (c.type === "BB") {
        const bbVal = bollinger(activeCandles, c.period || 20, c.period2 || 2.0);
        if (bbVal.mid.length) {
          const midS = chart.addSeries(LineSeries, { color: c.color, lineWidth: c.lineWidth as any, priceLineVisible: false, title: "BB Mid" });
          const upperS = chart.addSeries(LineSeries, { color: "rgba(148,163,184,0.4)", lineWidth: 1 as any, priceLineVisible: false, lineStyle: LineStyle.Dashed });
          const lowerS = chart.addSeries(LineSeries, { color: "rgba(148,163,184,0.4)", lineWidth: 1 as any, priceLineVisible: false, lineStyle: LineStyle.Dashed });
          
          midS.setData(bbVal.mid.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
          upperS.setData(bbVal.upper.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
          lowerS.setData(bbVal.lower.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
          
          indicatorSeriesRef.current.push(midS, upperS, lowerS);
        }
      }
    });
  }, [mode, indicatorConfigs, isLoading, replayMode, replayCursor, replayCandles, candleVersion]);

  // ── Sub-charts lifecycle & updates for oscillators (Goal 3 Section 2) ──────
  // RSI Sub-chart lifecycle
  useEffect(() => {
    const isEnabled = indicatorConfigs.find((c) => c.id === "rsi")?.enabled;
    if (!isEnabled || !rsiContainerRef.current || !chartRef.current) {
      if (rsiChartRef.current) {
        rsiChartRef.current.remove();
        rsiChartRef.current = null;
        rsiSeriesRef.current = null;
      }
      return;
    }

    if (!rsiChartRef.current) {
      const rsiChart = createChart(rsiContainerRef.current, {
        height: 80,
        layout: chartRef.current.options().layout,
        grid: chartRef.current.options().grid,
        crosshair: chartRef.current.options().crosshair,
        timeScale: { visible: false },
      });
      const rsiConf = indicatorConfigs.find((c) => c.id === "rsi")!;
      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color: rsiConf.color,
        lineWidth: rsiConf.lineWidth as any,
        priceLineVisible: false,
        lastValueVisible: true,
      });

      rsiSeries.createPriceLine({ price: 70, color: "rgba(239, 68, 68, 0.4)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true });
      rsiSeries.createPriceLine({ price: 30, color: "rgba(16, 185, 129, 0.4)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true });

      rsiChartRef.current = rsiChart;
      rsiSeriesRef.current = rsiSeries;

      // Sync timescale
      const mainTimeScale = chartRef.current.timeScale();
      const subTimeScale = rsiChart.timeScale();
      mainTimeScale.subscribeVisibleLogicalRangeChange((range) => {
        if (range) subTimeScale.setVisibleLogicalRange(range);
      });
    }
  }, [indicatorConfigs, chartRef.current]);

  // MACD Sub-chart lifecycle
  useEffect(() => {
    const isEnabled = indicatorConfigs.find((c) => c.id === "macd")?.enabled;
    if (!isEnabled || !macdContainerRef.current || !chartRef.current) {
      if (macdChartRef.current) {
        macdChartRef.current.remove();
        macdChartRef.current = null;
        macdMacdSeriesRef.current = null;
        macdSignalSeriesRef.current = null;
        macdHistSeriesRef.current = null;
      }
      return;
    }

    if (!macdChartRef.current) {
      const macdChart = createChart(macdContainerRef.current, {
        height: 80,
        layout: chartRef.current.options().layout,
        grid: chartRef.current.options().grid,
        crosshair: chartRef.current.options().crosshair,
        timeScale: { visible: false },
      });
      const macdConf = indicatorConfigs.find((c) => c.id === "macd")!;
      const macdSeries = macdChart.addSeries(LineSeries, {
        color: macdConf.color,
        lineWidth: macdConf.lineWidth as any,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      const signalSeries = macdChart.addSeries(LineSeries, {
        color: "#f97316",
        lineWidth: macdConf.lineWidth as any,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      const histSeries = macdChart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceLineVisible: false,
      });

      macdChartRef.current = macdChart;
      macdMacdSeriesRef.current = macdSeries;
      macdSignalSeriesRef.current = signalSeries;
      macdHistSeriesRef.current = histSeries;

      const mainTimeScale = chartRef.current.timeScale();
      const subTimeScale = macdChart.timeScale();
      mainTimeScale.subscribeVisibleLogicalRangeChange((range) => {
        if (range) subTimeScale.setVisibleLogicalRange(range);
      });
    }
  }, [indicatorConfigs, chartRef.current]);

  // ATR Sub-chart lifecycle
  useEffect(() => {
    const isEnabled = indicatorConfigs.find((c) => c.id === "atr")?.enabled;
    if (!isEnabled || !atrContainerRef.current || !chartRef.current) {
      if (atrChartRef.current) {
        atrChartRef.current.remove();
        atrChartRef.current = null;
        atrSeriesRef.current = null;
      }
      return;
    }

    if (!atrChartRef.current) {
      const atrChart = createChart(atrContainerRef.current, {
        height: 80,
        layout: chartRef.current.options().layout,
        grid: chartRef.current.options().grid,
        crosshair: chartRef.current.options().crosshair,
        timeScale: { visible: false },
      });
      const atrConf = indicatorConfigs.find((c) => c.id === "atr")!;
      const atrSeries = atrChart.addSeries(LineSeries, {
        color: atrConf.color,
        lineWidth: atrConf.lineWidth as any,
        priceLineVisible: false,
        lastValueVisible: true,
      });

      atrChartRef.current = atrChart;
      atrSeriesRef.current = atrSeries;

      const mainTimeScale = chartRef.current.timeScale();
      const subTimeScale = atrChart.timeScale();
      mainTimeScale.subscribeVisibleLogicalRangeChange((range) => {
        if (range) subTimeScale.setVisibleLogicalRange(range);
      });
    }
  }, [indicatorConfigs, chartRef.current]);

  // Update Oscillator Sub-Charts Data
  useEffect(() => {
    if (isLoading) return;
    const activeCandles = replayMode ? replayCandles.slice(0, replayCursor + 1) : candlesRef.current;
    if (!activeCandles.length) return;

    // RSI Data
    if (rsiSeriesRef.current) {
      const rsiConf = indicatorConfigs.find((c) => c.id === "rsi")!;
      const rsiVal = rsi(activeCandles, rsiConf.period || 14);
      rsiSeriesRef.current.setData(rsiVal.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
    }

    // MACD Data
    if (macdMacdSeriesRef.current && macdSignalSeriesRef.current && macdHistSeriesRef.current) {
      const macdConf = indicatorConfigs.find((c) => c.id === "macd")!;
      const macdVal = macd(activeCandles, macdConf.period || 12, macdConf.period2 || 26, macdConf.period3 || 9);
      macdMacdSeriesRef.current.setData(macdVal.macd.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
      macdSignalSeriesRef.current.setData(macdVal.signal.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
      macdHistSeriesRef.current.setData(macdVal.histogram.map(d => ({ time: d.time as UTCTimestamp, value: d.value, color: d.color })));
    }

    // ATR Data
    if (atrSeriesRef.current) {
      const atrConf = indicatorConfigs.find((c) => c.id === "atr")!;
      const atrVal = atr(activeCandles, atrConf.period || 14);
      atrSeriesRef.current.setData(atrVal.map(d => ({ time: d.time as UTCTimestamp, value: d.value })));
    }
  }, [indicatorConfigs, replayMode, replayCursor, replayCandles, isLoading, candleVersion]);

  // ── Annotation price lines + Key Levels Rendering (Goal 4 & Position) ──────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (mode !== "interactive" || !series || replayMode) return;

    for (const line of priceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {}
    }
    priceLinesRef.current = [];

    // 1. Draw Position levels & SMC levels
    for (const level of extractLevels(smc ?? null, managedState, timeframe, indicatorConfigs)) {
      try {
        const line = series.createPriceLine({
          price: level.price, color: level.color, lineWidth: 1,
          lineStyle: level.style, axisLabelVisible: level.title !== "", title: level.title,
        });
        priceLinesRef.current.push(line);
      } catch {}
    }

    // 2. Draw computed key levels (Goal 4)
    for (const kl of keyLevels) {
      try {
        const line = series.createPriceLine({
          price: kl.price,
          color: kl.color,
          lineWidth: kl.width as any,
          lineStyle:
            kl.style === "dashed"
              ? LineStyle.Dashed
              : kl.style === "dotted"
              ? LineStyle.Dotted
              : LineStyle.Solid,
          axisLabelVisible: true,
          title: kl.label,
        });
        priceLinesRef.current.push(line);
      } catch {}
    }
  }, [mode, smc, managedState, indicatorConfigs, timeframe, keyLevels, isLoading, replayMode]);

  // ── Replay controls (Goal 12) ──────────────────────────────────────────────
  const enterReplay = async () => {
    if (!replayDate) return;
    const endTs = Math.floor(new Date(replayDate + "T23:59:59Z").getTime() / 1000);
    const candles = await api.candles(instrument, timeframe, 500, endTs);
    if (!candles || !candles.length) return;
    setReplayCandles(candles);
    setReplayCursor(0);
    setReplayMode(true);
    setReplayAnalysis(null);
    setMarkedEntries([]);
    setShowReplayPicker(false);
    
    // Show just first candle
    applyAllData(candles.slice(0, 1));
  };

  const exitReplay = () => {
    setReplayMode(false);
    setReplayPlaying(false);
    setReplayAnalysis(null);
    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    if (replayMarkersRef.current) {
      replayMarkersRef.current.detach();
      replayMarkersRef.current = null;
    }
    // Reload live data
    setIsLoading(true);
  };

  const stepReplay = useCallback((delta: number) => {
    setReplayCursor((prev) => {
      const next = Math.max(0, Math.min(replayCandles.length - 1, prev + delta));
      applyAllData(replayCandles.slice(0, next + 1));
      return next;
    });
  }, [replayCandles, applyAllData]);

  // Auto-play
  useEffect(() => {
    if (replayTimerRef.current) clearInterval(replayTimerRef.current);
    if (!replayPlaying || !replayMode) return;
    const ms = replaySpeed === 1 ? 300 : 60;
    replayTimerRef.current = setInterval(() => {
      setReplayCursor((prev) => {
        if (prev >= replayCandles.length - 1) {
          setReplayPlaying(false);
          return prev;
        }
        const next = prev + 1;
        applyAllData(replayCandles.slice(0, next + 1));
        return next;
      });
    }, ms);
    return () => { if (replayTimerRef.current) clearInterval(replayTimerRef.current); };
  }, [replayPlaying, replayMode, replaySpeed, replayCandles, applyAllData]);

  const analyseCurrentBar = async () => {
    const currentCandles = replayCandles.slice(0, replayCursor + 1);
    try {
      const res = await fetch(`${API_BASE}/api/replay/analyse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candles: currentCandles, instrument }),
      });
      if (res.ok) setReplayAnalysis(await res.json());
    } catch { /* ignore */ }
  };

  const markEntry = (direction: "long" | "short") => {
    const candle = replayCandles[replayCursor];
    if (!candle) return;
    setMarkedEntries((prev) => [...prev, { time: candle.time, price: candle.close, direction }]);
    
    // Add arrow markers to candle series using the new plugin API
    const nextMarkers = [
      ...markedEntries.map((e) => ({
        time: e.time as UTCTimestamp,
        position: e.direction === "long" ? "belowBar" as const : "aboveBar" as const,
        color: e.direction === "long" ? "#22c55e" : "#ef4444",
        shape: e.direction === "long" ? "arrowUp" as const : "arrowDown" as const,
        text: e.direction === "long" ? "L" : "S",
      })),
      {
        time: candle.time as UTCTimestamp,
        position: direction === "long" ? "belowBar" as const : "aboveBar" as const,
        color: direction === "long" ? "#22c55e" : "#ef4444",
        shape: direction === "long" ? "arrowUp" as const : "arrowDown" as const,
        text: direction === "long" ? "L" : "S",
      },
    ];

    if (replayMarkersRef.current) {
      replayMarkersRef.current.setMarkers(nextMarkers);
    } else if (candleSeriesRef.current) {
      replayMarkersRef.current = createSeriesMarkers(candleSeriesRef.current, nextMarkers);
    }
  };

  const replayOutcomes = useMemo(() => {
    if (!replayMode || !markedEntries.length) return null;
    let wins = 0, losses = 0;
    for (const entry of markedEntries) {
      const afterIdx = replayCandles.findIndex((c) => c.time === entry.time);
      if (afterIdx < 0 || afterIdx >= replayCandles.length - 1) continue;
      const last = replayCandles[Math.min(afterIdx + 20, replayCandles.length - 1)];
      const pnl = entry.direction === "long" ? last.close - entry.price : entry.price - last.close;
      if (pnl > 0) wins++; else losses++;
    }
    return { wins, losses, total: markedEntries.length };
  }, [markedEntries, replayCandles, replayMode]);

  // Fullscreen change sync
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // TradingView-style keyboard shortcuts
  useEffect(() => {
    if (mode !== "interactive") return;
    const TOOL_KEYS: Record<string, DrawingToolType> = {
      Escape: "cursor",
      t: "trendline",
      h: "horizontal",
      v: "vertical",
      r: "ray",
      e: "extended",
      a: "arrow",
      p: "channel",
      f: "fibonacci",
      b: "rectangle",
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === "F11") { ev.preventDefault(); handleFullscreen(); return; }
      if (ev.key === "0") { ev.preventDefault(); handleResetChart(); return; }
      // Delete selected drawing
      if (ev.key === "Delete" || ev.key === "Backspace") {
        const mgr = drawingManagerRef.current;
        if (mgr) {
          const sel = mgr.getSelectedDrawing();
          if (sel) { mgr.removeDrawing(sel.id); return; }
        }
      }
      const tool = TOOL_KEYS[ev.key];
      if (tool) { ev.preventDefault(); handleToolSelect(tool); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div ref={chartWrapperRef} className="glass-card overflow-hidden relative flex flex-col">
      {/* ── Stats Bar (GOAL 1 & 2) ─────────────────────────────────────────── */}
      {!replayMode && <StatsBar instrument={instrument} />}

      {/* ── Chart Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--glass-border)] px-3 py-2 bg-black/10">
        <div className="flex flex-wrap items-center gap-1.5 pl-10">
          <span className="rounded-md bg-white/5 px-2 py-1 font-mono text-xs font-bold text-zinc-100">{instrument}</span>
          <div className="flex flex-wrap gap-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase",
                  timeframe === tf ? "bg-slate-100 text-slate-900" : "bg-white/5 text-slate-400 hover:text-slate-200"
                )}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowIndicatorsPanel(!showIndicatorsPanel)}
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-[10px] font-bold transition-all",
              showIndicatorsPanel ? "bg-blue-500/20 text-blue-300 border border-blue-500/20" : "bg-white/5 text-slate-400 border border-transparent hover:text-slate-200"
            )}
          >
            📊 Indicators
          </button>
          {!replayMode ? (
            <button
              onClick={() => setShowReplayPicker(!showReplayPicker)}
              className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-400 border border-transparent hover:text-slate-200"
            >
              ⏮ Replay
            </button>
          ) : (
            <button
              onClick={exitReplay}
              className="rounded-full bg-red-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-red-300 border border-red-500/25 hover:bg-red-500/30"
            >
              ✕ Exit Replay
            </button>
          )}
          <button
            onClick={handleResetChart}
            title="Fit all candles (0)"
            className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-400 border border-transparent hover:text-slate-200"
          >
            ⊡ Reset
          </button>
          <button
            onClick={handleFullscreen}
            title={isFullscreen ? "Exit fullscreen (F11)" : "Fullscreen (F11)"}
            className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-400 border border-transparent hover:text-slate-200"
          >
            {isFullscreen ? "⊠ Exit" : "⛶ Full"}
          </button>
          <button
            onClick={() => {
              setMode(mode === "interactive" ? "ai_view" : "interactive");
              setAiViewKey((k) => k + 1);
            }}
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-[10px] font-bold",
              mode === "ai_view" ? "bg-purple-500/20 text-purple-300 border border-purple-500/20" : "bg-white/5 text-slate-400 border border-transparent hover:text-slate-200"
            )}
          >
            {mode === "ai_view" ? "👁 AI VIEW" : "INTERACTIVE"}
          </button>
        </div>
      </div>

      {/* ── Replay date picker ─────────────────────────────────────────────── */}
      {showReplayPicker && !replayMode && (
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] bg-black/30 px-3 py-2 font-mono text-xs pl-12">
          <span className="text-slate-400">Replay to:</span>
          <input
            type="date"
            value={replayDate}
            onChange={(e) => setReplayDate(e.target.value)}
            className="rounded border border-white/10 bg-black/50 px-2 py-1 text-xs text-zinc-100"
          />
          <button
            onClick={enterReplay}
            disabled={!replayDate}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Load
          </button>
          <button onClick={() => setShowReplayPicker(false)} className="text-slate-500 hover:text-slate-300">✕</button>
        </div>
      )}

      {/* ── Replay controls (Goal 12) ──────────────────────────────────────── */}
      {replayMode && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--glass-border)] bg-black/30 px-3 py-2 font-mono text-[11px] pl-12">
          <button onClick={() => { setReplayCursor(0); applyAllData(replayCandles.slice(0, 1)); }} className="rounded bg-white/5 px-2 py-1 text-slate-300 hover:bg-white/10">⏮ Start</button>
          <button onClick={() => stepReplay(-1)} className="rounded bg-white/5 px-2 py-1 text-slate-300 hover:bg-white/10">◀ Prev</button>
          <button onClick={() => stepReplay(1)} className="rounded bg-white/5 px-2 py-1 text-slate-300 hover:bg-white/10">▶ Next</button>
          <button onClick={() => stepReplay(10)} className="rounded bg-white/5 px-2 py-1 text-slate-300 hover:bg-white/10">⏭ +10</button>
          <span className="text-slate-600">|</span>
          <button
            onClick={() => { setReplaySpeed(1); setReplayPlaying(!replayPlaying); }}
            className={cn("rounded px-2 py-1", replayPlaying && replaySpeed === 1 ? "bg-blue-600/30 text-blue-300" : "bg-white/5 text-slate-300 hover:bg-white/10")}
          >
            {replayPlaying && replaySpeed === 1 ? "⏸ Pause" : "▶▶ 1x"}
          </button>
          <button
            onClick={() => { setReplaySpeed(5); setReplayPlaying(!replayPlaying); }}
            className={cn("rounded px-2 py-1", replayPlaying && replaySpeed === 5 ? "bg-blue-600/30 text-blue-300" : "bg-white/5 text-slate-300 hover:bg-white/10")}
          >
            ▶▶ 5x
          </button>
          <span className="text-slate-600">|</span>
          <button onClick={analyseCurrentBar} className="rounded bg-purple-600/20 px-2 py-1 text-purple-300 hover:bg-purple-600/30">📐 Analyse</button>
          <button onClick={() => markEntry("long")} className="rounded bg-emerald-600/20 px-2 py-1 text-emerald-300 hover:bg-emerald-600/30">📍 Long</button>
          <button onClick={() => markEntry("short")} className="rounded bg-red-600/20 px-2 py-1 text-red-300 hover:bg-red-600/30">📍 Short</button>
          <span className="ml-auto text-slate-500">
            {replayCandles[replayCursor] ? new Date(replayCandles[replayCursor].time * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }) : ""}
            {" "}(candle {replayCursor + 1} of {replayCandles.length})
          </span>
        </div>
      )}

      {/* ── Replay outcomes ────────────────────────────────────────────────── */}
      {replayMode && replayOutcomes && replayOutcomes.total > 0 && (
        <div className="flex items-center gap-3 border-b border-[var(--glass-border)] bg-black/20 px-3 py-1 font-mono text-[10px] pl-12">
          <span className="text-slate-400">Entries: {replayOutcomes.total}</span>
          <span className="text-emerald-400 font-bold">W: {replayOutcomes.wins}</span>
          <span className="text-red-400 font-bold">L: {replayOutcomes.losses}</span>
        </div>
      )}

      {/* ── Sidebar and Chart Core ────────────────────────────────────────── */}
      <div className="relative flex-1 flex">
        {mode === "interactive" && (
          <DrawingToolbar
            activeTool={activeDrawingTool}
            onToolSelect={handleToolSelect}
            onClearAll={handleClearAllDrawings}
          />
        )}

        <div className="flex-1 relative flex flex-col pl-10 min-w-0">
          {mode === "interactive" ? (
            <div className="flex-1 flex flex-col relative min-h-[380px]">
              {isLoading && !replayMode && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/60 font-mono text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="animate-pulse">Loading {timeframe} candles...</span>
                  </div>
                </div>
              )}

              {/* Permanent OHLC display overlay (Goal 1 Task 1) */}
              {ohlc && (
                <div className="pointer-events-none absolute left-3 top-2.5 z-10 font-mono text-[10px] leading-relaxed bg-zinc-950/80 px-2 py-1 rounded border border-zinc-800/50 backdrop-blur-sm">
                  <div className="text-zinc-500 mb-0.5">{ohlc.time} IST</div>
                  <div className="text-zinc-400 flex flex-wrap gap-x-2">
                    <span>O: <span className="text-zinc-100">{ohlc.o.toLocaleString()}</span></span>
                    <span>H: <span className="text-emerald-400">{ohlc.h.toLocaleString()}</span></span>
                    <span>L: <span className="text-red-400">{ohlc.l.toLocaleString()}</span></span>
                    <span>C: <span className={ohlc.up ? "text-emerald-400" : "text-red-400"}>{ohlc.c.toLocaleString()}</span></span>
                    <span>V: <span className="text-zinc-200">{(ohlc.v / 1000).toFixed(1)}K</span></span>
                  </div>
                </div>
              )}

              {/* Main Candlestick Chart */}
              <div ref={containerRef} className="flex-1" style={{ height }} />

              {/* Sub-Panes stack (RSI, MACD, ATR) (Goal 3 Task 3) */}
              <div className="flex flex-col border-t border-zinc-900 bg-black/10">
                {indicatorConfigs.find((c) => c.id === "rsi")?.enabled && (
                  <div className="relative border-b border-zinc-900 last:border-0">
                    <div className="absolute left-3 top-1 pointer-events-none z-10 font-mono text-[9px] text-zinc-500">RSI 14</div>
                    <div ref={rsiContainerRef} className="h-[75px]" />
                  </div>
                )}
                {indicatorConfigs.find((c) => c.id === "macd")?.enabled && (
                  <div className="relative border-b border-zinc-900 last:border-0">
                    <div className="absolute left-3 top-1 pointer-events-none z-10 font-mono text-[9px] text-zinc-500">MACD (12, 26, 9)</div>
                    <div ref={macdContainerRef} className="h-[75px]" />
                  </div>
                )}
                {indicatorConfigs.find((c) => c.id === "atr")?.enabled && (
                  <div className="relative border-b border-zinc-900 last:border-0">
                    <div className="absolute left-3 top-1 pointer-events-none z-10 font-mono text-[9px] text-zinc-500">ATR 14</div>
                    <div ref={atrContainerRef} className="h-[75px]" />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={aiViewKey}
                src={`${API_BASE}/api/chart/live/${instrument}/${timeframe}?t=${aiViewKey}`}
                alt="AI annotated chart"
                className="w-full"
                style={{ height, objectFit: "contain" }}
              />
              <div className="absolute right-2 top-2 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-slate-400">
                AI VIEW · the AI&apos;s exact perspective
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Context Menu (Goal 2 Task 3) ───────────────────────────────────── */}
      {contextMenu && (
        <DrawingContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          drawing={contextMenu.drawing}
          onClose={() => setContextMenu(null)}
          onUpdate={handleDrawingUpdate}
          onDelete={handleDrawingDelete}
        />
      )}

      {/* ── Indicators sliding panel (Goal 3 Task 2) ───────────────────────── */}
      <IndicatorsPanel
        isOpen={showIndicatorsPanel}
        onClose={() => setShowIndicatorsPanel(false)}
        configs={indicatorConfigs}
        onUpdate={handleIndicatorsUpdate}
      />

      {/* ── Replay analysis side panel ─────────────────────────────────────── */}
      {replayMode && replayAnalysis && (
        <div className="max-h-64 overflow-y-auto border-t border-[var(--glass-border)] bg-black/40 p-3 font-mono text-[11px] pl-12 flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1">
            <span className="font-bold text-purple-300">SMC Analysis at Bar {replayCursor + 1}</span>
            <button onClick={() => setReplayAnalysis(null)} className="text-zinc-500 hover:text-zinc-300">✕ Close</button>
          </div>
          {replayAnalysis.structures && Object.entries(replayAnalysis.structures as Record<string, any>).map(([tf, s]: [string, any]) => (
            <div key={tf} className="text-slate-400">
              {tf}: <span className={s.trend === "BULLISH" ? "text-emerald-400 font-bold" : s.trend === "BEARISH" ? "text-red-400 font-bold" : "text-slate-500 font-bold"}>{s.trend}</span>
              {s.last_bos && <span className="ml-2 text-blue-400">BOS {s.last_bos.type}</span>}
              {s.last_choch && <span className="ml-2 text-amber-400">CHoCH {s.last_choch.type}</span>}
            </div>
          ))}
          {replayAnalysis.raw_score_pre_boardroom && (
            <div className="text-slate-300">
              SMC Score: <span className="font-bold text-amber-300">{replayAnalysis.raw_score_pre_boardroom.score}/9</span>
            </div>
          )}
          {replayAnalysis.context_text && (
            <div className="mt-1.5 pt-1.5 border-t border-zinc-800/60">
              <span className="font-bold text-zinc-300 block mb-1">Boardroom Decision Context:</span>
              <pre className="text-[10px] text-zinc-400 bg-black/30 p-2 rounded max-h-36 overflow-y-auto font-mono whitespace-pre-wrap leading-relaxed">
                {replayAnalysis.context_text}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
