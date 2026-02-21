"""
Provider pricing table (USD per 1M tokens).
Update as providers change their rates.
"""
from __future__ import annotations
from typing import Tuple

# Format: { "provider/model": (input_per_1m, output_per_1m) }
PRICING: dict[str, Tuple[float, float]] = {
    # OpenAI
    "openai/gpt-4o":                    (2.50,  10.00),
    "openai/gpt-4o-mini":               (0.15,   0.60),
    "openai/gpt-4-turbo":               (10.00,  30.00),
    "openai/gpt-4":                     (30.00,  60.00),
    "openai/gpt-3.5-turbo":             (0.50,   1.50),
    "openai/o1":                        (15.00,  60.00),
    "openai/o1-mini":                   (3.00,   12.00),
    # Anthropic
    "anthropic/claude-3-5-sonnet":      (3.00,   15.00),
    "anthropic/claude-3-5-haiku":       (0.80,   4.00),
    "anthropic/claude-3-opus":          (15.00,  75.00),
    "anthropic/claude-3-sonnet":        (3.00,   15.00),
    "anthropic/claude-3-haiku":         (0.25,   1.25),
    # Google
    "google/gemini-1.5-pro":            (3.50,   10.50),
    "google/gemini-1.5-flash":          (0.075,   0.30),
    # Cohere
    "cohere/command-r-plus":            (3.00,   15.00),
    "cohere/command-r":                 (0.50,   1.50),
    # Mistral
    "mistral/mistral-large":            (4.00,   12.00),
    "mistral/mistral-small":            (1.00,   3.00),
}

# Fallback per-token cost when model is unknown
_FALLBACK_INPUT  = 1.00   # $1 / 1M
_FALLBACK_OUTPUT = 3.00


def estimate_cost(
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> float:
    """Return estimated USD cost for a single call."""
    key = f"{provider}/{model}"
    # Try exact match, then partial match on model name
    rate = PRICING.get(key)
    if rate is None:
        for k, v in PRICING.items():
            if k.endswith(f"/{model}"):
                rate = v
                break
    if rate is None:
        rate = (_FALLBACK_INPUT, _FALLBACK_OUTPUT)

    input_cost  = (input_tokens  / 1_000_000) * rate[0]
    output_cost = (output_tokens / 1_000_000) * rate[1]
    return round(input_cost + output_cost, 8)
