"""
llm-monitor-sdk
~~~~~~~~~~~~~~~
One-line instrumentation for LLM calls.

Usage::

    import openai
    from llm_monitor import LLMMonitor

    monitor = LLMMonitor(api_key="proj_...")
    client = monitor.wrap_openai(openai.OpenAI())

    # All calls tracked automatically
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "Hello"}],
    )
"""

from .monitor import LLMMonitor
from .context import feature_tag
from .models import LLMEvent

__all__ = ["LLMMonitor", "feature_tag", "LLMEvent"]
__version__ = "0.1.0"
