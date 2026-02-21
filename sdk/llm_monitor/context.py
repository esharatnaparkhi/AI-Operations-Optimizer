"""Thread/async-safe context variable for feature tagging."""
from contextvars import ContextVar
from contextlib import contextmanager
from typing import Optional

_current_feature_tag: ContextVar[Optional[str]] = ContextVar(
    "llm_monitor_feature_tag", default=None
)


@contextmanager
def feature_tag(name: str):
    """
    Context manager to tag all LLM calls within a block.

    Usage::

        with feature_tag("summarize"):
            response = client.chat.completions.create(...)
    """
    token = _current_feature_tag.set(name)
    try:
        yield
    finally:
        _current_feature_tag.reset(token)


def get_current_feature_tag() -> Optional[str]:
    return _current_feature_tag.get()
