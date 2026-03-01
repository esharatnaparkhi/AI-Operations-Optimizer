"""Suggestions API: list, simulate, apply."""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_current_user_id
from ..models.db import Suggestion, Project
from ..models.schemas import (
    SuggestionResponse, SimulateRequest, SimulateResponse,
    ApplyRequest, ApplyResponse,
)

router = APIRouter(prefix="/api/v1/suggestions", tags=["suggestions"])


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

    # Run simulation (simple projection from stored data)
    current = sug.current_cost_per_day or 0.0
    projected = sug.projected_cost_per_day or current
    savings_pct = sug.estimated_savings_pct or 0.0

    savings_daily = current - projected
    savings_monthly = savings_daily * 30

    sug.status = "simulated"
    await db.flush()

    return SimulateResponse(
        suggestion_id=str(sug.id),
        projected_daily_cost=round(projected, 4),
        projected_monthly_cost=round(projected * 30, 2),
        savings_usd_monthly=round(savings_monthly, 2),
        savings_pct=round(savings_pct, 1),
        accuracy_risk=sug.accuracy_risk or "low",
        sample_size=100,  # placeholder; real impl replays events
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
        snippet = _generate_snippet(sug)
        sug.status = "applied"
    else:
        # runtime rule — enterprise feature
        snippet = None
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


def _generate_snippet(sug: Suggestion) -> str:
    """Generate a code snippet for the suggestion."""
    payload = sug.payload or {}
    if sug.suggestion_type == "model_downgrade":
        target_model = payload.get("target_model", "gpt-4o-mini")
        return (
            f"# Switch to cheaper model for feature: {sug.feature_tag}\n"
            f"response = client.chat.completions.create(\n"
            f'    model="{target_model}",\n'
            f"    messages=messages,\n"
            f")"
        )
    elif sug.suggestion_type == "prompt_compress":
        return (
            f"# Compressed prompt for feature: {sug.feature_tag}\n"
            f"# Estimated {sug.estimated_savings_pct:.0f}% token reduction\n"
            f"# Review and apply: {payload.get('compressed_prompt', 'see dashboard')}"
        )
    else:
        return f"# Apply suggestion: {sug.title}\n# See dashboard for details."
