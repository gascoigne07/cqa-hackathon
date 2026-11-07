"""Deterministic scoring. No LLM in here — judges can check this arithmetic.

Rules
-----
* Each criterion is normalized to s in [0, 1]:
    yes_no / yes_no_na -> yes = 1, no = 0
    scale              -> (raw - scale_min) / (scale_max - scale_min)
                          scale_min = lowest step value (0 if no steps)
* N/A (applicable = false) and "uncertain" criteria are excluded; their weight
  is redistributed over the applicable ones:
      effective_weight_i = 100 * w_i / Σ w_applicable        (percent)
      points_i           = effective_weight_i * s_i
      total              = Σ points_i                        (0..100)
* Sections: points = Σ points_i, max = Σ effective_weight_i inside the section.
* Criteria with weight 0 give no points (e.g. «Грубые ошибки — без баллов»);
  they are judged and shown, but never enter the total.
* Scale answers must be one of the defined steps; other values are snapped to
  the nearest step (and flagged).
* Gross error: a criterion whose verdict equals its `gross_error_if`
  ("yes" — e.g. violation found; "no" — a failed critical criterion).
  Flagged separately; with gross_error_policy == "zero_total" the total is 0.
* If no criterion with weight > 0 is applicable, the total is not calculated.
* Rounding: ROUND_HALF_UP; the total to `checklist.rounding` decimals,
  points/weights to 2 decimals.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from .schemas import ChecklistIn, Criterion, CriterionResult, Dialog, Evidence, Judgment, SectionResult


def round_half_up(x: float, decimals: int) -> float:
    return float(Decimal(str(x)).quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP))


def normalize(c: Criterion, j: Judgment) -> float | None:
    if j.status != "answered":
        return None
    if c.is_binary:
        return None if j.answer is None else (1.0 if j.answer else 0.0)
    if j.value is None:
        return None
    lo, hi = c.scale_min, float(c.scale_max)
    v = min(max(j.value, lo), hi)
    return (v - lo) / (hi - lo)


def verdict_of(c: Criterion, j: Judgment) -> str | None:
    if j.status == "na":
        return "na"
    if j.status == "uncertain":
        return "uncertain"
    if c.is_binary:
        return None if j.answer is None else ("yes" if j.answer else "no")
    if j.value is None:
        return None
    label = c.step_label(j.value)
    return label or (str(int(j.value)) if float(j.value).is_integer() else str(j.value))


def raw_of(c: Criterion, j: Judgment) -> float | None:
    if j.status != "answered":
        return None
    if c.is_binary:
        return None if j.answer is None else (1.0 if j.answer else 0.0)
    return j.value


def _coerce(c: Criterion, j: Judgment) -> tuple[Judgment, list[str]]:
    """Judgments that break checklist rules go to human review."""
    issues: list[str] = []
    if j.status == "answered" and not c.is_binary and j.value is not None and c.scale:
        steps = [st.value for st in c.scale]
        if j.value not in steps:
            nearest = min(steps, key=lambda v: (abs(v - j.value), -v))
            issues.append(f"Балл {j.value:g} не является ступенью шкалы — приведён к {nearest:g}")
            j = j.model_copy(update={"value": nearest})
    if j.status == "na" and not c.na_allowed:
        issues.append("Оценщик вернул N/A, но для критерия N/A запрещён — требуется проверка")
        j = j.model_copy(update={"status": "uncertain"})
    if j.status == "answered" and normalize(c, j) is None:
        issues.append("Ответ не соответствует типу критерия — требуется проверка")
        j = j.model_copy(update={"status": "uncertain"})
    return j, issues


@dataclass
class Computed:
    results: list[CriterionResult]
    total: float | None
    sections: list[SectionResult]
    gross_error: bool
    needs_review: bool


def compute(
    checklist: ChecklistIn,
    judgments: dict[str, Judgment],
    dialog: Dialog,
    issues: dict[str, list[str]] | None = None,
    overridden: set[str] | None = None,
) -> Computed:
    issues = issues or {}
    overridden = overridden or set()
    turns = dialog.transcript

    rows: list[tuple[Criterion, Judgment, float | None, list[str]]] = []
    for c in checklist.criteria:
        j = judgments.get(c.id) or Judgment(criterion_id=c.id, status="uncertain", explanation="Нет оценки по этому критерию")
        j, extra = _coerce(c, j)
        rows.append((c, j, normalize(c, j), extra + list(issues.get(c.id, []))))

    def counts(c: Criterion, s: float | None) -> bool:
        return s is not None and c.weight > 0

    def is_gross(c: Criterion, j: Judgment, s: float | None) -> bool:
        if c.gross_error_if is None or j.status != "answered" or s is None:
            return False
        return s == 1.0 if c.gross_error_if == "yes" else s == 0.0

    applicable_weight = sum(c.weight for c, _, s, _ in rows if counts(c, s))

    def evidence(j: Judgment) -> list[Evidence]:
        out = []
        for ev in j.evidence:
            if 0 <= ev.message_index < len(turns):
                out.append(Evidence(turn_idx=ev.message_index, timestamp=turns[ev.message_index].timestamp,
                                    quote=ev.quote or turns[ev.message_index].text[:120]))
        return out

    results: list[CriterionResult] = []
    for c, j, s, iss in rows:
        eff = (100.0 * c.weight / applicable_weight) if (counts(c, s) and applicable_weight > 0) else None
        evs = evidence(j)
        results.append(
            CriterionResult(
                criterion_id=c.id,
                applicable=j.status != "na",
                na_reason=(j.na_reason or "Критерий не применим") if j.status == "na" else None,
                verdict=verdict_of(c, j),
                raw_score=raw_of(c, j),
                scale_max=c.scale_max,
                points=None if eff is None else round_half_up(eff * s, 2),
                effective_weight=None if eff is None else round_half_up(eff, 2),
                explanation=j.explanation,
                evidence=evs[0] if evs else None,
                name=c.name,
                section=c.section,
                type=c.type,
                weight=c.weight,
                gross_error_if=c.gross_error_if,
                na_allowed=c.na_allowed,
                scale=c.scale,
                gross_error=is_gross(c, j, s),
                needs_review=j.status == "uncertain" or bool(iss),
                checked_range=j.checked_range,
                evidence_all=evs,
                issues=iss,
                confidence=j.confidence,
                overridden=c.id in overridden,
            )
        )

    total: float | None = None
    if applicable_weight > 0:
        total = round_half_up(sum(100.0 * c.weight * s / applicable_weight for c, _, s, _ in rows if counts(c, s)),
                              checklist.rounding)
    gross_error = any(r.gross_error for r in results)
    if gross_error and checklist.gross_error_policy == "zero_total" and total is not None:
        total = round_half_up(0.0, checklist.rounding)

    sections: list[SectionResult] = []
    for name in dict.fromkeys(c.section for c in checklist.criteria if c.section and c.weight > 0):
        inside = [r for r in results if r.section == name]
        sections.append(
            SectionResult(
                name=name,
                points=round_half_up(sum(r.points or 0 for r in inside), 2),
                max=round_half_up(sum(r.effective_weight or 0 for r in inside), 2),
            )
        )

    return Computed(
        results=results,
        total=total,
        sections=sections,
        gross_error=gross_error,
        needs_review=any(r.needs_review for r in results),
    )
