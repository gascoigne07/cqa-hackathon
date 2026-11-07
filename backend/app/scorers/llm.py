"""LLM providers.

* OpenAI-compatible chat APIs (OpenAI, Groq, a local Qwen3 via Ollama/vLLM)
  share one implementation: `OpenAICompatScorer`. Configure them in
  backend/.env — no code needed.
* Gemini is the ML team's slot: implement `GeminiScorer._complete`.

`_complete(system, user, schema)` returns the raw JSON text (or `(text, usage)`).
Prompt building and parsing live in `prompt.py`; `judge` records a trace of
every call (prompt, raw answer, model, duration, tokens) as proof of live
analysis.

Report each model's name and the cost of one evaluation in the README
(the organizers' FAQ asks for it).
"""

from __future__ import annotations

import asyncio
import os
import statistics
import time

import httpx

from ..schemas import Criterion, Dialog, Judgment
from .base import ProviderError, ProviderUnavailable, Scorer
from .prompt import build_messages, parse_response, response_json_schema


def _out_of_quota(resp: httpx.Response) -> bool:
    """429 because the account has no credits/quota — retrying will not help."""
    if resp.status_code != 429:
        return False
    try:
        err = resp.json().get("error") or {}
    except ValueError:
        return False
    text = f"{err.get('code', '')} {err.get('type', '')} {err.get('message', '')}".lower()
    return any(k in text for k in ("insufficient_quota", "no credits", "billing", "quota exceeded"))


class LLMScorer(Scorer):
    env_flag = ""  # e.g. CQA_GEMINI_API_KEY — must be set for the provider to be available
    implemented = False  # flip to True once _complete is written

    def model_name(self) -> str:
        return ""

    def available(self) -> tuple[bool, str]:
        if not self.implemented:
            return False, "Подключит ML-команда: реализовать _complete() в backend/app/scorers/llm.py"
        if self.env_flag and not os.environ.get(self.env_flag):
            return False, f"Не задан {self.env_flag} в backend/.env"
        return True, ""

    async def _complete(self, system: str, user: str, schema: dict) -> str | tuple[str, dict]:
        raise NotImplementedError

    async def judge(self, dialog: Dialog, criteria: list[Criterion], instructions: str = "",
                    trace: list[dict] | None = None) -> list[Judgment]:
        ok, note = self.available()
        if not ok:
            raise ProviderUnavailable(f"{self.name}: {note}")
        system, user = build_messages(dialog, criteria, instructions)
        started = time.perf_counter()
        result = await self._complete(system, user, response_json_schema(criteria))
        text, usage = result if isinstance(result, tuple) else (result, {})
        if trace is not None:
            trace.append({
                "provider": self.id, "model": self.model_name(), "criteria": [c.id for c in criteria],
                "system": system, "user": user, "raw": text,
                "duration_ms": int((time.perf_counter() - started) * 1000), "usage": usage or {},
            })
        return parse_response(text, criteria)


class OpenAICompatScorer(LLMScorer):
    """Any OpenAI-compatible /chat/completions endpoint, temperature 0, JSON mode."""

    implemented = True
    key_env = ""
    base_url_env = ""
    model_env = ""
    default_base_url = ""
    default_model = ""
    key_required = True
    transport: httpx.AsyncBaseTransport | None = None  # tests inject a fake server here

    def base_url(self) -> str:
        return (os.environ.get(self.base_url_env) or self.default_base_url).rstrip("/")

    def model_name(self) -> str:
        return os.environ.get(self.model_env) or self.default_model

    def available(self) -> tuple[bool, str]:
        if self.key_required and not os.environ.get(self.key_env):
            return False, f"Не задан {self.key_env} в backend/.env"
        if not self.base_url():
            return False, f"Не задан {self.base_url_env} в backend/.env"
        if not self.model_name():
            return False, f"Не задан {self.model_env} в backend/.env"
        return True, ""

    async def _complete(self, system: str, user: str, schema: dict) -> tuple[str, dict]:
        key = os.environ.get(self.key_env, "")
        body = {
            "model": self.model_name(),
            "temperature": 0,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "response_format": {"type": "json_object"},
        }
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        url = f"{self.base_url()}/chat/completions"
        delay = 2.0
        async with httpx.AsyncClient(timeout=180, transport=self.transport) as client:
            for attempt in range(4):
                try:
                    resp = await client.post(url, json=body, headers=headers)
                except httpx.HTTPError as exc:
                    if attempt == 3:
                        raise ProviderError(f"{self.name}: нет связи с {self.base_url()} ({exc.__class__.__name__})") from exc
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                if resp.status_code in (429, 500, 502, 503, 504) and attempt < 3 and not _out_of_quota(resp):
                    retry_after = resp.headers.get("retry-after")
                    await asyncio.sleep(float(retry_after) if retry_after and retry_after.replace(".", "").isdigit() else delay)
                    delay *= 2
                    continue
                break
        if resp.status_code != 200:
            try:
                detail = resp.json().get("error", {}).get("message") or resp.text[:300]
            except ValueError:
                detail = resp.text[:300]
            raise ProviderError(f"{self.name}: HTTP {resp.status_code} — {detail}")
        data = resp.json()
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError(f"{self.name}: неожиданный ответ API") from exc
        return text, data.get("usage") or {}


class GeminiScorer(LLMScorer):
    """Cloud: Google Gemini — the ML team's slot.

    Implement `_complete` with the Gemini API (generateContent with
    responseMimeType="application/json" and responseSchema=schema,
    temperature=0), reading the key from CQA_GEMINI_API_KEY and the model
    from CQA_GEMINI_MODEL. Return the JSON text (optionally `(text, usage)`).
    Then set `implemented = True`.
    """

    id = "gemini"
    name = "Облако · Gemini"
    kind = "cloud"
    optional = True  # empty slot — Claude is the implemented cloud provider; hide unless wired
    env_flag = "CQA_GEMINI_API_KEY"

    def model_name(self) -> str:
        return os.environ.get("CQA_GEMINI_MODEL") or "gemini"


class QwenScorer(OpenAICompatScorer):
    """Local: Qwen3 through an OpenAI-compatible server (Ollama: http://localhost:11434/v1)."""

    id = "qwen"
    name = "Локально · Qwen3"
    kind = "local"
    key_env = "CQA_QWEN_API_KEY"
    base_url_env = "CQA_QWEN_BASE_URL"
    model_env = "CQA_QWEN_MODEL"
    default_model = "qwen3:8b"
    key_required = False


class OpenAIScorer(OpenAICompatScorer):
    """Cloud: OpenAI — handy for testing."""

    id = "openai"
    name = "Облако · OpenAI"
    kind = "cloud"
    optional = True
    key_env = "CQA_OPENAI_API_KEY"
    base_url_env = "CQA_OPENAI_BASE_URL"
    model_env = "CQA_OPENAI_MODEL"
    default_base_url = "https://api.openai.com/v1"
    default_model = "gpt-4.1-mini"


class GroqScorer(OpenAICompatScorer):
    """Cloud: Groq (fast hosted open models, incl. Qwen3) — handy for testing."""

    id = "groq"
    name = "Облако · Groq"
    kind = "cloud"
    optional = True
    key_env = "CQA_GROQ_API_KEY"
    base_url_env = "CQA_GROQ_BASE_URL"
    model_env = "CQA_GROQ_MODEL"
    default_base_url = "https://api.groq.com/openai/v1"
    default_model = "qwen/qwen3-32b"


def _vote(criteria: list[Criterion], runs: list[list[Judgment]]) -> list[Judgment]:
    """Self-consistency: over N runs take the majority status/answer and the
    median scale value (snapped to a valid step). `confidence` = agreement ratio.
    Removes the run-to-run variance a single sampled call has."""
    bucket: dict[str, list[Judgment]] = {c.id: [] for c in criteria}
    for run in runs:
        for j in run:
            if j.criterion_id in bucket:
                bucket[j.criterion_id].append(j)
    out: list[Judgment] = []
    for c in criteria:
        js = bucket[c.id]
        if not js:
            out.append(Judgment(criterion_id=c.id, status="uncertain", explanation="Модель не вернула оценку"))
            continue
        statuses = [j.status for j in js]
        win = max(set(statuses), key=statuses.count)
        agree = statuses.count(win) / len(statuses)
        picks = [j for j in js if j.status == win]
        if win == "answered" and c.is_binary:
            answers = [j.answer for j in picks if j.answer is not None]
            if answers:
                a = max(set(answers), key=answers.count)
                rep = next((j for j in picks if j.answer is a), picks[0])
                out.append(rep.model_copy(update={"confidence": round(agree * answers.count(a) / len(answers), 2)}))
                continue
        elif win == "answered" and not c.is_binary:
            vals = [j.value for j in picks if j.value is not None]
            if vals:
                med = statistics.median(vals)
                step = min((s.value for s in c.scale), key=lambda v: abs(v - med)) if c.scale else med
                rep = min((j for j in picks if j.value is not None), key=lambda j: abs(j.value - step))
                out.append(rep.model_copy(update={"value": step, "confidence": round(agree, 2)}))
                continue
        out.append(picks[0].model_copy(update={"confidence": round(agree, 2)}))
    return out


class ClaudeScorer(LLMScorer):
    """Cloud: Anthropic Claude with self-consistency voting.

    A single Claude call is not deterministic (temperature is fixed on the
    5-series), so one sample's total can swing 15–30 points. We vote over
    `samples` concurrent calls → stable (±0–6) and matches a human gold set at
    MAE ~7.5 on 35 dialogs. The N calls are recorded in the trace (proof of
    live analysis also shows the voting).
    """

    id = "claude"
    name = "Облако · Claude"
    kind = "cloud"
    env_flag = "CQA_ANTHROPIC_API_KEY"
    implemented = True
    samples = int(os.environ.get("CQA_CLAUDE_SAMPLES", "5"))
    transport: httpx.AsyncBaseTransport | None = None  # tests inject a fake server here

    def model_name(self) -> str:
        return os.environ.get("CQA_ANTHROPIC_MODEL") or "claude-sonnet-5"

    async def _complete(self, system: str, user: str, schema: dict) -> tuple[str, dict]:
        key = os.environ.get("CQA_ANTHROPIC_API_KEY", "")
        body = {
            "model": self.model_name(),
            "max_tokens": 4096,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }  # temperature is deprecated on Claude 5 — omit it
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
        url = "https://api.anthropic.com/v1/messages"
        delay = 2.0
        async with httpx.AsyncClient(timeout=180, transport=self.transport) as client:
            for attempt in range(4):
                try:
                    resp = await client.post(url, json=body, headers=headers)
                except httpx.HTTPError as exc:
                    if attempt == 3:
                        raise ProviderError(f"{self.name}: нет связи с Anthropic ({exc.__class__.__name__})") from exc
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                if resp.status_code in (429, 500, 502, 503, 529) and attempt < 3 and not _out_of_quota(resp):
                    retry_after = resp.headers.get("retry-after")
                    await asyncio.sleep(float(retry_after) if retry_after and retry_after.replace(".", "").isdigit() else delay)
                    delay *= 2
                    continue
                break
        if resp.status_code != 200:
            try:
                detail = resp.json().get("error", {}).get("message") or resp.text[:300]
            except ValueError:
                detail = resp.text[:300]
            raise ProviderError(f"{self.name}: HTTP {resp.status_code} — {detail}")
        data = resp.json()
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        u = data.get("usage") or {}
        return text, {"prompt_tokens": u.get("input_tokens"), "completion_tokens": u.get("output_tokens")}

    async def judge(self, dialog: Dialog, criteria: list[Criterion], instructions: str = "",
                    trace: list[dict] | None = None) -> list[Judgment]:
        ok, note = self.available()
        if not ok:
            raise ProviderUnavailable(f"{self.name}: {note}")
        system, user = build_messages(dialog, criteria, instructions)
        schema = response_json_schema(criteria)

        async def one() -> list[Judgment]:
            started = time.perf_counter()
            text, usage = await self._complete(system, user, schema)
            if trace is not None:
                trace.append({
                    "provider": self.id, "model": self.model_name(), "criteria": [c.id for c in criteria],
                    "system": system, "user": user, "raw": text,
                    "duration_ms": int((time.perf_counter() - started) * 1000), "usage": usage or {},
                })
            return parse_response(text, criteria)

        results = await asyncio.gather(*(one() for _ in range(self.samples)), return_exceptions=True)
        runs = [r for r in results if isinstance(r, list)]
        if not runs:
            err = next((r for r in results if isinstance(r, Exception)), None)
            raise ProviderError(f"{self.name}: все {self.samples} прогонов не удались ({err})")
        return _vote(criteria, runs)
