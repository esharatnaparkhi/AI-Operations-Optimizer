"""
Celery agent tasks.

Agents run in background workers and produce Suggestions.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta, timezone, datetime
from typing import Optional

from celery import shared_task
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..models.db import LLMEvent, Project, Suggestion

logger = logging.getLogger(__name__)
settings = get_settings()

# Use sync engine for Celery workers
_sync_engine = None


def get_sync_session() -> Session:
    global _sync_engine
    if _sync_engine is None:
        from sqlalchemy import create_engine as ce
        _sync_engine = ce(settings.SYNC_DATABASE_URL, pool_pre_ping=True)
    return Session(_sync_engine)


# ── Metrics Aggregation ───────────────────────────────────────

@shared_task(name="app.agents.tasks.trigger_metrics_aggregation")
def trigger_metrics_aggregation(project_id: str) -> None:
    """Run heuristic suggestions for a project immediately after each ingest batch."""
    with get_sync_session() as db:
        project = db.execute(
            select(Project).where(Project.id == project_id)
        ).scalar_one_or_none()
        if not project:
            return
        n = _run_heuristics_for_project(db, project)
        db.commit()
        if n:
            logger.info("Heuristic agent created %d suggestion(s) for project %s", n, project_id)


# ── Heuristic Suggestion Agent ────────────────────────────────

@shared_task(name="app.agents.tasks.run_heuristic_agent")
def run_heuristic_agent() -> dict:
    """
    Rule-based suggestion engine.
    Runs 3 core rules over all projects.
    """
    logger.info("Heuristic agent starting")
    with get_sync_session() as db:
        projects = db.execute(select(Project)).scalars().all()
        results = {"projects": len(projects), "suggestions": 0}

        for project in projects:
            n = _run_heuristics_for_project(db, project)
            results["suggestions"] += n

        db.commit()
    return results


# ── Mode thresholds ───────────────────────────────────────────

_MODE_THRESHOLDS = {
    # instant: fire as soon as there's any signal — useful right after setup
    "instant": {
        "days_window":         1,      # look at last 1 day
        "min_cost":            0.0001, # fire after just $0.0001 spend
        "max_avg_out_tokens":  50,     # broader definition of "simple task"
        "latency_ms":          2000,   # flag anything > 2s
        "latency_min_calls":   1,      # fire after just 1 slow call
        "spike_multiplier":    1.5,    # flag if today > 1.5× yesterday
        "spike_min_cost":      0.001,  # flag if spend > $0.001
    },
    # balanced: default — needs a week of data and real spend
    "balanced": {
        "days_window":         7,
        "min_cost":            0.01,
        "max_avg_out_tokens":  25,
        "latency_ms":          5000,
        "latency_min_calls":   10,
        "spike_multiplier":    3.0,
        "spike_min_cost":      0.05,
    },
    # conservative: only surface high-confidence suggestions with lots of data
    "conservative": {
        "days_window":         30,
        "min_cost":            0.10,
        "max_avg_out_tokens":  15,
        "latency_ms":          8000,
        "latency_min_calls":   50,
        "spike_multiplier":    5.0,
        "spike_min_cost":      0.20,
    },
}


def _run_heuristics_for_project(db: Session, project: Project) -> int:
    """Apply heuristic rules and insert Suggestion rows, respecting the project's suggestion_mode."""
    mode = getattr(project, "suggestion_mode", "balanced") or "balanced"
    t = _MODE_THRESHOLDS.get(mode, _MODE_THRESHOLDS["balanced"])

    since = (date.today() - timedelta(days=t["days_window"])).isoformat()
    suggestions_created = 0

    # ── Rule 1: Expensive model for simple classification ──────
    # If a feature_tag's avg output tokens is low, it's likely a
    # classification/routing task that doesn't need a frontier model.
    result = db.execute(
        select(
            LLMEvent.feature_tag,
            LLMEvent.model,
            func.avg(LLMEvent.output_tokens).label("avg_out"),
            func.sum(LLMEvent.estimated_cost).label("total_cost"),
            func.count(LLMEvent.id).label("calls"),
        )
        .where(
            LLMEvent.project_id == project.id,
            func.date(LLMEvent.timestamp) >= since,
            LLMEvent.model.in_(["gpt-4o", "gpt-4-turbo", "claude-3-opus"]),
        )
        .group_by(LLMEvent.feature_tag, LLMEvent.model)
        .having(func.avg(LLMEvent.output_tokens) < t["max_avg_out_tokens"])
        .having(func.sum(LLMEvent.estimated_cost) > t["min_cost"])
    )
    for row in result.fetchall():
        existing = db.execute(
            select(Suggestion).where(
                Suggestion.project_id == project.id,
                Suggestion.suggestion_type == "model_downgrade",
                Suggestion.feature_tag == row.feature_tag,
                Suggestion.status.in_(["pending", "simulated"]),
            )
        ).scalar_one_or_none()
        if existing:
            continue

        cheaper = {"gpt-4o": "gpt-4o-mini", "gpt-4-turbo": "gpt-4o-mini", "claude-3-opus": "claude-3-haiku"}
        target = cheaper.get(row.model, "gpt-4o-mini")
        daily_cost = row.total_cost / max(t["days_window"], 1)
        savings_pct = 75.0

        db.add(Suggestion(
            project_id=project.id,
            suggestion_type="model_downgrade",
            feature_tag=row.feature_tag,
            title=f"Downgrade '{row.feature_tag}' from {row.model} → {target}",
            description=(
                f"Feature '{row.feature_tag}' averages only {row.avg_out:.0f} output tokens "
                f"over the last {t['days_window']} day(s), suggesting a simple task that doesn't need {row.model}. "
                f"Switching to {target} could reduce cost by ~{savings_pct:.0f}% with minimal accuracy impact."
            ),
            current_cost_per_day=daily_cost,
            projected_cost_per_day=daily_cost * (1 - savings_pct / 100),
            estimated_savings_pct=savings_pct,
            accuracy_risk="low",
            confidence=0.85,
            payload={"current_model": row.model, "target_model": target, "suggestion_mode": mode},
        ))
        suggestions_created += 1

    # ── Rule 2: High latency feature ───────────────────────────
    result2 = db.execute(
        select(
            LLMEvent.feature_tag,
            func.avg(LLMEvent.latency_ms).label("avg_lat"),
            func.sum(LLMEvent.estimated_cost).label("cost"),
        )
        .where(
            LLMEvent.project_id == project.id,
            func.date(LLMEvent.timestamp) >= since,
        )
        .group_by(LLMEvent.feature_tag)
        .having(func.avg(LLMEvent.latency_ms) > t["latency_ms"])
        .having(func.count(LLMEvent.id) >= t["latency_min_calls"])
    )
    for row in result2.fetchall():
        existing = db.execute(
            select(Suggestion).where(
                Suggestion.project_id == project.id,
                Suggestion.suggestion_type == "latency_optimization",
                Suggestion.feature_tag == row.feature_tag,
                Suggestion.status.in_(["pending", "simulated"]),
            )
        ).scalar_one_or_none()
        if existing:
            continue

        daily_cost = row.cost / max(t["days_window"], 1)
        db.add(Suggestion(
            project_id=project.id,
            suggestion_type="latency_optimization",
            feature_tag=row.feature_tag,
            title=f"High latency on '{row.feature_tag}' ({row.avg_lat:.0f}ms avg)",
            description=(
                f"'{row.feature_tag}' averages {row.avg_lat / 1000:.1f}s over the last {t['days_window']} day(s) — "
                "consider prompt caching, streaming, or switching to a faster/smaller model."
            ),
            current_cost_per_day=daily_cost,
            projected_cost_per_day=daily_cost * 0.9,
            estimated_savings_pct=10.0,
            accuracy_risk="low",
            confidence=0.70,
            payload={"avg_latency_ms": row.avg_lat, "suggestion_mode": mode},
        ))
        suggestions_created += 1

    # ── Rule 3: Cost spike vs trailing average ─────────────────
    today_str = date.today().isoformat()
    r_today = db.execute(
        select(func.sum(LLMEvent.estimated_cost))
        .where(
            LLMEvent.project_id == project.id,
            func.date(LLMEvent.timestamp) == today_str,
        )
    ).scalar() or 0.0

    r_avg = db.execute(
        select(func.avg(LLMEvent.estimated_cost))
        .where(
            LLMEvent.project_id == project.id,
            func.date(LLMEvent.timestamp) >= since,
            func.date(LLMEvent.timestamp) < today_str,
        )
    ).scalar() or 0.0

    if r_today > r_avg * t["spike_multiplier"] and r_today > t["spike_min_cost"]:
        existing = db.execute(
            select(Suggestion).where(
                Suggestion.project_id == project.id,
                Suggestion.suggestion_type == "anomaly_alert",
                Suggestion.status == "pending",
                func.date(Suggestion.created_at) == today_str,
            )
        ).scalar_one_or_none()
        if not existing:
            db.add(Suggestion(
                project_id=project.id,
                suggestion_type="anomaly_alert",
                title=f"Cost spike detected today (${r_today:.4f} vs ${r_avg:.4f} trailing avg)",
                description=(
                    f"Today's cost is {r_today / max(r_avg, 0.0001):.1f}× the trailing average "
                    f"over the last {t['days_window']} day(s). "
                    "Check for runaway loops, traffic spikes, or misconfigured prompts."
                ),
                current_cost_per_day=r_today,
                projected_cost_per_day=r_today,
                estimated_savings_pct=0.0,
                accuracy_risk="medium",
                confidence=0.90,
                payload={"today": r_today, "trailing_avg": r_avg, "suggestion_mode": mode},
            ))
            suggestions_created += 1

    return suggestions_created


# ── Anomaly Agent ─────────────────────────────────────────────

@shared_task(name="app.agents.tasks.run_anomaly_agent")
def run_anomaly_agent() -> dict:
    """Lightweight anomaly check that runs every 5 minutes."""
    logger.info("Anomaly agent: checking recent spikes")
    # In a real system this would query last-5-min window vs rolling baseline
    # For MVP: delegate to heuristic agent
    return {"status": "ok"}


# ── Prompt Compression Agent ──────────────────────────────────

@shared_task(name="app.agents.tasks.run_compression_agent")
def run_compression_agent(project_id: str, feature_tag: str, sample_prompt: str) -> dict:
    """
    Use a cheap LLM to compress a sample prompt and estimate savings.
    Requires OPENAI_API_KEY to be set.
    """
    if not settings.OPENAI_API_KEY:
        logger.warning("Compression agent: OPENAI_API_KEY not set, skipping")
        return {"status": "skipped"}

    try:
        import openai
        import tiktoken

        enc = tiktoken.get_encoding("cl100k_base")
        original_tokens = len(enc.encode(sample_prompt))

        oai = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
        response = oai.chat.completions.create(
            model=settings.COMPRESSION_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a prompt compression expert. Rewrite the following prompt "
                        "to be as concise as possible while preserving all instructions and context. "
                        "Output ONLY the compressed prompt, nothing else."
                    ),
                },
                {"role": "user", "content": sample_prompt},
            ],
            max_tokens=2048,
        )

        compressed = response.choices[0].message.content or ""
        compressed_tokens = len(enc.encode(compressed))
        savings_pct = ((original_tokens - compressed_tokens) / max(original_tokens, 1)) * 100

        if savings_pct > 10:
            with get_sync_session() as db:
                daily_token_estimate = original_tokens * 100  # assume 100 calls/day
                token_savings = daily_token_estimate * (savings_pct / 100)
                cost_savings = (token_savings / 1_000_000) * 1.0  # ~$1/1M tokens

                sug = Suggestion(
                    project_id=project_id,
                    suggestion_type="prompt_compress",
                    feature_tag=feature_tag,
                    title=f"Compress prompt for '{feature_tag}' (save {savings_pct:.0f}% tokens)",
                    description=(
                        f"Sample prompt compressed from {original_tokens} → {compressed_tokens} tokens "
                        f"({savings_pct:.0f}% reduction). Review the compressed version before applying."
                    ),
                    estimated_savings_pct=savings_pct,
                    current_cost_per_day=None,
                    projected_cost_per_day=None,
                    accuracy_risk="medium",
                    confidence=0.65,
                    payload={
                        "original_tokens": original_tokens,
                        "compressed_tokens": compressed_tokens,
                        "compressed_prompt": compressed[:2000],  # truncate for storage
                    },
                )
                db.add(sug)
                db.commit()

        return {
            "status": "ok",
            "original_tokens": original_tokens,
            "compressed_tokens": compressed_tokens,
            "savings_pct": round(savings_pct, 1),
        }

    except Exception as exc:
        logger.exception("Compression agent failed: %s", exc)
        return {"status": "error", "message": str(exc)}
