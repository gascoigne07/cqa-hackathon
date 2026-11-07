#!/usr/bin/env bash
# One-command local start (macOS / Linux): ./start.sh  ->  http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-python3}
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  echo "Нужен Python 3.10+ (сейчас: $("$PY" --version 2>&1)). Установите его, например: brew install python@3.12" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "→ Создаю виртуальное окружение .venv"
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
echo "→ Устанавливаю зависимости backend"
pip install -q --upgrade pip
pip install -q -r backend/requirements.txt

if [ ! -f frontend/dist/index.html ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "→ Собираю frontend"
    (cd frontend && npm install --no-audit --no-fund && npm run build)
  else
    echo "frontend/dist не найден и npm не установлен — установите Node.js 20.19+ и запустите снова." >&2
    exit 1
  fi
fi

[ -f backend/.env ] || cp backend/.env.example backend/.env

echo ""
echo "  CQA запущен:  http://localhost:8000"
echo "  API и docs:   http://localhost:8000/docs"
echo "  Остановить:   Ctrl+C"
echo ""
cd backend
exec uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-8000}"
