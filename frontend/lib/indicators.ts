import type { Candle } from "@/lib/api";

export interface LinePoint {
  time: number;
  value: number;
}

export function ema(candles: Candle[], period: number): LinePoint[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: LinePoint[] = [];
  let prev = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period;
  out.push({ time: candles[period - 1].time, value: +prev.toFixed(2) });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: +prev.toFixed(2) });
  }
  return out;
}

export function sma(candles: Candle[], period: number): LinePoint[] {
  if (candles.length < period) return [];
  const out: LinePoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    out.push({
      time: candles[i].time,
      value: +(slice.reduce((s, c) => s + c.close, 0) / period).toFixed(2),
    });
  }
  return out;
}

export function rsi(candles: Candle[], period = 14): LinePoint[] {
  if (candles.length <= period) return [];
  const out: LinePoint[] = [];
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  gain /= period;
  loss /= period;
  out.push({ time: candles[period].time, value: +(100 - 100 / (1 + gain / (loss || 1e-9))).toFixed(2) });
  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    gain = (gain * (period - 1) + Math.max(diff, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-diff, 0)) / period;
    out.push({ time: candles[i].time, value: +(100 - 100 / (1 + gain / (loss || 1e-9))).toFixed(2) });
  }
  return out;
}

export function bollinger(candles: Candle[], period = 20, mult = 2): {
  upper: LinePoint[];
  lower: LinePoint[];
  mid: LinePoint[];
} {
  const upper: LinePoint[] = [];
  const lower: LinePoint[] = [];
  const mid: LinePoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const m = slice.reduce((s, c) => s + c.close, 0) / period;
    const variance = slice.reduce((s, c) => s + (c.close - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const t = candles[i].time;
    mid.push({ time: t, value: +m.toFixed(2) });
    upper.push({ time: t, value: +(m + mult * sd).toFixed(2) });
    lower.push({ time: t, value: +(m - mult * sd).toFixed(2) });
  }
  return { upper, lower, mid };
}

export function atr(candles: Candle[], period = 14): LinePoint[] {
  if (candles.length < 2) return [];
  const trCandles: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    let tr = candles[i].high - candles[i].low;
    if (i > 0) {
      const prevClose = candles[i - 1].close;
      tr = Math.max(
        tr,
        Math.abs(candles[i].high - prevClose),
        Math.abs(candles[i].low - prevClose)
      );
    }
    trCandles.push({
      time: candles[i].time,
      open: tr,
      high: tr,
      low: tr,
      close: tr,
      volume: 0,
    });
  }
  return ema(trCandles, period);
}

export function vwap(candles: Candle[]): LinePoint[] {
  if (candles.length === 0) return [];
  const out: LinePoint[] = [];
  let cumPv = 0;
  let cumVol = 0;
  let prevDateStr = "";
  for (const c of candles) {
    const date = new Date(c.time * 1000);
    const currentDateStr = date.toDateString();
    if (currentDateStr !== prevDateStr) {
      cumPv = 0;
      cumVol = 0;
      prevDateStr = currentDateStr;
    }
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPv += typicalPrice * c.volume;
    cumVol += c.volume;
    out.push({
      time: c.time,
      value: cumVol > 0 ? +(cumPv / cumVol).toFixed(2) : c.close,
    });
  }
  return out;
}

export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): {
  macd: LinePoint[];
  signal: LinePoint[];
  histogram: { time: number; value: number; color: string }[];
} {
  const emaFast = ema(candles, fast);
  const emaSlow = ema(candles, slow);

  const fastMap = new Map(emaFast.map((p) => [p.time, p.value]));
  const slowMap = new Map(emaSlow.map((p) => [p.time, p.value]));

  const macdPoints: LinePoint[] = [];
  const commonCandles: Candle[] = [];

  for (const c of candles) {
    const fVal = fastMap.get(c.time);
    const sVal = slowMap.get(c.time);
    if (fVal !== undefined && sVal !== undefined) {
      const macdVal = fVal - sVal;
      macdPoints.push({ time: c.time, value: macdVal });
      commonCandles.push({
        time: c.time,
        open: macdVal,
        high: macdVal,
        low: macdVal,
        close: macdVal,
        volume: 0,
      });
    }
  }

  const signalPoints = ema(commonCandles, signalPeriod);
  const signalMap = new Map(signalPoints.map((p) => [p.time, p.value]));

  const macdOut: LinePoint[] = [];
  const signalOut: LinePoint[] = [];
  const histOut: { time: number; value: number; color: string }[] = [];

  for (const mp of macdPoints) {
    const sVal = signalMap.get(mp.time);
    if (sVal !== undefined) {
      macdOut.push(mp);
      signalOut.push({ time: mp.time, value: sVal });
      const hist = mp.value - sVal;
      histOut.push({
        time: mp.time,
        value: +hist.toFixed(2),
        color: hist >= 0 ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.5)",
      });
    }
  }

  return { macd: macdOut, signal: signalOut, histogram: histOut };
}
