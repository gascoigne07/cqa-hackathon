"""Settings from environment variables (or backend/.env)."""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent


def _load_dotenv() -> None:
    env = BACKEND_DIR / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

DATA_DIR = Path(os.environ.get("CQA_DATA_DIR", BACKEND_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_DIR = DATA_DIR / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

DB_URL = os.environ.get("CQA_DB_URL", f"sqlite:///{DATA_DIR / 'cqa_v2.db'}")

# Organizers' GET endpoint. The `group_id` query parameter is replaced per import.
API_URL = os.environ.get("CQA_API_URL", "")

# Local copy of a dataset, used on first start when the DB is empty.
SEED_FILE = Path(os.environ.get("CQA_SEED_FILE", BACKEND_DIR / "data" / "dev.json"))

DEFAULT_PROVIDER = os.environ.get("CQA_DEFAULT_PROVIDER", "mock")  # gemini | qwen | mock
CONCURRENCY = int(os.environ.get("CQA_CONCURRENCY", "4"))

# Drop logo.svg / logo.png / logo.webp / logo.jpg here to show it in the header.
BRANDING_DIR = Path(os.environ.get("CQA_BRANDING_DIR", ROOT_DIR / "branding"))

FRONTEND_DIST = Path(os.environ.get("CQA_FRONTEND_DIST", ROOT_DIR / "frontend" / "dist"))
CORS_ORIGINS = [o for o in os.environ.get("CQA_CORS_ORIGINS", "http://localhost:5173").split(",") if o]
