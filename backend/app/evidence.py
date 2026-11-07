"""Evidence validation: never trust a judge's citation without checking it.

A judgment is accepted only if every cited message index exists and, when a
quote is given, the quote actually appears in (or closely matches) that
message. This proves the citation is real — it does not prove the message
supports the verdict; that is what human review and appeals are for.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from .schemas import Dialog, Judgment

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[«»\"'“”„.,!?;:()\[\]—–-]")


def _norm(s: str) -> str:
    return _WS.sub(" ", _PUNCT.sub(" ", s.lower())).strip()


def quote_matches(quote: str, text: str, threshold: float = 0.75) -> bool:
    q, t = _norm(quote), _norm(text)
    if not q:
        return True
    if q in t:
        return True
    # fuzzy: best window of the same length as the quote
    n = len(q)
    if n > len(t):
        return SequenceMatcher(None, q, t).ratio() >= threshold
    step = max(1, n // 4)
    best = 0.0
    for i in range(0, len(t) - n + 1, step):
        best = max(best, SequenceMatcher(None, q, t[i : i + n]).ratio())
        if best >= threshold:
            return True
    return best >= threshold


def validate(dialog: Dialog, j: Judgment) -> tuple[Judgment, list[str]]:
    """Drop invalid evidence, return the cleaned judgment and a list of issues."""
    issues: list[str] = []
    n = len(dialog.transcript)
    kept = []
    for ev in j.evidence:
        if not 0 <= ev.message_index < n:
            issues.append(f"Ссылка на несуществующую реплику #{ev.message_index}")
            continue
        if ev.quote and not quote_matches(ev.quote, dialog.transcript[ev.message_index].text):
            issues.append(f"Цитата не совпадает с репликой #{ev.message_index}")
            continue
        kept.append(ev)

    checked = j.checked_range
    if checked is not None:
        if len(checked) != 2 or not (0 <= checked[0] <= checked[1] < n):
            issues.append("Некорректный проверенный участок разговора")
            checked = None

    return j.model_copy(update={"evidence": kept, "checked_range": checked}), issues
