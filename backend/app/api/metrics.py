"""
Metrics API: timeseries, overview, hotspots.
"""
from datetime import date, timedelta, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_current_user_id
from ..models.db import LLMEvent, Project, DailyMetric
from ..models.schemas import DailyMetricResponse, HotspotItem, OverviewResponse

router = APIRouter(prefix="/api/v1/metrics", tags=["metrics"])


async def _get_project(project_id: str, user_id: str, db: AsyncSession):
    r = await db.execute(
        select(Project).where(Project.id == project_id, Project.owner_id == user_id)
    )
    return r.scalar_one_or_none()


@router.get("/{project_id}/overview", response_model=OverviewResponse)
async def get_overview(
    project_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    if not await _get_project(project_id, user_id, db):
        raise HTTPException(status_code=404, detail="Project not found")

    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)

    def _day_query(day: date):
        start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        end = start + timedelta(days=1)

        return select(
            func.sum(LLMEvent.estimated_cost).label("cost"),
            func.sum(LLMEvent.total_tokens).label("tokens"),
            func.count(LLMEvent.id).label("calls"),
            func.avg(LLMEvent.latency_ms).label("avg_latency"),
        ).where(
            LLMEvent.project_id == project_id,
            LLMEvent.timestamp >= start,
            LLMEvent.timestamp < end,
        )

    r_today = await db.execute(_day_query(today))
    row_t = r_today.fetchone()

    r_yesterday = await db.execute(_day_query(yesterday))
    row_y = r_yesterday.fetchone()

    today_cost = row_t.cost or 0.0
    yesterday_cost = row_y.cost or 0.0
    trend = 0.0
    if yesterday_cost:
        trend = ((today_cost - yesterday_cost) / yesterday_cost) * 100

    # Efficiency score: naive heuristic — penalize high avg latency and high error rate
    calls = row_t.calls or 0
    avg_lat = row_t.avg_latency or 0.0
    latency_score = max(0, 100 - (avg_lat / 100))  # <100ms = 100, 10s = 0
    efficiency_score = round(min(100.0, max(0.0, latency_score)), 1)

    return OverviewResponse(
        today_cost=round(today_cost, 4),
        today_tokens=row_t.tokens or 0,
        today_calls=calls,
        avg_latency_ms=round(avg_lat, 1),
        efficiency_score=efficiency_score,
        cost_trend_pct=round(trend, 1),
    )


@router.get("/{project_id}/timeseries", response_model=List[DailyMetricResponse])
async def get_timeseries(
    project_id: str,
    days: int = Query(default=30, ge=1, le=365),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    if not await _get_project(project_id, user_id, db):
        raise HTTPException(status_code=404, detail="Project not found")

    since = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        select(
            func.date(LLMEvent.timestamp).label("date"),
            func.count(LLMEvent.id).label("total_calls"),
            func.sum(LLMEvent.total_tokens).label("total_tokens"),
            func.sum(LLMEvent.estimated_cost).label("total_cost"),
            func.avg(LLMEvent.latency_ms).label("avg_latency_ms"),
            func.sum(
                case((LLMEvent.error.isnot(None), 1), else_=0)
            ).label("error_count"),
        )
        .where(
            LLMEvent.project_id == project_id,
            LLMEvent.timestamp >= since,
        )
        .group_by(func.date(LLMEvent.timestamp))
        .order_by(func.date(LLMEvent.timestamp))
    )
    rows = result.fetchall()
    return [
        DailyMetricResponse(
            date=str(r.date),
            total_calls=r.total_calls or 0,
            total_tokens=r.total_tokens or 0,
            total_cost=round(r.total_cost or 0.0, 6),
            avg_latency_ms=round(r.avg_latency_ms or 0.0, 1),
            error_count=r.error_count or 0,
        )
        for r in rows
    ]


@router.get("/{project_id}/hotspots", response_model=List[HotspotItem])
async def get_hotspots(
    project_id: str,
    days: int = Query(default=7, ge=1, le=90),
    limit: int = Query(default=10, ge=1, le=50),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    if not await _get_project(project_id, user_id, db):
        raise HTTPException(status_code=404, detail="Project not found")

    since = datetime.now(timezone.utc) - timedelta(days=days)

    feature_expr = func.coalesce(LLMEvent.feature_tag, "__untagged__")

    result = await db.execute(
        select(
            feature_expr.label("feature_tag"),
            func.sum(LLMEvent.estimated_cost).label("total_cost"),
            func.sum(LLMEvent.total_tokens).label("total_tokens"),
            func.count(LLMEvent.id).label("total_calls"),
            func.avg(LLMEvent.latency_ms).label("avg_latency_ms"),
        )
        .where(
            LLMEvent.project_id == project_id,
            LLMEvent.timestamp >= since,
        )
        .group_by(feature_expr)
        .order_by(func.sum(LLMEvent.estimated_cost).desc())
        .limit(limit)
    )

    return [
        HotspotItem(
            feature_tag=r.feature_tag,
            total_cost=round(r.total_cost or 0.0, 6),
            total_tokens=r.total_tokens or 0,
            total_calls=r.total_calls or 0,
            avg_latency_ms=round(r.avg_latency_ms or 0.0, 1),
        )
        for r in result.fetchall()
    ]


@router.delete("/{project_id}/feature/{feature_tag}", status_code=204)
async def delete_feature_tag(
    project_id: str,
    feature_tag: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete all LLM events for a given feature tag in this project."""
    if not await _get_project(project_id, user_id, db):
        raise HTTPException(404, "Project not found")

    if feature_tag == "__untagged__":
        await db.execute(
            delete(LLMEvent).where(
                LLMEvent.project_id == project_id,
                LLMEvent.feature_tag.is_(None),
            )
        )
    else:
        await db.execute(
            delete(LLMEvent).where(
                LLMEvent.project_id == project_id,
                LLMEvent.feature_tag == feature_tag,
            )
        )
    await db.commit()