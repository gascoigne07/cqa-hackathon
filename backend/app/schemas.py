"""Data models, shaped to the team's API contract (see CONTRACT.md).

Fields marked "⊕" are extensions that fill gaps in the original contract; a
client written against the original contract can ignore them.

The scorer (LLM) only produces internal `Judgment` objects. Points, weights,
N/A redistribution, sections, gross error and rounding are computed
deterministically in `scoring.py`.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

# --------------------------------------------------------------------------
# Dialogs — organizers' raw format (input)
# --------------------------------------------------------------------------

Speaker = Literal["client", "operator", "bot", "system"]


class Message(BaseModel):
    timestamp: str
    speaker: Speaker
    text: str


class Dialog(BaseModel):
    conversation_id: str
    channel: str  # "agent chat" | "voice call"
    language: str  # "RU" | "KZ" | "EN"
    transcript: list[Message]
    audio_url: str | None = None


# --------------------------------------------------------------------------
# Dialogs — API output (contract)
# --------------------------------------------------------------------------


class Turn(BaseModel):
    idx: int
    timestamp: str
    speaker: Speaker
    text: str


class LastScore(BaseModel):  # ⊕
    score_id: int
    total: float | None
    original_total: float | None
    gross_error: bool
    needs_review: bool
    open_appeals: int
    checklist_id: int
    provider: str
    created_at: datetime


class DialogListItem(BaseModel):
    conversation_id: str
    channel: str
    language: str
    turns: int
    preview: str
    dataset: str = "DEV"  # ⊕
    has_audio: bool = False  # ⊕
    last_score: LastScore | None = None  # ⊕


class DialogOut(BaseModel):
    conversation_id: str
    channel: str
    language: str
    audio_url: str | None = Field(None, description="Playable MP3 served by this backend (not the organizers' player page)")
    audio_source_url: str | None = None  # ⊕ organizers' original player page
    transcript: list[Turn]


# --------------------------------------------------------------------------
# Checklist (contract)
# --------------------------------------------------------------------------

CriterionType = Literal["yes_no", "yes_no_na", "scale"]


class ScaleStep(BaseModel):
    value: float
    label: str = ""


class Criterion(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    order: int = 0
    section: str | None = None
    name: str = Field(min_length=1)
    type: CriterionType = "yes_no"
    weight: float = Field(ge=0, description="0 = no points (e.g. the gross-errors flag)")
    na_allowed: bool = False
    scale_max: float | None = None
    scale: list[ScaleStep] = []
    guidance: str = ""
    gross_error_if: Literal["yes", "no"] | None = Field(
        None, description='⊕ Verdict that means a gross error: "yes" (e.g. «Грубые ошибки — Да»), "no" (failed critical criterion) or null'
    )

    @model_validator(mode="before")
    @classmethod
    def _legacy_critical(cls, data):  # noqa: ANN001, ANN206 - accept the older `critical: true`
        if isinstance(data, dict) and data.get("critical") and not data.get("gross_error_if"):
            data = {**data, "gross_error_if": "no"}
        return data

    @model_validator(mode="after")
    def _check(self) -> "Criterion":
        if self.type == "yes_no_na":
            self.na_allowed = True
        if self.type == "scale":
            if self.scale_max is None and self.scale:
                self.scale_max = max(s.value for s in self.scale)
            if self.scale_max is None:
                raise ValueError(f"критерий {self.id}: для шкалы нужен scale_max")
            if self.scale_max <= self.scale_min:
                raise ValueError(f"критерий {self.id}: scale_max должен быть больше минимума шкалы")
            if any(not (self.scale_min <= s.value <= self.scale_max) for s in self.scale):
                raise ValueError(f"критерий {self.id}: ступени шкалы должны быть в пределах шкалы")
        else:
            self.scale_max, self.scale = None, []
        return self

    @property
    def is_binary(self) -> bool:
        return self.type in ("yes_no", "yes_no_na")

    @property
    def scale_min(self) -> float:
        """Lowest step value; 0 when no steps are defined."""
        return min((s.value for s in self.scale), default=0.0)

    def step_label(self, value: float | None) -> str | None:
        if value is None:
            return None
        for s in self.scale:
            if abs(s.value - value) < 1e-9:
                return s.label or None
        return None

    def judging_hash(self) -> str:
        """Hash of what the model is asked. Weight/section/order/critical only affect scoring."""
        payload = self.model_dump(include={"name", "guidance", "type", "scale_max", "scale", "na_allowed", "gross_error_if"})
        return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]


Channel = Literal["chat", "call", "all"]


class ChecklistIn(BaseModel):
    name: str = "Чек-лист"
    rounding: int = Field(2, ge=0, le=4, description="Decimal places of the total (ROUND_HALF_UP)")
    criteria: list[Criterion] = Field(min_length=1)
    channel: Channel = Field("all", description="⊕ Which dialogs it applies to: chat, call or all")
    instructions: str = Field("", description="⊕ General rules sent to the model with every criterion")
    gross_error_policy: Literal["flag", "zero_total"] = "flag"  # ⊕
    note: str = ""  # ⊕
    seed_key: str = ""  # ⊕ marks built-in checklists

    @model_validator(mode="after")
    def _normalize(self) -> "ChecklistIn":
        ids = [c.id for c in self.criteria]
        if len(ids) != len(set(ids)):
            raise ValueError("id критериев должны быть уникальны")
        if not any(c.weight > 0 for c in self.criteria):
            raise ValueError("хотя бы у одного критерия вес должен быть больше 0")
        self.criteria = sorted(self.criteria, key=lambda c: c.order)
        for i, c in enumerate(self.criteria, start=1):
            c.order = i
        return self


class Checklist(ChecklistIn):
    id: int
    created_at: datetime  # ⊕


class ChecklistListItem(BaseModel):
    id: int
    name: str
    criteria_count: int
    created_at: datetime
    channel: Channel = "all"  # ⊕


# --------------------------------------------------------------------------
# Judge output (internal — never sent as-is)
# --------------------------------------------------------------------------


class JudgeEvidence(BaseModel):
    message_index: int
    quote: str = ""


class Judgment(BaseModel):
    criterion_id: str
    status: Literal["answered", "na", "uncertain"]
    answer: bool | None = None  # yes_no / yes_no_na
    value: float | None = None  # scale
    evidence: list[JudgeEvidence] = []
    checked_range: list[int] | None = Field(None, description="[first, last] turn idx checked when the action was missing")
    explanation: str = ""
    na_reason: str = ""
    confidence: float | None = Field(None, ge=0, le=1)


# --------------------------------------------------------------------------
# Score response (contract)
# --------------------------------------------------------------------------


class Evidence(BaseModel):
    turn_idx: int
    timestamp: str
    quote: str


class ResultSnapshot(BaseModel):  # ⊕ the original (pre-appeal) value of a changed criterion
    applicable: bool
    verdict: str | None
    raw_score: float | None
    points: float | None
    explanation: str


class ReviewOut(BaseModel):  # ⊕
    decision: Literal["confirm", "change"]
    new_verdict: str | None
    new_score: float | None
    reason: str
    reviewer: str
    decided_at: datetime
    total_before: float | None
    total_after: float | None


class AppealBrief(BaseModel):  # ⊕
    appeal_id: int
    status: Literal["open", "resolved"]
    comment: str
    author: str
    created_at: datetime
    review: ReviewOut | None = None


class CriterionResult(BaseModel):
    criterion_id: str
    applicable: bool
    na_reason: str | None
    verdict: str | None = Field(description='"yes" | "no" | "na" | "uncertain" | scale step label | number')
    raw_score: float | None
    scale_max: float | None
    points: float | None
    effective_weight: float | None = Field(description="Share of the total after N/A redistribution, %")
    explanation: str
    evidence: Evidence | None
    # ⊕ extensions
    name: str = ""
    section: str | None = None
    type: CriterionType = "yes_no"
    weight: float = 0
    gross_error_if: Literal["yes", "no"] | None = None
    na_allowed: bool = False
    scale: list[ScaleStep] = []
    gross_error: bool = False
    needs_review: bool = False
    checked_range: list[int] | None = None
    evidence_all: list[Evidence] = []
    issues: list[str] = []
    confidence: float | None = None
    overridden: bool = False
    original: ResultSnapshot | None = None
    appeal: AppealBrief | None = None


class SectionResult(BaseModel):
    name: str
    points: float
    max: float


class RunInfo(BaseModel):  # ⊕ proof of live analysis
    model: str
    started_at: datetime
    duration_ms: int
    calls: int
    reused: int = 0
    judged: int = 0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class TraceEntry(BaseModel):  # ⊕ one model call: exact prompt and raw answer
    provider: str
    model: str
    criteria: list[str] = []
    system: str = ""
    user: str = ""
    raw: str = ""
    duration_ms: int = 0
    usage: dict = {}
    note: str = ""


class ScoreResponse(BaseModel):
    dialog_id: str
    provider: str
    total: float | None
    gross_error: bool
    sections: list[SectionResult]
    results: list[CriterionResult]
    # ⊕ extensions
    score_id: int = 0
    checklist_id: int = 0
    created_at: datetime | None = None
    original_total: float | None = None
    needs_review: bool = False
    run: RunInfo | None = None


# --------------------------------------------------------------------------
# Stored score (internal): inputs only — outputs are recomputed on read
# --------------------------------------------------------------------------


class StoredScore(BaseModel):
    id: int
    dialog_id: str
    checklist_id: int
    checklist: ChecklistIn  # snapshot used for this score
    provider: str
    created_at: datetime
    judgments: dict[str, Judgment]
    issues: dict[str, list[str]] = {}
    overrides: dict[str, Judgment] = {}
    stats: dict[str, int] = {}
    run: RunInfo | None = None
    trace: list[TraceEntry] = []


class StoredAppeal(BaseModel):
    id: int
    score_id: int
    dialog_id: str
    criterion_id: str
    criterion_name: str
    comment: str
    author: str
    status: Literal["open", "resolved"]
    created_at: datetime
    review: ReviewOut | None = None


# --------------------------------------------------------------------------
# Requests
# --------------------------------------------------------------------------


class ScoreRequest(BaseModel):
    dialog_id: str
    checklist_id: int | None = None  # None = newest checklist
    provider: str | None = None  # None = default provider


class BatchRequest(BaseModel):  # ⊕
    dialog_ids: list[str] | None = None
    checklist_id: int | None = None
    provider: str | None = None
    reuse_unchanged: bool = Field(False, description="Reuse judgments of criteria unchanged since the dialog's last score")


class BatchJob(BaseModel):  # ⊕
    job_id: str
    status: Literal["running", "done", "failed"]
    total: int
    done: int
    reused: int
    judged: int
    errors: list[str]
    checklist_id: int | None  # None = picked per dialog by channel
    provider: str


class AppealCreate(BaseModel):
    dialog_id: str
    criterion_id: str
    comment: str = Field(min_length=1)
    author: str = "Оператор"  # ⊕
    score_id: int | None = None  # ⊕ default: the dialog's latest score


class AppealCreated(BaseModel):
    appeal_id: int


class AppealListItem(BaseModel):  # ⊕
    appeal_id: int
    score_id: int
    dialog_id: str
    criterion_id: str
    criterion_name: str
    comment: str
    author: str
    status: Literal["open", "resolved"]
    created_at: datetime
    review: ReviewOut | None = None


class AppealDetail(BaseModel):  # ⊕
    appeal: AppealListItem
    result: CriterionResult  # the disputed (original) result
    fragment: list[Turn]
    evidence_idx: list[int]
    total: float | None
    original_total: float | None


class ReviewCreate(BaseModel):
    appeal_id: int
    decision: Literal["confirm", "change"]
    new_verdict: Literal["yes", "no", "na"] | None = None
    new_score: float | None = None
    reason: str = Field(min_length=1)
    reviewer: str = "Проверяющий"  # ⊕


class ReviewResult(BaseModel):
    result: ScoreResponse


class ProviderInfo(BaseModel):  # ⊕
    id: str
    name: str
    kind: Literal["cloud", "local", "demo"]
    available: bool
    note: str = ""
    optional: bool = False  # hide in the UI unless available
    model: str = ""


class ImportRequest(BaseModel):  # ⊕
    group_id: str = "DEV"


class ImportResult(BaseModel):  # ⊕
    dataset: str
    imported: int
    updated: int
