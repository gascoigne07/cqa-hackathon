"""Calibration: AI judge vs human Ground Truth (criterion #1).

Runs the judge on the 20 gold dialogs and measures per-criterion agreement +
final-score error against Guy B's gold labels. This is the headline accuracy
number. Run: python3 backend/calibrate.py [provider]
"""
import json
import os
import sys
import time
from collections import OrderedDict

import openpyxl

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import judge  # noqa: E402
import organizer  # noqa: E402

PROVIDER = sys.argv[1] if len(sys.argv) > 1 else "claude-sonnet-5"
SAMPLES = int(sys.argv[2]) if len(sys.argv) > 2 else 5
GOLD_FILES = ["CQA_gold_labeling.xlsx", "CQA_gold_labeling_part2.xlsx"]
CL = json.load(open(os.path.join(BASE, "checklists", "default.json"), encoding="utf-8"))
raw = json.load(open(os.path.join(BASE, "data", "dev_raw.json"), encoding="utf-8"))
DIA = {r["conversation_id"]: organizer.normalize(r) for r in raw["data"]["records"]}

CRIT = [("c01", "bool"), ("c02", "bool_na"), ("c03", "bool_na"), ("c04", "scale"),
        ("c05", "bool"), ("c06", "scale"), ("c07", "bool_na"), ("c08", "flag")]
TOL = {"c04": 5, "c06": 3}


def NU(v):
    return "" if v is None else str(v).strip().upper()


G = OrderedDict()
gold_total = {}
for fn in GOLD_FILES:
    gf = os.path.join(os.path.dirname(BASE), "labeling", fn)
    if not os.path.exists(gf):
        continue
    wb = openpyxl.load_workbook(gf, data_only=True)
    for r in (x for x in wb["Разметка"].iter_rows(min_row=6, values_only=True) if x and x[0]):
        G.setdefault(r[0], []).append(r)
    for row in wb["Итоги"].iter_rows(min_row=10, max_row=200, values_only=True):
        if row and row[0] and isinstance(row[7], (int, float)):
            gold_total[row[0]] = row[7]


def gold_v(ctype, vraw):
    v = NU(vraw)
    if v in ("N/A", "Н/Д", "Н/П"):
        return ("na", None)
    if ctype in ("bool", "bool_na", "flag"):
        return ("yes" if v == "ДА" else "no", None)
    try:
        return (None, int(float(str(vraw))))
    except Exception:
        return (None, None)


def ai_v(ctype, j):
    if ctype == "flag":
        return ("yes" if j.get("flag") else "no", None)
    if j.get("applicable") is False or j.get("verdict") == "na":
        return ("na", None)
    if ctype == "scale":
        return (None, j.get("raw_score"))
    return (j.get("verdict"), None)


agree = {c: 0 for c, _ in CRIT}
close = {c: 0 for c, t in CRIT if t == "scale"}
errs, per_dialog = [], []
gross_gold, gross_ai = set(), set()
n = 0
print(f"Калибровка {PROVIDER} vs эталон — прогон {len(G)} диалогов...\n")
for cid, rs in G.items():
    try:
        res = judge.judge_dialog(CL, DIA[cid], provider=PROVIDER, samples=SAMPLES)
    except Exception as e:
        print(f"  --/{len(G)} {cid}: ПРОПУЩЕН ({str(e)[:70]})")
        continue
    J = res["judgments"]
    for i, (crit_id, ctype) in enumerate(CRIT):
        gv = gold_v(ctype, rs[i][6])
        av = ai_v(ctype, J.get(crit_id, {}))
        if crit_id == "c08":
            if gv[0] == "yes":
                gross_gold.add(cid)
            if av[0] == "yes":
                gross_ai.add(cid)
            if gv[0] == av[0]:
                agree[crit_id] += 1
        elif ctype == "scale":
            gna, ana = gv[0] == "na", av[0] == "na"
            if gna and ana:
                agree[crit_id] += 1
                close[crit_id] += 1
            elif not gna and not ana and gv[1] is not None and av[1] is not None:
                if gv[1] == av[1]:
                    agree[crit_id] += 1
                if abs(gv[1] - av[1]) <= TOL[crit_id]:
                    close[crit_id] += 1
        else:
            if gv[0] == av[0]:
                agree[crit_id] += 1
    gt, at = gold_total.get(cid), res["total"]
    if isinstance(gt, (int, float)) and at is not None:
        errs.append(abs(gt - at))
        per_dialog.append((cid, gt, at, round(abs(gt - at), 2)))
    n += 1
    print(f"  {n:>2}/{len(G)} {cid}: эталон={gt} AI={at}")
    time.sleep(1)

if n == 0:
    print("\nВсе диалоги пропущены (0 успешных) — вероятно rate-limit/429. Остановка.")
    sys.exit(1)
name = {c["id"]: c["name"] for c in CL["criteria"]}
print(f"\n== РЕЗУЛЬТАТ: {PROVIDER} vs эталон ({n} диалогов) ==")
print("\nСовпадение по критериям (вердикт точно):")
for crit_id, ctype in CRIT:
    extra = f"   | в пределах шага: {close[crit_id]}/{n}" if ctype == "scale" else ""
    print(f"  {crit_id} {name[crit_id][:30]:<30} {agree[crit_id]:>2}/{n}  ({round(100*agree[crit_id]/n)}%){extra}")
mae = round(sum(errs) / len(errs), 2) if errs else None
within10 = sum(1 for e in errs if e <= 10)
print(f"\nОБЩИЙ БАЛЛ: MAE={mae} из 100 | в пределах ±10 баллов: {within10}/{len(errs)}")
print(f"Грубые ошибки: эталон={sorted(gross_gold)}")
print(f"               AI    ={sorted(gross_ai)}")
print("\nТоп расхождений по итогу:")
for cid, gt, at, e in sorted(per_dialog, key=lambda x: -x[3])[:6]:
    print(f"  {cid}: эталон={gt} AI={at}  Δ={e}")
