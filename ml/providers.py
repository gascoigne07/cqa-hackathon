"""Model providers — OpenAI-compatible abstraction. Default: Gemini (free).
Local Qwen3 (Ollama/vLLM) plugs in here later as another provider (same signature).
Uses stdlib urllib so the scoring pipeline runs with zero pip installs.
"""
import json
import os
import time
import urllib.error
import urllib.request

_GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def _load_key(name="GEMINI_API_KEY"):
    key = os.environ.get(name)
    if key:
        return key
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith(name + "="):
                    return line.split("=", 1)[1]
    raise RuntimeError(f"{name} not set (env or .env)")


def gemini_generate(prompt, model="gemini-2.5-flash", temperature=0.0, json_mode=True,
                    timeout=90, retries=5):
    """Return the model's text output. Retries transient 429/5xx with backoff
    (the free tier throws 503 under load — must not kill a run)."""
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature},
    }
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"
    data_bytes = json.dumps(body).encode("utf-8")
    url = _GEMINI_URL.format(model=model, key=_load_key())
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data_bytes,
                                     headers={"Content-Type": "application/json"},
                                     method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            cand = data["candidates"][0]
            return "".join(p.get("text", "") for p in cand["content"]["parts"])
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 529) and attempt < retries - 1:
                time.sleep(2 ** attempt + 1)
                continue
            raise RuntimeError(f"Gemini HTTP {e.code}: {e.read().decode('utf-8')[:300]}")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt + 1)
                continue
            raise RuntimeError(f"Gemini request failed: {e}")


def claude_generate(prompt, model="claude-sonnet-5", temperature=0.0, json_mode=True,
                    timeout=120, retries=5, max_tokens=4096):
    """Anthropic Messages API. Claude returns clean JSON from the prompt instruction
    (no response-schema needed). Retries transient 429/5xx/529 with backoff."""
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }  # temperature is deprecated on Claude 5 models — omit it
    data_bytes = json.dumps(body).encode("utf-8")
    key = _load_key("ANTHROPIC_API_KEY")
    for attempt in range(retries):
        req = urllib.request.Request(_ANTHROPIC_URL, data=data_bytes, headers={
            "x-api-key": key, "anthropic-version": "2023-06-01",
            "content-type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 529) and attempt < retries - 1:
                time.sleep(2 ** attempt + 1)
                continue
            raise RuntimeError(f"Anthropic HTTP {e.code}: {e.read().decode('utf-8')[:300]}")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt + 1)
                continue
            raise RuntimeError(f"Anthropic request failed: {e}")


# Registry so the backend can switch provider by name (cloud/local toggle).
PROVIDERS = {
    "gemini-2.5-flash": lambda p, **kw: gemini_generate(p, model="gemini-2.5-flash", **kw),
    "gemini-2.5-pro": lambda p, **kw: gemini_generate(p, model="gemini-2.5-pro", **kw),
    "claude-sonnet-5": lambda p, **kw: claude_generate(p, model="claude-sonnet-5", **kw),
    "claude-sonnet-5-5": lambda p, **kw: claude_generate(p, model="claude-sonnet-5-5", **kw),
    "claude-opus-4-8": lambda p, **kw: claude_generate(p, model="claude-opus-4-8", **kw),
    "claude-haiku-5-5": lambda p, **kw: claude_generate(p, model="claude-haiku-5-5", **kw),
    # "qwen3-local": lambda p, **kw: ollama_generate(p, model="qwen3", **kw),  # TODO
}


def generate(prompt, provider="gemini-2.5-flash", **kw):
    if provider not in PROVIDERS:
        raise ValueError(f"unknown provider: {provider}")
    return PROVIDERS[provider](prompt, **kw)
