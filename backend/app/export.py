"""Results export (CSV / JSON): the latest score of each dialog.

CSV has one row per dialog and, per criterion, a verdict column and a points
column — easy to compare with a reference (Ground Truth) sheet. UTF-8 with BOM
so Excel opens Cyrillic correctly.
"""

from __future__ import annotations

import csv
import io
import json

from . import service, store
from .schemas import ScoreResponse


def collect(ids: list[str] | None) -> list[dict]:
    wanted = set(ids) if ids else None
    latest = store.latest_scores()
    rows = []
    for d, dataset in store.list_dialogs():
        if wanted is not None and d.conversation_id not in wanted:
            continue
        sc = latest.get(d.conversation_id)
        resp: ScoreResponse | None = service.to_response(sc, d) if sc else None
        rows.append({
            "conversation_id": d.conversation_id,
            "channel": d.channel,
            "language": d.language,
            "dataset": dataset,
            "checklist_name": sc.checklist.name if sc else None,
            "score": json.loads(resp.model_dump_json()) if resp else None,
        })
    return rows


def to_json(rows: list[dict]) -> str:
    return json.dumps(rows, ensure_ascii=False, indent=2)


def to_csv(rows: list[dict]) -> str:
    criteria: list[str] = []
    for r in rows:
        for res in (r["score"] or {}).get("results", []):
            if res["criterion_id"] not in criteria:
                criteria.append(res["criterion_id"])

    head = ["conversation_id", "channel", "language", "dataset", "checklist_id", "checklist_name", "provider", "model",
            "total", "original_total", "gross_error", "needs_review", "scored_at", "duration_ms"]
    for cid in criteria:
        head += [f"{cid}.verdict", f"{cid}.points"]

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(head)
    for r in rows:
        s = r["score"]
        run = (s or {}).get("run") or {}
        line = [r["conversation_id"], r["channel"], r["language"], r["dataset"],
                s and s.get("checklist_id"), r["checklist_name"], s and s.get("provider"), run.get("model"),
                s and s.get("total"), s and s.get("original_total"),
                s and int(s.get("gross_error", False)), s and int(s.get("needs_review", False)),
                s and s.get("created_at"), run.get("duration_ms")]
        by_id = {res["criterion_id"]: res for res in (s or {}).get("results", [])}
        for cid in criteria:
            res = by_id.get(cid)
            line += [res and (res["verdict"] if res["type"] != "scale" or res["raw_score"] is None else res["raw_score"]),
                     res and res["points"]]
        w.writerow(["" if v is None else v for v in line])
    return "﻿" + buf.getvalue()
