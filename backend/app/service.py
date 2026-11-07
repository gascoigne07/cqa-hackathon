"""Business logic: live scoring, batch jobs, appeals and reviews."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from . import config, evidence, scoring, store
from .datasource import parse_payload
from .schemas import (
    AppealBrief,
    AppealCreate,
    AppealDetail,
    AppealListItem,
    BatchJob,
    Checklist,
    ChecklistIn,
    Criterion,
    Dialog,
    DialogListItem,
    Judgment,
    LastScore,
    RunInfo,
    TraceEntry,
    ResultSnapshot,
    ReviewCreate,
    ReviewOut,
    ScoreResponse,
    StoredAppeal,
    StoredScore,
    Turn,
)
from .scorers import ProviderUnavailable, Scorer, get_provider

log = logging.getLogger("cqa")


class NotFound(LookupError):
    pass


class BadRequest(ValueError):
    pass


# ---------------------------------------------------------------- bootstrap


BUILTIN_CHECKLISTS = ("chat.json", "call.json")


def bootstrap() -> None:
    store.init_db()
    present = {c.seed_key for c in store.list_checklists() if c.seed_key}
    for name in BUILTIN_CHECKLISTS:
        body = ChecklistIn.model_validate(json.loads((Path(__file__).parent / "checklists" / name).read_text(encoding="utf-8")))
        if body.seed_key not in present:
            store.create_checklist(body)
            log.info("Added built-in checklist %s", body.seed_key)
    if store.count_dialogs() == 0 and config.SEED_FILE.exists():
        dataset, dialogs = parse_payload(json.loads(config.SEED_FILE.read_text(encoding="utf-8")), default_dataset="DEV")
        store.upsert_dialogs(dialogs, dataset)
        log.info("Seeded %d dialogs from %s", len(dialogs), config.SEED_FILE)


def channel_of(d: Dialog) -> str:
    return "call" if d.channel.lower().startswith("voice") else "chat"


def resolve_checklist(checklist_id: int | None, dialog: Dialog | None = None) -> Checklist:
    """Explicit id, else the newest checklist for the dialog's channel, else the newest for "all"."""
    if checklist_id:
        cl = store.get_checklist(checklist_id)
        if cl is None:
            raise NotFound("Чек-лист не найден")
        return cl
    lists = store.list_checklists()  # newest first
    if dialog is not None:
        ch = channel_of(dialog)
        cl = next((c for c in lists if c.channel == ch), None) or next((c for c in lists if c.channel == "all"), None)
    else:
        cl = lists[0] if lists else None
    if cl is None:
        raise NotFound("Нет подходящего чек-листа")
    return cl


def body_of(cl: Checklist) -> ChecklistIn:
    return ChecklistIn.model_validate(cl.model_dump(include=set(ChecklistIn.model_fields)))


def require_dialog(dialog_id: str) -> Dialog:
    found = store.get_dialog(dialog_id)
    if found is None:
        raise NotFound(f"Диалог {dialog_id} не найден")
    return found[0]


# ------------------------------------------------------------------ dialogs


def preview_of(d: Dialog, limit: int = 140) -> str:
    """First meaningful client turn (skips IVR key presses like "2" and one-word turns)."""
    client = [" ".join(m.text.split()) for m in d.transcript if m.speaker == "client"]
    first = (
        next((t for t in client if len(t.split()) >= 4), None)
        or next((t for t in client if len(t.split()) >= 2), None)
        or next((" ".join(m.text.split()) for m in d.transcript if m.speaker == "operator"), None)
        or (client[0] if client else "")
    )
    return first if len(first) <= limit else first[: limit - 1].rstrip() + "…"


def turns_of(d: Dialog) -> list[Turn]:
    return [Turn(idx=i, timestamp=m.timestamp, speaker=m.speaker, text=m.text) for i, m in enumerate(d.transcript)]


def last_score_of(sc: StoredScore, dialog: Dialog) -> LastScore:
    final, original = compute_pair(sc, dialog)
    appeals = store.list_appeals(score_id=sc.id)
    return LastScore(
        score_id=sc.id,
        total=final.total,
        original_total=original.total,
        gross_error=final.gross_error,
        needs_review=final.needs_review,
        open_appeals=sum(a.status == "open" for a in appeals),
        checklist_id=sc.checklist_id,
        provider=sc.provider,
        created_at=sc.created_at,
    )


def list_dialogs() -> list[DialogListItem]:
    latest = store.latest_scores()
    out = []
    for d, dataset in store.list_dialogs():
        sc = latest.get(d.conversation_id)
        out.append(
            DialogListItem(
                conversation_id=d.conversation_id,
                channel=d.channel,
                language=d.language,
                turns=len(d.transcript),
                preview=preview_of(d),
                dataset=dataset,
                has_audio=bool(d.audio_url),
                last_score=last_score_of(sc, d) if sc else None,
            )
        )
    return out


# ------------------------------------------------------------------ scoring


async def _judge_validated(scorer: Scorer, dialog: Dialog, criteria: list[Criterion], instructions: str = "",
                           trace: list[dict] | None = None) -> tuple[dict[str, Judgment], dict[str, list[str]]]:
    """Ask the provider, validate citations, re-ask once for criteria with bad citations."""
    judgments: dict[str, Judgment] = {}
    issues: dict[str, list[str]] = {}
    by_id = {c.id: c for c in criteria}
    retry: list[Criterion] = []
    for j in await scorer.judge(dialog, criteria, instructions, trace):
        if j.criterion_id not in by_id:
            continue
        clean, problems = evidence.validate(dialog, j)
        judgments[j.criterion_id] = clean
        if problems:
            retry.append(by_id[j.criterion_id])
            issues[j.criterion_id] = problems
    if retry:
        for j in await scorer.judge(dialog, retry, instructions, trace):
            clean, problems = evidence.validate(dialog, j)
            if problems:
                judgments[j.criterion_id] = clean.model_copy(
                    update={"status": "uncertain", "explanation": clean.explanation + " (Ссылки на реплики не прошли проверку.)"}
                )
                issues[j.criterion_id] = problems
            else:
                judgments[j.criterion_id] = clean
                issues.pop(j.criterion_id, None)
    for c in criteria:
        judgments.setdefault(c.id, Judgment(criterion_id=c.id, status="uncertain", explanation="Оценщик не вернул результат"))
    return judgments, issues


def _reusable(dialog_id: str, provider: str, cl: Checklist) -> dict[str, Judgment]:
    """Judgments from the dialog's previous score for criteria whose wording (and general rules) did not change."""
    criteria = cl.criteria
    prev = store.latest_score(dialog_id, provider)
    if prev is None or prev.checklist.instructions != cl.instructions:
        return {}
    by_hash = {
        c.judging_hash(): prev.judgments[c.id]
        for c in prev.checklist.criteria
        if c.id in prev.judgments and c.id not in prev.issues
    }
    return {c.id: by_hash[c.judging_hash()].model_copy(update={"criterion_id": c.id}) for c in criteria if c.judging_hash() in by_hash}


async def score(dialog_id: str, checklist_id: int | None, provider: str | None, reuse_unchanged: bool = False) -> StoredScore:
    dialog = require_dialog(dialog_id)
    cl = resolve_checklist(checklist_id, dialog)
    scorer = get_provider(provider)
    ok, note = scorer.available()
    if not ok:
        raise ProviderUnavailable(f"{scorer.name}: {note}")

    judgments = _reusable(dialog_id, scorer.id, cl) if reuse_unchanged else {}
    missing = [c for c in cl.criteria if c.id not in judgments]
    issues: dict[str, list[str]] = {}
    trace: list[dict] = []
    started_at = store.now()
    t0 = time.perf_counter()
    if missing:
        fresh, issues = await _judge_validated(scorer, dialog, missing, cl.instructions, trace)
        judgments.update(fresh)

    def tokens(key: str) -> int | None:
        vals = [t.get("usage", {}).get(key) for t in trace]
        vals = [v for v in vals if isinstance(v, int)]
        return sum(vals) if vals else None

    run = RunInfo(
        model=next((t["model"] for t in trace if t.get("model")), scorer.model_name()) or scorer.id,
        started_at=started_at,
        duration_ms=int((time.perf_counter() - t0) * 1000),
        calls=len(trace),
        reused=len(cl.criteria) - len(missing),
        judged=len(missing),
        prompt_tokens=tokens("prompt_tokens"),
        completion_tokens=tokens("completion_tokens"),
    )

    return store.create_score(
        StoredScore(
            id=0,
            dialog_id=dialog_id,
            checklist_id=cl.id,
            checklist=body_of(cl),
            provider=scorer.id,
            created_at=store.now(),
            judgments=judgments,
            issues=issues,
            stats={"reused": len(cl.criteria) - len(missing), "judged": len(missing)},
            run=run,
            trace=[TraceEntry.model_validate(t) for t in trace],
        )
    )


def compute_pair(sc: StoredScore, dialog: Dialog) -> tuple[scoring.Computed, scoring.Computed]:
    """(final with reviewer overrides, original as scored)."""
    original = scoring.compute(sc.checklist, sc.judgments, dialog, sc.issues)
    if not sc.overrides:
        return original, original
    issues = {k: v for k, v in sc.issues.items() if k not in sc.overrides}
    final = scoring.compute(sc.checklist, sc.judgments | sc.overrides, dialog, issues, overridden=set(sc.overrides))
    return final, original


def _brief(a: StoredAppeal) -> AppealBrief:
    return AppealBrief(appeal_id=a.id, status=a.status, comment=a.comment, author=a.author, created_at=a.created_at, review=a.review)


def to_response(sc: StoredScore, dialog: Dialog | None = None) -> ScoreResponse:
    dialog = dialog or require_dialog(sc.dialog_id)
    final, original = compute_pair(sc, dialog)
    orig_by_id = {r.criterion_id: r for r in original.results}
    appeals = store.list_appeals(score_id=sc.id)  # newest first
    results = []
    for r in final.results:
        update: dict = {}
        if r.overridden:
            o = orig_by_id[r.criterion_id]
            update["original"] = ResultSnapshot(applicable=o.applicable, verdict=o.verdict, raw_score=o.raw_score,
                                                points=o.points, explanation=o.explanation)
        mine = [a for a in appeals if a.criterion_id == r.criterion_id]
        if mine:
            current = next((a for a in mine if a.status == "open"), mine[0])
            update["appeal"] = _brief(current)
        results.append(r.model_copy(update=update) if update else r)
    return ScoreResponse(
        dialog_id=sc.dialog_id,
        provider=sc.provider,
        total=final.total,
        gross_error=final.gross_error,
        sections=final.sections,
        results=results,
        score_id=sc.id,
        checklist_id=sc.checklist_id,
        created_at=sc.created_at,
        original_total=original.total,
        needs_review=final.needs_review,
        run=sc.run,
    )


def score_trace(score_id: int) -> list[TraceEntry]:
    sc = store.get_score(score_id)
    if sc is None:
        raise NotFound("Оценка не найдена")
    return sc.trace


def latest_response(dialog_id: str) -> ScoreResponse:
    dialog = require_dialog(dialog_id)
    sc = store.latest_score(dialog_id)
    if sc is None:
        raise NotFound("Диалог ещё не оценён")
    return to_response(sc, dialog)


# -------------------------------------------------------------------- batch


@dataclass
class _Job:
    job_id: str
    total: int
    checklist_id: int | None
    provider: str
    done: int = 0
    reused: int = 0
    judged: int = 0
    errors: list[str] = field(default_factory=list)
    status: str = "running"
    revision: int = 0

    def view(self) -> BatchJob:
        return BatchJob(job_id=self.job_id, status=self.status, total=self.total, done=self.done,  # type: ignore[arg-type]
                        reused=self.reused, judged=self.judged, errors=self.errors[-20:],
                        checklist_id=self.checklist_id, provider=self.provider)


JOBS: dict[str, _Job] = {}


def start_batch(dialog_ids: list[str] | None, checklist_id: int | None, provider: str | None, reuse_unchanged: bool) -> BatchJob:
    """checklist_id=None: each dialog gets the newest checklist for its channel."""
    if checklist_id:
        resolve_checklist(checklist_id)  # 404 early
    scorer = get_provider(provider)
    ok, note = scorer.available()
    if not ok:
        raise ProviderUnavailable(f"{scorer.name}: {note}")
    ids = dialog_ids or [d.conversation_id for d, _ in store.list_dialogs()]
    job = _Job(job_id=uuid.uuid4().hex[:12], total=len(ids), checklist_id=checklist_id, provider=scorer.id)
    JOBS[job.job_id] = job

    async def run() -> None:
        sem = asyncio.Semaphore(config.CONCURRENCY)

        async def one(did: str) -> None:
            async with sem:
                try:
                    sc = await score(did, checklist_id, scorer.id, reuse_unchanged)
                    job.reused += sc.stats.get("reused", 0)
                    job.judged += sc.stats.get("judged", 0)
                except Exception as exc:  # noqa: BLE001 - one dialog must not stop the batch
                    log.exception("scoring failed for %s", did)
                    job.errors.append(f"{did}: {exc}")
                finally:
                    job.done += 1
                    job.revision += 1

        await asyncio.gather(*(one(d) for d in ids))
        job.status = "failed" if job.total and len(job.errors) == job.total else "done"
        job.revision += 1

    asyncio.get_running_loop().create_task(run())
    return job.view()


def get_job(job_id: str) -> _Job:
    job = JOBS.get(job_id)
    if job is None:
        raise NotFound("Задача не найдена")
    return job


# ------------------------------------------------------------------ appeals


def _list_item(a: StoredAppeal) -> AppealListItem:
    return AppealListItem(appeal_id=a.id, score_id=a.score_id, dialog_id=a.dialog_id, criterion_id=a.criterion_id,
                          criterion_name=a.criterion_name, comment=a.comment, author=a.author, status=a.status,
                          created_at=a.created_at, review=a.review)


def create_appeal(body: AppealCreate) -> int:
    sc = store.get_score(body.score_id) if body.score_id else store.latest_score(body.dialog_id)
    if sc is None or sc.dialog_id != body.dialog_id:
        raise BadRequest("У диалога нет оценки — сначала оцените его")
    c = next((c for c in sc.checklist.criteria if c.id == body.criterion_id), None)
    if c is None:
        raise BadRequest("Критерий не найден в этой оценке")
    if any(a.criterion_id == c.id and a.status == "open" for a in store.list_appeals(score_id=sc.id)):
        raise BadRequest("По этому критерию уже есть открытая апелляция")
    a = store.create_appeal(StoredAppeal(id=0, score_id=sc.id, dialog_id=sc.dialog_id, criterion_id=c.id,
                                         criterion_name=c.name, comment=body.comment, author=body.author,
                                         status="open", created_at=store.now()))
    return a.id


def list_appeals(status: str | None) -> list[AppealListItem]:
    return [_list_item(a) for a in store.list_appeals(status)]


def appeal_detail(appeal_id: int) -> AppealDetail:
    a = store.get_appeal(appeal_id)
    if a is None:
        raise NotFound("Апелляция не найдена")
    sc = store.get_score(a.score_id)
    if sc is None:
        raise NotFound("Оценка не найдена")
    dialog = require_dialog(a.dialog_id)
    final, original = compute_pair(sc, dialog)
    # a resolved appeal shows the post-decision criterion (matches the recalculated total shown next to it);
    # an open appeal shows the original disputed result
    source = final if a.status != "open" else original
    disputed = next(r for r in source.results if r.criterion_id == a.criterion_id)

    n = len(dialog.transcript)
    ev_idx = [e.turn_idx for e in disputed.evidence_all]
    keep: set[int] = set()
    for i in ev_idx:
        keep.update(range(max(0, i - 2), min(n, i + 3)))
    if disputed.checked_range:
        lo, hi = disputed.checked_range
        keep.update(range(lo, min(hi + 1, lo + 12)))
    if not keep:
        op = [i for i, m in enumerate(dialog.transcript) if m.speaker == "operator"]
        start = op[0] if op else 0
        keep.update(range(start, min(n, start + 8)))
    turns = turns_of(dialog)
    return AppealDetail(appeal=_list_item(a), result=disputed, fragment=[turns[i] for i in sorted(keep)],
                        evidence_idx=ev_idx, total=final.total, original_total=original.total)


def _override(c: Criterion, original: Judgment, body: ReviewCreate) -> Judgment:
    base = {"explanation": f"Решение проверяющего: {body.reason}", "confidence": 1.0, "na_reason": ""}
    if body.new_verdict == "na":
        if not c.na_allowed:
            raise BadRequest("Для этого критерия N/A не разрешён")
        return original.model_copy(update=base | {"status": "na", "na_reason": body.reason, "answer": None, "value": None})
    if c.is_binary:
        verdict = body.new_verdict
        if verdict is None and body.new_score in (0, 1):
            verdict = "yes" if body.new_score == 1 else "no"
        if verdict not in ("yes", "no"):
            raise BadRequest("Укажите новый вердикт: yes или no")
        return original.model_copy(update=base | {"status": "answered", "answer": verdict == "yes", "value": None})
    if body.new_score is None or not (c.scale_min <= body.new_score <= c.scale_max):
        raise BadRequest(f"Укажите новый балл от {c.scale_min:g} до {c.scale_max:g}")
    return original.model_copy(update=base | {"status": "answered", "value": body.new_score, "answer": None})


def review(body: ReviewCreate) -> ScoreResponse:
    a = store.get_appeal(body.appeal_id)
    if a is None:
        raise NotFound("Апелляция не найдена")
    if a.status != "open":
        raise BadRequest("Апелляция уже рассмотрена")
    sc = store.get_score(a.score_id)
    if sc is None:
        raise NotFound("Оценка не найдена")
    dialog = require_dialog(a.dialog_id)
    c = next(c for c in sc.checklist.criteria if c.id == a.criterion_id)
    total_before = compute_pair(sc, dialog)[0].total

    if body.decision == "change":
        sc = sc.model_copy(update={"overrides": sc.overrides | {c.id: _override(c, sc.judgments[c.id], body)}})
        store.save_score(sc)
    total_after = compute_pair(sc, dialog)[0].total

    a = a.model_copy(update={
        "status": "resolved",
        "review": ReviewOut(decision=body.decision, new_verdict=body.new_verdict, new_score=body.new_score,
                            reason=body.reason, reviewer=body.reviewer, decided_at=store.now(),
                            total_before=total_before, total_after=total_after),
    })
    store.save_appeal(a)
    return to_response(sc, dialog)
