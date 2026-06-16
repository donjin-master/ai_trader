"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Instruments with live snapshot/candle support on the backend today
// (see backend/deps.py INSTRUMENT_MAP + perception/snapshot.py).
// Others can be added here once the engine/exchange feed supports them —
// they're intentionally left out of the selector rather than shown broken.
export interface InstrumentDef {
  symbol: string;       // backend/API symbol, e.g. "BTCUSD"
  label: string;        // display label, e.g. "BTC/USDT"
  tvSymbol: string;     // TradingView widget symbol
  color: string;        // brand accent color for the icon chip
  glyph: string;        // single-character glyph shown in the icon chip
}

export const INSTRUMENTS: InstrumentDef[] = [
  { symbol: "BTCUSD", label: "BTC/USDT", tvSymbol: "DELTAIN:BTCUSD.P", color: "#f7931a", glyph: "B" },
  { symbol: "ETHUSD", label: "ETH/USDT", tvSymbol: "DELTAIN:ETHUSD.P", color: "#627eea", glyph: "E" },
];

const STORAGE_KEY = "ai-trader-selected-instrument";

interface InstrumentContextValue {
  instrument: InstrumentDef;
  setInstrumentSymbol: (symbol: string) => void;
  instruments: InstrumentDef[];
}

const InstrumentContext = createContext<InstrumentContextValue | null>(null);

export function InstrumentProvider({ children }: { children: React.ReactNode }) {
  const [symbol, setSymbol] = useState<string>(INSTRUMENTS[0].symbol);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (saved && INSTRUMENTS.some((i) => i.symbol === saved)) {
      setSymbol(saved);
    }
  }, []);

  const setInstrumentSymbol = (next: string) => {
    if (!INSTRUMENTS.some((i) => i.symbol === next)) return;
    setSymbol(next);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo<InstrumentContextValue>(() => ({
    instrument: INSTRUMENTS.find((i) => i.symbol === symbol) ?? INSTRUMENTS[0],
    setInstrumentSymbol,
    instruments: INSTRUMENTS,
  }), [symbol]);

  return <InstrumentContext.Provider value={value}>{children}</InstrumentContext.Provider>;
}

export function useInstrument(): InstrumentContextValue {
  const ctx = useContext(InstrumentContext);
  if (!ctx) throw new Error("useInstrument must be used within an InstrumentProvider");
  return ctx;
}
