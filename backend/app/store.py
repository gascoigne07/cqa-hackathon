"""SQLite storage via SQLAlchemy 2.0. Switching to Postgres = change CQA_DB_URL.

Rows keep their payload as JSON validated by Pydantic models. A stored score
keeps only its inputs (checklist snapshot, judgments, reviewer overrides); the
response is recomputed on read, so original vs. final can always be shown.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, create_engine, event, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from . import config
from .schemas import Checklist, ChecklistIn, Dialog, StoredAppeal, StoredScore


def now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(dt: datetime) -> datetime:
    """SQLite drops tzinfo; values are always written in UTC, so restore it."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


class Base(DeclarativeBase):
    pass


class DialogRow(Base):
    __tablename__ = "dialogs"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, index=True)
    dataset: Mapped[str] = mapped_column(String, index=True)
    data: Mapped[dict] = mapped_column(JSON)


class ChecklistRow(Base):
    __tablename__ = "checklists"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ScoreRow(Base):
    __tablename__ = "scores"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dialog_id: Mapped[str] = mapped_column(ForeignKey("dialogs.id"), index=True)
    data: Mapped[dict] = mapped_column(JSON)


class AppealRow(Base):
    __tablename__ = "appeals"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    score_id: Mapped[int] = mapped_column(ForeignKey("scores.id"), index=True)
    status: Mapped[str] = mapped_column(String, index=True)
    data: Mapped[dict] = mapped_column(JSON)


_sqlite = config.DB_URL.startswith("sqlite")
engine = create_engine(config.DB_URL, connect_args={"check_same_thread": False} if _sqlite else {})

if _sqlite:

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_conn, _):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


SessionLocal = sessionmaker(engine, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


def _dump(model) -> dict:  # noqa: ANN001
    return json.loads(model.model_dump_json())


# ------------------------------------------------------------------ dialogs


def upsert_dialogs(dialogs: list[Dialog], dataset: str) -> tuple[int, int]:
    imported = updated = 0
    with SessionLocal.begin() as s:
        seq = len(s.scalars(select(DialogRow.id)).all())
        for d in dialogs:
            row = s.get(DialogRow, d.conversation_id)
            if row is None:
                s.add(DialogRow(id=d.conversation_id, seq=seq, dataset=dataset, data=_dump(d)))
                seq += 1
                imported += 1
            else:
                row.data, row.dataset = _dump(d), dataset
                updated += 1
    return imported, updated


def list_dialogs() -> list[tuple[Dialog, str]]:
    with SessionLocal() as s:
        rows = s.scalars(select(DialogRow).order_by(DialogRow.seq)).all()
        return [(Dialog.model_validate(r.data), r.dataset) for r in rows]


def get_dialog(dialog_id: str) -> tuple[Dialog, str] | None:
    with SessionLocal() as s:
        r = s.get(DialogRow, dialog_id)
        return (Dialog.model_validate(r.data), r.dataset) if r else None


def count_dialogs() -> int:
    with SessionLocal() as s:
        return len(s.scalars(select(DialogRow.id)).all())


# --------------------------------------------------------------- checklists


def _to_checklist(r: ChecklistRow) -> Checklist:
    return Checklist(**r.data, id=r.id, created_at=_utc(r.created_at))


def create_checklist(body: ChecklistIn) -> Checklist:
    with SessionLocal.begin() as s:
        row = ChecklistRow(data=_dump(body))
        s.add(row)
        s.flush()
        return _to_checklist(row)


def list_checklists() -> list[Checklist]:
    with SessionLocal() as s:
        return [_to_checklist(r) for r in s.scalars(select(ChecklistRow).order_by(ChecklistRow.id.desc())).all()]


def get_checklist(checklist_id: int) -> Checklist | None:
    with SessionLocal() as s:
        r = s.get(ChecklistRow, checklist_id)
        return _to_checklist(r) if r else None


def latest_checklist() -> Checklist | None:
    with SessionLocal() as s:
        r = s.scalars(select(ChecklistRow).order_by(ChecklistRow.id.desc())).first()
        return _to_checklist(r) if r else None


# -------------------------------------------------------------------- scores


def create_score(sc: StoredScore) -> StoredScore:
    with SessionLocal.begin() as s:
        row = ScoreRow(dialog_id=sc.dialog_id, data={})
        s.add(row)
        s.flush()
        sc = sc.model_copy(update={"id": row.id})
        row.data = _dump(sc)
        return sc


def save_score(sc: StoredScore) -> None:
    with SessionLocal.begin() as s:
        s.get(ScoreRow, sc.id).data = _dump(sc)


def get_score(score_id: int) -> StoredScore | None:
    with SessionLocal() as s:
        r = s.get(ScoreRow, score_id)
        return StoredScore.model_validate(r.data) if r else None


def latest_score(dialog_id: str, provider: str | None = None) -> StoredScore | None:
    with SessionLocal() as s:
        rows = s.scalars(select(ScoreRow).where(ScoreRow.dialog_id == dialog_id).order_by(ScoreRow.id.desc())).all()
        for r in rows:
            sc = StoredScore.model_validate(r.data)
            if provider is None or sc.provider == provider:
                return sc
    return None


def latest_scores() -> dict[str, StoredScore]:
    with SessionLocal() as s:
        latest: dict[str, dict] = {}
        for r in s.scalars(select(ScoreRow).order_by(ScoreRow.id)).all():
            latest[r.dialog_id] = r.data
    return {d: StoredScore.model_validate(v) for d, v in latest.items()}


# ------------------------------------------------------------------- appeals


def create_appeal(a: StoredAppeal) -> StoredAppeal:
    with SessionLocal.begin() as s:
        row = AppealRow(score_id=a.score_id, status=a.status, data={})
        s.add(row)
        s.flush()
        a = a.model_copy(update={"id": row.id})
        row.data = _dump(a)
        return a


def save_appeal(a: StoredAppeal) -> None:
    with SessionLocal.begin() as s:
        row = s.get(AppealRow, a.id)
        row.data, row.status = _dump(a), a.status


def get_appeal(appeal_id: int) -> StoredAppeal | None:
    with SessionLocal() as s:
        r = s.get(AppealRow, appeal_id)
        return StoredAppeal.model_validate(r.data) if r else None


def list_appeals(status: str | None = None, score_id: int | None = None) -> list[StoredAppeal]:
    with SessionLocal() as s:
        q = select(AppealRow).order_by(AppealRow.id.desc())
        if status:
            q = q.where(AppealRow.status == status)
        if score_id is not None:
            q = q.where(AppealRow.score_id == score_id)
        return [StoredAppeal.model_validate(r.data) for r in s.scalars(q).all()]
