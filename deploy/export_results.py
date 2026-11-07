"""Export results.json in the organizers' official format (JSON 1.0,
CQA_Student_Guide_Appendix_Results.pdf). THIS is the judged deliverable.

  python deploy/export_results.py --group DEV --out results/dev/results.json --expect 65
  python deploy/export_results.py --group <CONTROL> --out results/prod/results.json --expect 10

Imports the group if needed, scores every dialog via the live backend
(/api/score, Claude + self-consistency), maps our CriterionResult to the official
schema (criterion ids renamed, N/A -> null, evidence turns -> 1-based) and validates.
Set the team name: CQA_TEAM env or --team.
"""
import argparse
import json
import os
import urllib.request

BASE = os.environ.get("CQA_BASE", "http://127.0.0.1:8000")

# our checklist id -> official criterion_id
MAP = {"contact": "contact", "needs": "discovery", "identification": "identification",
       "consultation": "consultation", "empathy": "empathy", "dialog_management": "dialogue",
       "closing": "closure", "gross_errors": "critical"}
ORDER = ["contact", "discovery", "identification", "consultation", "empathy", "dialogue", "closure", "critical"]
SCALE = {"consultation", "dialogue"}


def api(method, path, body=None, timeout=220):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def official_value(off_id, r):
    if off_id == "critical":
        return bool(r.get("gross_error"))
    if r.get("applicable") is False or r.get("verdict") == "na":
        return None
    if off_id in SCALE:
        v = r.get("raw_score")
        return int(v) if isinstance(v, (int, float)) and float(v).is_integer() else v
    v = r.get("verdict")
    if v == "yes":
        return True
    if v == "no":
        return False
    return False  # "uncertain" -> conservative "Нет" for a yes/no criterion


def evidence_turns(r):
    evs = r.get("evidence_all") or ([r["evidence"]] if r.get("evidence") else [])
    turns = sorted({e["turn_idx"] + 1 for e in evs if e and e.get("turn_idx") is not None})
    return turns or [1]


def map_dialog(cid, res):
    by = {x["criterion_id"]: x for x in res.get("results", [])}
    crit = [{"criterion_id": off, "value": official_value(off, by.get(a, {})),
             "rationale": (by.get(a, {}).get("explanation") or "").strip() or "—",
             "evidence_turns": evidence_turns(by.get(a, {}))}
            for a, off in MAP.items()]
    crit.sort(key=lambda c: ORDER.index(c["criterion_id"]))
    return {"conversation_id": cid, "status": "ok", "criteria": crit,
            "score": {"final_score": res.get("total"), "critical_flag": bool(res.get("gross_error"))}}


def validate(doc, expect=None):
    probs = []
    ids = [r["conversation_id"] for r in doc["results"]]
    if len(ids) != len(set(ids)):
        probs.append("повтор conversation_id")
    if expect and len(ids) != expect:
        probs.append(f"ожидалось {expect} записей, получено {len(ids)}")
    for r in doc["results"]:
        if r["status"] == "ok" and sorted(c["criterion_id"] for c in r["criteria"]) != sorted(ORDER):
            probs.append(f"{r['conversation_id']}: не все 8 официальных критериев")
    return probs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", default="DEV")
    ap.add_argument("--out", required=True)
    ap.add_argument("--expect", type=int)
    ap.add_argument("--provider", default="claude")
    ap.add_argument("--team", default=os.environ.get("CQA_TEAM", "УКАЖИ_НАЗВАНИЕ_КОМАНДЫ"))
    ap.add_argument("--limit", type=int, help="score only the first N (format testing)")
    a = ap.parse_args()

    try:
        api("POST", "/api/datasets/import", {"group_id": a.group})
    except Exception as e:  # noqa: BLE001
        print(f"[import] {a.group}: {str(e)[:60]} (продолжаю, если диалоги уже в базе)")

    dialogs = [d for d in api("GET", "/api/dialogs") if d.get("dataset") == a.group]
    if a.limit:
        dialogs = dialogs[:a.limit]
    print(f"{a.group}: {len(dialogs)} диалогов через {a.provider}")
    results = []
    for i, d in enumerate(dialogs, 1):
        cid = d["conversation_id"]
        try:
            res = api("POST", "/api/score", {"dialog_id": cid, "provider": a.provider})
            results.append(map_dialog(cid, res))
            print(f"  {i}/{len(dialogs)} {cid}: {res.get('total')}")
        except Exception as e:  # noqa: BLE001
            results.append({"conversation_id": cid, "status": "error", "criteria": [], "score": None,
                            "error": f"{type(e).__name__}: {str(e)[:120]}"})
            print(f"  {i}/{len(dialogs)} {cid}: ОШИБКА {str(e)[:60]}")

    doc = {"schema_version": "1.0", "team_name": a.team,
           "model": {"mode": "external_api", "name": "Anthropic claude-sonnet-5 (self-consistency x5)"},
           "results": results}
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    json.dump(doc, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    probs = validate(doc, a.expect)
    print(f"\n-> {a.out} ({len(results)} записей)")
    print("валидация:", "ОК ✓" if not probs else "ПРОБЛЕМЫ: " + "; ".join(probs))
    if a.team == "УКАЖИ_НАЗВАНИЕ_КОМАНДЫ":
        print("⚠️  team_name не задан! Запусти с --team 'Название' или CQA_TEAM=... (НЕ YaTebyaMognu — это конкурент)")


if __name__ == "__main__":
    main()
