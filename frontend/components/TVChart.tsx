"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { Maximize2 } from "lucide-react";

const AdvancedRealTimeChart = dynamic(
  () => import("react-ts-tradingview-widgets").then((m) => m.AdvancedRealTimeChart),
  { ssr: false }
);

interface TVChartProps {
  symbol?: string;
  height?: number;
  interval?: "1" | "3" | "5" | "15" | "30" | "60" | "120" | "240" | "D" | "W";
}

export default function TVChart({
  symbol = "DELTAIN:BTCUSD.P",
  height = 500,
  interval = "15",
}: TVChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  function toggleFullscreen() {
    const el = wrapperRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  return (
    <div
      ref={wrapperRef}
      style={{ position: "relative", height, width: "100%", borderRadius: 12, overflow: "hidden" }}
    >
      <AdvancedRealTimeChart
        symbol={symbol}
        interval={interval}
        theme="dark"
        autosize
        timezone="Asia/Kolkata"
        locale="en"
        style="1"
        withdateranges
        allow_symbol_change={false}
        hide_side_toolbar={false}
        enable_publishing={false}
        save_image
        container_id={`tv_chart_${symbol.replace(/[^a-z0-9]/gi, "_")}`}
        backgroundColor="#0d0f14"
        copyrightStyles={{ parent: { display: "none" } }}
      />
      <button
        type="button"
        onClick={toggleFullscreen}
        title="Fullscreen"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 10,
          background: "rgba(13,15,20,0.75)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6,
          padding: "5px 7px",
          cursor: "pointer",
          color: "#a1a1aa",
          display: "flex",
          alignItems: "center",
          backdropFilter: "blur(4px)",
        }}
      >
        <Maximize2 size={14} />
      </button>
    </div>
  );
}
