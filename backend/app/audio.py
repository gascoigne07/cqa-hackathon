"""Call recordings.

The organizers' `audio_url` returns an HTML player page whose <source> points
to a signed MP3 link that expires after about an hour. To let the UI seek to
the exact evidence moment (same-origin, Range requests), we resolve that page,
download the MP3 once and serve it from a local cache.
"""

from __future__ import annotations

import html
import re
from pathlib import Path

import httpx

from . import config

_SOURCE = re.compile(r"<source[^>]+src=\"([^\"]+)\"", re.I)
_AUDIO_TYPES = ("audio/", "application/octet-stream")


class AudioError(RuntimeError):
    pass


def cache_path(dialog_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", dialog_id)
    return config.AUDIO_DIR / f"{safe}.mp3"


async def ensure_cached(dialog_id: str, audio_url: str) -> Path:
    path = cache_path(dialog_id)
    if path.exists() and path.stat().st_size > 0:
        return path
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        resp = await client.get(audio_url)
        if resp.status_code != 200:
            raise AudioError(f"audio_url ответил {resp.status_code}")
        ctype = resp.headers.get("content-type", "")
        if ctype.startswith(_AUDIO_TYPES):
            data = resp.content
        else:
            match = _SOURCE.search(resp.text)
            if not match:
                raise AudioError("Не нашли ссылку на запись на странице плеера")
            src = html.unescape(match.group(1))
            audio = await client.get(src)
            if audio.status_code != 200:
                raise AudioError(f"Ссылка на запись ответила {audio.status_code} (могла истечь)")
            data = audio.content
    if len(data) < 1024:
        raise AudioError("Запись пустая или повреждена")
    tmp = path.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(path)
    return path
