#!/usr/bin/env bash
# H23: контрольный набор через API — импорт → оценка ТОЛЬКО контрольных диалогов → выгрузка.
# Те же шаги, что в deploy/CONTROL_RUNBOOK.md (раздел «Путь через API»). Проверено dry-run 07.11.
#
#   GROUP=<group_id> bash deploy/h23_control.sh                     # живой URL, Claude
#   GROUP=<group_id> REUSE=true bash deploy/h23_control.sh          # после замены критерия: судить только изменённое
#   BASE=http://localhost:8000 PROVIDER=mock GROUP=<id> bash deploy/h23_control.sh
#   SKIP_IMPORT=true ...                                            # набор уже загружен
set -euo pipefail
BASE=${BASE:-https://cqa-web-production.up.railway.app}
GROUP=${GROUP:?укажи GROUP=<group_id от организаторов>}
PROVIDER=${PROVIDER:-claude}
REUSE=${REUSE:-false}

if [ "${SKIP_IMPORT:-false}" != "true" ]; then
  echo "== 1. Импорт $GROUP"
  curl -sS --fail-with-body -X POST "$BASE/api/datasets/import" -H 'Content-Type: application/json' -d "{\"group_id\":\"$GROUP\"}"
  echo
fi

echo "== 2. ID контрольного набора (поле dataset = $GROUP)"
IDS=$(curl -sS --fail "$BASE/api/dialogs" | python3 -c "import sys,json; print(','.join(d['conversation_id'] for d in json.load(sys.stdin) if d.get('dataset')=='$GROUP'))")
if [ -z "$IDS" ]; then echo "Нет диалогов с dataset=$GROUP — проверь импорт" >&2; exit 1; fi
echo "$IDS" | tr ',' '\n' | wc -l | xargs echo "диалогов:"
echo "$IDS"

echo "== 3. Оценка (provider=$PROVIDER, reuse_unchanged=$REUSE)"
python3 - "$BASE" "$IDS" "$PROVIDER" "$REUSE" <<'PY'
import json, sys, time, urllib.request
base, ids, provider, reuse = sys.argv[1], sys.argv[2].split(","), sys.argv[3], sys.argv[4] == "true"
def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, headers={"Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)
t0 = time.time()
job = call("POST", "/api/score/batch", {"dialog_ids": ids, "provider": provider, "reuse_unchanged": reuse})
while job["status"] == "running":
    time.sleep(2)
    job = call("GET", f"/api/score/batch/{job['job_id']}")
    print(f"  {time.time() - t0:5.0f} c  {job['done']}/{job['total']}", flush=True)
print(f"итог: {job['status']} {job['done']}/{job['total']} · судили критериев: {job['judged']} · "
      f"переиспользовано: {job['reused']} · за {time.time() - t0:.0f} c")
for e in job["errors"]:
    print("  ОШИБКА:", e)
sys.exit(0 if job["status"] == "done" and not job["errors"] else 1)
PY

echo "== 4. Выгрузка только контрольного набора"
STAMP=$(date +%H%M)
curl -sS --fail -o "control-$GROUP-$STAMP.csv" "$BASE/api/export?format=csv&ids=$IDS"
curl -sS --fail -o "control-$GROUP-$STAMP.json" "$BASE/api/export?format=json&ids=$IDS"
ls -l "control-$GROUP-$STAMP".*

echo "== 5. Проверка: все строки выгрузки оценены провайдером $PROVIDER"
python3 - "control-$GROUP-$STAMP.csv" "$PROVIDER" <<'PY'
import csv, sys
rows = list(csv.DictReader(open(sys.argv[1], encoding="utf-8-sig")))
bad = [(r["conversation_id"], r["provider"] or "не оценён") for r in rows if r["provider"] != sys.argv[2]]
print(f"строк: {len(rows)}, не {sys.argv[2]}: {len(bad)}")
for cid, prov in bad:
    print(f"  ВНИМАНИЕ: {cid} — в выгрузке оценка «{prov}» (свежая оценка не удалась). Переоцени перед сдачей.")
sys.exit(1 if bad else 0)
PY
