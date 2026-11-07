"""Measure the ACTUAL deployed product's accuracy: call the real /api/score
(A's prompt + ClaudeScorer self-consistency + A's deterministic scoring) and
compare totals to Guy B's gold. This is what the pitch number must reflect —
not the standalone ml/ judge that produced the 7.58 on the dashboard.
Run:  python3 ml/real_calibrate.py
"""
import json
import os
import urllib.request

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:8000"
GOLD_FILES = ["labeling/CQA_gold_labeling.xlsx", "labeling/CQA_gold_labeling_part2.xlsx"]

gold = {}
for gf in GOLD_FILES:
    wb = openpyxl.load_workbook(os.path.join(ROOT, gf), data_only=True)
    for row in wb["Итоги"].iter_rows(min_row=10, max_row=200, values_only=True):
        if row and row[0] and isinstance(row[7], (int, float)):
            gold[row[0]] = row[7]

# what my standalone ml/ judge produced (from the 35-dialog calibration), for comparison
standalone = {  # deployed /api/score BEFORE org-rules (from calibration_deployed.json)
    "p1-ru-002": 87.5, "p1-kz-003": 90.0, "p1-en-006": 100.0, "p1-ru-005": 81.88,
    "p1-kz-005": 77.69, "p1-ru-029": 62.31, "p1-en-015": 50.63, "p1-en-013": 54.62,
    "p1-ru-003": 63.75, "p1-en-014": 17.65, "p1-ru-022": 12.5, "p1-ru-018": 12.5,
    "p4-ru-001": 68.33, "p4-ru-002": 88.82,
}
subset = list(standalone)


def score(did):
    req = urllib.request.Request(
        BASE + "/api/score",
        data=json.dumps({"dialog_id": did, "provider": "claude"}).encode(),
        headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


errs, sa_errs = [], []
print(f"{'диалог':<12}{'эталон':>8}{'БОЕВОЙ':>8}{'Δ':>7}   {'standalone':>10}{'Δsa':>7}")
for did in subset:
    try:
        res = score(did)
        at, gt, sa = res.get("total"), gold.get(did), standalone.get(did)
        e = abs(at - gt) if (at is not None and gt is not None) else None
        esa = abs(sa - gt) if (sa is not None and gt is not None) else None
        if e is not None:
            errs.append(e)
        if esa is not None:
            sa_errs.append(esa)
        print(f"{did:<12}{gt:>8}{at:>8}{round(e,1) if e is not None else '—':>7}   {sa:>10}{round(esa,1) if esa is not None else '—':>7}")
    except Exception as ex:
        print(f"{did:<12}  ОШИБКА: {str(ex)[:55]}")

if errs:
    print(f"\nMAE БОЕВОГО пути: {round(sum(errs)/len(errs),2)}  (на {len(errs)} диалогах)")
    print(f"MAE standalone (эти же):  {round(sum(sa_errs)/len(sa_errs),2)}  — заявленный на 35 был 7.58")
