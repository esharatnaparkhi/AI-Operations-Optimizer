"""Data models for LLM telemetry events."""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class LLMEvent:
    """A single LLM API call telemetry record."""

    # Identity
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    project_key: str = ""

    # Timing
    timestamp: float = field(default_factory=time.time)
    latency_ms: float = 0.0

    # Provider info
    provider: str = ""          # openai, anthropic, cohere, ...
    model: str = ""             # gpt-4o, claude-3-5-sonnet, ...
    endpoint: str = ""          # chat.completions, messages, ...

    # Token counts
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0

    # Cost (USD)
    estimated_cost_usd: float = 0.0

    # Context
    feature_tag: Optional[str] = None   # e.g. "search", "summarize"
    user_id: Optional[str] = None       # hashed by default
    session_id: Optional[str] = None

    # RAG metadata (optional)
    rag_chunks: int = 0
    rag_avg_chunk_tokens: int = 0

    # Error info
    error: Optional[str] = None
    status_code: Optional[int] = None

    def to_dict(self) -> dict:
        return asdict(self)
