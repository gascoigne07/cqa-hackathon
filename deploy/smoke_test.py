"""End-to-end check of a running CQA instance (local container or the public URL).

    python deploy/smoke_test.py http://localhost:8000
    python deploy/smoke_test.py https://<your-app>.up.railway.app

Walks the demo path on the mock provider: dialog list → «Оценить» → appeal →
review (recalculation) → checklist edit → scoring with the edited checklist,
plus frontend, call audio and export. Standard library only.

Side effects: one resolved appeal and one extra checklist version with channel
"all" (it never replaces the chat/call checklists the app picks automatically).
On free hosting a restart wipes them anyway.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
failures: list[str] = []


def call(method: str, path: str, body: dict | None = None, raw: bool = False, timeout: int = 120):  # noqa: ANN201
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = resp.read()
        return (resp.status, resp.headers.get("content-type", ""), payload) if raw else json.loads(payload)


def check(name: str, fn) -> object:  # noqa: ANN001
    try:
        value, note = fn()
        print(f"  PASS  {name}: {note}")
        return value
    except Exception as exc:  # noqa: BLE001
        msg = exc.read().decode()[:200] if isinstance(exc, urllib.error.HTTPError) else str(exc)[:200]
        print(f"  FAIL  {name}: {type(exc).__name__}: {msg}")
        failures.append(name)
        return None


def main() -> int:
    print(f"CQA smoke test → {BASE}")

    health = check("health", lambda: (h := call("GET", "/api/health"), f"{h['dialogs']} dialogs, default provider {h['default_provider']}"))
    if not health:
        return 1

    def frontend():
        status, ctype, html = call("GET", "/", raw=True)
        assert status == 200 and b'id="root"' in html, "index.html without #root"
        js = html.split(b'src="', 1)[1].split(b'"', 1)[0].decode()
        assert call("GET", "/" + js.lstrip("/"), raw=True)[0] == 200
        return None, f"index.html + {js}"

    check("frontend served", frontend)

    def dialog_list():
        d = call("GET", "/api/dialogs")
        assert d, "empty list — set CQA_API_URL or use «Импорт из API»"
        return d, f"{len(d)} dialogs"

    dialogs = check("dialog list", dialog_list)
    if not dialogs:
        return 1
    chat = next(d for d in dialogs if not d["channel"].lower().startswith("voice"))
    call_dialog = next((d for d in dialogs if d["channel"].lower().startswith("voice")), None)

    check("providers", lambda: (p := call("GET", "/api/providers"), ", ".join(f"{x['id']}{'' if x['available'] else '(off)'}" for x in p)))

    score = check("«Оценить» (mock)", lambda: (s := call("POST", "/api/score", {"dialog_id": chat["conversation_id"], "provider": "mock"}),
                                                f"{chat['conversation_id']}: total {s['total']}, {len(s['results'])} criteria, score #{s['score_id']}"))
    if not score:
        return 1

    target = next(r for r in score["results"] if r["type"] in ("yes_no", "yes_no_na") and r["verdict"] in ("yes", "no") and r["weight"] > 0)
    flipped = "no" if target["verdict"] == "yes" else "yes"

    appeal = check("appeal", lambda: (a := call("POST", "/api/appeals", {"dialog_id": chat["conversation_id"], "criterion_id": target["criterion_id"],
                                                                     "comment": "smoke test: проверка апелляции", "score_id": score["score_id"]}),
                                     f"appeal #{a['appeal_id']} on «{target['name']}»"))
    if appeal:
        def review():
            res = call("POST", "/api/reviews", {"appeal_id": appeal["appeal_id"], "decision": "change", "new_verdict": flipped,
                                                "reason": "smoke test: пересмотр"})["result"]
            assert res["total"] != score["total"], "total did not change after the review"
            return res, f"verdict {target['verdict']}→{flipped}, total {res['original_total']} → {res['total']}"

        check("review + recalculation", review)

    def checklist_edit():
        lists = call("GET", "/api/checklists")
        base = call("GET", f"/api/checklists/{next(c for c in lists if c.get('channel') == 'chat')['id']}")
        body = json.loads(json.dumps({k: base[k] for k in ("name", "rounding", "criteria", "channel", "instructions", "gross_error_policy", "note") if k in base}))
        body["name"] = "smoke test — копия чек-листа"
        body["channel"] = "all"
        body["criteria"][0]["weight"] = base["criteria"][0]["weight"] + 5
        saved = call("POST", "/api/checklists", body)
        res = call("POST", "/api/score", {"dialog_id": chat["conversation_id"], "checklist_id": saved["id"], "provider": "mock"})
        assert res["checklist_id"] == saved["id"]
        return saved, f"saved checklist #{saved['id']} (weight {base['criteria'][0]['weight']}→{body['criteria'][0]['weight']}), rescored total {res['total']}"

    check("checklist edit → rescore", checklist_edit)

    if call_dialog:
        def audio():
            status, ctype, data = call("GET", f"/api/dialogs/{call_dialog['conversation_id']}/audio", raw=True, timeout=180)
            assert status == 200 and len(data) > 10_000, "no audio"
            return None, f"{call_dialog['conversation_id']}: {ctype}, {len(data) // 1024} KB"

        check("call recording", audio)

    check("export CSV", lambda: (r := call("GET", "/api/export?format=csv", raw=True), f"{r[1].split(';')[0]}, {len(r[2])} bytes"))

    print("RESULT:", "all checks passed" if not failures else f"{len(failures)} failed: {', '.join(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
