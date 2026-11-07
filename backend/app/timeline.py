"""Timestamps -> seconds from the start of the recording.

Chats use "MM:SS" (or "HH:MM:SS"); calls use ISO 8601 with a timezone.
For calls, the recording is paused during holds ("Запись и транскрибирование
приостановлены" … "возобновлены"), so paused time is subtracted to keep the
audio seek position close to the right moment. Original timestamps are never
modified — offsets are computed alongside them.
"""

from __future__ import annotations

import re
from datetime import datetime

from .schemas import Dialog

_PAUSE = re.compile(r"приостановлен|paused|тоқтатыл", re.I)
_RESUME = re.compile(r"возобновлен|resumed|жалғастырыл|қайта бастал", re.I)


def parse_seconds(ts: str) -> float | None:
    ts = ts.strip()
    if re.fullmatch(r"\d{1,3}:\d{2}(:\d{2})?(\.\d+)?", ts):
        parts = [float(p) for p in ts.split(":")]
        secs = 0.0
        for p in parts:
            secs = secs * 60 + p
        return secs
    try:
        # Python 3.11+ fromisoformat handles offsets; trim >6 fractional digits
        m = re.match(r"^(.*\.\d{6})\d*(.*)$", ts)
        iso = (m.group(1) + m.group(2)) if m else ts
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def offsets(dialog: Dialog) -> list[float | None]:
    raw = [parse_seconds(m.timestamp) for m in dialog.transcript]
    first = next((r for r in raw if r is not None), None)
    if first is None:
        return [None] * len(raw)

    is_call = dialog.channel.lower().startswith("voice")
    out: list[float | None] = []
    paused_total = 0.0
    paused_since: float | None = None
    for m, r in zip(dialog.transcript, raw):
        if r is None:
            out.append(None)
            continue
        if is_call and m.speaker == "system":
            if _PAUSE.search(m.text) and paused_since is None:
                paused_since = r
            elif _RESUME.search(m.text) and paused_since is not None:
                paused_total += max(0.0, r - paused_since)
                paused_since = None
        current_pause = (r - paused_since) if paused_since is not None else 0.0
        out.append(round(max(0.0, r - first - paused_total - current_pause), 2))
    return out


def label(ts: str) -> str:
    """Short human label: MM:SS for chats, HH:MM:SS for ISO timestamps."""
    if "T" in ts:
        try:
            return ts.split("T", 1)[1][:8]
        except IndexError:
            return ts
    return ts
