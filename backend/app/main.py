"""CQA — Conversation Quality Analytics API (team contract, see CONTRACT.md).

Run:  uvicorn app.main:app --reload   (from backend/)
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterable
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.sse import EventSourceResponse, ServerSentEvent
from fastapi.staticfiles import StaticFiles

from . import audio, config, export, service, store
from .datasource import DataSourceError, fetch_group, parse_payload
from .schemas import (
    AppealCreate,
    AppealCreated,
    AppealDetail,
    AppealListItem,
    BatchJob,
    BatchRequest,
    Checklist,
    ChecklistIn,
    ChecklistListItem,
    DialogListItem,
    DialogOut,
    ImportRequest,
    ImportResult,
    ProviderInfo,
    ReviewCreate,
    ReviewResult,
    ScoreRequest,
    ScoreResponse,
    TraceEntry,
)
from .scorers import PROVIDERS, ProviderError, ProviderUnavailable

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    service.bootstrap()
    yield


app = FastAPI(title="CQA — Conversation Quality Analytics", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def _err(status: int):  # noqa: ANN202
    async def handler(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=status, content={"detail": str(exc)})

    return handler


app.add_exception_handler(service.NotFound, _err(404))
app.add_exception_handler(service.BadRequest, _err(400))
app.add_exception_handler(ProviderUnavailable, _err(503))
app.add_exception_handler(ProviderError, _err(502))
app.add_exception_handler(DataSourceError, _err(502))
app.add_exception_handler(audio.AudioError, _err(502))


# ======================================================== contract endpoints


@app.get("/api/dialogs", response_model=list[DialogListItem], tags=["contract"])
def list_dialogs() -> list[DialogListItem]:
    return service.list_dialogs()


@app.get("/api/dialogs/{dialog_id}", response_model=DialogOut, tags=["contract"])
def get_dialog(dialog_id: str) -> DialogOut:
    d = service.require_dialog(dialog_id)
    return DialogOut(
        conversation_id=d.conversation_id,
        channel=d.channel,
        language=d.language,
        audio_url=f"/api/dialogs/{d.conversation_id}/audio" if d.audio_url else None,
        audio_source_url=d.audio_url,
        transcript=service.turns_of(d),
    )


@app.get("/api/checklists", response_model=list[ChecklistListItem], tags=["contract"])
def list_checklists() -> list[ChecklistListItem]:
    return [ChecklistListItem(id=c.id, name=c.name, criteria_count=len(c.criteria), created_at=c.created_at, channel=c.channel)
            for c in store.list_checklists()]


@app.get("/api/checklists/{checklist_id}", response_model=Checklist, tags=["contract"])
def get_checklist(checklist_id: int) -> Checklist:
    return service.resolve_checklist(checklist_id)


@app.post("/api/checklists", response_model=Checklist, tags=["contract"])
def create_checklist(body: ChecklistIn) -> Checklist:
    """Saves a NEW checklist (new id). Old scores keep the checklist they were made with."""
    return store.create_checklist(body)


@app.post("/api/score", response_model=ScoreResponse, tags=["contract"])
async def score(body: ScoreRequest) -> ScoreResponse:
    """Live analysis: always calls the provider (no cache). Without checklist_id the newest
    checklist for the dialog's channel (chat / call) is used."""
    sc = await service.score(body.dialog_id, body.checklist_id, body.provider)
    return service.to_response(sc)


@app.post("/api/appeals", response_model=AppealCreated, tags=["contract"])
def create_appeal(body: AppealCreate) -> AppealCreated:
    return AppealCreated(appeal_id=service.create_appeal(body))


@app.post("/api/reviews", response_model=ReviewResult, tags=["contract"])
def create_review(body: ReviewCreate) -> ReviewResult:
    return ReviewResult(result=service.review(body))


# ================================================ ⊕ extensions (fill the gaps)


@app.get("/api/providers", response_model=list[ProviderInfo], tags=["extensions"])
def providers() -> list[ProviderInfo]:
    out = []
    for p in PROVIDERS.values():
        ok, note = p.available()
        out.append(ProviderInfo(id=p.id, name=p.name, kind=p.kind, available=ok, note=note,  # type: ignore[arg-type]
                                optional=p.optional, model=p.model_name() if ok else ""))
    return out


@app.get("/api/dialogs/{dialog_id}/score", response_model=ScoreResponse, tags=["extensions"])
def latest_score(dialog_id: str) -> ScoreResponse:
    """The dialog's latest saved score, with original vs. final and appeals."""
    return service.latest_response(dialog_id)


@app.get("/api/scores/{score_id}/trace", response_model=list[TraceEntry], tags=["extensions"])
def score_trace(score_id: int) -> list[TraceEntry]:
    """Every model call behind a score: exact prompt, raw answer, model, duration, tokens."""
    return service.score_trace(score_id)


@app.get("/api/export", tags=["extensions"])
def export_results(format: str = Query("csv", pattern="^(csv|json)$"), ids: str | None = None) -> Response:  # noqa: A002
    """Latest score of each dialog (optionally only `ids`, comma-separated) as CSV or JSON."""
    rows = export.collect([i for i in ids.split(",") if i] if ids else None)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    if format == "json":
        return Response(export.to_json(rows), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="cqa-results-{stamp}.json"'})
    return Response(export.to_csv(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="cqa-results-{stamp}.csv"'})


@app.get("/api/dialogs/{dialog_id}/audio", response_class=FileResponse, tags=["extensions"])
async def get_audio(dialog_id: str) -> FileResponse:
    d = service.require_dialog(dialog_id)
    if not d.audio_url:
        raise HTTPException(404, "У диалога нет записи")
    return FileResponse(await audio.ensure_cached(dialog_id, d.audio_url), media_type="audio/mpeg")


@app.get("/api/appeals", response_model=list[AppealListItem], tags=["extensions"])
def list_appeals(status: str | None = Query(None, pattern="^(open|resolved)$")) -> list[AppealListItem]:
    return service.list_appeals(status)


@app.get("/api/appeals/{appeal_id}", response_model=AppealDetail, tags=["extensions"])
def get_appeal(appeal_id: int) -> AppealDetail:
    return service.appeal_detail(appeal_id)


@app.post("/api/score/batch", response_model=BatchJob, tags=["extensions"])
async def start_batch(body: BatchRequest) -> BatchJob:
    return service.start_batch(body.dialog_ids, body.checklist_id, body.provider, body.reuse_unchanged)


def _job(job_id: str):  # noqa: ANN202 - dependency so 404 happens before streaming starts
    return service.get_job(job_id)


@app.get("/api/score/batch/{job_id}", response_model=BatchJob, tags=["extensions"])
def get_batch(job=Depends(_job)) -> BatchJob:  # noqa: ANN001
    return job.view()


@app.get("/api/score/batch/{job_id}/events", response_class=EventSourceResponse, tags=["extensions"])
async def batch_events(job=Depends(_job)) -> AsyncIterable[ServerSentEvent]:  # noqa: ANN001
    seen = -1
    while True:
        if job.revision != seen:
            seen = job.revision
            yield ServerSentEvent(data=job.view(), event="progress")
        if job.status != "running":
            yield ServerSentEvent(data=job.view(), event="done")
            return
        await asyncio.sleep(0.25)


@app.post("/api/datasets/import", response_model=ImportResult, tags=["extensions"])
async def import_dataset(body: ImportRequest) -> ImportResult:
    dataset, dialogs = await fetch_group(body.group_id)
    imported, updated = store.upsert_dialogs(dialogs, dataset)
    return ImportResult(dataset=dataset, imported=imported, updated=updated)


@app.post("/api/dialogs/upload", response_model=ImportResult, tags=["extensions"])
async def upload_dialogs(file: UploadFile = File(...), dataset: str = Query("UPLOAD")) -> ImportResult:
    try:
        payload = json.loads((await file.read()).decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(400, "Файл должен быть JSON в формате API организаторов") from exc
    try:
        name, dialogs = parse_payload(payload, default_dataset=dataset)
    except DataSourceError as exc:
        raise HTTPException(400, str(exc)) from exc
    imported, updated = store.upsert_dialogs(dialogs, name)
    return ImportResult(dataset=name, imported=imported, updated=updated)


LOGO_NAMES = ("logo.svg", "logo.png", "logo.webp", "logo.jpg", "logo.jpeg")


def _logo_path():  # noqa: ANN202
    return next((p for n in LOGO_NAMES if (p := config.BRANDING_DIR / n).is_file()), None)


@app.get("/api/branding", tags=["extensions"])
def branding() -> dict:
    """Header logo, if a file was dropped into the branding/ folder."""
    p = _logo_path()
    return {"logo_url": f"/api/branding/logo?v={int(p.stat().st_mtime)}" if p else None}


@app.get("/api/branding/logo", response_class=FileResponse, tags=["extensions"])
def branding_logo() -> FileResponse:
    p = _logo_path()
    if p is None:
        raise HTTPException(404, "Логотип не задан")
    return FileResponse(p)


@app.get("/api/health", tags=["extensions"])
def health() -> dict:
    return {"ok": True, "dialogs": store.count_dialogs(), "default_provider": config.DEFAULT_PROVIDER}


# ------------------------------------------------------- built frontend

if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")
