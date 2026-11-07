import json
import time

from fastapi.testclient import TestClient

from app.main import app


def wait_job(client, job_id, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/score/batch/{job_id}").json()
        if job["status"] != "running":
            return job
        time.sleep(0.1)
    raise AssertionError("batch did not finish")


def test_contract_flow():
    with TestClient(app) as client:
        # GET /api/dialogs -> [{conversation_id, channel, language, turns, preview}]
        dialogs = client.get("/api/dialogs").json()
        first = dialogs[0]
        assert {"conversation_id", "channel", "language", "turns", "preview"} <= first.keys()
        did = first["conversation_id"]

        # GET /api/dialogs/{id} -> transcript with idx
        d = client.get(f"/api/dialogs/{did}").json()
        assert d["transcript"][0]["idx"] == 0 and {"timestamp", "speaker", "text"} <= d["transcript"][0].keys()

        # checklists: official chat + call checklists are built in
        lst = client.get("/api/checklists").json()
        by_channel = {c["channel"]: c["id"] for c in lst}
        assert {"chat", "call"} <= by_channel.keys()
        cl = client.get(f"/api/checklists/{by_channel['chat']}").json()
        assert {"id", "name", "rounding", "criteria"} <= cl.keys()
        assert cl["rounding"] == 2 and [c["weight"] for c in cl["criteria"]] == [10, 15, 20, 20, 15, 15, 5, 0]
        assert cl["criteria"][-1]["gross_error_if"] == "yes"
        c0 = cl["criteria"][0]
        assert {"id", "order", "section", "name", "type", "weight", "na_allowed", "scale_max", "scale", "guidance"} <= c0.keys()

        # providers: gemini/qwen listed, mock available
        prov = {p["id"]: p for p in client.get("/api/providers").json()}
        assert {"gemini", "qwen", "mock"} <= prov.keys() and prov["mock"]["available"]
        bad = client.post("/api/score", json={"dialog_id": did, "checklist_id": cl["id"], "provider": "gemini"})
        assert bad.status_code == 503

        # POST /api/score -> live result
        s1 = client.post("/api/score", json={"dialog_id": did, "checklist_id": cl["id"], "provider": "mock"}).json()
        assert {"dialog_id", "provider", "total", "gross_error", "sections", "results"} <= s1.keys()
        r0 = s1["results"][0]
        assert {"criterion_id", "applicable", "na_reason", "verdict", "raw_score", "scale_max", "points",
                "effective_weight", "explanation", "evidence"} <= r0.keys()
        assert {"name", "points", "max"} <= s1["sections"][0].keys()
        if r0["evidence"]:
            assert {"turn_idx", "timestamp", "quote"} <= r0["evidence"].keys()
        # live: a second click is a new score, nothing reused
        s2 = client.post("/api/score", json={"dialog_id": did, "checklist_id": cl["id"], "provider": "mock"}).json()
        assert s2["score_id"] != s1["score_id"]
        assert client.get(f"/api/dialogs/{did}/score").json()["score_id"] == s2["score_id"]
        # without checklist_id the checklist follows the dialog's channel
        auto = client.post("/api/score", json={"dialog_id": did, "provider": "mock"}).json()
        assert auto["checklist_id"] == by_channel["chat"]
        call_id = next((x["conversation_id"] for x in dialogs if x["channel"] == "voice call"), None)
        if call_id:
            call = client.post("/api/score", json={"dialog_id": call_id, "provider": "mock"}).json()
            assert call["checklist_id"] == by_channel["call"]
        s2 = auto

        # appeal -> review(change) -> recalculated, original kept
        target = next(r for r in s2["results"] if r["type"] != "scale" and r["weight"] > 0 and r["verdict"] in ("yes", "no"))
        appeal = client.post("/api/appeals", json={"dialog_id": did, "criterion_id": target["criterion_id"], "comment": "Не согласен"}).json()
        assert "appeal_id" in appeal
        dup = client.post("/api/appeals", json={"dialog_id": did, "criterion_id": target["criterion_id"], "comment": "ещё"})
        assert dup.status_code == 400
        open_list = client.get("/api/appeals?status=open").json()
        assert open_list[0]["appeal_id"] == appeal["appeal_id"]
        detail = client.get(f"/api/appeals/{appeal['appeal_id']}").json()
        assert detail["fragment"] and detail["result"]["criterion_id"] == target["criterion_id"]

        flipped = "no" if target["verdict"] == "yes" else "yes"
        res = client.post("/api/reviews", json={"appeal_id": appeal["appeal_id"], "decision": "change",
                                                "new_verdict": flipped, "reason": "Доказательство не подтверждает вывод"}).json()["result"]
        changed = next(r for r in res["results"] if r["criterion_id"] == target["criterion_id"])
        assert changed["verdict"] == flipped and changed["overridden"]
        assert changed["original"]["verdict"] == target["verdict"]
        assert changed["appeal"]["review"]["decision"] == "change"
        assert res["original_total"] == s2["total"]
        assert changed["appeal"]["review"]["total_after"] == res["total"]

        # checklist swap: new checklist id; batch with reuse re-judges only the changed criterion
        body = {k: cl[k] for k in ("name", "rounding", "criteria", "channel", "instructions", "gross_error_policy", "note")}
        body["criteria"] = [c for c in body["criteria"] if c["id"] != "closing"] + [{
            "id": "next_steps", "order": 99, "section": "Завершение", "name": "Озвучены следующие шаги",
            "type": "yes_no", "weight": 5, "na_allowed": False, "guidance": "Оператор объяснил, что делать дальше"}]
        cl2 = client.post("/api/checklists", json=body).json()
        assert cl2["id"] != cl["id"] and cl2["criteria"][-1]["order"] == 8
        job = client.post("/api/score/batch", json={"checklist_id": cl2["id"], "provider": "mock", "reuse_unchanged": True}).json()
        done = wait_job(client, job["job_id"])
        assert done["status"] == "done" and done["done"] == len(dialogs) and not done["errors"]
        assert done["judged"] >= len(dialogs)  # at least the new criterion everywhere
        with client.stream("GET", f"/api/score/batch/{job['job_id']}/events") as resp:
            assert "event: done" in "".join(resp.iter_text())
        listed = {x["conversation_id"]: x for x in client.get("/api/dialogs").json()}
        assert listed[did]["last_score"]["checklist_id"] == cl2["id"]


def test_upload_and_validation():
    with TestClient(app) as client:
        record = {"conversation_id": "u-1", "channel": "agent chat", "language": "EN",
                  "transcript": [{"timestamp": "00:01", "speaker": "operator", "text": "Hello, I'm Sam. Goodbye!"}],
                  "audio_url": None}
        r = client.post("/api/dialogs/upload", files={"file": ("d.json", json.dumps(record), "application/json")})
        assert r.status_code == 200 and r.json()["imported"] == 1
        bad = client.post("/api/dialogs/upload", files={"file": ("d.json", "{\"foo\": 1}", "application/json")})
        assert bad.status_code == 400
        bad_cl = client.post("/api/checklists", json={"criteria": [{"id": "a", "name": "a", "weight": 1, "type": "scale"}]})
        assert bad_cl.status_code == 422
        none = client.post("/api/appeals", json={"dialog_id": "u-1", "criterion_id": "contact", "comment": "x"})
        assert none.status_code == 400  # not scored yet


def test_branding_logo_slot(tmp_path, monkeypatch):
    from app import config

    monkeypatch.setattr(config, "BRANDING_DIR", tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/branding").json() == {"logo_url": None}
        assert client.get("/api/branding/logo").status_code == 404

        (tmp_path / "logo.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>', encoding="utf-8")
        url = client.get("/api/branding").json()["logo_url"]
        assert url.startswith("/api/branding/logo?v=")
        r = client.get(url)
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg")
