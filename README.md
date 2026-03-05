# LLM Efficiency Platform

An end-to-end observability and optimization platform for production LLM applications. It instruments your OpenAI (or Anthropic) client with a single line of code, ships structured telemetry to a backend pipeline, and surfaces actionable cost and latency optimizations in a real-time dashboard.

Think of it as **Sentry for LLM costs** — passive instrumentation, zero changes to business logic, automatic recommendations.

---

## Aim

LLM API costs and latency are opaque by default. Teams commonly overspend on frontier models for simple tasks, write bloated prompts, and have no visibility into which features of their product are responsible for most of the spend.

This platform solves that by:

- Giving you **per-feature cost and latency breakdowns** across your entire LLM pipeline
- Running **automated heuristic analysis** after every ingest batch to detect model over-engineering, latency regressions, and cost spikes
- Producing **concrete, human-readable fix recommendations** (not just alerts) that tell you exactly what to change in your pipeline and why
- Letting you **simulate the financial impact** of a suggested change before applying it

---

## What It Takes as Input

### From your application (via the SDK)

Every time your application makes an LLM call, the SDK captures and ships:

| Field | Description |
|---|---|
| `model` | Model name (e.g. `gpt-4o`, `claude-3-5-sonnet`) |
| `provider` | API provider (`openai`, `anthropic`, `cohere`, etc.) |
| `input_tokens` | Prompt token count |
| `output_tokens` | Completion token count |
| `latency_ms` | End-to-end wall-clock latency |
| `feature_tag` | Optional label grouping calls by product feature |
| `user_id` | Optional user identifier (hashed before transmission) |
| `session_id` | Optional session identifier |
| `error` | Error message if the call failed |
| `status_code` | HTTP status from the provider |

The SDK captures all of this automatically by wrapping the client — no manual instrumentation needed.

### Configuration inputs

- **Project API key** — issued per project from the dashboard, authenticates SDK events
- **Suggestion frequency mode** — controls how aggressively the analysis pipeline runs (`instant`, `24h`, or a custom interval like `6h`)
- **OpenAI API key** (optional) — enables LLM-powered recommendation text; falls back to static templates if absent

---

## What It Gives as Output

### Dashboard metrics

- **Overview** — today's cost, token usage, API call count, average latency, efficiency score, and day-over-day cost trend
- **14-day timeseries** — daily cost, token usage, and call volume charts
- **Cost hotspots** — every feature tag ranked by total spend, with share of budget, token counts, call volumes, and latency

### Optimization suggestions

Each suggestion includes:

- **Type** — one of: model downgrade, prompt compression, latency optimization, anomaly alert
- **Feature tag** — which part of your pipeline is affected
- **Cost before / after** — current daily cost and projected daily cost after the fix
- **Estimated savings %** — percentage reduction in cost
- **Accuracy risk** — low / medium / high, indicating how safe the change is
- **Fix recommendation** — a plain-English step-by-step guide structured as:
  - **WHAT TO CHANGE** — the specific parameter or value to update
  - **WHERE** — which API call or pipeline component is affected
  - **HOW** — exact steps to make the change
  - **WHY** — before/after numbers showing the financial impact

### Suggestion states

Suggestions flow through: `pending` → `simulated` → `applied` (or `dismissed`)

- **Simulate** — calculates precise monthly savings and sample size before you commit
- **Apply** — generates the full human-readable recommendation
- **Dismiss** — removes it from your queue

---

## How the System Works

```
Your App
  └─ SDK wraps OpenAI/Anthropic client
       └─ Intercepts every LLM call
            └─ Captures telemetry (tokens, cost, latency, tags)
                 └─ Batches events (up to 50, flushed every 0.5s)
                      └─ POST /api/v1/ingest → Backend
                           ├─ Stores LLMEvent rows in PostgreSQL
                           └─ Triggers Celery task (async)
                                └─ Heuristic analysis engine
                                     ├─ Model downgrade check
                                     ├─ Latency regression check
                                     └─ Cost spike detection
                                          └─ Creates Suggestion rows
                                               └─ Dashboard reads & displays
```

### 1. SDK instrumentation

The SDK's `LLMMonitor.wrap_openai()` monkey-patches `client.chat.completions.create`. The patch:
1. Records the start time
2. Calls the real API
3. Extracts token counts, model name, and feature tag from the response and context
4. Estimates cost using built-in pricing tables (covering 20+ models across OpenAI, Anthropic, Google, Cohere, Mistral)
5. Enqueues an `LLMEvent` to a thread-safe in-memory queue

A background daemon thread flushes the queue to the backend in batches, keeping the critical path latency impact under 1ms.

### 2. Ingest API

`POST /api/v1/ingest` accepts batched events authenticated by project API key. It:
- De-duplicates by `event_id` (UUID generated client-side)
- Stores each event as an `LLMEvent` row
- Fires a `trigger_metrics_aggregation` Celery task asynchronously

### 3. Heuristic analysis (zero LLM calls)

After every ingest batch, the Celery worker runs `_run_project_analysis()` — a pure Python function that queries the database and applies three checks:

**Model downgrade check**: Finds feature tags where ≥5 calls used a frontier model (e.g. `gpt-4o`, `gpt-4-turbo`, `claude-3-opus`) and the average output token count is ≤100. This indicates a simple task that doesn't need a frontier model. Creates a `model_downgrade` suggestion with ~75% projected cost savings.

**Latency optimization check**: Finds feature tags with average latency above 3000ms. Creates a `latency_optimization` suggestion recommending streaming (`stream=True`) and timeouts.

**Cost spike check**: Compares today's total project cost against a 7-day trailing daily average. If today's cost is ≥2× the average, creates an `anomaly_alert` suggestion.

All three checks include an inline duplicate guard — if a non-dismissed suggestion of the same type and feature tag already exists, it is skipped.

### 4. Periodic sweeps (Celery Beat)

In addition to per-ingest triggers, a Celery Beat scheduler runs:
- **Hourly** (`run_heuristic_agent`) — scans all active projects and runs `_run_project_analysis` on any that are due based on their configured suggestion frequency
- **Hourly** (`run_anomaly_agent`) — dedicated cost-spike pass across all projects

### 5. LLM calls (used sparingly)

The platform uses a real LLM in only one place: prompt compression. When a `prompt_compress` suggestion is applied, `run_compression_agent` makes a **single** `gpt-4o-mini` call to analyze a sample prompt and suggest a compressed version. All other analysis (model downgrade, latency, anomaly) is pure Python with zero LLM calls.

When a user clicks **View fix steps**, `_generate_snippet_llm` makes one LLM call (also `gpt-4o-mini`) to produce the plain-text WHAT/WHERE/HOW/WHY recommendation. If the OpenAI key is absent or the call fails, it falls back to `_generate_snippet_static` — a template-based fallback that covers all suggestion types.

### 6. Dashboard

A Next.js frontend reads from the backend REST API using a typed API client. All pages are client-rendered with React hooks. The dashboard has four sections: Overview, Cost Hotspots, Suggestions, and Settings.

---

## How to Run

### Prerequisites

- Docker and Docker Compose
- An OpenAI API key (optional — only needed for LLM-powered recommendation text)

### 1. Clone and configure

```bash
git clone <repo>
cd llm-efficiency-platform
cp .env.example .env
```

Edit `.env`:

```env
# Required
SECRET_KEY=<long-random-string>

# Optional — enables LLM-powered fix recommendations
OPENAI_API_KEY=sk-...
```

The defaults in `.env.example` work out of the box for local Docker Compose.

### 2. Start all services

```bash
docker compose up --build
```

This starts six containers:

| Container | Role | Port |
|---|---|---|
| `db` | PostgreSQL 16 | 5432 |
| `redis` | Redis 7 (broker + result backend) | 6379 |
| `backend` | FastAPI + Uvicorn | 8000 |
| `worker` | Celery worker (analysis tasks) | — |
| `beat` | Celery Beat (scheduled sweeps) | — |
| `dashboard` | Next.js frontend | 3000 |

The backend runs `alembic upgrade head` on startup before accepting requests.

### 3. Open the dashboard

Navigate to [http://localhost:3000](http://localhost:3000), register an account, and create a project. Copy the project API key from Settings.

### 4. Instrument your application

```bash
pip install llm-monitor-sdk
```

```python
import openai
from llm_monitor import LLMMonitor, feature_tag

# Initialize once at startup
monitor = LLMMonitor(
    api_key="<your-project-api-key>",
    endpoint="http://localhost:8000",
)

# Wrap your client — one line, no other changes needed
client = monitor.wrap_openai(openai.OpenAI())

# Tag calls by feature for per-feature cost breakdown
with feature_tag("summarize"):
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Summarize this article..."}],
    )
```

Data appears in the dashboard within seconds. Suggestions appear automatically as the analysis pipeline processes your events.

### 5. Development (without Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Worker (separate terminal)
celery -A app.celery_app worker --concurrency=4 -Q default,agents

# Beat scheduler (separate terminal)
celery -A app.celery_app beat

# Dashboard (separate terminal)
cd dashboard
npm install
npm run dev
```

Requires a running PostgreSQL instance and Redis. Set `DATABASE_URL`, `SYNC_DATABASE_URL`, and `REDIS_URL` in your environment.

---

## Project Structure

```
llm-efficiency-platform/
├── sdk/                    # Python client SDK
│   └── llm_monitor/
│       ├── monitor.py      # LLMMonitor — wraps clients, manages lifecycle
│       ├── wrappers.py     # OpenAI / Anthropic intercept patches
│       ├── shipper.py      # Thread-safe batched HTTP event queue
│       ├── pricing.py      # Cost estimation tables (20+ models)
│       ├── context.py      # feature_tag() context manager
│       └── models.py       # LLMEvent dataclass
│
├── backend/
│   └── app/
│       ├── main.py         # FastAPI app, CORS, router registration
│       ├── celery_app.py   # Celery + Beat schedule
│       ├── core/
│       │   ├── config.py   # Pydantic settings from environment
│       │   ├── database.py # Async SQLAlchemy engine (asyncpg)
│       │   └── auth.py     # JWT + bcrypt authentication
│       ├── models/
│       │   ├── db.py       # ORM: User, Project, LLMEvent, Suggestion, DailyMetric
│       │   └── schemas.py  # Pydantic request/response schemas
│       ├── api/
│       │   ├── auth.py     # /register, /login
│       │   ├── projects.py # Project CRUD + mode settings
│       │   ├── ingest.py   # Telemetry ingestion endpoint
│       │   ├── metrics.py  # Overview, timeseries, hotspots
│       │   └── suggestions.py # List, simulate, apply, dismiss
│       └── agents/
│           └── tasks.py    # Celery tasks + heuristic analysis engine
│
└── dashboard/              # Next.js React frontend
    └── src/app/
        ├── dashboard/
        │   ├── layout.tsx      # Sidebar navigation
        │   ├── page.tsx        # Overview with charts
        │   ├── hotspots/       # Feature cost breakdown
        │   ├── suggestions/    # Optimization recommendations
        │   └── settings/       # API key + suggestion frequency
        └── lib/api.ts          # Typed API client
```
