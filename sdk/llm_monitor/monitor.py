"""
LLMMonitor — main entry point.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from .shipper import EventShipper
from .wrappers import wrap_openai, wrap_anthropic

logger = logging.getLogger("llm_monitor")


class LLMMonitor:
    """
    Central monitor object.  Create once, reuse everywhere.

    Parameters
    ----------
    api_key:
        Project API key from the dashboard.
    endpoint:
        Base URL of your self-hosted or cloud ingest service.
        Defaults to the hosted SaaS endpoint.
    max_batch_size:
        Flush when this many events accumulate.
    flush_interval_secs:
        Flush at most this often (seconds).
    sampling_rate:
        Float 0–1.  Send only this fraction of events (saves bandwidth
        for very high-volume apps).  Default 1.0 = 100%.
    hash_content:
        Hash user IDs and other PII before sending.  Default True.
    """

    def __init__(
        self,
        api_key: str,
        endpoint: str = "https://api.llm-monitor.io",
        max_batch_size: int = 50,
        flush_interval_secs: float = 5.0,
        sampling_rate: float = 1.0,
        hash_content: bool = True,
    ):
        self.api_key = api_key
        self.hash_content = hash_content
        self._project_key = api_key  # can decode from JWT in future

        self._shipper = EventShipper(
            endpoint=endpoint,
            api_key=api_key,
            max_batch_size=max_batch_size,
            flush_interval_secs=flush_interval_secs,
            sampling_rate=sampling_rate,
        )

        logging.basicConfig(level=logging.WARNING)

    # ── Wrapping helpers ──────────────────────────────────────

    def wrap_openai(self, client: Any) -> Any:
        """
        Instrument an openai.OpenAI (or AsyncOpenAI) client.

        Returns the same client object (mutated in-place) for
        easy one-liner usage::

            client = monitor.wrap_openai(openai.OpenAI())
        """
        return wrap_openai(
            client,
            shipper=self._shipper,
            project_key=self._project_key,
            hash_content=self.hash_content,
        )

    def wrap_anthropic(self, client: Any) -> Any:
        """Instrument an anthropic.Anthropic client."""
        return wrap_anthropic(
            client,
            shipper=self._shipper,
            project_key=self._project_key,
            hash_content=self.hash_content,
        )

    def flush(self) -> None:
        """Force-flush all pending events. Useful before shutdown."""
        self._shipper.flush()

    def shutdown(self) -> None:
        """Graceful shutdown — flush and stop background thread."""
        self._shipper.shutdown()

    # ── Manual tracking ───────────────────────────────────────

    def track(
        self,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        latency_ms: float,
        feature_tag: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """
        Manually record a call if auto-wrapping isn't possible.

        Example::

            monitor.track(
                provider="openai",
                model="gpt-4o",
                input_tokens=512,
                output_tokens=128,
                latency_ms=340.5,
                feature_tag="rag-search",
            )
        """
        from .models import LLMEvent
        from .pricing import estimate_cost

        event = LLMEvent(
            project_key=self._project_key,
            provider=provider,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
            latency_ms=latency_ms,
            estimated_cost_usd=estimate_cost(provider, model, input_tokens, output_tokens),
            feature_tag=feature_tag,
            **kwargs,
        )
        self._shipper.enqueue(event)
