"""FastAPI application entry point."""
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .core.database import engine, Base
from .celery_app import celery_app  # noqa: F401 — must be imported before tasks so @shared_task binds to the configured Redis broker
from .api import auth, projects, ingest, metrics, suggestions

settings = get_settings()
logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL, logging.INFO))


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.ENVIRONMENT == "development":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="LLM Efficiency Monitor API",
    description="Monitor, explain, and optimize LLM cost & latency.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(ingest.router)
app.include_router(metrics.router)
app.include_router(suggestions.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
