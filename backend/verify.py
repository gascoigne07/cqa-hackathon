"""Re-verification harness: key liveness, determinism (temp=0), and RU/KZ/EN coverage.
Run: python3 backend/verify.py
"""
import json
import os
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import judge  # noqa: E402

CL = json.load(open(os.path.join(BASE, "checklists", "default.json"), encoding="utf-8"))
D = json.load(open(os.path.join(BASE, "mock_dialogs.json"), encoding="utf-8"))
by = {d["conversation_id"]: d for d in D}


def line(x):
    v = x.get("verdict") or (f'шкала {x.get("raw_score")}' if x.get("raw_score") is not None else "N/A")
    return f'  {x["criterion_id"]} {str(v):<9} {x["points"]:>6}б | {(x.get("explanation") or "")[:78]}'


print("== 1. ДЕТЕРМИНИЗМ (RU, 3 прогона при temperature=0) ==")
totals = []
for k in range(3):
    t = time.time()
    r = judge.judge_dialog(CL, by["mock-ru-001"])
    totals.append(r["total"])
    print(f'  прогон {k + 1}: итог={r["total"]}  грубая={r["gross_error"]}  ({time.time() - t:.1f}s)')
print(f'  -> {"СТАБИЛЬНО ✅" if len(set(totals)) == 1 else "ЕСТЬ РАЗБРОС ⚠️ (нужна self-consistency)"}  {totals}')

for cid in ("mock-kz-001", "mock-en-001", "mock-ru-002"):
    d = by[cid]
    t = time.time()
    r = judge.judge_dialog(CL, d)
    print(f'\n== {d["language"]} {cid} ==  итог={r["total"]}  грубая={"ДА" if r["gross_error"] else "нет"}  ({time.time() - t:.1f}s)')
    for x in r["results"]:
        print(line(x))
