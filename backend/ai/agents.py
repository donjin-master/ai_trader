"""Bull, Bear, Judge, Reflection, and Counterfactual agents."""

import asyncio
import json
import os
import re
import time
from typing import Any

from anthropic import AsyncAnthropic
from loguru import logger

from backend.ai import prompts
from backend.config import settings

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1000

_client = AsyncAnthropic(api_key=settings.anthropic_api_key)


def _strip_json_fences(text: str) -> str:
    """Extract the first {...} JSON block from LLM output, stripping fences or surrounding prose."""
    text = text.strip()
    # Try extracting from code fences first
    if "```" in text:
        parts = text.split("```")
        for part in parts[1::2]:  # odd-indexed parts are inside fences
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{"):
                return _sanitise_json(part)
    # Fall back to regex: find the outermost { ... } block
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return _sanitise_json(match.group(0))
    return text


def _sanitise_json(raw: str) -> str:
    """Fix common LLM JSON mistakes: unescaped newlines/tabs inside string values."""
    result = []
    in_string = False
    escape_next = False
    for ch in raw:
        if escape_next:
            result.append(ch)
            escape_next = False
        elif ch == "\\" and in_string:
            result.append(ch)
            escape_next = True
        elif ch == '"':
            in_string = not in_string
            result.append(ch)
        elif in_string and ch == "\n":
            result.append("\\n")
        elif in_string and ch == "\r":
            result.append("\\r")
        elif in_string and ch == "\t":
            result.append("\\t")
        else:
            result.append(ch)
    return "".join(result)


async def _call_agent(system: str, user_message: str, agent_name: str) -> dict:
    """Call the model and parse a JSON response. Retry once on parse failure."""
    last_text = ""
    for attempt in range(1, 3):
        logger.debug("{} prompt (attempt {}):\n{}", agent_name, attempt, user_message)
        response = await _client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": user_message}],
        )
        last_text = response.content[0].text
        logger.debug("{} raw response:\n{}", agent_name, last_text)
        try:
            return json.loads(_strip_json_fences(last_text))
        except json.JSONDecodeError as exc:
            logger.warning("{} JSON parse failed (attempt {}): {}", agent_name, attempt, exc)
            user_message += "\n\nYour previous response was not valid JSON. Respond with ONLY the JSON object."
    raise ValueError(f"{agent_name} returned unparseable JSON after retry: {last_text[:200]}")




async def run_reflection_agent(trade: dict, market_data_window: dict) -> dict:
    user = (
        f"=== CLOSED TRADE ===\n{json.dumps(trade, indent=2, default=str)}\n\n"
        f"=== MARKET DATA DURING TRADE WINDOW ===\n"
        f"{json.dumps(market_data_window, indent=2, default=str)}\n\n"
        f"Review this trade and extract lessons."
    )
    return await _call_agent(prompts.SYSTEM_REFLECTION, user, "ReflectionAgent")


async def run_counterfactual_agent(trade: dict, price_history: list[dict]) -> dict:
    user = (
        f"=== CLOSED TRADE ===\n{json.dumps(trade, indent=2, default=str)}\n\n"
        f"=== PRICE HISTORY DURING AND AFTER TRADE WINDOW ===\n"
        f"{json.dumps(price_history, indent=2, default=str)}\n\n"
        f"Run the counterfactual analysis now."
    )
    return await _call_agent(prompts.SYSTEM_COUNTERFACTUAL, user, "CounterfactualAgent")


async def pause_between_agents(seconds: float = 0.5) -> None:
    """Small delay between consecutive agent calls to stay under rate limits."""
    await asyncio.sleep(seconds)


# ═══════════════════════════════════════════════════════════════════════════
# BOARDROOM (UPGRADE_BOARDROOM.md) — independent votes → deliberation → Chair
# ═══════════════════════════════════════════════════════════════════════════

import httpx

BOARD_MEMBERS = [
    {
        "name": "claude_technical",
        "model": "claude-sonnet-4-6",
        "provider": "anthropic",
        "personality": (
            "Technical price action analyst. "
            "Focus: chart structure, OBs, FVGs, market structure. "
            "Ignore macro and sentiment. Pure chart analysis."
        ),
        "analytical_mandate": "TECHNICAL",
    },
    {
        "name": "gpt_macro",
        "model": "gpt-5.5",
        "provider": "openai",
        "personality": (
            "Macro and derivatives analyst. "
            "Focus: funding rates, open interest, options flow, "
            "sentiment, positioning. Big picture view."
        ),
        "analytical_mandate": "MACRO",
    },
    {
        "name": "gemini_risk",
        "model": "gemini-2.5-flash",
        "provider": "google",
        "personality": (
            "Risk management analyst. "
            "Focus: downside scenarios, volatility, IV regime, "
            "what can go wrong. Inherently skeptical."
        ),
        "analytical_mandate": "RISK",
    }
]

CHAIR = {
    "name": "claude_chair",
    "model": "claude-opus-4-8",
    "provider": "anthropic"
}

_PROVIDER_KEYS = {
    "anthropic": lambda: settings.anthropic_api_key,
    "openai": lambda: settings.openai_api_key,
    "google": lambda: settings.google_api_key,
}


def active_board_members() -> list[dict]:
    """All 3 members are always active, falling back to Sonnet if APIs fail."""
    return BOARD_MEMBERS


async def _call_anthropic(model: str, system: str, user: str, max_tokens: int = MAX_TOKENS) -> str:
    response = await _client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
    )
    usage = response.usage
    if hasattr(usage, "cache_read_input_tokens") and usage.cache_read_input_tokens:
        logger.debug(
            "Prompt cache HIT: {} tokens saved (${:.4f})",
            usage.cache_read_input_tokens,
            usage.cache_read_input_tokens * 0.003 / 1000,
        )
    return response.content[0].text


async def _call_openai(model: str, system: str, user: str) -> str:
    # GPT-5.x are reasoning models: they require max_completion_tokens (not
    # max_tokens) and need generous headroom since reasoning tokens count
    # against the budget before any answer text is produced.
    is_reasoning = model.startswith("gpt-5") or model.startswith("o1") or model.startswith("o3")
    payload: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if is_reasoning:
        payload["max_completion_tokens"] = 4000
    else:
        payload["max_tokens"] = 1000
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60.0,
        )
        data = response.json()
        choices = data.get("choices")
        if not choices:
            raise ValueError(f"OpenAI returned no choices: {data.get('error', data)}")
        return choices[0]["message"]["content"]


async def _call_google(model: str, system: str, user: str) -> str:
    # Gemini 2.5 enables "thinking" by default, which consumes the output-token
    # budget before the answer. Disable it and give generous headroom so the
    # JSON vote/decision is never truncated.
    gen_config: dict = {"maxOutputTokens": 2048}
    if model.startswith("gemini-2.5"):
        gen_config["thinkingConfig"] = {"thinkingBudget": 0}
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            params={"key": settings.google_api_key},
            json={
                "system_instruction": {"parts": [{"text": system}]},
                "contents": [{"parts": [{"text": user}]}],
                "generationConfig": gen_config,
            },
            timeout=30.0,
        )
        data = response.json()
        candidates = data.get("candidates")
        if not candidates:
            raise ValueError(f"Gemini returned no candidates: {data.get('error', data)}")
        parts = candidates[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts)


async def _call_model(provider: str, model: str, system: str, user: str) -> str:
    if provider == "anthropic":
        return await _call_anthropic(model, system, user)
    if provider == "openai":
        return await _call_openai(model, system, user)
    if provider == "google":
        return await _call_google(model, system, user)
    raise ValueError(f"Unknown provider: {provider}")


def _snapshot_text(market_snapshot: dict | str) -> str:
    """Boardroom accepts either a dict snapshot or rich SMC context text."""
    if isinstance(market_snapshot, str):
        return market_snapshot
    return json.dumps(market_snapshot, indent=2, default=str)


async def _cast_vote(
    member: dict, market_snapshot: dict | str, recent_lessons: list[dict]
) -> dict:
    """One board member casts their independent vote.
    On failure or missing API key: fallback to Claude Sonnet with member's personality.
    """
    import time
    lessons_text = "\n".join(
        f"- {l.get('watch_for') or l.get('lesson') or l.get('lesson_text') or ''}"
        for l in recent_lessons[:5]
    ) or "No lessons yet."

    system_prompt = prompts.BOARDROOM_MEMBER_VOTE.format(
        market_snapshot=_snapshot_text(market_snapshot),
        recent_lessons=lessons_text,
    )
    user_prompt = (
        f"Your analytical focus: {member['personality']}\n\n"
        "Cast your independent vote based on the data provided."
    )

    t0 = time.monotonic()
    try:
        provider = member["provider"]
        key = _PROVIDER_KEYS[provider]()
        if not key or not key.strip():
            raise ValueError(f"Missing API key for provider '{provider}'")

        raw = await _call_model(provider, member["model"], system_prompt, user_prompt)
        response_time_ms = int((time.monotonic() - t0) * 1000)
        result = json.loads(_strip_json_fences(raw))
        result["member"] = member["name"]
        result["model"] = member["model"]
        result["response_time_ms"] = response_time_ms
        result["fallback_used"] = False
        logger.info(
            "Board member {} voted: {} (conviction: {}, {}ms)",
            member["name"], result.get("vote"), result.get("conviction"), response_time_ms,
        )
        return result
    except Exception as exc:
        logger.warning(
            "Board member {} ({}) failed: {}. Falling back to Claude Sonnet with mandate.",
            member["name"], member["model"], exc
        )
        # Fallback: use Claude Sonnet with analytical mandate override
        mandate_override = f"\nYour analytical mandate for this vote: {member['personality']}"
        try:
            raw = await _call_anthropic(
                "claude-sonnet-4-6",
                system_prompt + mandate_override,
                "Cast your vote based on your analytical mandate."
            )
            response_time_ms = int((time.monotonic() - t0) * 1000)
            result = json.loads(_strip_json_fences(raw))
            result["member"] = member["name"]
            result["model"] = "claude-sonnet-4-6-fallback"
            result["response_time_ms"] = response_time_ms
            result["fallback_used"] = True
            logger.info("Fallback vote cast for {}", member["name"])
            return result
        except Exception as fallback_exc:
            logger.error("Fallback also failed for {}: {}", member["name"], fallback_exc)
            return {
                "member": member["name"],
                "model": "failed",
                "vote": "HOLD",
                "conviction": 5,
                "primary_reason": f"API failure: {str(exc)} (fallback: {str(fallback_exc)})",
                "key_signals": [],
                "biggest_risk": "Technical failure",
                "suggested_entry_offset_pct": 0,
                "suggested_sl_offset_pct": 0,
                "suggested_tp_offset_pct": 0,
                "fallback_used": True,
                "response_time_ms": int((time.monotonic() - t0) * 1000),
            }



async def _deliberate(member: dict, my_vote: dict, other_votes: list[dict]) -> dict:
    """One board member reviews other votes and can update their position."""
    other_votes_text = "\n".join(
        f"- {v['member']} ({v['model']}): {v['vote']} "
        f"(conviction {v['conviction']}) — {v.get('primary_reason', '')}"
        for v in other_votes
    ) or "No other members voted this round."

    try:
        raw = await _call_model(
            member["provider"],
            member["model"],
            prompts.BOARDROOM_MEMBER_DELIBERATE.format(
                my_vote=my_vote.get("vote"),
                my_conviction=my_vote.get("conviction"),
                other_votes=other_votes_text,
            ),
            "Review the other votes and decide if you want to update your position.",
        )
        result = json.loads(_strip_json_fences(raw))
        result["member"] = member["name"]
        result["original_vote"] = my_vote.get("vote")
        changed = result.get("final_vote") != my_vote.get("vote")
        logger.info(
            "Board member {} deliberation: {}",
            member["name"],
            f"CHANGED to {result.get('final_vote')}" if changed else f"HELD at {my_vote.get('vote')}",
        )
        return result
    except Exception as exc:
        logger.error("Board member {} deliberation failed: {}", member["name"], exc)
        return {
            "member": member["name"],
            "decision": "HOLD_POSITION",
            "final_vote": my_vote.get("vote", "HOLD"),
            "final_conviction": my_vote.get("conviction", 5),
            "reasoning": f"Deliberation failed: {exc}",
            "original_vote": my_vote.get("vote"),
        }


async def _run_chair_with_vision(
    system: str,
    text_context: str,
    chart_15m_b64: str | None,
    chart_1h_b64: str | None,
) -> str:
    """Chair call with optional chart images. Falls back to text-only if no charts."""
    content: list[dict] = []
    if chart_15m_b64:
        content.append({"type": "text", "text": "15-MINUTE CHART (primary entry timeframe):"})
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": chart_15m_b64},
        })
    if chart_1h_b64:
        content.append({"type": "text", "text": "1-HOUR CHART (structural context):"})
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": chart_1h_b64},
        })
    if content:
        text_context += (
            "\n\nThe charts above show the annotated market structure including "
            "order blocks (green/red dashed levels), fair value gaps (dotted zones), "
            "liquidity levels (blue/purple lines), and any open position levels.\n\n"
            "Pay particular attention to:\n"
            "- Does the visual chart confirm what the text analysis says?\n"
            "- Are the order blocks visually clean or messy?\n"
            "- Does price action look like a genuine setup or forced?\n"
            "- What does the overall visual structure tell you that numbers alone might miss?"
        )
    content.append({"type": "text", "text": text_context})

    response = await _client.messages.create(
        model=CHAIR["model"],
        max_tokens=1500,
        system=system,
        messages=[{"role": "user", "content": content}],
    )
    return response.content[0].text


async def run_boardroom(
    instrument: str,
    market_snapshot: dict | str,
    portfolio_state: dict,
    recent_lessons: list[dict],
    counterfactual_insights: list[str],
    chart_15m_b64: str | None = None,
    chart_1h_b64: str | None = None,
) -> dict:
    """Round 1 blind votes (parallel) → Round 2 deliberation (parallel) → Chair.

    Returns a decision dict schema-compatible with the old Judge output, so
    validator/executor/DB need no changes.
    """
    logger.info("Boardroom convening for {}...", instrument)
    members = active_board_members()
    if not members:
        raise RuntimeError("No board members have API keys configured")

    # ── ROUND 1: Independent blind votes ──────────────────────────────────
    logger.info("Round 1: Independent votes...")
    vote_tasks = [
        _cast_vote(m, market_snapshot, recent_lessons)
        for m in members
    ]
    votes = list(await asyncio.gather(*vote_tasks))
    logger.info("Round 1 complete: {}", [v["vote"] for v in votes])

    # ── ROUND 2: Deliberation (skip when only one member is active) ──────
    if len(members) > 1:
        logger.info("Round 2: Deliberation...")
        deliberations = list(await asyncio.gather(*[
            _deliberate(member, votes[i], [v for j, v in enumerate(votes) if j != i])
            for i, member in enumerate(members)
        ]))
    else:
        deliberations = [{
            "member": votes[0]["member"],
            "decision": "HOLD_POSITION",
            "final_vote": votes[0].get("vote", "HOLD"),
            "final_conviction": votes[0].get("conviction", 5),
            "reasoning": "Single-member board — no deliberation round",
            "original_vote": votes[0].get("vote"),
        }]

    final_votes = [d.get("final_vote", "HOLD") for d in deliberations]
    vote_tally = {v: final_votes.count(v) for v in set(final_votes)}
    logger.info("Round 2 complete. Final tally: {}", vote_tally)

    # ── ROUND 3: Chair decision ───────────────────────────────────────────
    logger.info("Round 3: Chair deciding...")
    voting_summary = (
        "INITIAL VOTES:\n"
        + "\n".join(
            f"- {v['member']}: {v['vote']} (conviction {v['conviction']}) — {v.get('primary_reason', '')}"
            for v in votes
        )
        + "\n\nAFTER DELIBERATION:\n"
        + "\n".join(
            f"- {d['member']}: {d.get('final_vote', 'HOLD')} "
            f"(conviction {d.get('final_conviction', 5)}) — {d.get('reasoning', '')}"
            for d in deliberations
        )
        + f"\n\nVOTE TALLY: {vote_tally}"
        + f"\nACTIVE BOARD SIZE: {len(members)} member(s)"
    )

    lessons_text = "\n".join(
        f"- {l.get('watch_for') or l.get('lesson') or l.get('lesson_text') or ''}"
        for l in recent_lessons[:10]
    ) or "No lessons yet."
    cf_text = "\n".join(f"- {i}" for i in counterfactual_insights) or "No counterfactual data yet."

    changed_count = sum(
        1 for d in deliberations if d.get("final_vote") != d.get("original_vote")
    )
    deliberation_change_rate = round(changed_count / max(len(deliberations), 1), 2)
    avg_response_ms = int(sum(v.get("response_time_ms", 0) for v in votes) / max(len(votes), 1))

    boardroom_record = {
        "votes": votes,
        "deliberations": deliberations,
        "vote_tally": vote_tally,
        "rounds": 2 if len(members) > 1 else 1,
        "active_members": [m["name"] for m in members],
        "deliberation_change_rate": deliberation_change_rate,
        "avg_vote_response_ms": avg_response_ms,
        "model_response_times": {
            v["member"]: v.get("response_time_ms", 0)
            for v in votes
        },
        "fallbacks_used": sum(1 for v in votes if v.get("fallback_used", False)),
    }


    try:
        chair_system = prompts.BOARDROOM_CHAIR.format(
            voting_summary=voting_summary,
            portfolio_state=json.dumps(portfolio_state, indent=2, default=str),
            recent_lessons=lessons_text,
            counterfactual_insights=cf_text,
        )
        if chart_15m_b64 or chart_1h_b64:
            logger.info("Round 3: Chair deciding WITH VISION (charts attached)...")
            raw = await _run_chair_with_vision(
                chair_system,
                f"=== MARKET CONTEXT ===\n{_snapshot_text(market_snapshot)}\n\nMake the final trade decision for {instrument}.",
                chart_15m_b64,
                chart_1h_b64,
            )
        else:
            raw = await _call_anthropic(
                CHAIR["model"], chair_system,
                f"=== MARKET CONTEXT ===\n{_snapshot_text(market_snapshot)}\n\nMake the final trade decision for {instrument}.",
            )
        decision = json.loads(_strip_json_fences(raw))
        decision["boardroom"] = boardroom_record
        decision.setdefault("instrument", instrument)
        decision["vision_used"] = chart_15m_b64 is not None
        # Compatibility fields for validator/executor/DB written for Judge output
        decision.setdefault("reasoning", decision.get("chair_reasoning"))
        logger.info(
            "Chair decision: {} | Consensus: {} | Confidence: {} | Vision: {}",
            str(decision.get("action", "")).upper(),
            decision.get("consensus_level"),
            decision.get("confidence"),
            decision["vision_used"],
        )
        return decision
    except Exception as exc:
        logger.error("Chair decision failed: {}", exc)
        return {
            "action": "hold",
            "instrument": instrument,
            "size_pct": 0,
            "entry_type": "limit",
            "price_offset_pct": 0,
            "stop_loss_offset_pct": 0,
            "take_profit_offset_pct": 0,
            "confidence": 0,
            "vote_tally": str(vote_tally),
            "consensus_level": "error",
            "chair_reasoning": f"Boardroom failed: {exc}",
            "reasoning": f"Boardroom failed: {exc}",
            "overriding_majority": False,
            "override_reason": None,
            "dissenting_view": None,
            "key_signals": [],
            "boardroom": boardroom_record,
        }

async def run_market_regime_agent(instrument: str, snapshot: dict, iv_snapshot: dict) -> dict:
    """Invoked after 6 consecutive mathematical skips to reassess regime."""
    prompt = f"""The mathematical SMC system has skipped trading for ~3 hours due to chop/lack of setups.
We need to know if we should sell options premium or force a boardroom run.

Instrument: {instrument}
Market Snapshot: {json.dumps(snapshot)}
IV Snapshot: {json.dumps(iv_snapshot)}

Output JSON ONLY:
{{
  "action": "route_options" | "route_boardroom" | "wait",
  "direction": "long" | "short" | "neutral",
  "conviction": 1-10,
  "reasoning": "string"
}}
If IV is high/extreme and market is ranging, return route_options + neutral.
If market is squeezing heavily with an imminent breakout, return route_boardroom.
Otherwise wait.
"""
    raw = await _call_google("gemini-2.5-flash", "You are the Market Regime Assessor.", prompt)
    try:
        return json.loads(_strip_json_fences(raw))
    except Exception as e:
        logger.error(f"Failed to parse regime agent: {e}")
        return {"action": "wait", "reasoning": str(e)}
