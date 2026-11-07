# CQA — one container serves both the API and the built React frontend.
# Build:  docker build -t cqa .
# Run:    docker run -p 8000:8000 --env-file backend/.env cqa   ->  http://localhost:8000
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# dependencies first, so code changes don't reinstall them
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ backend/
COPY frontend/dist/ frontend/dist/
COPY branding/ branding/
COPY deploy/ deploy/

# run as a non-root user; the SQLite DB and cached recordings live in backend/data.
# chmod: files copied from a checkout may be owner-only (e.g. mode 600) — make them readable.
RUN chmod -R a+rX /app \
    && useradd --create-home --uid 10001 cqa \
    && mkdir -p backend/data/audio \
    && chown -R cqa:cqa backend/data branding
USER cqa

WORKDIR /app/backend
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8000'), timeout=4)" || exit 1

# 1) if backend/data/dev.json is absent (it is git-ignored), download the dataset from CQA_API_URL;
# 2) start uvicorn on $PORT (Render/Railway set it), 8000 by default.
CMD ["sh", "-c", "python /app/deploy/fetch_seed.py; exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
