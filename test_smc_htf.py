import asyncio
import os
from loguru import logger
from backend.deps import delta_client
from backend.perception.smc import SMCAnalyser
from backend.cache.market_data_cache import MarketDataCache
from backend.deps import snapshot_builder

async def main():
    instrument = "BTCUSD_PERP"
    cache = MarketDataCache(instrument, delta_client)
    
    # Pre-warm cache
    logger.info("Fetching market data...")
    snapshot = await snapshot_builder.build_snapshot(instrument, cache)
    
    analyser = SMCAnalyser()
    logger.info("Running SMC analysis...")
    analysis = await analyser.analyse(instrument, delta_client, snapshot)
    
    print("\n" + "="*50)
    print("HTF LIQUIDITY PROXIMITY CHECK")
    print("="*50)
    
    context = analysis.get("context_text", "")
    if "HTF LIQUIDITY PROXIMITY ALERT" in context:
        print("\n✅ ALERTS FOUND IN CONTEXT TEXT:")
        lines = context.split("\n")
        alert_idx = lines.index("🚨 **HTF LIQUIDITY PROXIMITY ALERT** 🚨")
        for line in lines[alert_idx:]:
            print(line)
    else:
        print("\nℹ️ No HTF Liquidity Proximity Alerts triggered currently.")
        
    print("\n1H Liquidity:", analysis.get("liquidity", {}).get("1h", {}))

if __name__ == "__main__":
    asyncio.run(main())
