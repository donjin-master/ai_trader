import asyncio
from sqlalchemy import select
from backend.db.database import AsyncSessionLocal
from backend.db.models import Trade

async def main():
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Trade).order_by(Trade.timestamp.desc()).limit(10)
        )
        trades = result.scalars().all()
        for t in trades:
            reason = t.decision_json.get("skip_reason") if t.decision_json else "None"
            print(f"Trade {t.id} - Status: {t.status} - Reason: {reason} - Time: {t.timestamp}")

asyncio.run(main())
