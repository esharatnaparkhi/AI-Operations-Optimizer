"""Celery application factory."""
from celery import Celery
from .core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "llm_monitor",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.agents.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "app.agents.tasks.*": {"queue": "agents"},
    },
    beat_schedule={
        "run-heuristics-every-hour": {
            "task": "app.agents.tasks.run_heuristic_agent",
            "schedule": 3600.0,
        },
        "run-anomaly-check-every-5min": {
            "task": "app.agents.tasks.run_anomaly_agent",
            "schedule": 300.0,
        },
    },
)
