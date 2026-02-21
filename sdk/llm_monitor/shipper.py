"""
Batched event shipper.
Collects events in memory and flushes them to the ingest API
either on a timer or when the batch reaches max_batch_size.
"""
from __future__ import annotations

import atexit
import logging
import queue
import threading
import time
from typing import List, Optional

import httpx

from .models import LLMEvent

logger = logging.getLogger("llm_monitor.shipper")


class EventShipper:
    """Thread-safe, batched HTTP shipper."""

    def __init__(
        self,
        endpoint: str,
        api_key: str,
        max_batch_size: int = 50,
        flush_interval_secs: float = 5.0,
        timeout_secs: float = 5.0,
        sampling_rate: float = 1.0,
    ):
        self.endpoint = endpoint.rstrip("/") + "/api/v1/ingest"
        self.api_key = api_key
        self.max_batch_size = max_batch_size
        self.flush_interval = flush_interval_secs
        self.timeout = timeout_secs
        self.sampling_rate = sampling_rate

        self._queue: queue.Queue[LLMEvent] = queue.Queue(maxsize=10_000)
        self._lock = threading.Lock()
        self._stop = threading.Event()

        self._thread = threading.Thread(target=self._flush_loop, daemon=True, name="llm-monitor-shipper")
        self._thread.start()
        atexit.register(self.flush)

    def enqueue(self, event: LLMEvent) -> None:
        """Non-blocking enqueue. Drops if queue is full (backpressure)."""
        import random
        if self.sampling_rate < 1.0 and random.random() > self.sampling_rate:
            return
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            logger.debug("llm_monitor: event queue full, dropping event")

    def flush(self) -> None:
        """Drain the queue and send all pending events."""
        events: List[LLMEvent] = []
        while not self._queue.empty():
            try:
                events.append(self._queue.get_nowait())
            except queue.Empty:
                break
        if events:
            self._send(events)

    def shutdown(self) -> None:
        self._stop.set()
        self.flush()

    # ── Internal ──────────────────────────────────────────────

    def _flush_loop(self) -> None:
        last_flush = time.monotonic()
        while not self._stop.is_set():
            now = time.monotonic()
            elapsed = now - last_flush
            qsize = self._queue.qsize()

            if qsize >= self.max_batch_size or elapsed >= self.flush_interval:
                self.flush()
                last_flush = time.monotonic()
            else:
                time.sleep(0.2)

    def _send(self, events: List[LLMEvent]) -> None:
        payload = [e.to_dict() for e in events]
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(
                    self.endpoint,
                    json={"events": payload},
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "User-Agent": "llm-monitor-sdk/0.1.0",
                    },
                )
                if resp.status_code >= 400:
                    logger.warning(
                        "llm_monitor: ingest API returned %s — %s",
                        resp.status_code,
                        resp.text[:200],
                    )
        except Exception as exc:
            logger.debug("llm_monitor: failed to ship events: %s", exc)
