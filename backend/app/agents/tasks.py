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
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain.agents import AgentExecutor, create_tool_calling_agent

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

        trailing_avg = db.execute(
            select(func.avg(LLMEvent.estimated_cost)).where(
                LLMEvent.project_id == project_id,
                func.date(LLMEvent.timestamp) >= since,
                func.date(LLMEvent.timestamp) < today_str,
            )
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
        db.add(Suggestion(
            project_id=project_id,
            suggestion_type=suggestion_type,
            feature_tag=feature_tag or None,
            title=title,
            description=description,
            current_cost_per_day=current_cost_per_day or None,
            projected_cost_per_day=projected_cost_per_day or None,
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


# ── Agent factory ─────────────────────────────────────────────

_AGENT_TOOLS = [
    list_all_projects,
    find_expensive_model_features,
    find_high_latency_features,
    detect_cost_spike,
    pending_suggestion_exists,
    save_suggestion,
    compress_prompt_text,
]

_SYSTEM_PROMPT = """You are an LLM cost-optimization agent for a usage-monitoring platform.
You have tools to query usage data and save suggestions into the database.

Rules you MUST follow:
1. Always call pending_suggestion_exists before calling save_suggestion to avoid duplicates.
   If it returns 'true', skip that suggestion.

2. model_downgrade suggestions:
     accuracy_risk='low', confidence=0.85, estimated_savings_pct=75.0
     current_cost_per_day = the 'daily_cost' field returned by find_expensive_model_features
     projected_cost_per_day = current_cost_per_day * 0.25
     payload_json must include these exact keys (use the tool output values):
       current_model  (= the 'model' field from the tool),
       target_model   (= the 'target_model' field from the tool),
       avg_out_tokens (= the 'avg_out_tokens' field from the tool),
       suggestion_mode (= the 'suggestion_mode' field from the tool).

3. latency_optimization suggestions:
     accuracy_risk='low', confidence=0.70, estimated_savings_pct=10.0
     current_cost_per_day = the 'daily_cost' field returned by find_high_latency_features
     projected_cost_per_day = current_cost_per_day * 0.9
     payload_json must include:
       avg_latency_ms (from tool), daily_cost (from tool), suggestion_mode (from tool).

4. anomaly_alert suggestions:
     accuracy_risk='medium', confidence=0.90, estimated_savings_pct=0.0
     current_cost_per_day  = the 'today_cost' field from detect_cost_spike
     projected_cost_per_day = the 'trailing_avg' field from detect_cost_spike
     feature_tag must be empty string "".
     payload_json must include:
       today_cost (from tool), trailing_avg (from tool),
       multiplier (from tool), suggestion_mode (from tool).

5. prompt_compress suggestions:
     Only save if savings_pct > 10.
     accuracy_risk='medium', confidence=0.65
     current_cost_per_day=0.0, projected_cost_per_day=0.0
     payload_json must include: original_tokens, compressed_tokens, compressed_prompt.

6. payload_json must always be a valid JSON string (use double quotes for all keys and string values).
7. Complete all requested work before stopping."""


def _build_agent() -> AgentExecutor:
    llm = ChatOpenAI(
        model=settings.COMPRESSION_MODEL,
        api_key=settings.OPENAI_API_KEY,
        temperature=0,
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", _SYSTEM_PROMPT),
        ("human", "{input}"),
        MessagesPlaceholder("agent_scratchpad"),
    ])
    agent = create_tool_calling_agent(llm, _AGENT_TOOLS, prompt)
    return AgentExecutor(agent=agent, tools=_AGENT_TOOLS, verbose=False)


# ── Celery Tasks ──────────────────────────────────────────────

def _invoke_agent(input_text: str) -> dict:
    """Build and invoke the agent, returning a result dict. Handles auth and runtime errors."""
    try:
        result = _build_agent().invoke({"input": input_text})
        return {"status": "ok", "output": result.get("output", "")}
    except Exception as exc:
        # Surface invalid-key errors with a clear message so they're easy to spot in logs
        err_str = str(exc)
        if "401" in err_str or "invalid_api_key" in err_str or "Incorrect API key" in err_str:
            logger.error("Agent failed: invalid OPENAI_API_KEY — update it in .env: %s", exc)
            return {"status": "error", "message": "invalid_api_key"}
        logger.exception("Agent invocation failed: %s", exc)
        return {"status": "error", "message": err_str}


@shared_task(name="app.agents.tasks.trigger_metrics_aggregation")
def trigger_metrics_aggregation(project_id: str) -> None:
    """Run the LangChain agent for a single project after each ingest batch.

    Fires immediately for 'instant' mode projects.
    For interval modes ('Nh') it skips if not enough time has elapsed since
    the last suggestion was created.
    """
    if not settings.OPENAI_API_KEY:
        logger.warning("trigger_metrics_aggregation: OPENAI_API_KEY not set, skipping")
        return
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
    logger.info("LangChain agent running for project %s (mode: %s)", project_id, mode)
    _invoke_agent(
        f"Analyze project {project_id}. Check for: "
        "(1) expensive frontier models used on simple tasks → model_downgrade suggestion, "
        "(2) high latency features → latency_optimization suggestion, "
        "(3) cost spike today → anomaly_alert suggestion. "
        "For each finding, check for a duplicate before saving."
    )


@shared_task(name="app.agents.tasks.run_heuristic_agent")
def run_heuristic_agent() -> dict:
    """Periodic sweep: run the LangChain agent for every interval-mode project that is due.

    'instant' projects are handled exclusively by the ingest trigger and are skipped here.
    """
    if not settings.OPENAI_API_KEY:
        logger.warning("run_heuristic_agent: OPENAI_API_KEY not set, skipping")
        return {"status": "skipped"}

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
    return _invoke_agent(
        f"Analyze these projects: {', '.join(due)}. For each one run the three checks: "
        "(1) expensive frontier models on simple tasks → model_downgrade, "
        "(2) high average latency → latency_optimization, "
        "(3) cost spike today → anomaly_alert. "
        "Skip any finding that already has a pending suggestion. "
        "Return a brief summary of suggestions created per project."
    )


@shared_task(name="app.agents.tasks.run_anomaly_agent")
def run_anomaly_agent() -> dict:
    """LangChain agent that checks for cost spikes across all projects."""
    if not settings.OPENAI_API_KEY:
        logger.warning("run_anomaly_agent: OPENAI_API_KEY not set, skipping")
        return {"status": "skipped"}
    logger.info("Anomaly agent: checking recent spikes")
    return _invoke_agent(
        "List all projects and check each for a cost spike today. "
        "For any spike found, verify no anomaly_alert already exists for today, "
        "then save an anomaly_alert suggestion."
    )


@shared_task(name="app.agents.tasks.run_compression_agent")
def run_compression_agent(project_id: str, feature_tag: str, sample_prompt: str) -> dict:
    """LangChain agent that compresses a sample prompt and saves a suggestion if savings > 10%."""
    if not settings.OPENAI_API_KEY:
        logger.warning("Compression agent: OPENAI_API_KEY not set, skipping")
        return {"status": "skipped"}
    logger.info("Compression agent running for project %s / %s", project_id, feature_tag)
    return _invoke_agent(
        f"Compress the following prompt for project {project_id}, "
        f"feature tag '{feature_tag}':\n\n{sample_prompt}\n\n"
        "If savings_pct > 10, check that no pending prompt_compress suggestion exists "
        "for this feature, then save a prompt_compress suggestion."
    )
