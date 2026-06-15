import asyncio
from backend.db.database import get_db
from sqlalchemy import text

async def main():
    async for db in get_db():
        try:
            await db.execute(text("ALTER TABLE risk_profile ADD COLUMN active_instruments JSONB DEFAULT '[\"BTCUSD_PERP\", \"ETHUSD_PERP\", \"SOLUSD_PERP\", \"XAUUSD_PERP\"]'::jsonb;"))
            await db.commit()
            print("Successfully added active_instruments column.")
        except Exception as e:
            print(f"Error (column might already exist): {e}")

if __name__ == "__main__":
    asyncio.run(main())
