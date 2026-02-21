"""
Provider-specific wrappers that intercept calls and emit LLMEvents.
"""
from __future__ import annotations

import time
import hashlib
import logging
from typing import Any, Callable, Optional

from .models import LLMEvent
from .pricing import estimate_cost
from .context import get_current_feature_tag

logger = logging.getLogger("llm_monitor.wrappers")


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:16]


# ── OpenAI ────────────────────────────────────────────────────────────────────

def wrap_openai(client: Any, shipper: Any, project_key: str, hash_content: bool, provider: str = "openai") -> Any:
    """
    Monkey-patch an openai.OpenAI / AsyncOpenAI client in-place.
    Returns the same client.
    """
    original_create = client.chat.completions.create

    def patched_create(*args, **kwargs):
        # Extract feature tag from custom header or context
        headers = kwargs.pop("extra_headers", {}) or {}
        tag = headers.get("X-Feature-Tag") or get_current_feature_tag()
        user_id = kwargs.get("user")
        if user_id and hash_content:
            user_id = _hash(user_id)

        start = time.perf_counter()
        error: Optional[str] = None
        status_code = 200
        response = None

        try:
            response = original_create(*args, **kwargs, extra_headers=headers)
        except Exception as exc:
            error = type(exc).__name__
            status_code = getattr(getattr(exc, "response", None), "status_code", 500)
            raise
        finally:
            latency_ms = (time.perf_counter() - start) * 1000

            # Extract token counts
            usage = getattr(response, "usage", None)
            input_tokens  = getattr(usage, "prompt_tokens", 0) if usage else 0
            output_tokens = getattr(usage, "completion_tokens", 0) if usage else 0
            total_tokens  = getattr(usage, "total_tokens", 0) if usage else 0

            model = kwargs.get("model", "") or (response.model if response else "")

            event = LLMEvent(
                project_key     = project_key,
                provider        = "openai",
                model           = model,
                endpoint        = "chat.completions",
                latency_ms      = round(latency_ms, 2),
                input_tokens    = input_tokens,
                output_tokens   = output_tokens,
                total_tokens    = total_tokens,
                estimated_cost_usd = estimate_cost("openai", model, input_tokens, output_tokens),
                feature_tag     = tag,
                user_id         = user_id,
                error           = error,
                status_code     = status_code,
            )
            shipper.enqueue(event)

        return response

    client.chat.completions.create = patched_create
    return client


# ── Anthropic ─────────────────────────────────────────────────────────────────

def wrap_anthropic(client: Any, shipper: Any, project_key: str, hash_content: bool) -> Any:
    """Monkey-patch an anthropic.Anthropic client in-place."""
    original_create = client.messages.create

    def patched_create(*args, **kwargs):
        tag = get_current_feature_tag()
        start = time.perf_counter()
        error = None
        status_code = 200
        response = None

        try:
            response = original_create(*args, **kwargs)
        except Exception as exc:
            error = type(exc).__name__
            status_code = 500
            raise
        finally:
            latency_ms = (time.perf_counter() - start) * 1000
            usage = getattr(response, "usage", None)
            input_tokens  = getattr(usage, "input_tokens", 0) if usage else 0
            output_tokens = getattr(usage, "output_tokens", 0) if usage else 0
            model = kwargs.get("model", "")

            event = LLMEvent(
                project_key    = project_key,
                provider       = "anthropic",
                model          = model,
                endpoint       = "messages",
                latency_ms     = round(latency_ms, 2),
                input_tokens   = input_tokens,
                output_tokens  = output_tokens,
                total_tokens   = input_tokens + output_tokens,
                estimated_cost_usd = estimate_cost("anthropic", model, input_tokens, output_tokens),
                feature_tag    = tag,
                error          = error,
                status_code    = status_code,
            )
            shipper.enqueue(event)

        return response

    client.messages.create = patched_create
    return client
