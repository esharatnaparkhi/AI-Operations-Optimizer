"""Suggestions API: list, simulate, apply."""
import logging
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..core.database import get_db
from ..core.auth import get_current_user_id
from ..models.db import LLMEvent, Suggestion, Project
from ..models.schemas import (
    SuggestionResponse, SimulateRequest, SimulateResponse,
    ApplyRequest, ApplyResponse,
)

router = APIRouter(prefix="/api/v1/suggestions", tags=["suggestions"])
logger = logging.getLogger(__name__)


@router.get("/{project_id}", response_model=List[SuggestionResponse])
async def list_suggestions(
    project_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    # Verify ownership
    r = await db.execute(
        select(Project).where(Project.id == project_id, Project.owner_id == user_id)
    )
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Project not found")

    result = await db.execute(
        select(Suggestion)
        .where(Suggestion.project_id == project_id, Suggestion.status != "dismissed")
        .order_by(Suggestion.created_at.desc())
    )
    return result.scalars().all()


@router.post("/simulate", response_model=SimulateResponse)
async def simulate_suggestion(
    body: SimulateRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Suggestion).where(Suggestion.id == body.suggestion_id)
    )
    sug = result.scalar_one_or_none()
    if not sug:
        raise HTTPException(404, "Suggestion not found")

    # Verify the suggestion's project belongs to the current user
    owner_check = await db.execute(
        select(Project).where(Project.id == sug.project_id, Project.owner_id == user_id)
    )
    if not owner_check.scalar_one_or_none():
        raise HTTPException(404, "Suggestion not found")

    current = sug.current_cost_per_day if sug.current_cost_per_day is not None else 0.0
    projected = sug.projected_cost_per_day if sug.projected_cost_per_day is not None else current
    savings_pct = sug.estimated_savings_pct if sug.estimated_savings_pct is not None else 0.0

    savings_daily = current - projected
    savings_monthly = savings_daily * 30

    # Count actual events used for this suggestion to give an honest sample_size
    payload_data = sug.payload or {}
    days_window = int(payload_data.get("days_window", 7))
    since = datetime.now(timezone.utc) - timedelta(days=days_window)

    count_q = select(func.count(LLMEvent.id)).where(
        LLMEvent.project_id == sug.project_id,
        LLMEvent.timestamp >= since,
    )
    if sug.feature_tag:
        count_q = count_q.where(LLMEvent.feature_tag == sug.feature_tag)
    sample_size = (await db.execute(count_q)).scalar() or 0

    sug.status = "simulated"
    await db.flush()

    return SimulateResponse(
        suggestion_id=str(sug.id),
        current_monthly_cost=round(current * 30, 2),
        projected_daily_cost=round(projected, 6),
        projected_monthly_cost=round(projected * 30, 2),
        savings_usd_monthly=round(savings_monthly, 2),
        savings_pct=round(savings_pct, 1),
        accuracy_risk=sug.accuracy_risk or "low",
        sample_size=sample_size,
    )


@router.post("/apply", response_model=ApplyResponse)
async def apply_suggestion(
    body: ApplyRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Suggestion).where(Suggestion.id == body.suggestion_id)
    )
    sug = result.scalar_one_or_none()
    if not sug:
        raise HTTPException(404, "Suggestion not found")

    # Verify the suggestion's project belongs to the current user
    owner_check = await db.execute(
        select(Project).where(Project.id == sug.project_id, Project.owner_id == user_id)
    )
    if not owner_check.scalar_one_or_none():
        raise HTTPException(404, "Suggestion not found")

    snippet = None
    if body.apply_mode == "snippet":
        snippet = await _generate_snippet_llm(sug)
        sug.status = "applied"
    else:
        sug.status = "applied"

    await db.flush()
    return ApplyResponse(
        suggestion_id=str(sug.id),
        mode=body.apply_mode,
        snippet=snippet,
        message="Snippet ready for review." if snippet else "Runtime rule applied.",
    )


@router.post("/{suggestion_id}/dismiss", status_code=204)
async def dismiss_suggestion(
    suggestion_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Suggestion).where(Suggestion.id == suggestion_id))
    sug = result.scalar_one_or_none()
    if not sug:
        raise HTTPException(404)

    # Verify the suggestion's project belongs to the current user
    owner_check = await db.execute(
        select(Project).where(Project.id == sug.project_id, Project.owner_id == user_id)
    )
    if not owner_check.scalar_one_or_none():
        raise HTTPException(404)

    sug.status = "dismissed"
    await db.flush()


# ── Snippet generation ────────────────────────────────────────


async def _generate_snippet_llm(sug: Suggestion) -> str:
    """
    Use an LLM to produce a clear, textual recommendation explaining exactly
    what change to make in the pipeline and why.
    Falls back to a static template if the LLM is unavailable.
    """
    settings = get_settings()
    if not settings.OPENAI_API_KEY:
        return _generate_snippet_static(sug)

    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        payload = sug.payload or {}
        feature = sug.feature_tag or "your feature"

        system = (
            "You are an LLM cost-optimization advisor. "
            "Write a clear, actionable plain-text recommendation (no code blocks, no markdown). "
            "Structure your response as:\n"
            "WHAT TO CHANGE: one sentence naming the specific call or parameter to update.\n"
            "WHERE: the part of the pipeline affected (e.g. the model= argument in the API call for feature '<tag>').\n"
            "HOW: step-by-step plain-English instructions, referencing the specific parameter names or values to change.\n"
            "WHY: brief explanation of the cost/latency impact with the before/after numbers provided.\n"
            "Keep the total response under 200 words."
        )

        if sug.suggestion_type == "model_downgrade":
            current_model = payload.get("current_model", payload.get("model", "gpt-4o"))
            target_model = payload.get("target_model", "gpt-4o-mini")
            avg_tokens = payload.get("avg_out_tokens", "~30")
            current_daily = sug.current_cost_per_day or 0.0
            projected_daily = sug.projected_cost_per_day or current_daily * 0.25
            human = (
                f'Feature: "{feature}"\n'
                f"Current model: {current_model} (averages ~{avg_tokens} output tokens — a simple task)\n"
                f"Recommended model: {target_model}\n"
                f"Current daily cost: ${current_daily:.6f} → Projected: ${projected_daily:.6f}/day after fix\n\n"
                f"Write a plain-text recommendation telling the developer to find every place in their "
                f'pipeline where the "{feature}" feature tag is used and change model="{current_model}" '
                f'to model="{target_model}". Mention the savings.'
            )

        elif sug.suggestion_type == "latency_optimization":
            avg_latency = payload.get("avg_latency_ms", "high")
            human = (
                f'Feature: "{feature}"\n'
                f"Average latency: {avg_latency}ms\n\n"
                f"Write a plain-text recommendation telling the developer how to reduce latency "
                f'for the "{feature}" feature. Focus on: enabling streaming (stream=True) so the '
                f"user sees output immediately rather than waiting for the full response, adding a "
                f"request timeout, and considering whether the model choice can be simplified. "
                f"Reference the specific API call parameter names."
            )

        elif sug.suggestion_type == "anomaly_alert":
            today_cost = payload.get("today_cost", 0.0)
            trailing_avg = payload.get("trailing_avg", 0.0)
            multiplier = payload.get("multiplier", 2.0)
            human = (
                f"Today's LLM cost: ${today_cost:.4f}\n"
                f"Trailing daily average: ${trailing_avg:.4f}\n"
                f"Spike ratio: {multiplier:.1f}x\n\n"
                f"Write a plain-text recommendation alerting the developer to an unusual cost spike. "
                f"Suggest they: (1) check which feature tags drove the spike today, "
                f"(2) look for loops or retries that may have caused excessive calls, "
                f"(3) add a daily budget guard to their pipeline that logs a warning if cost exceeds "
                f"2x the trailing average, and (4) review recent deployments for regressions."
            )

        elif sug.suggestion_type == "prompt_compress":
            savings = sug.estimated_savings_pct or 0
            original_tokens = payload.get("original_tokens", "unknown")
            compressed_tokens = payload.get("compressed_tokens", "unknown")
            human = (
                f'Feature: "{feature}"\n'
                f"Original tokens: {original_tokens} → Compressed tokens: {compressed_tokens} "
                f"({savings:.0f}% reduction)\n\n"
                f"Write a plain-text recommendation telling the developer to shorten their system "
                f'prompt for the "{feature}" feature. Suggest they: (1) remove filler phrases and '
                f"redundant instructions, (2) replace verbose examples with concise bullet points, "
                f"(3) use imperative tense ('Summarize in 3 bullets' not 'You should summarize using "
                f"three bullet points'), and (4) re-test the compressed prompt for quality before deploying."
            )

        else:
            human = (
                f"Suggestion: {sug.title}\n"
                f"Context: {sug.description}\n\n"
                "Write a plain-text recommendation for what to change and how."
            )

        llm = ChatOpenAI(
            model=settings.COMPRESSION_MODEL,
            api_key=settings.OPENAI_API_KEY,
            temperature=0,
            max_tokens=400,
        )
        response = await llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=human),
        ])
        recommendation = (response.content or "").strip()
        return recommendation if recommendation else _generate_snippet_static(sug)

    except Exception as exc:
        logger.warning("LLM recommendation generation failed, using static fallback: %s", exc)
        return _generate_snippet_static(sug)


def _generate_snippet_static(sug: Suggestion) -> str:
    """Static fallback textual recommendation when the LLM is unavailable."""
    payload = sug.payload or {}
    feature = sug.feature_tag or "your feature"

    if sug.suggestion_type == "model_downgrade":
        current_model = payload.get("current_model", payload.get("model", "gpt-4o"))
        target_model = payload.get("target_model", "gpt-4o-mini")
        current_daily = sug.current_cost_per_day or 0.0
        projected_daily = sug.projected_cost_per_day or current_daily * 0.25
        return (
            f'WHAT TO CHANGE: Replace model="{current_model}" with model="{target_model}" '
            f'in all API calls made under the "{feature}" feature tag.\n\n'
            f"WHERE: Find every call to your LLM client where feature_tag is set to "
            f'"{feature}" and locate the model= parameter in that call.\n\n'
            f"HOW: Change the model argument from \"{current_model}\" to \"{target_model}\". "
            f"No other changes are needed — the API interface is identical.\n\n"
            f"WHY: This feature averages very few output tokens, making it a simple task "
            f"that does not need a frontier model. {target_model} handles it equally well "
            f"at ~75% lower cost. Estimated savings: "
            f"${current_daily:.6f}/day → ${projected_daily:.6f}/day."
        )
    elif sug.suggestion_type == "prompt_compress":
        savings = sug.estimated_savings_pct or 0
        original_tokens = payload.get("original_tokens", "unknown")
        compressed_tokens = payload.get("compressed_tokens", "unknown")
        return (
            f'WHAT TO CHANGE: Shorten the system prompt used by the "{feature}" feature.\n\n'
            f"WHERE: Find the system prompt string passed to the messages= parameter "
            f'in your "{feature}" pipeline.\n\n'
            f"HOW: (1) Remove filler phrases and repeated instructions. "
            f"(2) Replace multi-sentence examples with concise bullet points. "
            f"(3) Use imperative tense — e.g. 'Summarize in 3 bullets' instead of "
            f"'You should provide a summary using three bullet points'. "
            f"(4) Test the shorter prompt for quality before deploying.\n\n"
            f"WHY: Analysis shows the prompt can be reduced from {original_tokens} to "
            f"~{compressed_tokens} tokens — a {savings:.0f}% reduction that directly "
            f"lowers input token costs on every call."
        )
    elif sug.suggestion_type == "latency_optimization":
        avg_latency = payload.get("avg_latency_ms", "high")
        return (
            f'WHAT TO CHANGE: Enable streaming on API calls for the "{feature}" feature.\n\n'
            f"WHERE: Find the call to your LLM client where feature_tag is set to "
            f'"{feature}" and add stream=True to its parameters.\n\n'
            f"HOW: (1) Add stream=True to the API call. "
            f"(2) Update the calling code to iterate over the stream chunks instead of "
            f"awaiting a single response — e.g. iterate chunk.choices[0].delta.content. "
            f"(3) Add a timeout parameter (e.g. timeout=30) to avoid hanging calls. "
            f"(4) Consider whether a smaller model could also reduce latency.\n\n"
            f"WHY: This feature has an average latency of {avg_latency}ms. Streaming "
            f"makes the first token visible immediately, reducing perceived latency "
            f"significantly without changing model or prompt."
        )
    elif sug.suggestion_type == "anomaly_alert":
        today_cost = payload.get("today_cost", 0.0)
        trailing_avg = payload.get("trailing_avg", 0.0)
        multiplier = payload.get("multiplier", 2.0)
        return (
            f"WHAT TO CHANGE: Investigate the cost spike and add a budget guard to your pipeline.\n\n"
            f"WHERE: Review all LLM calls made today across your project.\n\n"
            f"HOW: (1) Check which feature tags drove the most spend today using the Hotspots page. "
            f"(2) Look for loops, retries, or fan-out patterns that may have caused excessive calls. "
            f"(3) Add a check at the start of your pipeline that compares today's running cost "
            f"against your daily budget threshold and logs a warning if exceeded. "
            f"(4) Review any recent deployments for regressions in call volume or prompt size.\n\n"
            f"WHY: Today's cost (${today_cost:.4f}) is {multiplier:.1f}x the trailing daily "
            f"average (${trailing_avg:.4f}), indicating an unusual spike that warrants investigation."
        )
    else:
        return f"{sug.title}\n\n{sug.description}"
