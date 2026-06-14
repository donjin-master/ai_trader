"""Bull, Bear, Judge, Reflection, and Counterfactual agents."""

import asyncio
import json
import os
from typing import Any

from anthropic import AsyncAnthropic
from loguru import logger

from backend.ai import prompts
from backend.config import settings

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1000

_client = AsyncAnthropic(api_key=settings.anthropic_api_key)


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


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


async def run_bull_agent(instrument: str, snapshot: dict) -> dict:
    system = prompts.SYSTEM_BULL.replace("{instrument}", instrument)
    user = f"Current market data for {instrument}:\n{json.dumps(snapshot, indent=2)}"
    result = await _call_agent(system, user, "BullAgent")
    logger.info("Bull conviction: {}", result.get("conviction"))
    return result


async def run_bear_agent(instrument: str, snapshot: dict) -> dict:
    system = prompts.SYSTEM_BEAR.replace("{instrument}", instrument)
    user = f"Current market data for {instrument}:\n{json.dumps(snapshot, indent=2)}"
    result = await _call_agent(system, user, "BearAgent")
    logger.info("Bear conviction: {}", result.get("conviction"))
    return result


async def run_judge_agent(
    instrument: str,
    bull_result: dict,
    bear_result: dict,
    portfolio_state: dict,
    recent_lessons: list[dict],
    counterfactual_insights: list[str],
) -> dict:
    lessons_text = (
        json.dumps(recent_lessons, indent=2, default=str)
        if recent_lessons
        else "No lessons yet — make your best judgment."
    )
    insights_text = (
        "\n".join(f"- {i}" for i in counterfactual_insights)
        if counterfactual_insights
        else "No counterfactual insights yet — make your best judgment."
    )
    user = (
        f"Instrument: {instrument}\n\n"
        f"=== BULL CASE (conviction {bull_result.get('conviction')}) ===\n"
        f"{json.dumps(bull_result, indent=2)}\n\n"
        f"=== BEAR CASE (conviction {bear_result.get('conviction')}) ===\n"
        f"{json.dumps(bear_result, indent=2)}\n\n"
        f"=== PORTFOLIO STATE ===\n"
        f"{json.dumps(portfolio_state, indent=2, default=str)}\n\n"
        f"=== LAST 10 LESSONS ===\n{lessons_text}\n\n"
        f"=== RECENT COUNTERFACTUAL INSIGHTS ===\n{insights_text}\n\n"
        f"Make your final decision now."
    )
    result = await _call_agent(prompts.SYSTEM_JUDGE, user, "JudgeAgent")
    logger.info(
        "Judge decision: {} (confidence {})",
        str(result.get("action", "")).upper(), result.get("confidence"),
    )
    return result


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
        "name": "haiku",
        "model": "claude-haiku-4-5-20251001",
        "provider": "anthropic",
        "personality": "Technical analyst, focus on price action and derivatives data",
    },
    {
        "name": "gpt",
        "model": "gpt-5.4",
        "provider": "openai",
        "personality": "Macro analyst, focus on sentiment, funding rates, and market structure",
    },
    {
        "name": "gemini",
        "model": "gemini-3.5-flash",
        "provider": "google",
        "personality": "Risk analyst, focus on volatility, options data, and downside scenarios",
    },
]

BOARDROOM_MODE = settings.boardroom_mode

SYSTEM_TECHNICAL_ANALYST = """
You are a technical price action analyst on a crypto trading board.
Your focus: chart structure, Smart Money Concepts (SMC), swing points, BOS, CHoCH, order blocks, Fair Value Gaps (FVGs), liquidity sweeps, and invalidation levels.

Your Skills:
1. Swing Analysis: Locate swing high/low points. Determine structural direction (BULLISH/BEARISH/RANGING).
2. Trigger Spotting: Locate clean wicks sweeping liquidity or breaking structure (CHoCH on 15M). A 15M CHoCH after a sweep is your primary trigger signal.
3. Zone Confluence: Check if an FVG overlaps with an unmitigated Order Block (OB).
4. Entry Offset: Determine precise entries near the boundary of the OB or inside the FVG.

Rule: If a clear 15M trigger or structural change (CHoCH) occurs after a liquidity sweep, endorse a trade entry immediately even if the macro trend is ranging.
"""

SYSTEM_RISK_MANAGER = """
You are a risk manager on a crypto trading board.
Your focus: identifying invalidation logic, stop safety, and risk/reward asymmetry.

Your Skills:
1. Invalidation Check: Validate if the proposed stop loss is logically placed (e.g. below the sweep low or OB low for longs; above high for shorts). Ensure it is not arbitrary.
2. Volatility Stress: Ensure the stop distance is wide enough to survive noise (using ATR context if available).
3. Risk/Reward (R:R): Compare entry to target levels (key levels / round numbers).

Rule: Your mandate is to evaluate if risk is bounded and payout is asymmetric. Support the trade if invalidation is logical and target R:R is valid (>= 1.5R). Oppose only if invalidation is arbitrary, R:R is poor (< 1.5R), or safety limits (daily budget/loss limits) are violated. Do not veto setups on minor uncertainty.
"""

SYSTEM_MOMENTUM_ANALYST = """
You are a momentum and market flow analyst on a crypto trading board.
Your focus: volume confirmation, funding rates, open interest, and session activity.

Your Skills:
1. Volume Validation: Identify volume expansion on candles breaking structure or sweeping liquidity.
2. Market Skew: Check if funding rate or open interest changes support the trade direction (e.g., negative funding supporting long squeeze).
3. Session Alignment: Track if trading is occurring during active London or US session hours.

Rule: Identify if there is sufficient flow and volume backing to accelerate the trade. Support the entry if volume is rising, funding is favorable, or the session is active.
"""

SINGLE_CLAUDE_MEMBERS = [
    {"name": "claude_technical", "model": MODEL, "provider": "anthropic", "system": SYSTEM_TECHNICAL_ANALYST},
    {"name": "claude_risk", "model": MODEL, "provider": "anthropic", "system": SYSTEM_RISK_MANAGER},
    {"name": "claude_momentum", "model": MODEL, "provider": "anthropic", "system": SYSTEM_MOMENTUM_ANALYST},
]

# Chair on Sonnet 4.6 — strong judgment at lower cost (owner's choice; Opus optional)
CHAIR = {"name": "sonnet_chair", "model": "claude-sonnet-4-6", "provider": "anthropic"}

_PROVIDER_KEYS = {
    "anthropic": lambda: settings.anthropic_api_key,
    "openai": lambda: settings.openai_api_key,
    "google": lambda: settings.google_api_key,
}


def active_board_members() -> list[dict]:
    """Members whose provider key is configured. GPT/Gemini activate when keys land in .env."""
    if BOARDROOM_MODE == "single_claude":
        return SINGLE_CLAUDE_MEMBERS if settings.anthropic_api_key else []
    active = [m for m in BOARD_MEMBERS if (_PROVIDER_KEYS[m["provider"]]() or "").strip()]
    skipped = [m["name"] for m in BOARD_MEMBERS if m not in active]
    if skipped:
        logger.warning("Board members without API keys (skipped): {}", skipped)
    return active


async def _call_anthropic(model: str, system: str, user: str, max_tokens: int = MAX_TOKENS) -> str:
    response = await _client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
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
    if model.startswith("gemini-2.5") or model.startswith("gemini-3"):
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
    """One board member casts their independent vote."""
    lessons_text = "\n".join(
        f"- {l.get('watch_for') or l.get('lesson') or l.get('lesson_text') or ''}"
        for l in recent_lessons[:5]
    ) or "No lessons yet."

    try:
        raw = await _call_model(
            member["provider"],
            member["model"],
            prompts.BOARDROOM_MEMBER_VOTE.format(
                market_snapshot=_snapshot_text(market_snapshot),
                recent_lessons=lessons_text,
            ),
            f"Your analytical focus: {member['personality']}\n\n"
            f"Cast your independent vote based on the data provided.",
        )
        result = json.loads(_strip_json_fences(raw))
        result["member"] = member["name"]
        result["model"] = member["model"]
        logger.info(
            "Board member {} voted: {} (conviction: {})",
            member["name"], result.get("vote"), result.get("conviction"),
        )
        return result
    except Exception as exc:
        logger.error("Board member {} failed to vote: {}", member["name"], exc)
        return {
            "member": member["name"],
            "model": member["model"],
            "vote": "HOLD",
            "conviction": 5,
            "primary_reason": f"Vote failed: {exc}",
            "key_signals": [],
            "biggest_risk": "Technical failure",
            "suggested_entry_offset_pct": 0,
            "suggested_sl_offset_pct": 0,
            "suggested_tp_offset_pct": 0,
            "failed": True,
        }


async def _cast_vote_with_mandate(
    member: dict, market_snapshot: dict | str, recent_lessons: list[dict]
) -> dict:
    """Single-Claude board member with distinct system mandate."""
    lessons_text = "\n".join(
        f"- {l.get('watch_for') or l.get('lesson') or l.get('lesson_text') or ''}"
        for l in recent_lessons[:5]
    ) or "No lessons yet."
    try:
        system = member["system"] + "\n\n" + prompts.BOARDROOM_MEMBER_VOTE.format(
            market_snapshot=_snapshot_text(market_snapshot),
            recent_lessons=lessons_text,
        )
        raw = await _call_anthropic(
            member["model"],
            system,
            "Cast your independent vote based only on your mandate.",
        )
        result = json.loads(_strip_json_fences(raw))
        result["member"] = member["name"]
        result["model"] = member["model"]
        return result
    except Exception as exc:
        logger.error("Mandated board member {} failed: {}", member["name"], exc)
        return {
            "member": member["name"],
            "model": member["model"],
            "vote": "HOLD",
            "conviction": 5,
            "primary_reason": f"Vote failed: {exc}",
            "key_signals": [],
            "biggest_risk": "Technical failure",
            "suggested_entry_offset_pct": 0,
            "suggested_sl_offset_pct": 0,
            "suggested_tp_offset_pct": 0,
            "failed": True,
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
    if BOARDROOM_MODE == "single_claude":
        votes = list(await asyncio.gather(*[
            _cast_vote_with_mandate(m, market_snapshot, recent_lessons) for m in members
        ]))
    else:
        votes = list(await asyncio.gather(*[
            _cast_vote(m, market_snapshot, recent_lessons) for m in members
        ]))
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

    boardroom_record = {
        "votes": votes,
        "deliberations": deliberations,
        "vote_tally": vote_tally,
        "rounds": 2 if len(members) > 1 else 1,
        "active_members": [m["name"] for m in members],
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
