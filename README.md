# 🧠 LLM Efficiency Monitoring & Optimization Platform

> Sentry/Datadog for LLM systems — monitor, explain, and optimize cost & latency safely.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Your App                             │
│  from llm_monitor import monitor                            │
│  monitor.wrap_openai(openai_client)  # one line             │
└────────────────────────┬────────────────────────────────────┘
                         │ batched events (HTTP)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (FastAPI)                         │
│  Ingest API → Redis Queue → Celery Workers → Postgres       │
│  Agents: Metrics, Anomaly, Heuristic, Compression, Sim      │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Dashboard (Next.js)                         │
│  Cost/Tokens • Hotspots • Suggestions • Simulate • Apply    │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Clone and start all services
git clone <repo>
cd llm-efficiency-platform
cp .env.example .env
docker compose up -d

# Install the SDK
pip install llm-monitor-sdk
```

## Components

| Component | Path | Tech |
|-----------|------|------|
| Python SDK | `sdk/` | Python 3.9+ |
| Backend API | `backend/` | FastAPI + Postgres + Redis |
| Dashboard | `dashboard/` | Next.js 14 + Tailwind |
| Infrastructure | `infra/` | Docker + docker-compose |

## SDK Usage

```python
import openai
from llm_monitor import LLMMonitor

monitor = LLMMonitor(api_key="your-project-key")
client = monitor.wrap_openai(openai.OpenAI())

# All calls now tracked automatically
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={"X-Feature-Tag": "chat"}
)
```

## Development

```bash
# Backend only
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload

# Dashboard only  
cd dashboard && npm install && npm run dev

# Full stack
docker compose up
```

## Environment Variables

Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL` — Postgres connection string
- `REDIS_URL` — Redis connection string
- `SECRET_KEY` — JWT signing secret
- `OPENAI_API_KEY` — For prompt compression agent (optional)

```
llm-efficiency-platform/
├── .env.example
├── .gitignore
├── README.md
├── docker-compose.yml
│
├── sdk/
│   ├── pyproject.toml
│   ├── llm_monitor/
│   │   ├── __init__.py
│   │   ├── monitor.py
│   │   ├── wrappers.py
│   │   ├── shipper.py
│   │   ├── pricing.py
│   │   ├── context.py
│   │   └── models.py
│   └── tests/
│       └── test_sdk.py
│
├── backend/
│   ├── Dockerfile
│   ├── alembic.ini
│   ├── requirements.txt
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── celery_app.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── ingest.py
│   │   │   ├── metrics.py
│   │   │   ├── projects.py
│   │   │   └── suggestions.py
│   │   ├── agents/
│   │   │   ├── __init__.py
│   │   │   └── tasks.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── config.py
│   │   │   └── database.py
│   │   └── models/
│   │       ├── __init__.py
│   │       ├── db.py
│   │       └── schemas.py
│   └── migrations/
│       ├── env.py
│       ├── script.py.mako
│       └── versions/
│           └── 0001_initial.py
│
└── dashboard/
    ├── Dockerfile
    ├── next.config.js
    ├── package.json
    ├── postcss.config.js
    ├── tailwind.config.js
    ├── tsconfig.json
    └── src/
        ├── app/
        │   ├── globals.css
        │   ├── layout.tsx         ← root layout
        │   ├── page.tsx           ← login/register page
        │   └── dashboard/
        │       ├── layout.tsx     ← sidebar + nav
        │       ├── page.tsx       ← overview (charts, stats)
        │       ├── hotspots/
        │       │   └── page.tsx   ← hot endpoints table
        │       ├── suggestions/
        │       │   └── page.tsx   ← simulate & apply
        │       └── settings/
        │           └── page.tsx   ← API key + SDK setup
        └── lib/
            └── api.ts             ← typed API client
```