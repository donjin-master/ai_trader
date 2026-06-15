"""Real-time WebSocket tick processor — zero LLM cost, emits MarketEvent objects."""

import asyncio
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING

import websockets
from loguru import logger

from backend.websocket.candle_builder import Candle, CandleBuilder

if TYPE_CHECKING:
    from backend.websocket.event_router import EventRouter


class EventTier(Enum):
    IMMEDIATE = 1
    DELAYED = 2
    IGNORE = 3


@dataclass
class MarketEvent:
    type: str
    instrument: str
    price: float
    tier: EventTier
    message: str
    level: float = 0.0
    data: dict = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.utcnow)

    def __repr__(self) -> str:
        return f"MarketEvent({self.type}@{self.instrument} ${self.price:,.0f} [{self.tier.name}])"


class MarketStreamProcessor:
    """
    Persistent WebSocket connection to Delta Exchange.
    Processes every tick — pure Python, no LLM calls.
    Emits MarketEvent when meaningful signals are detected.
    """

    WS_URL = "wss://socket.india.delta.exchange"

    KEY_LEVEL_TOLERANCE_PCT = float(os.getenv("EVENT_KEY_LEVEL_TOLERANCE_PCT", "0.10"))
    SIGNIFICANT_CANDLE_PCT = float(os.getenv("EVENT_SIGNIFICANT_CANDLE_BODY_PCT", "0.40"))
    VOLUME_SPIKE_MULT = float(os.getenv("EVENT_VOLUME_SPIKE_MULTIPLIER", "2.0"))
    FUNDING_THRESHOLD_1 = float(os.getenv("EVENT_FUNDING_THRESHOLD_1", "0.01"))
    FUNDING_THRESHOLD_2 = float(os.getenv("EVENT_FUNDING_THRESHOLD_2", "0.02"))

    def __init__(
        self,
        instruments: list[str],
        event_router: "EventRouter",
        cache_registry: dict | None = None,
    ) -> None:
        self.instruments = instruments
        self.router = event_router
        self.cache_registry = cache_registry or {}
        self.candle_builder = CandleBuilder(timeframes=["1m", "15m", "1h"])
        self.candle_builder.on_candle_close(self._on_candle_close)

        self._last_price: dict[str, float] = {}
        self._last_funding: dict[str, float] = {}
        self._last_oi: dict[str, float] = {}
        self._volume_ma: dict[str, list] = {i: [] for i in instruments}
        self._key_levels: dict[str, dict] = {}
        self._ob_zones: dict[str, list] = {}
        self._fvg_zones: dict[str, list] = {}
        self._running = False
        self._connected = False
        self._reconnect_count = 0

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def start(self) -> None:
        self._running = True
        reconnect_delay = int(os.getenv("WS_RECONNECT_DELAY_SECONDS", "5"))

        while self._running:
            try:
                logger.info("Connecting to Delta WebSocket for: {}", self.instruments)
                async with websockets.connect(
                    self.WS_URL,
                    ping_interval=int(os.getenv("WS_HEARTBEAT_INTERVAL_SECONDS", "30")),
                    ping_timeout=10,
                    close_timeout=5,
                ) as ws:
                    self._connected = True
                    for instrument in self.instruments:
                        sub = {
                            "type": "subscribe",
                            "payload": {
                                "channels": [
                                    {"name": "v2/ticker", "symbols": [instrument]},
                                    {"name": "all_trades", "symbols": [instrument]},
                                ]
                            },
                        }
                        await ws.send(json.dumps(sub))
                        logger.info("Subscribed to {} on Delta WebSocket", instrument)

                    async for raw in ws:
                        if not self._running:
                            break
                        try:
                            await self._process_message(json.loads(raw))
                        except json.JSONDecodeError:
                            pass
                        except Exception:
                            logger.exception("Error processing WS message")

            except websockets.ConnectionClosed as exc:
                logger.warning("WebSocket closed: {}. Reconnecting in {}s...", exc, reconnect_delay)
            except Exception:
                logger.exception("WebSocket error. Reconnecting in {}s...", reconnect_delay)
            finally:
                self._connected = False

            if self._running:
                self._reconnect_count += 1
                await asyncio.sleep(reconnect_delay)
                await self._on_reconnect()

    async def stop(self) -> None:
        self._running = False
        logger.info("MarketStreamProcessor stopping...")

    async def _on_reconnect(self) -> None:
        from backend.websocket.analysis_dispatcher import analysis_dispatcher
        logger.info("WebSocket reconnected — running safety scans")
        for instrument in self.instruments:
            asyncio.create_task(analysis_dispatcher.dispatch_safety_scan(instrument))

    async def _process_message(self, msg: dict) -> None:
        msg_type = msg.get("type")
        if msg_type == "v2/ticker":
            await self._process_ticker(msg)
        elif msg_type == "all_trades":
            await self._process_trade(msg)

    async def _process_ticker(self, msg: dict) -> None:
        instrument = msg.get("symbol")
        if not instrument or instrument not in self.instruments:
            return
        price = float(msg.get("mark_price") or msg.get("close") or 0)
        funding = float(msg.get("funding_rate") or 0)
        oi = float(msg.get("open_interest") or 0)
        if not price:
            return

        cache = self.cache_registry.get(instrument)
        if cache:
            cache.update_from_websocket("ticker", {"mark_price": price, "funding_rate": funding,
                                                    "open_interest": oi, "close": price})

        await asyncio.gather(
            self._detect_funding_cross(instrument, price, funding),
            self._detect_key_level_cross(instrument, price),
            self._detect_ob_entry(instrument, price),
            self._detect_fvg_entry(instrument, price),
            self._detect_oi_spike(instrument, oi),
        )
        self._last_price[instrument] = price
        self._last_funding[instrument] = funding
        self._last_oi[instrument] = oi

    async def _process_trade(self, msg: dict) -> None:
        instrument = msg.get("symbol")
        if not instrument or instrument not in self.instruments:
            return
        price = float(msg.get("price") or 0)
        volume = float(msg.get("size") or 0)
        if not price:
            return
        self.candle_builder.update(instrument, price, volume)
        await self._detect_volume_spike(instrument, volume)
        self._last_price[instrument] = price

    async def _on_candle_close(self, candle: Candle) -> None:
        await self._detect_significant_candle(candle.instrument, candle)
        logger.debug("Candle closed: {} {} O:{:.0f} H:{:.0f} L:{:.0f} C:{:.0f}",
                     candle.instrument, candle.timeframe, candle.open, candle.high, candle.low, candle.close)

    # ── Signal Detectors ────────────────────────────────────────────────────────

    async def _detect_key_level_cross(self, instrument: str, price: float) -> None:
        levels = self._key_levels.get(instrument, {})
        prev = self._last_price.get(instrument, price)
        checks = [
            ("PDH_CROSS", levels.get("prev_day_high"), "Previous Day High"),
            ("PDL_CROSS", levels.get("prev_day_low"), "Previous Day Low"),
            ("PDC_CROSS", levels.get("prev_day_close"), "Previous Day Close"),
            ("PWH_CROSS", levels.get("prev_week_high"), "Previous Week High"),
            ("PWL_CROSS", levels.get("prev_week_low"), "Previous Week Low"),
            ("WEEKLY_OPEN", levels.get("weekly_open"), "Weekly Open"),
            ("DAILY_OPEN", levels.get("daily_open"), "Daily Open"),
        ]
        for event_type, level, name in checks:
            if level is None:
                continue
            crossed = (prev < level <= price) or (prev > level >= price)
            if crossed:
                direction = "above" if price >= level else "below"
                await self.router.emit(MarketEvent(
                    type=event_type, instrument=instrument, price=price,
                    tier=EventTier.IMMEDIATE, level=level,
                    message=f"Price crossed {direction} {name} at ${level:,.0f}",
                    data={"level_name": name, "direction": direction},
                ))

    async def _detect_ob_entry(self, instrument: str, price: float) -> None:
        prev = self._last_price.get(instrument, price)
        for ob in self._ob_zones.get(instrument, []):
            if ob.get("mitigated"):
                continue
            lo, hi = ob["low"], ob["high"]
            if (lo <= price <= hi) and not (lo <= prev <= hi):
                await self.router.emit(MarketEvent(
                    type="OB_ENTRY", instrument=instrument, price=price,
                    tier=EventTier.IMMEDIATE, level=(lo + hi) / 2,
                    message=f"Price entered {ob.get('type','?')} OB ${lo:,.0f}–${hi:,.0f}",
                    data={"ob_type": ob.get("type"), "ob_low": lo, "ob_high": hi},
                ))

    async def _detect_fvg_entry(self, instrument: str, price: float) -> None:
        prev = self._last_price.get(instrument, price)
        for fvg in self._fvg_zones.get(instrument, []):
            if fvg.get("filled"):
                continue
            bot, top = fvg["bottom"], fvg["top"]
            if (bot <= price <= top) and not (bot <= prev <= top):
                gap_pct = (top - bot) / bot * 100
                await self.router.emit(MarketEvent(
                    type="FVG_ENTRY", instrument=instrument, price=price,
                    tier=EventTier.IMMEDIATE, level=(bot + top) / 2,
                    message=f"Price entered {fvg.get('type','?')} FVG ${bot:,.0f}–${top:,.0f} ({gap_pct:.2f}%)",
                    data={"fvg_type": fvg.get("type"), "gap_size_pct": gap_pct},
                ))

    async def _detect_funding_cross(self, instrument: str, price: float, funding: float) -> None:
        prev_funding = self._last_funding.get(instrument)
        if prev_funding is None:
            return
        for threshold in [-self.FUNDING_THRESHOLD_2, -self.FUNDING_THRESHOLD_1,
                          0.0, self.FUNDING_THRESHOLD_1, self.FUNDING_THRESHOLD_2]:
            crossed_up = prev_funding < threshold <= funding
            crossed_down = prev_funding > threshold >= funding
            if crossed_up or crossed_down:
                direction = "above" if crossed_up else "below"
                implication = "longs paying shorts" if funding > 0 else "shorts paying longs"
                await self.router.emit(MarketEvent(
                    type="FUNDING_CROSS", instrument=instrument, price=price,
                    tier=EventTier.IMMEDIATE, level=threshold,
                    message=f"Funding crossed {direction} {threshold:.3f}%: now {funding:.4f}% — {implication}",
                    data={"threshold": threshold, "current_funding": funding, "direction": direction},
                ))

    async def _detect_volume_spike(self, instrument: str, volume: float) -> None:
        window = self._volume_ma.setdefault(instrument, [])
        window.append(volume)
        if len(window) > 50:
            window.pop(0)
        if len(window) < 10:
            return
        avg = sum(window[:-1]) / len(window[:-1])
        if avg > 0 and volume > avg * self.VOLUME_SPIKE_MULT:
            ratio = volume / avg
            await self.router.emit(MarketEvent(
                type="VOLUME_SPIKE", instrument=instrument,
                price=self._last_price.get(instrument, 0),
                tier=EventTier.DELAYED,
                message=f"Volume spike: {ratio:.1f}x average ({volume:.0f} vs avg {avg:.0f})",
                data={"ratio": ratio, "current_volume": volume, "avg_volume": avg},
            ))

    async def _detect_oi_spike(self, instrument: str, oi: float) -> None:
        prev_oi = self._last_oi.get(instrument)
        if not prev_oi:
            return
        change_pct = abs(oi - prev_oi) / prev_oi * 100
        if change_pct > 3.0:
            direction = "increased" if oi > prev_oi else "decreased"
            await self.router.emit(MarketEvent(
                type="OI_SPIKE", instrument=instrument,
                price=self._last_price.get(instrument, 0),
                tier=EventTier.DELAYED,
                message=f"Open Interest {direction} {change_pct:.1f}%",
                data={"oi_change_pct": change_pct, "current_oi": oi, "prev_oi": prev_oi},
            ))

    async def _detect_significant_candle(self, instrument: str, candle: Candle) -> None:
        if not candle.closed or candle.open == 0:
            return
        body_pct = abs(candle.close - candle.open) / candle.open * 100
        if body_pct > self.SIGNIFICANT_CANDLE_PCT:
            direction = "bullish" if candle.close > candle.open else "bearish"
            await self.router.emit(MarketEvent(
                type="SIGNIFICANT_CANDLE", instrument=instrument, price=candle.close,
                tier=EventTier.IMMEDIATE,
                message=f"Significant {direction} {candle.timeframe} candle: {body_pct:.2f}% body",
                data={"timeframe": candle.timeframe, "body_pct": body_pct, "direction": direction},
            ))

    # ── Zone management ─────────────────────────────────────────────────────────

    def update_smc_zones(self, instrument: str, smc_analysis: dict) -> None:
        obs_15m = (smc_analysis.get("order_blocks") or {}).get("15m", [])
        obs_1h = (smc_analysis.get("order_blocks") or {}).get("1h", [])
        fvgs_15m = (smc_analysis.get("fvgs") or {}).get("15m", [])
        fvgs_1h = (smc_analysis.get("fvgs") or {}).get("1h", [])
        self._ob_zones[instrument] = [
            {**ob, "timeframe": tf}
            for tf, obs in [("15m", obs_15m), ("1h", obs_1h)]
            for ob in obs
            if not ob.get("mitigated")
        ]
        self._fvg_zones[instrument] = [
            {**fvg, "timeframe": tf}
            for tf, fvgs in [("15m", fvgs_15m), ("1h", fvgs_1h)]
            for fvg in fvgs
            if not fvg.get("filled")
        ]
        logger.info("Zones updated for {}: {} OBs, {} FVGs", instrument,
                    len(self._ob_zones[instrument]), len(self._fvg_zones[instrument]))

    def update_key_levels(self, instrument: str, key_levels: dict) -> None:
        self._key_levels[instrument] = key_levels
        pdh = key_levels.get("prev_day_high")
        logger.info("Key levels updated for {}: PDH={}", instrument, f"{pdh:.0f}" if pdh else "N/A")
