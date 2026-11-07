"""Fetch + normalize the organizer dataset (Power Automate flow).

The raw API omits a turn index; we add a stable `idx` per turn so evidence links
can point to an exact reply. `group_id` is swappable (DEV now, control set later)
without touching the signed URL.
"""
import json
import os
import re
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))


def _load_url():
    url = os.environ.get("ORGANIZER_API_URL")
    if url:
        return url
    env = os.path.abspath(os.path.join(BASE, "..", ".env"))
    if os.path.exists(env):
        for line in open(env, encoding="utf-8"):
            if line.strip().startswith("ORGANIZER_API_URL="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("ORGANIZER_API_URL not set (env or .env)")


def _swap_group(url, group_id):
    if re.search(r"[?&]group_id=", url):
        return re.sub(r"(group_id=)[^&]*", r"\g<1>" + group_id, url)
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}group_id={group_id}"


def fetch_raw(group_id="DEV", timeout=60):
    url = _swap_group(_load_url(), group_id)
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize(record):
    turns = [
        {"idx": i, "timestamp": t.get("timestamp"),
         "speaker": t.get("speaker"), "text": t.get("text")}
        for i, t in enumerate(record.get("transcript", []))
    ]
    preview = next((t["text"] for t in turns if t["speaker"] in ("client", "operator")), "")
    return {
        "conversation_id": record.get("conversation_id"),
        "channel": record.get("channel"),
        "language": record.get("language"),
        "audio_url": record.get("audio_url"),
        "transcript": turns,
        "turns": len(turns),
        "preview": (preview or "")[:120],
    }


def load_dataset(group_id="DEV"):
    raw = fetch_raw(group_id)
    if not raw.get("isSuccess"):
        raise RuntimeError(f"organizer API error: {raw.get('error')!r}")
    return [normalize(r) for r in raw.get("data", {}).get("records", [])]
