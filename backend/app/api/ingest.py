"""
POST /api/v1/ingest  — receive batched SDK events.
Validates the project key, stores events, queues agent tasks.
"""
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..core.database import get_db
from ..core.auth import get_project_from_key
from ..models.schemas import IngestRequest, IngestResponse
from ..models.db import LLMEvent, Project
from ..agents.tasks import trigger_metrics_aggregation

router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])
logger = logging.getLogger(__name__)


@router.post("", response_model=IngestResponse)
async def ingest_events(
    body: IngestRequest,
    project_key: str = Depends(get_project_from_key),
    db: AsyncSession = Depends(get_db),
):
    # Lookup project by api_key
    result = await db.execute(
        select(Project).where(Project.api_key == project_key)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=401, detail="Unknown project key")

    # De-duplicate by event_id
    incoming_ids = [e.event_id for e in body.events]
    existing = await db.execute(
        select(LLMEvent.event_id).where(LLMEvent.event_id.in_(incoming_ids))
    )
    seen_ids = {row[0] for row in existing.fetchall()}

    queued = 0
    for evt in body.events:
        if evt.event_id in seen_ids:
            continue
        ts = datetime.fromtimestamp(evt.timestamp, tz=timezone.utc)
        record = LLMEvent(
            event_id       = evt.event_id,
            project_id     = project.id,
            timestamp      = ts,
            latency_ms     = evt.latency_ms,
            provider       = evt.provider,
            model          = evt.model,
            endpoint       = evt.endpoint,
            input_tokens   = evt.input_tokens,
            output_tokens  = evt.output_tokens,
            total_tokens   = evt.total_tokens,
            estimated_cost = evt.estimated_cost_usd,
            feature_tag    = evt.feature_tag,
            user_id        = evt.user_id,
            session_id     = evt.session_id,
            rag_chunks     = evt.rag_chunks,
            error          = evt.error,
            status_code    = evt.status_code,
        )
        db.add(record)
        queued += 1

    await db.flush()

    # Trigger async aggregation (non-blocking)
    if queued:
        try:
            trigger_metrics_aggregation.delay(str(project.id))
        except Exception as exc:
            logger.debug("Could not enqueue aggregation task (Celery may not be running): %s", exc)

    return IngestResponse(received=len(body.events), queued=queued)
