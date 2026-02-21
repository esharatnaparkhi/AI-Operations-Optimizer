"""Basic SDK tests."""
import time
import pytest
from unittest.mock import MagicMock, patch

from llm_monitor import LLMMonitor, feature_tag
from llm_monitor.pricing import estimate_cost
from llm_monitor.models import LLMEvent


def test_estimate_cost_known_model():
    cost = estimate_cost("openai", "gpt-4o", 1000, 500)
    # 1000 input @ $2.50/1M + 500 output @ $10/1M
    assert abs(cost - (0.0025 + 0.005)) < 1e-7


def test_estimate_cost_fallback():
    cost = estimate_cost("unknown", "unknown-model", 1000, 500)
    assert cost > 0


def test_feature_tag_context():
    from llm_monitor.context import get_current_feature_tag
    assert get_current_feature_tag() is None
    with feature_tag("test-feature"):
        assert get_current_feature_tag() == "test-feature"
    assert get_current_feature_tag() is None


def test_llm_event_to_dict():
    event = LLMEvent(
        project_key="pk_test",
        provider="openai",
        model="gpt-4o",
        input_tokens=100,
        output_tokens=50,
    )
    d = event.to_dict()
    assert d["provider"] == "openai"
    assert d["model"] == "gpt-4o"
    assert d["input_tokens"] == 100
    assert "event_id" in d
    assert "timestamp" in d


def test_monitor_track(tmp_path):
    """Track a manual event and verify it enqueues."""
    with patch("llm_monitor.shipper.EventShipper._send") as mock_send:
        monitor = LLMMonitor(
            api_key="test",
            endpoint="http://localhost:8000",
            flush_interval_secs=999,  # won't auto-flush
        )
        monitor.track(
            provider="openai",
            model="gpt-4o-mini",
            input_tokens=200,
            output_tokens=100,
            latency_ms=250.0,
            feature_tag="test",
        )
        # Manually flush
        monitor.flush()
        assert mock_send.called
        events = mock_send.call_args[0][0]
        assert len(events) == 1
        assert events[0].feature_tag == "test"
        monitor.shutdown()
