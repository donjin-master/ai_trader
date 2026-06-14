"""OpenAI embedding helper with graceful fallback."""

from __future__ import annotations

import httpx
from loguru import logger

from backend.config import settings


async def generate_embedding(text: str) -> list[float] | None:
    if not settings.openai_api_key:
        return None
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={"model": "text-embedding-3-small", "input": text[:8000]},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            return data["data"][0]["embedding"]
    except Exception as exc:
        logger.error("Embedding generation failed: {}", exc)
        return None


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"
