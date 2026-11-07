"""OpenAI-compatible providers against a fake server, trace (proof of live analysis) and export."""

import csv
import io
import json
import re

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.scorers import PROVIDERS

SEEN: list[dict] = []


def fake_openai(status_sequence=(200,)):
    statuses = list(status_sequence)

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        SEEN.append({"headers": dict(request.headers), "body": body})
        status = statuses.pop(0) if statuses else 200
        if status != 200:
            return httpx.Response(status, headers={"retry-after": "0"}, json={"error": {"message": "rate limited"}})
        user = body["messages"][1]["content"]
        ids = re.findall(r'- id: "([^"]+)"', user)
        first_op = int(re.search(r"\[(\d+)\] \([^)]*\) operator: (.{0,30})", user).group(1))
        quote = re.search(rf"\[{first_op}\] \([^)]*\) operator: (.{{0,25}})", user).group(1)
        judgments = []
        for cid in ids:
            block = user.split(f'- id: "{cid}"', 1)[1].split("- id:", 1)[0]
            j = {"criterion_id": cid, "status": "answered", "evidence": [{"turn_idx": first_op, "quote": quote}],
                 "explanation": "ok", "confidence": 0.9}
            if "ONE of these step values" in block:
                j["value"] = max(float(v) for v in re.findall(r"^\s{4}(\d+(?:\.\d+)?) —", block, re.M))
            else:
                j["answer"] = cid != "gross_errors"
            judgments.append(j)
        content = "<think>reasoning…</think>" + json.dumps({"judgments": judgments}, ensure_ascii=False)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}],
                                         "usage": {"prompt_tokens": 1200, "completion_tokens": 300}})

    return httpx.MockTransport(handler)


@pytest.fixture
def openai_provider(monkeypatch):
    monkeypatch.setenv("CQA_OPENAI_API_KEY", "sk-test")
    p = PROVIDERS["openai"]
    yield p
    p.transport = None
    SEEN.clear()


def test_openai_compatible_provider_and_trace(openai_provider):
    openai_provider.transport = fake_openai()
    with TestClient(app) as client:
        prov = {p["id"]: p for p in client.get("/api/providers").json()}
        assert prov["openai"]["available"] and prov["openai"]["optional"] and prov["openai"]["model"] == "gpt-4.1-mini"
        assert prov["groq"]["optional"] and not prov["groq"]["available"]

        did = client.get("/api/dialogs").json()[0]["conversation_id"]
        s = client.post("/api/score", json={"dialog_id": did, "provider": "openai"}).json()
        assert s["provider"] == "openai" and s["total"] == 100 and not s["gross_error"]
        assert all(r["evidence"] for r in s["results"]) and not s["needs_review"]
        run = s["run"]
        assert run["model"] == "gpt-4.1-mini" and run["calls"] == 1 and run["prompt_tokens"] == 1200 and run["duration_ms"] >= 0

        req = SEEN[0]
        assert req["headers"]["authorization"] == "Bearer sk-test"
        assert req["body"]["temperature"] == 0 and req["body"]["response_format"] == {"type": "json_object"}
        assert "GENERAL RULES OF THIS CHECKLIST" in req["body"]["messages"][1]["content"]

        trace = client.get(f"/api/scores/{s['score_id']}/trace").json()
        assert len(trace) == 1 and trace[0]["raw"].startswith("<think>") and "TRANSCRIPT" in trace[0]["user"]


def test_provider_retries_then_reports_errors(openai_provider):
    openai_provider.transport = fake_openai((429, 200))
    with TestClient(app) as client:
        did = client.get("/api/dialogs").json()[0]["conversation_id"]
        ok = client.post("/api/score", json={"dialog_id": did, "provider": "openai"})
        assert ok.status_code == 200 and len(SEEN) == 2  # retried once after 429

        openai_provider.transport = fake_openai((401,))
        bad = client.post("/api/score", json={"dialog_id": did, "provider": "openai"})
        assert bad.status_code == 502 and "HTTP 401" in bad.json()["detail"]


def test_mock_trace_and_export():
    with TestClient(app) as client:
        dialogs = client.get("/api/dialogs").json()
        ids = [d["conversation_id"] for d in dialogs[:3]]
        for did in ids:
            s = client.post("/api/score", json={"dialog_id": did, "provider": "mock"}).json()
        trace = client.get(f"/api/scores/{s['score_id']}/trace").json()
        assert trace[0]["note"] and s["run"]["model"] == "keywords-v1"

        res = client.get("/api/export", params={"format": "csv", "ids": ",".join(ids)})
        assert res.status_code == 200 and "attachment" in res.headers["content-disposition"]
        rows = list(csv.DictReader(io.StringIO(res.text.lstrip("﻿"))))
        assert [r["conversation_id"] for r in rows] == ids
        assert "contact.verdict" in rows[0] and "consultation.points" in rows[0] and rows[0]["total"]

        data = client.get("/api/export", params={"format": "json"}).json()
        assert len(data) == len(dialogs) and data[0]["score"]["results"]


def test_out_of_credits_fails_fast(openai_provider):
    def handler(request):
        SEEN.append({})
        return httpx.Response(429, json={"error": {"code": "insufficient_quota", "message": "You have no credits remaining."}})

    openai_provider.transport = httpx.MockTransport(handler)
    with TestClient(app) as client:
        did = client.get("/api/dialogs").json()[0]["conversation_id"]
        bad = client.post("/api/score", json={"dialog_id": did, "provider": "openai"})
        assert bad.status_code == 502 and "no credits" in bad.json()["detail"] and len(SEEN) == 1  # no retries
