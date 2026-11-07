"""Container start-up helper (deploy only — not part of the app).

backend/data/dev.json is git-ignored, so a deploy from Git or `railway up` starts
without dialogs, and free-tier disks are wiped on every restart. If the seed file
is missing and CQA_API_URL is set, download the dataset (group CQA_SEED_GROUP,
default DEV) once, so the app's own start-up seeds the database from it.

Never prints the URL (it is signed) and never blocks start-up: on any failure the
app starts empty and data can still be loaded with «Импорт из API» in the UI.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))


def main() -> None:
    from app import config  # noqa: PLC0415 - after sys.path setup
    from app.datasource import _url_for_group, parse_payload  # noqa: PLC0415

    seed = config.SEED_FILE
    if seed.exists():
        print(f"[seed] {seed.name} present — skipping download", flush=True)
        return
    if not config.API_URL:
        print("[seed] CQA_API_URL is not set — starting without dialogs (use «Импорт из API»)", flush=True)
        return

    import httpx  # noqa: PLC0415

    group = os.environ.get("CQA_SEED_GROUP", "DEV").strip() or "DEV"
    try:
        resp = httpx.get(_url_for_group(group), timeout=90, follow_redirects=True)
        resp.raise_for_status()
        payload = resp.json()
        _, dialogs = parse_payload(payload, default_dataset=group)
    except Exception as exc:  # noqa: BLE001 - report the type only, the message may contain the URL
        print(f"[seed] download failed ({type(exc).__name__}) — starting without dialogs", flush=True)
        return

    seed.parent.mkdir(parents=True, exist_ok=True)
    tmp = seed.with_suffix(".part")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(seed)
    print(f"[seed] downloaded {len(dialogs)} dialogs of group {group}", flush=True)


if __name__ == "__main__":
    main()
