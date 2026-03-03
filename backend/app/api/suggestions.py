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

    current = sug.current_cost_per_day or 0.0
    projected = sug.projected_cost_per_day or current
    savings_pct = sug.estimated_savings_pct or 0.0

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
    Use an LLM to read the suggestion evidence and generate a valid, complete
    Python code snippet the developer can paste into their codebase.
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
            "You are an expert Python developer helping optimize LLM API usage. "
            "Generate a complete, runnable Python code snippet that implements the fix. "
            "Output ONLY the Python code — no markdown fences, no explanation outside # comments. "
            "Include all necessary imports at the top."
        )

        if sug.suggestion_type == "model_downgrade":
            current_model = payload.get("current_model", payload.get("model", "gpt-4o"))
            target_model = payload.get("target_model", "gpt-4o-mini")
            avg_tokens = payload.get("avg_out_tokens", "~30")
            current_daily = sug.current_cost_per_day or 0.0
            projected_daily = sug.projected_cost_per_day or current_daily * 0.25
            human = (
                f'The "{feature}" feature currently calls {current_model} '
                f"but averages only ~{avg_tokens} output tokens — a simple task.\n"
                f"{target_model} costs ~17x less and handles it just as well.\n"
                f"Current cost: ~${current_daily * 30:.2f}/month → "
                f"Projected: ~${projected_daily * 30:.2f}/month after fix.\n\n"
                "Write a complete Python snippet that:\n"
                "1. Imports openai and llm_monitor\n"
                "2. Wraps the OpenAI client with LLMMonitor\n"
                f"3. Makes the API call using model='{target_model}' "
                f"(was: '{current_model}')\n"
                f"4. Uses feature_tag='{feature}'\n"
                "5. Adds a comment showing the monthly savings estimate"
            )

        elif sug.suggestion_type == "latency_optimization":
            avg_latency = payload.get("avg_latency_ms", "high")
            human = (
                f'The "{feature}" feature has an average latency of {avg_latency}ms.\n\n'
                "Write a Python snippet that reduces latency by:\n"
                "1. Using stream=True so the user sees output immediately\n"
                "2. Setting a request timeout\n"
                "3. Showing how to iterate the stream and print each chunk\n"
                f"4. Including feature_tag='{feature}'\n"
                "5. Adding comments explaining each optimization"
            )

        elif sug.suggestion_type == "anomaly_alert":
            today_cost = payload.get("today_cost", 0.0)
            trailing_avg = payload.get("trailing_avg", 0.0)
            multiplier = payload.get("multiplier", 2.0)
            human = (
                f"Today's LLM cost (${today_cost:.4f}) is {multiplier:.1f}x "
                f"the trailing daily average (${trailing_avg:.4f}).\n\n"
                "Write a Python snippet that:\n"
                "1. Defines a daily budget threshold (e.g. 2x the trailing average)\n"
                "2. Checks if today's cost exceeds the threshold\n"
                "3. Logs a warning with the overage amount\n"
                "4. Can be dropped into a cron job or health-check endpoint\n"
                "5. Uses the llm_monitor SDK to fetch today's cost"
            )

        elif sug.suggestion_type == "prompt_compress":
            compressed = payload.get("compressed_prompt", "")
            savings = sug.estimated_savings_pct or 0
            human = (
                f'The "{feature}" feature\'s prompts can be compressed by ~{savings:.0f}%.\n\n'
                + (
                    f"Compressed system prompt:\n{compressed[:800]}\n\n"
                    if compressed
                    else ""
                )
                + "Write a Python snippet that:\n"
                "1. Shows the ORIGINAL verbose prompt as a comment\n"
                "2. Defines the compressed SYSTEM_PROMPT as a variable\n"
                "3. Uses it in the API call\n"
                f"4. Includes feature_tag='{feature}'"
            )

        else:
            human = (
                f"Suggestion: {sug.title}\n"
                f"Context: {sug.description}\n\n"
                "Write a complete, runnable Python snippet to implement this fix."
            )

        llm = ChatOpenAI(
            model=settings.COMPRESSION_MODEL,
            api_key=settings.OPENAI_API_KEY,
            temperature=0,
            max_tokens=700,
        )
        response = await llm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=human),
        ])
        snippet = (response.content or "").strip()
        return snippet if snippet else _generate_snippet_static(sug)

    except Exception as exc:
        logger.warning("LLM snippet generation failed, using static fallback: %s", exc)
        return _generate_snippet_static(sug)


def _generate_snippet_static(sug: Suggestion) -> str:
    """Static fallback template when the LLM is unavailable."""
    payload = sug.payload or {}
    feature = sug.feature_tag or "your_feature"

    if sug.suggestion_type == "model_downgrade":
        current_model = payload.get("current_model", payload.get("model", "gpt-4o"))
        target_model = payload.get("target_model", "gpt-4o-mini")
        return (
            f"import openai\n"
            f"from llm_monitor import LLMMonitor, feature_tag\n\n"
            f"monitor = LLMMonitor(api_key=YOUR_API_KEY)\n"
            f"client = monitor.wrap_openai(openai.OpenAI())\n\n"
            f"# Switch to cheaper model for feature: {feature}\n"
            f"# {current_model} → {target_model}  (~75% cost reduction)\n"
            f"with feature_tag('{feature}'):\n"
            f"    response = client.chat.completions.create(\n"
            f'        model="{target_model}",  # was: "{current_model}"\n'
            f"        messages=messages,\n"
            f"    )"
        )
    elif sug.suggestion_type == "prompt_compress":
        compressed = payload.get("compressed_prompt", "")
        savings = sug.estimated_savings_pct or 0
        return (
            f"# Compressed prompt for feature: {feature}\n"
            f"# ~{savings:.0f}% token reduction\n\n"
            + (
                f"SYSTEM_PROMPT = '''\n{compressed[:500]}\n'''"
                if compressed
                else "# Paste compressed prompt here"
            )
        )
    elif sug.suggestion_type == "latency_optimization":
        return (
            f"# Reduce latency for feature: {feature}\n"
            f"# Use streaming so the user sees output immediately\n"
            f"import openai\n"
            f"from llm_monitor import LLMMonitor, feature_tag\n\n"
            f"monitor = LLMMonitor(api_key=YOUR_API_KEY)\n"
            f"client = monitor.wrap_openai(openai.OpenAI())\n\n"
            f"with feature_tag('{feature}'):\n"
            f"    stream = client.chat.completions.create(\n"
            f"        model=model,\n"
            f"        messages=messages,\n"
            f"        stream=True,\n"
            f"        timeout=30,\n"
            f"    )\n"
            f"    for chunk in stream:\n"
            f"        delta = chunk.choices[0].delta.content\n"
            f"        if delta:\n"
            f"            print(delta, end='', flush=True)"
        )
    else:
        return f"# {sug.title}\n# {sug.description}"
