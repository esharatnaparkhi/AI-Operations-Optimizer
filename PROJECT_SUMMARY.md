# Project Summary — LLM Efficiency Platform

A deep-dive technical reference covering every component of the system: architecture, data flow, agent logic, LLM call strategy, optimization heuristics, latency management, and suggestion lifecycle.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Complete Project Structure](#2-complete-project-structure)
3. [End-to-End Data Flow](#3-end-to-end-data-flow)
4. [SDK — How LLM Calls Are Intercepted](#4-sdk--how-llm-calls-are-intercepted)
5. [Ingest Pipeline — How Events Enter the Backend](#5-ingest-pipeline--how-events-enter-the-backend)
6. [Database Schema](#6-database-schema)
7. [Metrics API — What Gets Computed and How](#7-metrics-api--what-gets-computed-and-how)
8. [Agent System — How Analysis Works](#8-agent-system--how-analysis-works)
9. [LLM vs Static Logic — Where LLMs Are Called](#9-llm-vs-static-logic--where-llms-are-called)
10. [Suggestion Logic — Heuristics and Thresholds](#10-suggestion-logic--heuristics-and-thresholds)
11. [Suggestion Lifecycle](#11-suggestion-lifecycle)
12. [Latency Management](#12-latency-management)
13. [Authentication and Multi-Tenancy](#13-authentication-and-multi-tenancy)
14. [Celery Task Scheduling](#14-celery-task-scheduling)
15. [Configuration and Environment](#15-configuration-and-environment)
16. [Infrastructure — Docker Services](#16-infrastructure--docker-services)

---

## 1. System Architecture Overview

The platform is composed of three independently deployed components that communicate via HTTP and a shared PostgreSQL database.

```
┌─────────────────────────────────────────────────────────┐
│                  Your Application                        │
│                                                         │
│   client = monitor.wrap_openai(openai.OpenAI())         │
│                     │                                   │
│              LLM API call intercepted                   │
│                     │                                   │
│           Event queued in memory (thread-safe)          │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP POST /api/v1/ingest (batch, async)
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   Backend (FastAPI)                      │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │  Ingest API │  │ Metrics API │  │ Suggestions API│  │
│  └──────┬──────┘  └──────┬──────┘  └───────┬────────┘  │
│         │                │                  │           │
│         ▼                ▼                  ▼           │
│              PostgreSQL (single DB)                     │
│         │                                               │
│         └──── triggers Celery task ───────────────────► │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Celery Worker (analysis engine)         │   │
│  │                                                   │   │
│  │  _run_project_analysis()  ← zero LLM calls        │   │
│  │    ├─ model downgrade check                       │   │
│  │    ├─ latency regression check                    │   │
│  │    └─ cost spike detection                        │   │
│  │                                                   │   │
│  │  run_compression_agent()  ← 1 LLM call (optional) │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────┐                        │
│  │  Celery Beat (scheduler)    │                        │
│  │  - hourly heuristic sweep   │                        │
│  │  - hourly anomaly sweep     │                        │
│  └─────────────────────────────┘                        │
└─────────────────────────────────────────────────────────┘
                       │ REST API reads
                       ▼
┌─────────────────────────────────────────────────────────┐
│               Dashboard (Next.js)                        │
│                                                         │
│   Overview  │  Cost Hotspots  │  Suggestions  │  Settings│
└─────────────────────────────────────────────────────────┘
```

**Technology stack:**

| Layer | Technology |
|---|---|
| SDK | Pure Python 3.9+, `httpx`, `wrapt`, `contextvars` |
| Backend API | FastAPI, SQLAlchemy (async), asyncpg, Pydantic |
| Database | PostgreSQL 16 |
| Task queue | Celery 5, Redis 7 |
| LLM (compression only) | OpenAI `gpt-4o-mini` via LangChain |
| Frontend | Next.js 14 (App Router), React, Recharts, Tailwind CSS |
| Auth | JWT (HS256), bcrypt |
| Orchestration | Docker Compose |

---

## 2. Complete Project Structure

```
llm-efficiency-platform/
│
├── README.md                          # Project overview and quickstart
├── PROJECT_SUMMARY.md                 # This file — deep technical reference
├── .env                               # Local environment variables (gitignored)
├── .env.example                       # Template with all required variables
├── .gitignore
├── docker-compose.yml                 # 6-service orchestration
│
├── sdk/                               # Python client library
│   ├── pyproject.toml                 # Package metadata (httpx, wrapt, tiktoken)
│   └── llm_monitor/
│       ├── __init__.py                # Public exports
│       ├── monitor.py                 # LLMMonitor class — main entrypoint
│       ├── wrappers.py                # OpenAI and Anthropic monkey-patches
│       ├── shipper.py                 # Thread-safe batched event queue + HTTP flush
│       ├── pricing.py                 # Pricing tables: 20+ models, 6 providers
│       ├── context.py                 # feature_tag() context manager (contextvars)
│       └── models.py                  # LLMEvent dataclass
│
├── backend/
│   ├── requirements.txt               # Python dependencies
│   ├── Dockerfile
│   ├── alembic.ini                    # Migration configuration
│   ├── celerybeat-schedule            # Beat persistent schedule (auto-managed)
│   │
│   ├── migrations/
│   │   ├── env.py                     # Alembic env — uses SYNC_DATABASE_URL
│   │   ├── script.py.mako
│   │   └── versions/
│   │       ├── 68ccf8d20324_initial_clean.py      # Full initial schema
│   │       └── b3e9f1a02c47_add_suggestion_mode.py # Adds suggestion_mode to projects
│   │
│   └── app/
│       ├── __init__.py
│       ├── main.py                    # FastAPI app factory, CORS, lifespan, routers
│       ├── celery_app.py              # Celery instance + Beat schedule
│       │
│       ├── core/
│       │   ├── config.py              # Pydantic BaseSettings — all env vars
│       │   ├── database.py            # Async engine, session factory, get_db()
│       │   └── auth.py                # JWT creation/decoding, password hashing,
│       │                              #   get_current_user_id(), get_project_from_key()
│       │
│       ├── models/
│       │   ├── db.py                  # ORM: User, Project, LLMEvent, Suggestion,
│       │   │                          #       DailyMetric
│       │   └── schemas.py             # Pydantic schemas for all request/response types
│       │
│       ├── api/
│       │   ├── auth.py                # POST /register, POST /login
│       │   ├── projects.py            # CRUD /projects, PATCH /{id}/mode, DELETE /{id}
│       │   ├── ingest.py              # POST /ingest — receives SDK telemetry
│       │   ├── metrics.py             # GET /overview, /timeseries, /hotspots,
│       │   │                          #     DELETE /feature/{tag}
│       │   └── suggestions.py         # GET /{project_id}, POST /simulate, /apply,
│       │                              #     POST /{id}/dismiss
│       │
│       └── agents/
│           └── tasks.py               # Celery tasks + heuristic analysis engine
│                                      #   + LangChain tools for compression
│
└── dashboard/
    ├── package.json
    ├── Dockerfile
    ├── next.config.js
    ├── tailwind.config.js             # Brand colors, custom tokens (ink/base/brand)
    └── src/
        ├── app/
        │   ├── globals.css            # Design system: .card, .surface, .icon-box
        │   ├── page.tsx               # Login/register page
        │   └── dashboard/
        │       ├── layout.tsx         # Sidebar, project switcher, nav
        │       ├── page.tsx           # Overview: stat cards + timeseries charts
        │       ├── hotspots/
        │       │   └── page.tsx       # Feature cost breakdown + bar chart + table
        │       ├── suggestions/
        │       │   └── page.tsx       # Optimization tip cards + fix modal
        │       └── settings/
        │           └── page.tsx       # API key + suggestion frequency
        └── lib/
            └── api.ts                 # Typed REST client + all TypeScript interfaces
```

---

## 3. End-to-End Data Flow

### Happy path — from LLM call to dashboard

```
1. Application calls client.chat.completions.create(...)
   │
   ▼
2. SDK wrapper intercepts: records start_time, calls real API
   │
   ▼
3. Response arrives: extract model, input_tokens, output_tokens, latency
   Look up current feature_tag from contextvars
   Estimate cost using pricing.py table
   Build LLMEvent dataclass
   │
   ▼
4. EventShipper.enqueue(event)
   Appends to thread-safe queue (max 10,000 items)
   │
   ▼
5. Background daemon thread (_flush_loop) fires every 0.5s
   OR when queue reaches 50 events
   Sends POST /api/v1/ingest  [Bearer: project_api_key]
   Body: { events: [...] }
   │
   ▼
6. Ingest API (ingest.py):
   Authenticates project from Bearer token
   For each event: upsert LLMEvent (skip duplicate event_ids)
   fire_and_forget: trigger_metrics_aggregation.delay(project_id)
   Returns 200 { accepted: N, duplicate: M }
   │
   ▼
7. Celery worker picks up trigger_metrics_aggregation:
   Reads project.suggestion_mode
   Checks cooldown: _should_run(project_id, mode)
     - instant: always runs
     - Nh: runs only if last run was >N hours ago
   If due: calls _run_project_analysis(project_id)
   │
   ▼
8. _run_project_analysis (zero LLM calls):
   Opens sync DB session
   Runs three heuristic checks (see Section 10)
   Creates Suggestion rows for any findings
   Skips if same-type suggestion already pending for that feature
   Commits atomically
   │
   ▼
9. Dashboard polls /api/v1/suggestions/{project_id}
   Displays suggestion cards with cost before/after
   │
   ▼
10. User clicks "View fix steps":
    POST /api/v1/suggestions/simulate  → calculates savings, marks simulated
    POST /api/v1/suggestions/apply     → calls _generate_snippet_llm (1 LLM call)
                                         OR _generate_snippet_static (0 LLM calls)
    Modal shows WHAT/WHERE/HOW/WHY recommendation
```

---

## 4. SDK — How LLM Calls Are Intercepted

### Wrapping mechanism

`LLMMonitor.wrap_openai(client)` replaces `client.chat.completions.create` with a closure that:

```python
original_create = client.chat.completions.create

def patched_create(*args, **kwargs):
    # Remove X-Feature-Tag from headers if present (not a real OpenAI header)
    feature = kwargs.pop("extra_headers", {}).get("X-Feature-Tag")
               or get_current_feature_tag()  # from contextvars

    start = time.monotonic()
    response = original_create(*args, **kwargs)
    latency_ms = (time.monotonic() - start) * 1000

    model  = response.model
    usage  = response.usage
    cost   = estimate_cost(provider, model, usage.prompt_tokens, usage.completion_tokens)

    event = LLMEvent(
        event_id      = str(uuid4()),
        project_key   = self.api_key,
        timestamp     = datetime.utcnow().isoformat(),
        latency_ms    = latency_ms,
        model         = model,
        provider      = "openai",
        input_tokens  = usage.prompt_tokens,
        output_tokens = usage.completion_tokens,
        total_tokens  = usage.total_tokens,
        estimated_cost_usd = cost,
        feature_tag   = feature,
    )
    self._shipper.enqueue(event)
    return response

client.chat.completions.create = patched_create
```

The original API response is returned unchanged. The interception adds negligible overhead (a few microseconds of Python).

### Feature tagging

Feature tags use Python's `contextvars` — they are thread-safe, async-safe, and do not require passing context through call stacks:

```python
# contextvars preserve values across await boundaries in asyncio
# and across thread boundaries (each thread gets its own copy)

_current_feature_tag: ContextVar[str | None] = ContextVar("feature_tag", default=None)

@contextmanager
def feature_tag(name: str):
    token = _current_feature_tag.set(name)
    try:
        yield
    finally:
        _current_feature_tag.reset(token)
```

This means:
- Multiple concurrent requests can each have different feature tags with no interference
- Async handlers with `await` maintain their tag across yield points
- Tags nest correctly (inner context overrides outer, resets on exit)

### EventShipper — batching strategy

The shipper runs a daemon thread that:

```
Queue (max 10,000 events)
  │
  ├─ enqueue(event)      ← called from patched client (non-blocking)
  │
  └─ _flush_loop()       ← daemon thread
       ├─ Sleep 0.5s
       ├─ Drain up to 50 events
       └─ POST to /api/v1/ingest
            ├─ On success: clear batch
            └─ On failure: re-enqueue events (best-effort retry)
```

Key design decisions:
- **Non-blocking enqueue**: If the queue is full (10,000 events), new events are silently dropped rather than blocking the application
- **Daemon thread**: Dies automatically when the main process exits; `atexit` hooks attempt a final flush
- **Sampling**: If `sampling_rate < 1.0`, each event is randomly dropped client-side before enqueuing
- **PII protection**: If `hash_content=True` (default), `user_id` is SHA-256 hashed before the event is built

### Cost estimation (pricing.py)

Cost is computed client-side before shipping, so the backend never needs to call provider APIs for pricing:

```python
PRICING = {
    "openai": {
        "gpt-4o":          {"input": 5.00,  "output": 15.00},  # per 1M tokens
        "gpt-4o-mini":     {"input": 0.15,  "output": 0.60},
        "gpt-4-turbo":     {"input": 10.00, "output": 30.00},
        "gpt-3.5-turbo":   {"input": 0.50,  "output": 1.50},
        ...
    },
    "anthropic": {
        "claude-3-5-sonnet-20241022": {"input": 3.00,  "output": 15.00},
        "claude-3-5-haiku-20241022":  {"input": 0.80,  "output": 4.00},
        "claude-3-opus-20240229":     {"input": 15.00, "output": 75.00},
        ...
    },
    # also: google, cohere, mistral
}

def estimate_cost(provider, model, input_tokens, output_tokens) -> float:
    rates = PRICING.get(provider, {}).get(model)
    if not rates:
        return 0.0
    return (input_tokens * rates["input"] + output_tokens * rates["output"]) / 1_000_000
```

---

## 5. Ingest Pipeline — How Events Enter the Backend

### Endpoint

```
POST /api/v1/ingest
Authorization: Bearer <project_api_key>
Content-Type: application/json

{
  "events": [
    {
      "event_id": "uuid",
      "timestamp": "2025-01-01T10:00:00Z",
      "model": "gpt-4o",
      "provider": "openai",
      "input_tokens": 512,
      "output_tokens": 128,
      "latency_ms": 1240.5,
      "estimated_cost_usd": 0.00448,
      "feature_tag": "summarize",
      ...
    }
  ]
}
```

### Processing

```python
async def ingest(body: IngestRequest, project: Project = Depends(get_project_from_key), db = Depends(get_db)):
    accepted = 0
    duplicates = 0

    for ev in body.events:
        # De-duplicate: check if event_id already exists for this project
        existing = await db.execute(
            select(LLMEvent).where(
                LLMEvent.event_id == ev.event_id,
                LLMEvent.project_id == project.id,
            )
        )
        if existing.scalar_one_or_none():
            duplicates += 1
            continue

        db.add(LLMEvent(
            project_id      = project.id,
            event_id        = ev.event_id,
            timestamp       = ev.timestamp,
            model           = ev.model,
            provider        = ev.provider,
            input_tokens    = ev.input_tokens,
            output_tokens   = ev.output_tokens,
            total_tokens    = (ev.input_tokens or 0) + (ev.output_tokens or 0),
            estimated_cost  = ev.estimated_cost_usd or 0.0,
            latency_ms      = ev.latency_ms,
            feature_tag     = ev.feature_tag or "__untagged__",
            ...
        ))
        accepted += 1

    await db.commit()

    # Fire Celery task non-blocking — ingest response is not delayed
    trigger_metrics_aggregation.delay(str(project.id))

    return {"accepted": accepted, "duplicate": duplicates}
```

The response is returned immediately — the task is fire-and-forget. The ingest API never blocks on analysis.

---

## 6. Database Schema

### Tables

#### `users`
```
id              UUID PK
email           VARCHAR UNIQUE NOT NULL
hashed_password VARCHAR NOT NULL
name            VARCHAR
is_active       BOOLEAN DEFAULT TRUE
created_at      TIMESTAMP DEFAULT NOW()
```

#### `projects`
```
id              UUID PK
name            VARCHAR NOT NULL
api_key         VARCHAR UNIQUE NOT NULL (auto-generated UUID)
owner_id        UUID FK → users.id (CASCADE DELETE)
suggestion_mode VARCHAR DEFAULT 'instant'  # instant | Nh
created_at      TIMESTAMP DEFAULT NOW()
```

#### `llm_events`
```
id              UUID PK
event_id        VARCHAR UNIQUE        # client-generated, used for dedup
project_id      UUID FK → projects.id (CASCADE DELETE)
timestamp       TIMESTAMP NOT NULL    # when the LLM call was made
latency_ms      FLOAT                 # end-to-end wall-clock ms
provider        VARCHAR               # openai, anthropic, cohere, etc.
model           VARCHAR               # exact model name
endpoint        VARCHAR               # chat.completions, messages, etc.
input_tokens    INTEGER
output_tokens   INTEGER
total_tokens    INTEGER               # input + output
estimated_cost  FLOAT                 # USD, computed by SDK pricing tables
feature_tag     VARCHAR DEFAULT '__untagged__'
user_id         VARCHAR               # optional, hashed if PII protection on
session_id      VARCHAR               # optional
rag_chunks      INTEGER               # number of RAG chunks if applicable
error           VARCHAR               # error message if call failed
status_code     INTEGER               # HTTP status from provider
ingested_at     TIMESTAMP DEFAULT NOW()

Indexes: (project_id, timestamp), (feature_tag)
```

#### `suggestions`
```
id                      UUID PK
project_id              UUID FK → projects.id (CASCADE DELETE)
created_at              TIMESTAMP DEFAULT NOW()
suggestion_type         VARCHAR  # model_downgrade | prompt_compress |
                                 # latency_optimization | anomaly_alert
feature_tag             VARCHAR  # which feature this targets (nullable for anomaly)
title                   VARCHAR  # short display title
description             TEXT     # human-readable explanation
current_cost_per_day    FLOAT    # baseline cost (USD/day)
projected_cost_per_day  FLOAT    # expected cost after fix (USD/day)
estimated_savings_pct   FLOAT    # (current - projected) / current * 100
accuracy_risk           VARCHAR  # low | medium | high
confidence              FLOAT    # 0.0 - 1.0
payload                 JSON     # type-specific data (model names, thresholds, etc.)
status                  VARCHAR DEFAULT 'pending'  # pending | simulated | applied | dismissed
applied_at              TIMESTAMP                  # set when status → applied
```

#### `daily_metrics` (pre-aggregated)
```
id              UUID PK
project_id      UUID FK → projects.id (CASCADE DELETE)
date            DATE NOT NULL
feature_tag     VARCHAR
total_calls     INTEGER DEFAULT 0
total_tokens    BIGINT DEFAULT 0
total_cost      FLOAT DEFAULT 0.0
avg_latency_ms  FLOAT DEFAULT 0.0
error_count     INTEGER DEFAULT 0
model_breakdown JSON  # {"gpt-4o": {"calls": 10, "cost": 0.05}, ...}

Unique: (project_id, date, feature_tag)
```

### Indexing strategy

- `(project_id, timestamp)` on `llm_events` — used by every metrics query which always filters by project and time window
- `feature_tag` on `llm_events` — used by hotspot queries which group by tag
- Unique constraint on `event_id` — fast O(1) duplicate check at ingest time

---

## 7. Metrics API — What Gets Computed and How

### Overview endpoint

`GET /api/v1/metrics/{project_id}/overview`

Computes today's metrics directly from raw `llm_events` with a single database query:

```python
today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
yesterday_start = today_start - timedelta(days=1)

# Today's aggregates
today_q = select(
    func.count(LLMEvent.id).label("calls"),
    func.sum(LLMEvent.total_tokens).label("tokens"),
    func.sum(LLMEvent.estimated_cost).label("cost"),
    func.avg(LLMEvent.latency_ms).label("avg_latency"),
).where(LLMEvent.project_id == project_id, LLMEvent.timestamp >= today_start)

# Yesterday's cost (for trend %)
yesterday_q = select(func.sum(LLMEvent.estimated_cost)).where(
    LLMEvent.project_id == project_id,
    LLMEvent.timestamp >= yesterday_start,
    LLMEvent.timestamp < today_start,
)

# Efficiency score: 100 - (avg_latency / 100), clamped to [0, 100]
efficiency_score = max(0, min(100, 100 - avg_latency_ms / 100))

# Cost trend
cost_trend_pct = ((today_cost - yesterday_cost) / yesterday_cost) * 100
```

### Timeseries endpoint

`GET /api/v1/metrics/{project_id}/timeseries?days=14`

Aggregates `llm_events` by calendar day. Uses `func.date(LLMEvent.timestamp)` as the grouping key. Returns one row per day even for days with no data (filled with zeros in the response layer).

### Hotspots endpoint

`GET /api/v1/metrics/{project_id}/hotspots?days=7&limit=10`

Groups `llm_events` by `feature_tag` within the time window:

```python
select(
    LLMEvent.feature_tag,
    func.sum(LLMEvent.estimated_cost).label("total_cost"),
    func.sum(LLMEvent.total_tokens).label("total_tokens"),
    func.count(LLMEvent.id).label("total_calls"),
    func.avg(LLMEvent.latency_ms).label("avg_latency_ms"),
).where(
    LLMEvent.project_id == project_id,
    LLMEvent.timestamp >= since,
).group_by(LLMEvent.feature_tag)
 .order_by(desc("total_cost"))
 .limit(limit)
```

Results include `__untagged__` as a catch-all for calls without a feature tag.

---

## 8. Agent System — How Analysis Works

### Overview

The agent system is entirely contained in `backend/app/agents/tasks.py`. It is built as a set of Celery tasks backed by a pure-Python analysis function (`_run_project_analysis`). There is no LangChain agent or ReAct loop for the core heuristics — those were removed in favor of direct DB queries.

The system has four Celery tasks:

| Task | Trigger | LLM calls |
|---|---|---|
| `trigger_metrics_aggregation` | Every ingest batch | 0 |
| `run_heuristic_agent` | Hourly (Beat) | 0 |
| `run_anomaly_agent` | Hourly (Beat) | 0 |
| `run_compression_agent` | On-demand (user action) | 1 |

### `trigger_metrics_aggregation`

Called after every successful ingest. Checks the project's suggestion mode and whether enough time has elapsed since the last run, then calls `_run_project_analysis`:

```python
@shared_task(name="app.agents.tasks.trigger_metrics_aggregation")
def trigger_metrics_aggregation(project_id: str) -> None:
    with get_sync_session() as db:
        project = db.execute(select(Project).where(Project.id == project_id)).scalar_one_or_none()
        if not project:
            return
        mode = project.suggestion_mode or "instant"

    if not _should_run(project_id, mode):
        return

    _run_project_analysis(project_id)
```

### `_should_run(project_id, mode)`

Controls analysis frequency per project:

```python
_last_run: dict[str, datetime] = {}  # in-process cache (per worker)

def _should_run(project_id: str, mode: str) -> bool:
    if mode == "instant":
        return True  # always run

    # Parse interval: "24h" → 24 hours, "6h" → 6 hours
    match = re.match(r"^(\d+)h$", mode)
    if not match:
        return True

    hours = int(match.group(1))
    last = _last_run.get(project_id)

    if last is None or (datetime.utcnow() - last).total_seconds() >= hours * 3600:
        _last_run[project_id] = datetime.utcnow()
        return True

    return False
```

Note: `_last_run` is an in-process dict. In a multi-worker deployment, each worker maintains its own state. This is intentional — the duplicate guard at the DB level prevents double-suggestions even if two workers both decide to run.

### `_run_project_analysis(project_id)`

The core analysis function. Opens a synchronous DB session and runs all three checks in one transaction:

```python
def _run_project_analysis(project_id: str) -> dict:
    cheaper = {
        "gpt-4o": "gpt-4o-mini",
        "gpt-4-turbo": "gpt-4o-mini",
        "claude-3-opus": "claude-3-haiku",
    }
    created = []

    with get_sync_session() as db:
        # ── 1. Model downgrade check ──────────────────────────────
        # ── 2. Latency optimization check ────────────────────────
        # ── 3. Cost spike detection ───────────────────────────────
        db.commit()

    return {"status": "ok", "created": created}
```

Each check follows the same pattern:
1. Query the database
2. Apply threshold
3. Check for existing non-dismissed suggestion of the same type+feature_tag
4. If no duplicate: create and add `Suggestion` row

### `run_heuristic_agent` (Beat task)

Runs hourly. Finds all projects that are "due" based on their suggestion mode and runs `_run_project_analysis` for each:

```python
@shared_task(name="app.agents.tasks.run_heuristic_agent")
def run_heuristic_agent() -> dict:
    with get_sync_session() as db:
        projects = db.execute(select(Project)).scalars().all()

    due = [str(p.id) for p in projects if _should_run(str(p.id), p.suggestion_mode or "instant")]
    results = [_run_project_analysis(pid) for pid in due]
    return {"status": "ok", "results": results}
```

### `run_anomaly_agent` (Beat task)

Dedicated cost-spike pass. Runs all projects through `_run_project_analysis` to specifically catch anomalies that might have been missed between heuristic sweeps:

```python
@shared_task(name="app.agents.tasks.run_anomaly_agent")
def run_anomaly_agent() -> dict:
    with get_sync_session() as db:
        project_ids = [str(p.id) for p in db.execute(select(Project)).scalars().all()]
    results = [_run_project_analysis(pid) for pid in project_ids]
    return {"status": "ok", "results": results}
```

### `run_compression_agent`

The only task that makes a real LLM call. Called on-demand when a prompt compression suggestion is created:

```python
@shared_task(name="app.agents.tasks.run_compression_agent")
def run_compression_agent(project_id: str, feature_tag: str, sample_prompt: str) -> dict:
    # 1. Call compress_prompt_text tool (1 LLM call to gpt-4o-mini)
    result = json.loads(compress_prompt_text(sample_prompt))

    original_tokens   = result.get("original_tokens", 0)
    compressed_tokens = result.get("compressed_tokens", 0)
    compressed_text   = result.get("compressed_prompt", "")

    if not compressed_text or compressed_tokens >= original_tokens:
        return {"status": "no_improvement"}

    savings_pct = ((original_tokens - compressed_tokens) / original_tokens) * 100

    # 2. Compute cost impact from recent events
    with get_sync_session() as db:
        since = datetime.utcnow() - timedelta(days=7)
        avg_cost = db.execute(
            select(func.avg(LLMEvent.estimated_cost))
            .where(LLMEvent.project_id == project_id,
                   LLMEvent.feature_tag == feature_tag,
                   LLMEvent.timestamp >= since)
        ).scalar() or 0.0

        current_cost_per_day = avg_cost * 24
        projected_cost_per_day = current_cost_per_day * (1 - savings_pct / 100)

        # 3. Duplicate guard + save
        existing = db.execute(
            select(Suggestion).where(
                Suggestion.project_id == project_id,
                Suggestion.feature_tag == feature_tag,
                Suggestion.suggestion_type == "prompt_compress",
                Suggestion.status != "dismissed",
            )
        ).scalar_one_or_none()

        if existing:
            return {"status": "duplicate"}

        db.add(Suggestion(
            project_id              = project_id,
            suggestion_type         = "prompt_compress",
            feature_tag             = feature_tag,
            title                   = f"Shorten prompt for '{feature_tag}'",
            description             = f"Prompt can be reduced by ~{savings_pct:.0f}% ...",
            current_cost_per_day    = current_cost_per_day,
            projected_cost_per_day  = projected_cost_per_day,
            estimated_savings_pct   = savings_pct,
            accuracy_risk           = "medium",
            payload                 = {
                "original_tokens": original_tokens,
                "compressed_tokens": compressed_tokens,
                "compressed_prompt": compressed_text,
            },
        ))
        db.commit()

    return {"status": "ok"}
```

---

## 9. LLM vs Static Logic — Where LLMs Are Called

This is a critical design decision. The platform deliberately minimizes LLM calls to reduce latency, cost, and failure modes.

### No LLM calls (pure Python / SQL)

| Operation | Method |
|---|---|
| Model downgrade detection | SQL query + Python threshold check |
| Latency regression detection | SQL AVG query + threshold |
| Cost spike detection | SQL subquery for daily averages + ratio check |
| Cost estimation | Lookup table in `pricing.py` |
| Suggestion duplicate detection | SQL EXISTS check |
| Overview metrics | SQL SUM/COUNT/AVG |
| Hotspot ranking | SQL GROUP BY + ORDER BY |
| Timeseries aggregation | SQL GROUP BY date |
| Suggestion simulate (savings calc) | Arithmetic on stored `current_cost_per_day` / `projected_cost_per_day` |

### One LLM call (gpt-4o-mini)

| Operation | When | Model | Fallback |
|---|---|---|---|
| `_generate_snippet_llm` | User clicks "View fix steps" | `gpt-4o-mini` | `_generate_snippet_static` |
| `compress_prompt_text` | Prompt compression suggestion | `gpt-4o-mini` | Returns no suggestion |

### LLM call logic for fix recommendations

When the user applies a suggestion, `_generate_snippet_llm` is called. It constructs a structured prompt tailored to the suggestion type:

```
SYSTEM:
  You are an LLM cost-optimization advisor.
  Write a clear, actionable plain-text recommendation (no code blocks, no markdown).
  Structure: WHAT TO CHANGE / WHERE / HOW / WHY
  Under 200 words.

HUMAN (model_downgrade):
  Feature: "summarize"
  Current model: gpt-4o (averages ~28 output tokens — a simple task)
  Recommended model: gpt-4o-mini
  Current daily cost: $0.000512 → Projected: $0.000128/day after fix
  Write a recommendation telling the developer to find every place where
  the "summarize" feature tag is used and change model="gpt-4o" to model="gpt-4o-mini".
```

The response is plain text (no markdown, no code blocks) so it reads naturally in the dashboard's fix modal.

**Fallback (`_generate_snippet_static`)**: If `OPENAI_API_KEY` is not set, or if the LLM call fails, the system falls back to a template-based generator that produces identical-structure text using the stored suggestion metadata. The fallback covers all four suggestion types.

---

## 10. Suggestion Logic — Heuristics and Thresholds

### 1. Model Downgrade (`model_downgrade`)

**Goal**: Identify features using an expensive frontier model for simple, low-output tasks.

**Query**:
```sql
SELECT feature_tag, model,
       COUNT(*) as call_count,
       AVG(output_tokens) as avg_out_tokens,
       SUM(estimated_cost) / COUNT(DISTINCT DATE(timestamp)) as cost_per_day
FROM llm_events
WHERE project_id = :pid
  AND timestamp >= NOW() - INTERVAL '7 days'
  AND model IN ('gpt-4o', 'gpt-4-turbo', 'claude-3-opus', ...)
GROUP BY feature_tag, model
HAVING COUNT(*) >= 5           -- minimum data points
   AND AVG(output_tokens) <= 100  -- output is short → simple task
```

**Thresholds**:
- Minimum 5 calls in the 7-day window (avoids noise)
- Average output tokens ≤ 100 (short output = task doesn't need frontier model)
- Model must be in the "downgradeable" set (frontier models with cheaper alternatives)

**Projected cost**: `current_cost_per_day * 0.25` — frontier-to-mini models typically cost ~75% less.

**Accuracy risk**: `low` — the smaller models handle simple tasks (short responses, classification, extraction) equally well.

**Stored payload**:
```json
{
  "current_model": "gpt-4o",
  "target_model": "gpt-4o-mini",
  "avg_out_tokens": 28,
  "days_window": 7
}
```

### 2. Latency Optimization (`latency_optimization`)

**Goal**: Identify features with high average latency where streaming would reduce perceived wait time.

**Query**:
```sql
SELECT feature_tag,
       AVG(latency_ms) as avg_latency,
       SUM(estimated_cost) / COUNT(DISTINCT DATE(timestamp)) as cost_per_day
FROM llm_events
WHERE project_id = :pid
  AND timestamp >= NOW() - INTERVAL '7 days'
GROUP BY feature_tag
HAVING COUNT(*) >= 5
   AND AVG(latency_ms) > 3000   -- > 3 seconds is high latency
```

**Thresholds**:
- Average latency > 3,000ms (3 seconds)
- Minimum 5 calls

**Recommendation**: Enable `stream=True` on the API call so the first token is visible immediately. Add a `timeout` parameter to prevent indefinite hangs. Consider whether a smaller model would reduce latency.

**Accuracy risk**: `low` — streaming changes delivery, not model behavior.

**Projected cost**: Same as current (streaming does not change token count or billing).

### 3. Cost Spike (`anomaly_alert`)

**Goal**: Detect when today's cost is anomalously high compared to recent history.

**Today's cost**:
```python
today_cost = db.execute(
    select(func.sum(LLMEvent.estimated_cost))
    .where(
        LLMEvent.project_id == project_id,
        LLMEvent.timestamp >= today_start,
    )
).scalar() or 0.0
```

**Trailing daily average** (correctly computed as average of daily sums, not average per event):
```python
daily_sums_subq = (
    select(func.sum(LLMEvent.estimated_cost).label("day_total"))
    .where(
        LLMEvent.project_id == project_id,
        LLMEvent.timestamp >= seven_days_ago,
        LLMEvent.timestamp < today_start,
    )
    .group_by(func.date(LLMEvent.timestamp))
    .subquery()
)
trailing_avg = db.execute(
    select(func.avg(daily_sums_subq.c.day_total))
).scalar() or 0.0
```

**Threshold**:
- `today_cost >= 2 * trailing_avg` (2x spike)
- `today_cost > 0.001` (ignore near-zero amounts)
- `trailing_avg > 0` (need a baseline)

**Accuracy risk**: `medium` — spike might be legitimate increased usage.

**Projected cost / savings**: Not applicable for anomaly alerts. `estimated_savings_pct = 0.0`, `projected_cost_per_day = current_cost_per_day` (same value — this is an alert, not a cost-reducing suggestion).

**Stored payload**:
```json
{
  "today_cost": 0.0842,
  "trailing_avg": 0.0031,
  "multiplier": 2.7,
  "days_window": 7
}
```

### 4. Prompt Compression (`prompt_compress`)

**Goal**: Reduce token count of system prompts by rewriting them to be more concise.

Unlike the other three types, prompt compression is **not run automatically** by the heuristic sweep. It is triggered when the system detects a feature with a large average input token count (implementation-specific — can be triggered by the periodic sweep or on-demand). It makes **one LLM call** to rewrite the prompt.

**LLM prompt to compress**:
```
Compress this LLM system prompt to be as short as possible while preserving
all instructions. Return JSON: {"original_tokens": N, "compressed_tokens": M,
"compressed_prompt": "..."}
```

**Threshold for creating a suggestion**: compressed version must be at least a few tokens shorter than the original (any improvement is reported).

**Accuracy risk**: `medium` — compressed prompts may subtly change model behavior and should be tested.

---

## 11. Suggestion Lifecycle

```
                    ┌─────────────┐
      Created by    │   pending   │   Initial state.
      heuristic ──► │             │   Shown in "New" section.
                    └──────┬──────┘
                           │ User clicks "View fix steps"
                           │ POST /simulate
                           ▼
                    ┌─────────────┐
                    │  simulated  │   Savings calculated.
                    │             │   Shown in "In progress" section.
                    └──────┬──────┘
                           │ (auto) POST /apply
                           │ immediately after simulate
                           ▼
                    ┌─────────────┐
                    │   applied   │   Fix recommendation generated.
                    │             │   Shown in "Applied" section.
                    └─────────────┘

At any point:
    │ User clicks dismiss
    ▼
┌─────────────┐
│  dismissed  │   Hidden from list queries.
│             │   Not deleted — preserved in DB for audit.
└─────────────┘
```

### Simulate endpoint

`POST /api/v1/suggestions/simulate` — marks suggestion as `simulated` and returns detailed projections:

```python
current  = sug.current_cost_per_day  if sug.current_cost_per_day  is not None else 0.0
projected = sug.projected_cost_per_day if sug.projected_cost_per_day is not None else current
savings_pct = sug.estimated_savings_pct if sug.estimated_savings_pct is not None else 0.0

# Count actual events in the suggestion's time window for honest sample size
sample_size = db.execute(
    select(func.count(LLMEvent.id))
    .where(LLMEvent.project_id == sug.project_id,
           LLMEvent.timestamp >= since,
           LLMEvent.feature_tag == sug.feature_tag)  # if applicable
).scalar()

return SimulateResponse(
    current_monthly_cost   = current * 30,
    projected_monthly_cost = projected * 30,
    savings_usd_monthly    = (current - projected) * 30,
    savings_pct            = savings_pct,
    accuracy_risk          = sug.accuracy_risk,
    sample_size            = sample_size,
)
```

**Important**: The `is not None` check (not truthiness) is critical because `0.0` is a valid cost value. Using `or` would incorrectly treat `0.0` as missing and fall back to `current`.

### Apply endpoint

`POST /api/v1/suggestions/apply` — marks as `applied` and returns the recommendation text. In the dashboard's one-click flow, simulate and apply are called back-to-back automatically.

---

## 12. Latency Management

The platform addresses latency at multiple levels:

### SDK-level: zero blocking

- The `wrap_openai` patch adds **no latency** to your LLM call — it only reads response fields that are already available
- Event enqueue is a non-blocking `queue.put_nowait()` — if the queue is full, the event is dropped silently
- HTTP shipping happens on a **daemon thread**, completely off the request path
- `flush_interval_secs=0.5` is tuned to deliver events quickly without excessive HTTP calls

### Ingest API: fire-and-forget analysis

- `trigger_metrics_aggregation.delay()` is **non-blocking** — the Celery task is enqueued in Redis and the ingest response is returned immediately
- The ingest endpoint never waits for analysis to complete

### Database: query optimization

- All metrics queries are bounded by `(project_id, timestamp)` index
- Hotspot queries use `GROUP BY feature_tag` with index on `feature_tag`
- Overview uses a single aggregation query (not per-event processing)
- The trailing daily average for anomaly detection uses a subquery pattern to compute per-day sums first, then average those — this is more expensive than `AVG(cost)` per event but gives the correct result

### Analysis engine: pure Python, no I/O wait

- `_run_project_analysis` makes direct DB queries with no external HTTP calls
- All three heuristic checks run in a single DB transaction
- No LLM calls in the analysis path — maximum analysis latency is determined by DB query speed

### Dashboard: client-side rendering

- All pages use React hooks with `useEffect` for data fetching — initial HTML loads instantly
- Charts render client-side with Recharts (no SSR for dynamic data)
- API responses are typed with TypeScript interfaces in `api.ts`

---

## 13. Authentication and Multi-Tenancy

The platform uses two separate authentication flows:

### User authentication (dashboard)

```
POST /api/v1/auth/login
Body: { email, password }
→ Returns: { access_token: "eyJ..." }

Dashboard stores token in localStorage.
All dashboard API calls: Authorization: Bearer <access_token>
```

JWT payload: `{ sub: "<user_uuid>", exp: <timestamp> }` — 24-hour expiry.

Password hashing: SHA-256 pre-hash (to handle passwords > 72 bytes) then bcrypt with cost factor 12.

### Project API key authentication (SDK)

```
POST /api/v1/ingest
Authorization: Bearer <project_api_key>
```

Project API keys are stored as plain UUIDs in the `projects.api_key` column. They are validated by `get_project_from_key()` which does a direct DB lookup — no JWT involved.

### Multi-tenancy isolation

Every API endpoint that returns data verifies ownership:

```python
# Suggestions: verify project ownership before returning suggestions
r = await db.execute(
    select(Project).where(Project.id == project_id, Project.owner_id == user_id)
)
if not r.scalar_one_or_none():
    raise HTTPException(404, "Project not found")
```

Projects are owned by users. All LLM events, suggestions, and metrics are scoped to a project. Users can only see and modify their own projects.

---

## 14. Celery Task Scheduling

### Broker topology

```
Redis DB 1: Celery broker (task messages)
Redis DB 2: Celery result backend (task state/results)
```

### Beat schedule (celery_app.py)

```python
celery_app.conf.beat_schedule = {
    "run-heuristics-hourly-sweep": {
        "task": "app.agents.tasks.run_heuristic_agent",
        "schedule": 3600.0,  # every hour
    },
    # run_anomaly_agent is also registered and fired hourly in the same sweep
}
```

### Queue routing

Workers consume from two queues:
```
celery -A app.celery_app worker --concurrency=4 -Q default,agents
```

- `default` — ingest triggers, standard API-initiated tasks
- `agents` — analysis tasks (heuristic sweeps, compression)

The concurrency of 4 means up to 4 analysis tasks can run in parallel per worker.

### Task idempotency

All tasks are safe to retry and run multiple times:
- `_run_project_analysis` checks for existing non-dismissed suggestions before creating new ones
- The `trigger_metrics_aggregation` task respects `_should_run()` cooldown logic
- `run_compression_agent` has an explicit duplicate guard before inserting

---

## 15. Configuration and Environment

All configuration is managed through Pydantic `BaseSettings` in `core/config.py`. Environment variables override defaults.

```env
# ── Database ───────────────────────────────────────────────
DATABASE_URL=postgresql+asyncpg://postgres:postgres@db:5432/llm_monitor
# Used by FastAPI async sessions (asyncpg driver)

SYNC_DATABASE_URL=postgresql://postgres:postgres@db:5432/llm_monitor
# Used by Celery tasks (sync psycopg2 driver)

# ── Redis/Celery ───────────────────────────────────────────
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/1
CELERY_RESULT_BACKEND=redis://redis:6379/2

# ── Authentication ─────────────────────────────────────────
SECRET_KEY=<long-random-string>       # MUST be changed in production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440      # 24 hours

# ── Application ────────────────────────────────────────────
ENVIRONMENT=development
LOG_LEVEL=INFO
CORS_ORIGINS=http://localhost:3000    # comma-separated for multiple

# ── LLM ────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...                 # Optional: enables LLM recommendations
COMPRESSION_MODEL=gpt-4o-mini         # Model for compression + fix text

# ── Notifications ──────────────────────────────────────────
SLACK_WEBHOOK_URL=                    # Optional: future alerting hook

# ── Dashboard ──────────────────────────────────────────────
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The system is designed to run without `OPENAI_API_KEY`. All core functionality (ingestion, metrics, heuristic suggestions, cost analysis) works with zero LLM calls. The only degraded experience is that "View fix steps" produces template-generated text instead of LLM-generated text.

---

## 16. Infrastructure — Docker Services

```yaml
services:
  db:
    image: postgres:16
    healthcheck: pg_isready

  redis:
    image: redis:7-alpine
    healthcheck: redis-cli ping

  backend:
    build: ./backend
    command: alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    depends_on: [db, redis]
    ports: ["8000:8000"]

  worker:
    build: ./backend
    command: celery -A app.celery_app worker --concurrency=4 -Q default,agents
    depends_on: [db, redis]

  beat:
    build: ./backend
    command: celery -A app.celery_app beat --loglevel=info
    depends_on: [db, redis]

  dashboard:
    build: ./dashboard
    ports: ["3000:3000"]
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
```

**Migration strategy**: The backend container runs `alembic upgrade head` as the first part of its startup command. This ensures the schema is always up to date before the API begins accepting requests. The worker and beat containers share the same image and environment but do not run migrations.

**Health checks**: The backend and worker containers wait for `db` and `redis` health checks to pass before starting. This prevents startup failures from race conditions during `docker compose up`.
