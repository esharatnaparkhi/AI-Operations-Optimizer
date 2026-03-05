"""
Celery agent tasks — fully powered by LangChain.

Each Celery task builds a LangChain AgentExecutor backed by OpenAI tool-calling
and invokes it with a natural-language objective.  All DB operations and the
prompt-compression LLM call are exposed as @tool functions so the agent can
decide what to query and when to save a suggestion.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone

from celery import shared_task
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

from ..core.config import get_settings
from ..models.db import LLMEvent, Project, Suggestion

logger = logging.getLogger(__name__)
settings = get_settings()

_sync_engine = None


def get_sync_session() -> Session:
    global _sync_engine
    if _sync_engine is None:
        _sync_engine = create_engine(settings.SYNC_DATABASE_URL, pool_pre_ping=True)
    return Session(_sync_engine)


# ── Mode helpers ──────────────────────────────────────────────

def _parse_interval_hours(mode: str) -> int:
    """Return interval in hours: 0 for 'instant', N for 'Nh', 24 for legacy/unknown."""
    if mode == "instant":
        return 0
    if mode.endswith("h") and mode[:-1].isdigit():
        return int(mode[:-1])
    return 24  # fallback for legacy "balanced" / "conservative"


def _get_thresholds(mode: str) -> dict:
    """
    Compute analysis thresholds from the suggestion mode.
    Instant mode uses a 1-day window with very low thresholds.
    Interval modes (e.g. '6h', '24h') scale the window with the interval.
    """
    hours = _parse_interval_hours(mode)
    days = max(1, hours // 24) if hours else 1
    if hours == 0:  # instant
        return {
            "days_window":        1,
            "min_cost":           0.0001,
            "max_avg_out_tokens": 50,
            "latency_ms":         2000,
            "latency_min_calls":  1,
            "spike_multiplier":   1.5,
            "spike_min_cost":     0.001,
        }
    return {
        "days_window":        days,
        "min_cost":           max(0.001, 0.001 * days),
        "max_avg_out_tokens": 35,
        "latency_ms":         3000,
        "latency_min_calls":  max(1, hours // 6),
        "spike_multiplier":   2.5,
        "spike_min_cost":     max(0.005, 0.005 * days),
    }


def _should_run(project_id: str, mode: str) -> bool:
    """
    For 'instant' mode always returns True.
    For interval modes ('Nh') returns True only if enough time has elapsed
    since the last suggestion was created for this project.
    """
    hours = _parse_interval_hours(mode)
    if hours == 0:
        return True
    with get_sync_session() as db:
        last_created = db.execute(
            select(func.max(Suggestion.created_at)).where(
                Suggestion.project_id == project_id
            )
        ).scalar()
    if last_created is None:
        return True
    elapsed = (datetime.now(timezone.utc) - last_created).total_seconds() / 3600
    return elapsed >= hours


# ── LangChain Tools ───────────────────────────────────────────

@tool
def list_all_projects() -> str:
    """
    Return all projects as a JSON list.
    Each entry has: id, name, suggestion_mode.
    Call this first to discover which project IDs to analyze.
    """
    with get_sync_session() as db:
        projects = db.execute(select(Project)).scalars().all()
        return json.dumps([
            {
                "id": str(p.id),
                "name": p.name,
                "suggestion_mode": getattr(p, "suggestion_mode", "balanced") or "balanced",
            }
            for p in projects
        ])


@tool
def find_expensive_model_features(project_id: str) -> str:
    """
    Find feature tags that use expensive frontier models (gpt-4o, gpt-4-turbo,
    claude-3-opus) on simple tasks with low average output tokens.
    Thresholds are derived from the project's suggestion_mode.

    Returns a JSON list of findings. Each finding has:
      feature_tag, model, avg_out_tokens, total_cost, daily_cost,
      target_model, days_window, suggestion_mode.
    An empty list means no findings.
    """
    cheaper = {
        "gpt-4o": "gpt-4o-mini",
        "gpt-4-turbo": "gpt-4o-mini",
        "claude-3-opus": "claude-3-haiku",
    }
    with get_sync_session() as db:
        project = db.execute(
            select(Project).where(Project.id == project_id)
        ).scalar_one_or_none()
        if not project:
            return json.dumps([])

        mode = getattr(project, "suggestion_mode", "instant") or "instant"
        t = _get_thresholds(mode)
        since = (date.today() - timedelta(days=t["days_window"])).isoformat()

        rows = db.execute(
            select(
                LLMEvent.feature_tag,
                LLMEvent.model,
                func.avg(LLMEvent.output_tokens).label("avg_out"),
                func.sum(LLMEvent.estimated_cost).label("total_cost"),
            )
            .where(
                LLMEvent.project_id == project_id,
                func.date(LLMEvent.timestamp) >= since,
                LLMEvent.model.in_(list(cheaper.keys())),
            )
            .group_by(LLMEvent.feature_tag, LLMEvent.model)
            .having(func.avg(LLMEvent.output_tokens) < t["max_avg_out_tokens"])
            .having(func.sum(LLMEvent.estimated_cost) > t["min_cost"])
        ).fetchall()

        return json.dumps([
            {
                "feature_tag": row.feature_tag,
                "model": row.model,
                "avg_out_tokens": round(float(row.avg_out), 1),
                "total_cost": round(float(row.total_cost), 6),
                "daily_cost": round(float(row.total_cost) / max(t["days_window"], 1), 6),
                "target_model": cheaper.get(row.model, "gpt-4o-mini"),
                "days_window": t["days_window"],
                "suggestion_mode": mode,
            }
            for row in rows
        ])


@tool
def find_high_latency_features(project_id: str) -> str:
    """
    Find feature tags with high average latency.
    Thresholds are derived from the project's suggestion_mode.

    Returns a JSON list of findings. Each finding has:
      feature_tag, avg_latency_ms, daily_cost, days_window, suggestion_mode.
    An empty list means no findings.
    """
    with get_sync_session() as db:
        project = db.execute(
            select(Project).where(Project.id == project_id)
        ).scalar_one_or_none()
        if not project:
            return json.dumps([])

        mode = getattr(project, "suggestion_mode", "instant") or "instant"
        t = _get_thresholds(mode)
        since = (date.today() - timedelta(days=t["days_window"])).isoformat()

        rows = db.execute(
            select(
                LLMEvent.feature_tag,
                func.avg(LLMEvent.latency_ms).label("avg_lat"),
                func.sum(LLMEvent.estimated_cost).label("cost"),
            )
            .where(
                LLMEvent.project_id == project_id,
                func.date(LLMEvent.timestamp) >= since,
            )
            .group_by(LLMEvent.feature_tag)
            .having(func.avg(LLMEvent.latency_ms) > t["latency_ms"])
            .having(func.count(LLMEvent.id) >= t["latency_min_calls"])
        ).fetchall()

        return json.dumps([
            {
                "feature_tag": row.feature_tag,
                "avg_latency_ms": round(float(row.avg_lat), 1),
                "daily_cost": round(float(row.cost) / max(t["days_window"], 1), 6),
                "days_window": t["days_window"],
                "suggestion_mode": mode,
            }
            for row in rows
        ])


@tool
def detect_cost_spike(project_id: str) -> str:
    """
    Check whether today's LLM spend for a project is anomalously high
    compared to the trailing daily average.
    Thresholds are derived from the project's suggestion_mode.

    Returns JSON with keys:
      spike (bool), today_cost, trailing_avg, multiplier, days_window, suggestion_mode.
    """
    with get_sync_session() as db:
        project = db.execute(
            select(Project).where(Project.id == project_id)
        ).scalar_one_or_none()
        if not project:
            return json.dumps({"spike": False})

        mode = getattr(project, "suggestion_mode", "instant") or "instant"
        t = _get_thresholds(mode)
        today_str = date.today().isoformat()
        since = (date.today() - timedelta(days=t["days_window"])).isoformat()

        today_cost = db.execute(
            select(func.sum(LLMEvent.estimated_cost)).where(
                LLMEvent.project_id == project_id,
                func.date(LLMEvent.timestamp) == today_str,
            )
        ).scalar() or 0.0

        # Compute trailing average as the mean of per-day totals (not per-event avg)
        daily_sums_subq = (
            select(func.sum(LLMEvent.estimated_cost).label("day_total"))
            .where(
                LLMEvent.project_id == project_id,
                func.date(LLMEvent.timestamp) >= since,
                func.date(LLMEvent.timestamp) < today_str,
            )
            .group_by(func.date(LLMEvent.timestamp))
            .subquery()
        )
        trailing_avg = db.execute(
            select(func.avg(daily_sums_subq.c.day_total))
        ).scalar() or 0.0

        is_spike = (
            today_cost > trailing_avg * t["spike_multiplier"]
            and today_cost > t["spike_min_cost"]
        )
        return json.dumps({
            "spike": is_spike,
            "today_cost": round(float(today_cost), 6),
            "trailing_avg": round(float(trailing_avg), 6),
            "multiplier": round(float(today_cost) / max(float(trailing_avg), 0.0001), 2),
            "days_window": t["days_window"],
            "suggestion_mode": mode,
        })


@tool
def pending_suggestion_exists(
    project_id: str,
    suggestion_type: str,
    feature_tag: str = "",
) -> str:
    """
    Check whether a pending or simulated suggestion already exists to avoid duplicates.
    For anomaly_alert, pass feature_tag as an empty string — today's date is also checked.
    Returns the string 'true' or 'false'.
    """
    with get_sync_session() as db:
        q = select(Suggestion).where(
            Suggestion.project_id == project_id,
            Suggestion.suggestion_type == suggestion_type,
        )
        if suggestion_type == "anomaly_alert":
            today_str = date.today().isoformat()
            q = q.where(
                Suggestion.status == "pending",
                func.date(Suggestion.created_at) == today_str,
            )
        else:
            q = q.where(
                Suggestion.feature_tag == feature_tag,
                Suggestion.status.in_(["pending", "simulated"]),
            )
        existing = db.execute(q).scalar_one_or_none()
        return "true" if existing else "false"


@tool
def save_suggestion(
    project_id: str,
    suggestion_type: str,
    title: str,
    description: str,
    accuracy_risk: str,
    confidence: float,
    estimated_savings_pct: float,
    current_cost_per_day: float,
    projected_cost_per_day: float,
    payload_json: str,
    feature_tag: str = "",
) -> str:
    """
    Persist a new Suggestion row to the database.

    Args:
        suggestion_type: one of model_downgrade, latency_optimization,
                         anomaly_alert, prompt_compress.
        accuracy_risk:   low, medium, or high.
        confidence:      float 0-1.
        payload_json:    a valid JSON string with supporting evidence.
        feature_tag:     leave empty for project-level suggestions (e.g. anomaly_alert).
        current_cost_per_day / projected_cost_per_day: pass 0.0 when not applicable.

    Returns 'saved' on success.
    """
    with get_sync_session() as db:
        # Final DB-level duplicate guard to handle concurrent agent runs
        dup_q = select(Suggestion).where(
            Suggestion.project_id == project_id,
            Suggestion.suggestion_type == suggestion_type,
        )
        if suggestion_type == "anomaly_alert":
            today_str = date.today().isoformat()
            dup_q = dup_q.where(
                Suggestion.status == "pending",
                func.date(Suggestion.created_at) == today_str,
            )
        else:
            dup_q = dup_q.where(
                Suggestion.feature_tag == (feature_tag or None),
                Suggestion.status.in_(["pending", "simulated"]),
            )
        if db.execute(dup_q).scalar_one_or_none():
            return "duplicate_skipped"

        db.add(Suggestion(
            project_id=project_id,
            suggestion_type=suggestion_type,
            feature_tag=feature_tag or None,
            title=title,
            description=description,
            current_cost_per_day=current_cost_per_day if current_cost_per_day is not None else None,
            projected_cost_per_day=projected_cost_per_day if projected_cost_per_day is not None else None,
            estimated_savings_pct=estimated_savings_pct,
            accuracy_risk=accuracy_risk,
            confidence=confidence,
            payload=json.loads(payload_json),
        ))
        db.commit()
    return "saved"


@tool
def compress_prompt_text(prompt: str) -> str:
    """
    Compress a prompt using a cheap LLM to reduce token usage.
    Returns JSON with keys:
      original_tokens, compressed_tokens, savings_pct, compressed_prompt.
    Returns {error: ...} if OPENAI_API_KEY is not configured.
    """
    if not settings.OPENAI_API_KEY:
        return json.dumps({"error": "OPENAI_API_KEY not set"})

    from langchain_core.messages import SystemMessage, HumanMessage

    llm = ChatOpenAI(
        model=settings.COMPRESSION_MODEL,
        api_key=settings.OPENAI_API_KEY,
        max_tokens=2048,
    )

    original_tokens = llm.get_num_tokens(prompt)
    response = llm.invoke([
        SystemMessage(content=(
            "You are a prompt compression expert. Rewrite the following prompt "
            "to be as concise as possible while preserving all instructions and context. "
            "Output ONLY the compressed prompt, nothing else."
        )),
        HumanMessage(content=prompt),
    ])
    compressed = response.content or ""
    compressed_tokens = llm.get_num_tokens(compressed)
    savings_pct = ((original_tokens - compressed_tokens) / max(original_tokens, 1)) * 100

    return json.dumps({
        "original_tokens": original_tokens,
        "compressed_tokens": compressed_tokens,
        "savings_pct": round(savings_pct, 1),
        "compressed_prompt": compressed[:2000],
    })


# ── Direct analysis (no LLM needed for heuristics) ────────────

def _run_project_analysis(project_id: str) -> dict:
    """
    Run all three heuristic checks (model downgrade, high latency, cost spike)
    directly via DB queries — zero LLM calls.
    Creates Suggestion rows for any findings, skipping duplicates atomically.
    """
    cheaper = {
        "gpt-4o": "gpt-4o-mini",
        "gpt-4-turbo": "gpt-4o-mini",
        "claude-3-opus": "claude-3-haiku",
    }
    created: list[str] = []

    with get_sync_session() as db:
        project = db.execute(
            select(Project).where(Project.id == project_id)
        ).scalar_one_or_none()
        if not project:
            return {"status": "skipped", "reason": "project not found"}

        mode = project.suggestion_mode or "instant"
        t = _get_thresholds(mode)
        today_str = date.today().isoformat()
        since_str = (date.today() - timedelta(days=t["days_window"])).isoformat()

        # ── 1. MODEL DOWNGRADE ──────────────────────────────────
        rows = db.execute(
            select(
                LLMEvent.feature_tag,
                LLMEvent.model,
                func.avg(LLMEvent.output_tokens).label("avg_out"),
                func.sum(LLMEvent.estimated_cost).label("total_cost"),
            )
            .where(
                LLMEvent.project_id == project_id,
                func.date(LLMEvent.timestamp) >= since_str,
                LLMEvent.model.in_(list(cheaper.keys())),
            )
            .group_by(LLMEvent.feature_tag, LLMEvent.model)
            .having(func.avg(LLMEvent.output_tokens) < t["max_avg_out_tokens"])
            .having(func.sum(LLMEvent.estimated_cost) > t["min_cost"])
        ).fetchall()

        for row in rows:
            tag = row.feature_tag or ""
            target = cheaper.get(row.model, "gpt-4o-mini")
            daily_cost = round(float(row.total_cost) / max(t["days_window"], 1), 6)
            avg_out = round(float(row.avg_out), 1)
            tag_label = tag or "untagged"

            dup = db.execute(
                select(Suggestion).where(
                    Suggestion.project_id == project_id,
                    Suggestion.suggestion_type == "model_downgrade",
                    Suggestion.feature_tag == (tag or None),
                    Suggestion.status.in_(["pending", "simulated"]),
                )
            ).scalar_one_or_none()
            if dup:
                continue

            db.add(Suggestion(
                project_id=project_id,
                suggestion_type="model_downgrade",
                feature_tag=tag or None,
                title=f"Switch '{tag_label}' from {row.model} to {target}",
                description=(
                    f"The '{tag_label}' feature uses {row.model} but averages only "
                    f"{avg_out} output tokens — a simple task. {target} handles it "
                    f"equally well at ~75% lower cost."
                ),
                current_cost_per_day=daily_cost,
                projected_cost_per_day=round(daily_cost * 0.25, 6),
                estimated_savings_pct=75.0,
                accuracy_risk="low",
                confidence=0.85,
                payload={
                    "current_model": row.model,
                    "target_model": target,
                    "avg_out_tokens": avg_out,
                    "days_window": t["days_window"],
                    "suggestion_mode": mode,
                },
            ))
            created.append(f"model_downgrade:{tag_label}")

        # ── 2. LATENCY OPTIMIZATION ─────────────────────────────
        rows = db.execute(
            select(
                LLMEvent.feature_tag,
                func.avg(LLMEvent.latency_ms).label("avg_lat"),
                func.sum(LLMEvent.estimated_cost).label("cost"),
            )
            .where(
                LLMEvent.project_id == project_id,
                func.date(LLMEvent.timestamp) >= since_str,
            )
            .group_by(LLMEvent.feature_tag)
            .having(func.avg(LLMEvent.latency_ms) > t["latency_ms"])
            .having(func.count(LLMEvent.id) >= t["latency_min_calls"])
        ).fetchall()

        for row in rows:
            tag = row.feature_tag or ""
            daily_cost = round(float(row.cost) / max(t["days_window"], 1), 6)
            avg_lat = round(float(row.avg_lat), 1)
            tag_label = tag or "untagged"

            dup = db.execute(
                select(Suggestion).where(
                    Suggestion.project_id == project_id,
                    Suggestion.suggestion_type == "latency_optimization",
                    Suggestion.feature_tag == (tag or None),
                    Suggestion.status.in_(["pending", "simulated"]),
                )
            ).scalar_one_or_none()
            if dup:
                continue

            db.add(Suggestion(
                project_id=project_id,
                suggestion_type="latency_optimization",
                feature_tag=tag or None,
                title=f"Reduce latency for '{tag_label}' ({int(avg_lat)}ms avg)",
                description=(
                    f"The '{tag_label}' feature averages {int(avg_lat)}ms per call. "
                    f"Enabling streaming makes responses feel instant — the user sees "
                    f"output as it's generated instead of waiting for the full reply."
                ),
                current_cost_per_day=daily_cost,
                projected_cost_per_day=round(daily_cost * 0.9, 6),
                estimated_savings_pct=10.0,
                accuracy_risk="low",
                confidence=0.70,
                payload={
                    "avg_latency_ms": avg_lat,
                    "daily_cost": daily_cost,
                    "days_window": t["days_window"],
                    "suggestion_mode": mode,
                },
            ))
            created.append(f"latency_optimization:{tag_label}")

        # ── 3. ANOMALY / COST SPIKE ─────────────────────────────
        today_cost = db.execute(
            select(func.sum(LLMEvent.estimated_cost)).where(
                LLMEvent.project_id == project_id,
                func.date(LLMEvent.timestamp) == today_str,
            )
        ).scalar() or 0.0

        daily_sums_subq = (
            select(func.sum(LLMEvent.estimated_cost).label("day_total"))
            .where(
                LLMEvent.project_id == project_id,
                func.date(LLMEvent.timestamp) >= since_str,
                func.date(LLMEvent.timestamp) < today_str,
            )
            .group_by(func.date(LLMEvent.timestamp))
            .subquery()
        )
        trailing_avg = db.execute(
            select(func.avg(daily_sums_subq.c.day_total))
        ).scalar() or 0.0

        is_spike = (
            float(today_cost) > float(trailing_avg) * t["spike_multiplier"]
            and float(today_cost) > t["spike_min_cost"]
        )
        if is_spike:
            dup = db.execute(
                select(Suggestion).where(
                    Suggestion.project_id == project_id,
                    Suggestion.suggestion_type == "anomaly_alert",
                    Suggestion.status == "pending",
                    func.date(Suggestion.created_at) == today_str,
                )
            ).scalar_one_or_none()
            if not dup:
                multiplier = round(float(today_cost) / max(float(trailing_avg), 0.0001), 2)
                db.add(Suggestion(
                    project_id=project_id,
                    suggestion_type="anomaly_alert",
                    feature_tag=None,
                    title=f"Unusual cost spike: {multiplier:.1f}× your daily average",
                    description=(
                        f"Today's spend (${float(today_cost):.4f}) is {multiplier:.1f}× "
                        f"higher than your trailing daily average (${float(trailing_avg):.4f}). "
                        f"This may indicate a bug, retry loop, or unexpected surge in calls."
                    ),
                    current_cost_per_day=float(today_cost),
                    projected_cost_per_day=float(trailing_avg),
                    estimated_savings_pct=0.0,
                    accuracy_risk="medium",
                    confidence=0.90,
                    payload={
                        "today_cost": round(float(today_cost), 6),
                        "trailing_avg": round(float(trailing_avg), 6),
                        "multiplier": multiplier,
                        "days_window": t["days_window"],
                        "suggestion_mode": mode,
                    },
                ))
                created.append("anomaly_alert")

        db.commit()

    logger.info("Project %s analysis: %s", project_id, created or "no new suggestions")
    return {"status": "ok", "created": created}


# ── Celery Tasks ──────────────────────────────────────────────

@shared_task(name="app.agents.tasks.trigger_metrics_aggregation")
def trigger_metrics_aggregation(project_id: str) -> None:
    """Analyse a single project after each ingest batch (no LLM calls).

    Fires immediately for 'instant' mode projects.
    For interval modes ('Nh') it skips if not enough time has elapsed since
    the last suggestion was created.
    """
    with get_sync_session() as db:
        project = db.execute(
            select(Project).where(Project.id == project_id)
        ).scalar_one_or_none()
        if not project:
            return
        mode = project.suggestion_mode or "instant"
    if not _should_run(project_id, mode):
        logger.debug("Skipping project %s — within cooldown for mode '%s'", project_id, mode)
        return
    _run_project_analysis(project_id)


@shared_task(name="app.agents.tasks.run_heuristic_agent")
def run_heuristic_agent() -> dict:
    """Periodic sweep: analyse every interval-mode project that is due (no LLM calls)."""
    with get_sync_session() as db:
        projects = db.execute(select(Project)).scalars().all()
        due = [
            str(p.id) for p in projects
            if (p.suggestion_mode or "instant") != "instant"
            and _should_run(str(p.id), p.suggestion_mode or "24h")
        ]

    if not due:
        logger.info("Heuristic sweep: no interval-mode projects due")
        return {"status": "ok", "output": "no projects due"}

    logger.info("Heuristic sweep: %d project(s) due — %s", len(due), due)
    results = [_run_project_analysis(pid) for pid in due]
    return {"status": "ok", "results": results}


@shared_task(name="app.agents.tasks.run_anomaly_agent")
def run_anomaly_agent() -> dict:
    """Check all projects for cost spikes (no LLM calls)."""
    logger.info("Anomaly sweep: checking all projects")
    with get_sync_session() as db:
        project_ids = [str(p.id) for p in db.execute(select(Project)).scalars().all()]
    results = [_run_project_analysis(pid) for pid in project_ids]
    return {"status": "ok", "results": results}


@shared_task(name="app.agents.tasks.run_compression_agent")
def run_compression_agent(project_id: str, feature_tag: str, sample_prompt: str) -> dict:
    """Compress a sample prompt and save a suggestion if savings > 10% (1 LLM call only)."""
    if not settings.OPENAI_API_KEY:
        logger.warning("Compression agent: OPENAI_API_KEY not set, skipping")
        return {"status": "skipped"}

    logger.info("Compression running for project %s / tag '%s'", project_id, feature_tag)

    # Single LLM call for compression
    result = json.loads(compress_prompt_text(sample_prompt))
    if "error" in result:
        return {"status": "error", "message": result["error"]}

    savings_pct = result.get("savings_pct", 0)
    if savings_pct <= 10:
        return {"status": "ok", "output": "savings too small, skipped"}

    original_tokens = result["original_tokens"]
    compressed_tokens = result["compressed_tokens"]
    compressed_prompt = result.get("compressed_prompt", "")
    tag_label = feature_tag or "untagged"

    with get_sync_session() as db:
        # Get feature daily cost for before/after
        since_str = (date.today() - timedelta(days=7)).isoformat()
        total_cost = db.execute(
            select(func.sum(LLMEvent.estimated_cost)).where(
                LLMEvent.project_id == project_id,
                LLMEvent.feature_tag == (feature_tag or None),
                func.date(LLMEvent.timestamp) >= since_str,
            )
        ).scalar() or 0.0
        daily_cost = round(float(total_cost) / 7, 6)

        dup = db.execute(
            select(Suggestion).where(
                Suggestion.project_id == project_id,
                Suggestion.suggestion_type == "prompt_compress",
                Suggestion.feature_tag == (feature_tag or None),
                Suggestion.status.in_(["pending", "simulated"]),
            )
        ).scalar_one_or_none()
        if dup:
            return {"status": "ok", "output": "duplicate_skipped"}

        db.add(Suggestion(
            project_id=project_id,
            suggestion_type="prompt_compress",
            feature_tag=feature_tag or None,
            title=f"Compress '{tag_label}' prompts ({savings_pct:.0f}% token reduction)",
            description=(
                f"The '{tag_label}' feature's prompts can be shortened by ~{savings_pct:.0f}% "
                f"(from {original_tokens} to ~{compressed_tokens} tokens) with no loss of meaning. "
                f"Shorter prompts reduce input token costs on every call."
            ),
            current_cost_per_day=daily_cost,
            projected_cost_per_day=round(daily_cost * (1 - savings_pct / 100), 6),
            estimated_savings_pct=savings_pct,
            accuracy_risk="medium",
            confidence=0.65,
            payload={
                "original_tokens": original_tokens,
                "compressed_tokens": compressed_tokens,
                "compressed_prompt": compressed_prompt,
                "savings_pct": savings_pct,
                "days_window": 7,
            },
        ))
        db.commit()

    return {"status": "ok", "output": f"prompt_compress created for '{feature_tag}'"}
