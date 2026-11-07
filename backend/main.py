"""CQA backend API (FastAPI).

Endpoints the frontend talks to. Pulls dialogs from the organizer API (proxy =
CORS fix + cache), scores via the LLM judge + deterministic math, and stores the
appeal/review loop in SQLite. No auth (demo). Run:
  uvicorn main:app --app-dir backend --port 8000
"""
import json
import os
import sqlite3

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import judge
import organizer
import scoring

BK = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BK, "data")
DB = os.path.join(DATA, "cqa.sqlite3")
os.makedirs(DATA, exist_ok=True)

# ---- checklists (config-driven; editable at runtime, incl. the H23 swap) -----
CHECKLISTS = {}


def load_checklists():
    cdir = os.path.join(BK, "checklists")
    for fn in os.listdir(cdir):
        if fn.endswith(".json"):
            c = json.load(open(os.path.join(cdir, fn), encoding="utf-8"))
            CHECKLISTS[c["id"]] = c


load_checklists()

# ---- dialog cache (per group_id); live API, fallback to the cached raw pull ---
_CACHE = {}


def get_dialogs(group_id="DEV"):
    if group_id not in _CACHE:
        try:
            _CACHE[group_id] = organizer.load_dataset(group_id)
        except Exception:
            raw_path = os.path.join(DATA, "dev_raw.json")
            if group_id == "DEV" and os.path.exists(raw_path):
                raw = json.load(open(raw_path, encoding="utf-8"))
                _CACHE[group_id] = [organizer.normalize(r) for r in raw["data"]["records"]]
            else:
                raise
    return _CACHE[group_id]


def find_dialog(cid, group_id="DEV"):
    for d in get_dialogs(group_id):
        if d["conversation_id"] == cid:
            return d
    raise HTTPException(404, "dialog not found")


_LAST = {}  # dialog_id -> (checklist_id, judgments) for appeal recompute

# ---- storage ----------------------------------------------------------------


def db():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    con = db()
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS appeals(
          id INTEGER PRIMARY KEY AUTOINCREMENT, dialog_id TEXT, criterion_id TEXT,
          comment TEXT, status TEXT DEFAULT 'open', created TEXT DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS reviews(
          id INTEGER PRIMARY KEY AUTOINCREMENT, appeal_id INTEGER, decision TEXT,
          new_verdict TEXT, new_score INTEGER, reason TEXT,
          created TEXT DEFAULT (datetime('now')));
        """
    )
    con.commit()
    con.close()


init_db()

app = FastAPI(title="CQA API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


@app.get("/api/health")
def health():
    return {"ok": True, "checklists": list(CHECKLISTS), "cached_groups": list(_CACHE)}


@app.get("/api/dialogs")
def list_dialogs(group_id: str = "DEV"):
    return [{"conversation_id": d["conversation_id"], "channel": d["channel"],
             "language": d["language"], "turns": d["turns"], "preview": d["preview"],
             "has_audio": bool(d["audio_url"])} for d in get_dialogs(group_id)]


@app.get("/api/dialogs/{cid}")
def get_dialog(cid: str, group_id: str = "DEV"):
    return find_dialog(cid, group_id)


@app.get("/api/checklists")
def list_checklists():
    return [{"id": c["id"], "name": c["name"]} for c in CHECKLISTS.values()]


@app.get("/api/checklists/{cid}")
def get_checklist(cid: str):
    if cid not in CHECKLISTS:
        raise HTTPException(404, "checklist not found")
    return CHECKLISTS[cid]


@app.put("/api/checklists/{cid}")
def save_checklist(cid: str, body: dict):
    body["id"] = cid
    CHECKLISTS[cid] = body
    json.dump(body, open(os.path.join(BK, "checklists", cid + ".json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    return {"ok": True, "id": cid}


class ScoreReq(BaseModel):
    dialog_id: str
    checklist_id: str = "default"
    provider: str = "claude-sonnet-5"  # accurate judge (MAE ~7 vs human gold)
    samples: int = 5  # self-consistency: vote over N runs to kill model variance
    group_id: str = "DEV"


@app.post("/api/score")
def score(req: ScoreReq):
    cl = CHECKLISTS.get(req.checklist_id)
    if not cl:
        raise HTTPException(404, "checklist not found")
    d = find_dialog(req.dialog_id, req.group_id)
    result = judge.judge_dialog(cl, d, provider=req.provider, samples=req.samples)
    _LAST[req.dialog_id] = (req.checklist_id, result["judgments"])
    return result


class AppealIn(BaseModel):
    dialog_id: str
    criterion_id: str
    comment: str = ""


@app.post("/api/appeals")
def create_appeal(a: AppealIn):
    con = db()
    cur = con.execute("INSERT INTO appeals(dialog_id,criterion_id,comment) VALUES(?,?,?)",
                      (a.dialog_id, a.criterion_id, a.comment))
    con.commit()
    aid = cur.lastrowid
    con.close()
    return {"appeal_id": aid, "status": "open"}


@app.get("/api/appeals")
def list_appeals(dialog_id: str = None):
    con = db()
    if dialog_id:
        rows = con.execute("SELECT * FROM appeals WHERE dialog_id=? ORDER BY id DESC",
                           (dialog_id,)).fetchall()
    else:
        rows = con.execute("SELECT * FROM appeals ORDER BY id DESC").fetchall()
    out = [dict(r) for r in rows]
    con.close()
    return out


class ReviewIn(BaseModel):
    appeal_id: int
    decision: str  # "confirm" | "change"
    new_verdict: str = None
    new_score: int = None
    reason: str = ""


@app.post("/api/reviews")
def create_review(r: ReviewIn):
    con = db()
    ap = con.execute("SELECT * FROM appeals WHERE id=?", (r.appeal_id,)).fetchone()
    if not ap:
        con.close()
        raise HTTPException(404, "appeal not found")
    con.execute(
        "INSERT INTO reviews(appeal_id,decision,new_verdict,new_score,reason) VALUES(?,?,?,?,?)",
        (r.appeal_id, r.decision, r.new_verdict, r.new_score, r.reason))
    con.execute("UPDATE appeals SET status='reviewed' WHERE id=?", (r.appeal_id,))
    con.commit()
    con.close()

    # Recompute final from the override (append-only: original stays intact).
    dialog_id, crit = ap["dialog_id"], ap["criterion_id"]
    stored = _LAST.get(dialog_id)
    if not stored:
        return {"ok": True, "note": "Оцените диалог заново, чтобы пересчитать итог."}
    cl_id, judgments = stored
    cl = CHECKLISTS[cl_id]
    original = scoring.score_dialog(cl, judgments)
    new_j = json.loads(json.dumps(judgments))
    if r.decision == "change":
        j = new_j.setdefault(crit, {})
        if r.new_verdict is not None:
            j["verdict"] = r.new_verdict
            j["applicable"] = (r.new_verdict != "na")
        if r.new_score is not None:
            j["raw_score"] = r.new_score
    final = scoring.score_dialog(cl, new_j)
    return {"criterion_id": crit, "decision": r.decision, "reason": r.reason,
            "original_total": original["total"], "final_total": final["total"],
            "result": final}
