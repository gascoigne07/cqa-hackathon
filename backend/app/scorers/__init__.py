"""Provider registry — drives the provider toggle in the UI (GET /api/providers)."""

from __future__ import annotations

from .. import config
from .base import ProviderError, ProviderUnavailable, Scorer
from .llm import ClaudeScorer, GeminiScorer, GroqScorer, OpenAIScorer, QwenScorer
from .mock import MockScorer

PROVIDERS: dict[str, Scorer] = {
    s.id: s for s in (ClaudeScorer(), GeminiScorer(), QwenScorer(), OpenAIScorer(), GroqScorer(), MockScorer())
}


def get_provider(provider_id: str | None) -> Scorer:
    pid = provider_id or config.DEFAULT_PROVIDER
    scorer = PROVIDERS.get(pid)
    if scorer is None:
        raise ProviderUnavailable(f"Неизвестный провайдер «{pid}». Доступные: {', '.join(PROVIDERS)}")
    return scorer


__all__ = ["PROVIDERS", "ProviderError", "ProviderUnavailable", "Scorer", "get_provider"]
