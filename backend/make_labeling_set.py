"""Generate a stratified hand-labeling set for the human Ground Truth (Guy B).

Picks all 5 voice calls (trickiest, only 5) + stratified chats across RU/KZ/EN,
renders them human-readable (NO model output — keep the labels unbiased), and a
CSV skeleton (one row per dialog x criterion) ready to fill in Google Sheets.
Run: python3 backend/make_labeling_set.py
"""
import csv
import json
import os

BK = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(BK), "labeling")
os.makedirs(OUT, exist_ok=True)

raw = json.load(open(os.path.join(BK, "data", "dev_raw.json"), encoding="utf-8"))
import organizer  # noqa: E402
recs = [organizer.normalize(r) for r in raw["data"]["records"]]
CL = json.load(open(os.path.join(BK, "checklists", "default.json"), encoding="utf-8"))

calls = [d for d in recs if d["channel"] == "voice call"]
chats = [d for d in recs if d["channel"] == "agent chat"]


def take(lst, lang, n):
    return [d for d in lst if d["language"] == lang][:n]


selected = calls[:]  # all 5 calls
quota = {"RU": 8, "KZ": 3, "EN": 2}
for lang, n in quota.items():
    selected += take(chats, lang, n)
# dedup, keep order
seen, final = set(), []
for d in selected:
    if d["conversation_id"] not in seen:
        seen.add(d["conversation_id"])
        final.append(d)

# 1) human-readable transcripts
md = ["# Диалоги на разметку (мини-Ground-Truth)\n",
      f"Отобрано {len(final)} диалогов. Размечай по [брифу](../BRIEF-razmetka-pacan-B.md) и чек-листу. "
      "Оценивай ТОЛЬКО реплики `operator`; `client`/`bot`/`system` — контекст.\n"]
for d in final:
    md.append(f"\n---\n## {d['conversation_id']}  ·  {d['language']}  ·  {d['channel']}"
              + (f"  ·  🔊 {d['audio_url']}" if d["audio_url"] else ""))
    for t in d["transcript"]:
        md.append(f"- `[{t['idx']}]` `{t['timestamp']}` **{t['speaker']}**: {t['text']}")
open(os.path.join(OUT, "dialogs_to_label.md"), "w", encoding="utf-8").write("\n".join(md))

# 2) CSV label skeleton
name_by = {c["id"]: c["name"] for c in CL["criteria"]}
type_by = {c["id"]: c["type"] for c in CL["criteria"]}
with open(os.path.join(OUT, "labels_template.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["conversation_id", "language", "criterion_id", "criterion",
                "type", "verdict/score", "evidence_timestamp", "evidence_quote",
                "reason", "note"])
    for d in final:
        for c in CL["criteria"]:
            w.writerow([d["conversation_id"], d["language"], c["id"],
                        name_by[c["id"]], type_by[c["id"]], "", "", "", "", ""])

from collections import Counter
print(f"Отобрано {len(final)} диалогов:",
      dict(Counter(d["language"] for d in final)),
      "| звонков:", sum(1 for d in final if d["channel"] == "voice call"))
print("Файлы:")
print("  labeling/dialogs_to_label.md   — читаемые транскрипты (отдать пацану Б)")
print("  labeling/labels_template.csv   — скелет для Google Sheets (verdict/score пустые)")
