"""Pydantic API schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, EmailStr, Field


# ── Auth ──────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    name: Optional[str] = None


class UserResponse(BaseModel):
    id: str
    email: str
    name: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ── Projects ──────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class ProjectResponse(BaseModel):
    id: str
    name: str
    api_key: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Ingest ────────────────────────────────────────────────────

class EventPayload(BaseModel):
    event_id: str
    project_key: str
    timestamp: float
    latency_ms: float = 0.0
    provider: str = ""
    model: str = ""
    endpoint: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0
    feature_tag: Optional[str] = None
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    rag_chunks: int = 0
    rag_avg_chunk_tokens: int = 0
    error: Optional[str] = None
    status_code: Optional[int] = None


class IngestRequest(BaseModel):
    events: List[EventPayload]


class IngestResponse(BaseModel):
    received: int
    queued: int


# ── Metrics ───────────────────────────────────────────────────

class DailyMetricResponse(BaseModel):
    date: str
    total_calls: int
    total_tokens: int
    total_cost: float
    avg_latency_ms: float
    error_count: int

    class Config:
        from_attributes = True


class HotspotItem(BaseModel):
    feature_tag: str
    total_cost: float
    total_tokens: int
    total_calls: int
    avg_latency_ms: float


class OverviewResponse(BaseModel):
    today_cost: float
    today_tokens: int
    today_calls: int
    avg_latency_ms: float
    efficiency_score: float   # 0-100
    cost_trend_pct: float     # vs yesterday


# ── Suggestions ───────────────────────────────────────────────

class SuggestionResponse(BaseModel):
    id: str
    suggestion_type: str
    feature_tag: Optional[str]
    title: str
    description: str
    current_cost_per_day: Optional[float]
    projected_cost_per_day: Optional[float]
    estimated_savings_pct: Optional[float]
    accuracy_risk: Optional[str]
    confidence: Optional[float]
    payload: Optional[Any]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class SimulateRequest(BaseModel):
    suggestion_id: str


class SimulateResponse(BaseModel):
    suggestion_id: str
    projected_daily_cost: float
    projected_monthly_cost: float
    savings_usd_monthly: float
    savings_pct: float
    accuracy_risk: str
    sample_size: int


class ApplyRequest(BaseModel):
    suggestion_id: str
    apply_mode: str = "snippet"   # snippet | runtime_rule


class ApplyResponse(BaseModel):
    suggestion_id: str
    mode: str
    snippet: Optional[str] = None
    message: str
