"""Annotated candlestick chart images — AI vision input + visual decision memory."""

import asyncio
import base64
import os
import time
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import matplotlib

matplotlib.use("Agg")  # headless rendering, no GUI

import matplotlib.pyplot as plt
import mplfinance as mpf
import pandas as pd
from loguru import logger

CHART_DIR = "/tmp/charts"
MAX_LEVEL_ANNOTATIONS = 14  # keep the chart readable for the vision model

# Two threads: one active, one warm — keeps event loop unblocked
_chart_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="chart_gen")


class ChartGenerator:
    """Generates annotated candlestick chart images.

    Used as vision input for the Chair agent and stored with every
    decision so any trade can be replayed ("what the AI saw").
    """

    def _generate_chart_sync(
        self,
        instrument: str,
        timeframe: str,
        candles: list[dict],
        smc_analysis: dict | None,
        open_position: dict | None,
        decision: dict | None,
        output_size: tuple,
    ) -> dict:
        """Blocking chart generation — always run via ThreadPoolExecutor."""
        df = pd.DataFrame(candles).tail(80)
        df.index = pd.DatetimeIndex(pd.to_datetime(df["time"], unit="s"))
        df = df[["open", "high", "low", "close", "volume"]].astype(float)
        n = len(df)
        price_min, price_max = float(df["low"].min()), float(df["high"].max())
        pad = (price_max - price_min) * 0.25 or price_min * 0.01
        visible_lo, visible_hi = price_min - pad, price_max + pad

        def in_view(price: float | None) -> bool:
            return price is not None and visible_lo <= price <= visible_hi

        extra_plots: list = []
        annotations: list[tuple[int, float, str, str]] = []
        smc = smc_analysis or {}

        def add_level(price: float, color: str, style: str, width: float, alpha: float,
                      label: str | None = None) -> None:
            if not in_view(price) or len(annotations) >= MAX_LEVEL_ANNOTATIONS:
                return
            extra_plots.append(mpf.make_addplot(
                [price] * n, type="line", color=color, alpha=alpha,
                linestyle=style, width=width,
            ))
            if label:
                annotations.append((n - 1, price, label, color))

        # 1. ORDER BLOCKS (chart timeframe + 1h context)
        for tf in (timeframe.replace("m", "m"), "1h"):
            for ob in (smc.get("order_blocks", {}) or {}).get(tf, [])[:3]:
                if ob.get("mitigated"):
                    color, alpha = "#374151", 0.2
                else:
                    color = "#166534" if ob["type"] == "BULLISH" else "#7f1d1d"
                    alpha = 0.45
                label = f"{'B' if ob['type'] == 'BULLISH' else 'S'}-OB {tf}"
                add_level(ob["high"], color, "--", 0.8, alpha)
                add_level(ob["low"], color, "--", 0.8, alpha, label)

        # 2. FAIR VALUE GAPS (chart timeframe)
        for fvg in (smc.get("fvgs", {}) or {}).get(timeframe, [])[:3]:
            if fvg.get("filled"):
                continue
            color = "#16a34a" if fvg["type"] == "BULLISH" else "#dc2626"
            add_level(fvg["top"], color, ":", 1.0, 0.5)
            add_level(fvg["bottom"], color, ":", 1.0, 0.5, "FVG")

        # 3. LIQUIDITY LEVELS (1h)
        liquidity = (smc.get("liquidity", {}) or {}).get("1h", {})
        for liq in liquidity.get("buy_side_liquidity", [])[:2]:
            add_level(liq["price"], "#3b82f6", ":", 0.8, 0.5, f"LIQ {liq['type'][:6]}")
        for liq in liquidity.get("sell_side_liquidity", [])[:2]:
            add_level(liq["price"], "#a855f7", ":", 0.8, 0.5, f"LIQ {liq['type'][:6]}")

        # 4. OPEN POSITION LEVELS
        if open_position:
            add_level(open_position.get("entry_price"), "#ffffff", "-", 1.2, 0.9, "ENTRY")
            add_level(open_position.get("current_sl"), "#ef4444", "--", 1.2, 0.9, "SL")
            tp_colors = {"tp1": "#f59e0b", "tp2": "#22c55e", "tp3": "#4ade80"}
            for tp_key, tp_color in tp_colors.items():
                tp_price = open_position.get(tp_key)
                if tp_price:
                    hit = open_position.get(f"{tp_key}_hit", False)
                    add_level(
                        tp_price,
                        "#374151" if hit else tp_color,
                        "--", 1.0, 0.3 if hit else 0.7,
                        f"{tp_key.upper()}{' ✓' if hit else ''}",
                    )

        # 5. PROPOSED ENTRY (decision overlay, not yet executed)
        elif decision and decision.get("action") in ("long", "short"):
            current_price = float(df["close"].iloc[-1])
            direction = decision["action"]
            sl_offset = float(decision.get("stop_loss_offset_pct") or 0.8) / 100
            tp_offset = float(decision.get("take_profit_offset_pct") or 2.4) / 100
            if direction == "long":
                sl_price = current_price * (1 - sl_offset)
                tp_price = current_price * (1 + tp_offset)
            else:
                sl_price = current_price * (1 + sl_offset)
                tp_price = current_price * (1 - tp_offset)
            add_level(current_price, "#818cf8", "--", 1.2, 0.85, f"PROPOSED {direction.upper()}")
            add_level(sl_price, "#ef4444", "--", 1.0, 0.6, "PROPOSED SL")
            add_level(tp_price, "#22c55e", "--", 1.0, 0.6, "PROPOSED TP")

        # ── RENDER ─────────────────────────────────────────────────────
        mc = mpf.make_marketcolors(
            up="#22c55e", down="#ef4444",
            wick={"up": "#16a34a", "down": "#b91c1c"},
            volume={"up": "#16a34a", "down": "#b91c1c"},
            edge="none",
        )
        style = mpf.make_mpf_style(
            marketcolors=mc,
            base_mpl_style="dark_background",
            gridstyle=":",
            gridcolor="#27272a",
            gridaxis="both",
            facecolor="#09090b",
            edgecolor="#27272a",
            figcolor="#09090b",
            rc={
                "axes.labelcolor": "#a1a1aa",
                "xtick.color": "#a1a1aa",
                "ytick.color": "#a1a1aa",
                "font.family": "monospace",
                "font.size": 8,
            },
        )

        fig, axes = mpf.plot(
            df,
            type="candle",
            style=style,
            volume=True,
            addplot=extra_plots if extra_plots else None,
            figsize=(output_size[0] / 100, output_size[1] / 100),
            returnfig=True,
            tight_layout=True,
        )

        ax = axes[0]
        for x_idx, y_price, label, color in annotations:
            ax.annotate(
                label,
                xy=(x_idx, y_price),
                xytext=(x_idx + 0.5, y_price),
                fontsize=7,
                color=color,
                fontfamily="monospace",
                alpha=0.95,
                ha="left",
                va="center",
            )

        verdict = (decision.get("action", "monitoring") if decision else "monitoring").upper()
        title_color = {"LONG": "#22c55e", "SHORT": "#ef4444"}.get(verdict, "#a1a1aa")
        timestamp_str = pd.Timestamp.now(tz="Asia/Kolkata").strftime("%d %b %Y %H:%M IST")
        ax.set_title(
            f"{instrument} · {timeframe.upper()} · {verdict} · {timestamp_str}",
            color=title_color, fontsize=9, fontfamily="monospace", loc="left", pad=8,
        )

        buf = BytesIO()
        fig.savefig(buf, format="png", dpi=100, bbox_inches="tight", facecolor="#09090b")
        plt.close(fig)
        buf.seek(0)
        image_bytes = buf.read()
        image_base64 = base64.b64encode(image_bytes).decode("utf-8")

        os.makedirs(CHART_DIR, exist_ok=True)
        path = f"{CHART_DIR}/{instrument}_{timeframe}_{int(time.time())}.png"
        with open(path, "wb") as f:
            f.write(image_bytes)

        logger.info(
            "Chart generated: {} {} ({} candles, {} annotations, {:.0f} KB)",
            instrument, timeframe, n, len(annotations), len(image_bytes) / 1024,
        )
        return {
            "image_base64": image_base64,
            "image_bytes": image_bytes,
            "image_path": path,
            "metadata": {
                "instrument": instrument,
                "timeframe": timeframe,
                "timestamp": timestamp_str,
                "annotations_count": len(annotations),
                "candles_shown": n,
            },
        }

    async def generate_decision_chart(
        self,
        instrument: str,
        timeframe: str,
        candles: list[dict],
        smc_analysis: dict | None,
        open_position: dict | None = None,
        decision: dict | None = None,
        output_size: tuple = (1200, 700),
    ) -> dict:
        """Async wrapper — offloads blocking mplfinance work to thread pool."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            _chart_executor,
            self._generate_chart_sync,
            instrument, timeframe, candles, smc_analysis,
            open_position, decision, output_size,
        )

    def _generate_notification_chart_sync(
        self,
        instrument: str,
        candles: list[dict],
        smc_analysis: dict | None,
        entry_price: float | None = None,
        sl_price: float | None = None,
        tp_prices: list[float] | None = None,
        trail_price: float | None = None,
    ) -> bytes:
        """Compact 800x400 chart for Telegram. Shows last 50 candles."""
        df = pd.DataFrame(candles).tail(50)
        df.index = pd.DatetimeIndex(pd.to_datetime(df["time"], unit="s"))
        df = df[["open", "high", "low", "close", "volume"]].astype(float)
        n = len(df)
        price_min, price_max = float(df["low"].min()), float(df["high"].max())
        pad = (price_max - price_min) * 0.15 or price_min * 0.005
        visible_lo, visible_hi = price_min - pad, price_max + pad

        def in_view(price: float | None) -> bool:
            return price is not None and visible_lo <= price <= visible_hi

        extra_plots = []
        annotations = []

        def add_level(price: float, color: str, style: str, width: float, alpha: float, label: str | None = None) -> None:
            if not in_view(price) or len(annotations) >= 8:
                return
            extra_plots.append(mpf.make_addplot(
                [price] * n, type="line", color=color, alpha=alpha,
                linestyle=style, width=width,
            ))
            if label:
                annotations.append((n - 1, price, label, color))

        # 1. SMC LEVELS — order blocks, liquidity, FVGs
        smc = smc_analysis or {}

        for ob in (smc.get("order_blocks", {}) or {}).get("15m", [])[:2]:
            if not ob.get("mitigated"):
                color = "#166534" if ob["type"] == "BULLISH" else "#7f1d1d"
                add_level(ob["high"], color, "--", 0.7, 0.45)
                add_level(ob["low"], color, "--", 0.7, 0.45,
                          f"{'B' if ob['type'] == 'BULLISH' else 'S'}-OB")

        for fvg in (smc.get("fvgs", {}) or {}).get("15m", [])[:2]:
            if not fvg.get("filled"):
                color = "#16a34a" if fvg["type"] == "BULLISH" else "#dc2626"
                add_level(fvg["top"], color, ":", 0.8, 0.4)
                add_level(fvg["bottom"], color, ":", 0.8, 0.4, "FVG")

        liquidity = (smc.get("liquidity", {}) or {}).get("1h", {})
        for liq in liquidity.get("buy_side_liquidity", [])[:1]:
            add_level(liq["price"], "#3b82f6", ":", 0.8, 0.5, "BSL")
        for liq in liquidity.get("sell_side_liquidity", [])[:1]:
            add_level(liq["price"], "#a855f7", ":", 0.8, 0.5, "SSL")

        # 2. Entry, SL, TPs, Trail levels
        if entry_price:
            add_level(entry_price, "#ffffff", "-", 1.2, 0.9, "ENTRY")
        if sl_price:
            add_level(sl_price, "#ef4444", "--", 1.2, 0.9, "SL")
        if tp_prices:
            for idx, tp in enumerate(tp_prices):
                add_level(tp, "#22c55e", "--", 1.0, 0.7, f"TP{idx+1}")
        if trail_price:
            add_level(trail_price, "#f59e0b", "--", 1.0, 0.8, "TRAIL")

        mc = mpf.make_marketcolors(
            up="#22c55e", down="#ef4444",
            wick={"up": "#16a34a", "down": "#b91c1c"},
            volume={"up": "#16a34a", "down": "#b91c1c"},
            edge="none",
        )
        style = mpf.make_mpf_style(
            marketcolors=mc,
            base_mpl_style="dark_background",
            gridstyle=":",
            gridcolor="#27272a",
            gridaxis="both",
            facecolor="#09090b",
            edgecolor="#27272a",
            figcolor="#09090b",
            rc={
                "axes.labelcolor": "#a1a1aa",
                "xtick.color": "#a1a1aa",
                "ytick.color": "#a1a1aa",
                "font.family": "monospace",
                "font.size": 7,
            },
        )

        fig, axes = mpf.plot(
            df,
            type="candle",
            style=style,
            volume=False,
            addplot=extra_plots if extra_plots else None,
            figsize=(8, 4),
            returnfig=True,
            tight_layout=True,
        )

        ax = axes[0]
        for x_idx, y_price, label, color in annotations:
            ax.annotate(
                label,
                xy=(x_idx, y_price),
                xytext=(x_idx + 0.5, y_price),
                fontsize=7,
                color=color,
                fontfamily="monospace",
                alpha=0.95,
                ha="left",
                va="center",
            )

        timestamp_str = pd.Timestamp.now(tz="Asia/Kolkata").strftime("%H:%M IST")
        ax.set_title(
            f"{instrument} · Alert Chart · {timestamp_str}",
            color="#a1a1aa", fontsize=8, fontfamily="monospace", loc="left", pad=4,
        )

        buf = BytesIO()
        fig.savefig(buf, format="png", dpi=100, bbox_inches="tight", facecolor="#09090b")
        plt.close(fig)
        buf.seek(0)
        return buf.read()

    async def generate_notification_chart(
        self,
        instrument: str,
        candles: list[dict],
        smc_analysis: dict | None,
        entry_price: float | None = None,
        sl_price: float | None = None,
        tp_prices: list[float] | None = None,
        trail_price: float | None = None,
    ) -> bytes:
        """Async wrapper — offloads notification chart generation to thread pool."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            _chart_executor,
            self._generate_notification_chart_sync,
            instrument, candles, smc_analysis,
            entry_price, sl_price, tp_prices, trail_price,
        )


chart_generator = ChartGenerator()
