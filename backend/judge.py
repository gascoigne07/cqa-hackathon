"""LLM judge: checklist + dialog -> per-criterion judgments -> deterministic score.

The model ONLY decides each criterion's verdict/scale/evidence. All arithmetic
(weights, N/A redistribution, rounding) stays in scoring.py so it is exact and
auditable. One call per dialog returns all 8 judgments (cheap; refine to
per-criterion + self-consistency later if calibration needs it).
"""
import json
import os
import re
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import providers  # noqa: E402
import scoring  # noqa: E402


def _fmt_transcript(dialog):
    return "\n".join(
        f'[{t["idx"]}] {t["timestamp"]} {t["speaker"]}: {t["text"]}'
        for t in dialog["transcript"]
    )


def _fmt_criteria(checklist):
    out = []
    for c in checklist["criteria"]:
        t = c["type"]
        if t == "bool":
            form = 'verdict: "yes" или "no"'
        elif t == "bool_na":
            form = 'verdict: "yes" / "no" / "na" (na — только если выполнено условие неприменимости)'
        elif t == "scale":
            steps = "; ".join(f'{s["value"]}={s["label"]}' for s in c["scale"])
            form = f'raw_score: одна ступень 0..{c["scale_max"]} [{steps}]; verdict "na" если применимо'
        else:  # flag
            form = 'flag: true/false (грубая ошибка)'
        out.append(f'{c["id"]} «{c["name"]}» [{t}, вес {c["weight"]}]: {c["guidance"]} || {form}')
    return "\n".join(out)


_PROMPT = """Ты — старший контролёр качества клиентской поддержки.
Оцени РАБОТУ ОПЕРАТОРА в диалоге СТРОГО по чек-листу. Оцениваешь только реплики роли operator; client, bot, system — это контекст.
Ключевые правила:
- «no» = действие было нужно, но оператор его пропустил или выполнил неверно.
- «na» = критерий неприменим по его условию (ставь только где na разрешено).
- Не добавляй своих правил, штрафов или критериев. Порог первой реакции, теги, вложения — не оценивай.
- evidence.quote — ТОЧНАЯ цитата реплики из диалога (или системного сообщения), turn_idx — её номер в квадратных скобках. Для пропущенного действия укажи, где оно ожидалось. Объяснения — на русском.

Грубая ошибка (c08): ставь флаг даже за ОДИН случай — предложение увести оплату или личный контакт за плату, грубость/оскорбление, раскрытие конфиденциальных данных. Лучше поймать, чем пропустить.

ЧЕК-ЛИСТ:
{criteria}

ДИАЛОГ (канал: {channel}, язык: {language}):
{transcript}

Верни СТРОГО JSON, по одному объекту на каждый критерий c01..c08:
{{"judgments":[{{"criterion_id":"c01","verdict":"yes|no|na|null","raw_score":null,"applicable":true,"na_reason":null,"explanation":"...","evidence":{{"turn_idx":0,"quote":"..."}},"flag":false}}]}}"""


def _clean_json(raw):
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?|\n?```$", "", raw).strip()
    return raw


def _one_judgment(checklist, dialog, provider):
    """Single LLM pass → per-criterion judgments dict (no scoring)."""
    prompt = _PROMPT.format(
        criteria=_fmt_criteria(checklist),
        channel=dialog.get("channel"), language=dialog.get("language"),
        transcript=_fmt_transcript(dialog),
    )
    raw = providers.generate(prompt, provider=provider, temperature=0.0, json_mode=True)
    parsed = json.loads(_clean_json(raw))
    # Models vary the wrapper: a bare [...] array, {"judgments":[...]}, or a
    # dict keyed by criterion id. Normalize all three to a list of judgment dicts.
    if isinstance(parsed, list):
        items = parsed
    elif isinstance(parsed, dict):
        items = parsed.get("judgments") or parsed.get("results")
        if not items and parsed and all(isinstance(v, dict) for v in parsed.values()):
            items = [{"criterion_id": k, **v} for k, v in parsed.items()]
        items = items or []
    else:
        items = []
    judgments = {}
    for item in items:
        cid = item.get("criterion_id")
        if not cid:
            continue
        v = item.get("verdict")
        judgments[cid] = {
            "verdict": v if v in ("yes", "no", "na") else None,
            "raw_score": item.get("raw_score"),
            "applicable": item.get("applicable"),
            "na_reason": item.get("na_reason"),
            "explanation": item.get("explanation"),
            "evidence": item.get("evidence"),
            "flag": item.get("flag"),
        }
    return judgments


def _is_na_j(j):
    return j.get("applicable") is False or j.get("verdict") == "na"


def _aggregate(checklist, runs):
    """Self-consistency: over N runs take majority verdict (bool/na), median scale
    (snapped to a valid step), majority flag. Kills Claude's run-to-run variance."""
    agg = {}
    for c in checklist["criteria"]:
        cid, ctype = c["id"], c["type"]
        js = [r.get(cid, {}) for r in runs if r.get(cid)]
        if not js:
            agg[cid] = {}
            continue
        if ctype == "flag":
            yes = sum(1 for j in js if j.get("flag") is True or j.get("verdict") == "yes")
            flag = yes > len(js) / 2
            pick = next((j for j in js if (j.get("flag") is True or j.get("verdict") == "yes") == flag), js[0])
            agg[cid] = {"flag": flag, "explanation": pick.get("explanation"), "evidence": pick.get("evidence")}
        elif ctype == "scale":
            na = sum(1 for j in js if _is_na_j(j))
            scores = [j["raw_score"] for j in js if not _is_na_j(j) and isinstance(j.get("raw_score"), (int, float))]
            if c.get("na_allowed") and na > len(js) / 2:
                pick = next((j for j in js if _is_na_j(j)), js[0])
                agg[cid] = {"applicable": False, "na_reason": pick.get("na_reason"), "evidence": pick.get("evidence")}
            elif scores:
                med = statistics.median(scores)
                step = min((s["value"] for s in c["scale"]), key=lambda val: abs(val - med))
                pick = min((j for j in js if not _is_na_j(j)), key=lambda j: abs((j.get("raw_score") or 0) - step))
                agg[cid] = {"raw_score": step, "explanation": pick.get("explanation"), "evidence": pick.get("evidence")}
            else:
                agg[cid] = {"raw_score": 0}
        else:  # bool / bool_na
            cats = ["na" if _is_na_j(j) else j.get("verdict") for j in js]
            winner = max(set(cats), key=cats.count)
            pick = next((j for j, cat in zip(js, cats) if cat == winner), js[0])
            if winner == "na":
                agg[cid] = {"applicable": False, "na_reason": pick.get("na_reason"), "evidence": pick.get("evidence")}
            else:
                agg[cid] = {"verdict": winner, "explanation": pick.get("explanation"), "evidence": pick.get("evidence")}
    return agg


def judge_dialog(checklist, dialog, provider="gemini-2.5-flash", samples=1):
    """Score a dialog. samples>1 runs the judge N times and votes (self-consistency)
    to remove run-to-run variance before the deterministic math."""
    if samples == 1:
        runs = [_one_judgment(checklist, dialog, provider)]
    else:
        # Run the N votes concurrently (I/O-bound) so latency ≈ one call, not N.
        runs = []
        with ThreadPoolExecutor(max_workers=min(samples, 8)) as ex:
            futures = [ex.submit(_one_judgment, checklist, dialog, provider)
                       for _ in range(samples)]
            for f in futures:
                try:
                    runs.append(f.result())
                except Exception:
                    pass
        if not runs:
            raise RuntimeError("all judge samples failed")
    judgments = runs[0] if len(runs) == 1 else _aggregate(checklist, runs)

    result = scoring.score_dialog(checklist, judgments)
    result["provider"] = provider
    result["samples"] = len(runs)
    result["dialog_id"] = dialog.get("conversation_id")
    result["judgments"] = judgments  # kept so appeals can recompute from the override
    # merge model's explanation/evidence onto scored rows (scoring keeps its own too)
    for row in result["results"]:
        j = judgments.get(row["criterion_id"], {})
        row["explanation"] = row.get("explanation") or j.get("explanation")
        row["evidence"] = row.get("evidence") or j.get("evidence")
    return result


if __name__ == "__main__":
    with open(os.path.join(BASE, "checklists", "default.json"), encoding="utf-8") as f:
        CL = json.load(f)
    with open(os.path.join(BASE, "mock_dialogs.json"), encoding="utf-8") as f:
        DIALOGS = json.load(f)

    d = DIALOGS[0]
    print(f"Диалог {d['conversation_id']} ({d['language']}, {d['channel']}) — оценка через gemini-2.5-flash...\n")
    res = judge_dialog(CL, d)
    name_by_id = {c["id"]: c["name"] for c in CL["criteria"]}
    for row in res["results"]:
        verd = row.get("verdict") or (f'шкала {row.get("raw_score")}/{row.get("scale_max")}'
                                      if row.get("raw_score") is not None else "N/A")
        ev = (row.get("evidence") or {}).get("quote")
        print(f'  {row["criterion_id"]} {name_by_id[row["criterion_id"]]:<38} '
              f'{str(verd):<14} {row["points"]:>6} б.  | {row.get("explanation") or ""}')
        if ev:
            print(f'       ↳ «{ev}»')
    ge = next((j for j in res["results"] if j["criterion_id"] == "c08"), None)
    print(f'\n  ИТОГ: {res["total"]}   |   грубая ошибка: {"ДА" if res["gross_error"] else "нет"}')
