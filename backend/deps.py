"""Shared singletons used across loops, execution, and the API layer."""

from backend.delta.client import DeltaClient
from backend.perception.snapshot import MarketSnapshot

delta_client = DeltaClient()
snapshot_builder = MarketSnapshot(delta_client)

# AI-facing instrument names (used in prompts/validation) -> Delta India symbols
INSTRUMENT_MAP: dict[str, str] = {
    "BTCUSD_PERP": "BTCUSD",
    "ETHUSD_PERP": "ETHUSD",
    "BTC_USDT_PERP": "BTCUSD",
    "ETH_USDT_PERP": "ETHUSD",
}


def to_delta_symbol(instrument: str) -> str:
    """Map an AI-facing instrument name to the Delta Exchange symbol."""
    return INSTRUMENT_MAP.get(instrument, instrument)
