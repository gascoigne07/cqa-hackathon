"""The one interface a provider implements.

A scorer receives a dialog and the criteria to judge, and returns one
`Judgment` per criterion. It must NOT compute points, weights or totals —
`scoring.py` does that deterministically.

Contract
--------
* Cite evidence by turn index (`idx`, 0-based) with a short verbatim quote.
  Invalid citations are rejected by `evidence.validate`; the criterion is
  re-asked once, then marked "uncertain".
* When an expected action is missing, return answer=False and
  `checked_range=[first_idx, last_idx]` — the part of the dialog checked.
* status="na" (with `na_reason`) only if the criterion allows N/A.
* Judge the OPERATOR. Bot and system turns are context only.
* Do not pass operator identity or history to the model (it biases verdicts).
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..schemas import Criterion, Dialog, Judgment


class ProviderUnavailable(RuntimeError):
    """The provider is not configured (UI shows it greyed out)."""


class ProviderError(RuntimeError):
    """The provider was called but failed (HTTP error, bad response)."""


class Scorer(ABC):
    id: str = "base"
    name: str = "base"
    kind: str = "demo"  # cloud | local | demo
    optional: bool = False  # optional providers are hidden in the UI unless configured

    def model_name(self) -> str:
        return ""

    def available(self) -> tuple[bool, str]:
        """(is it usable right now, note for the UI)."""
        return True, ""

    @abstractmethod
    async def judge(self, dialog: Dialog, criteria: list[Criterion], instructions: str = "",
                    trace: list[dict] | None = None) -> list[Judgment]:
        """Return one Judgment per criterion in `criteria`.

        `instructions` are the checklist's general rules (e.g. how N/A differs
        from "Нет", what counts as evidence); send them to the model too.
        Append one dict per model call to `trace` (prompt, raw answer, model,
        duration_ms, usage) — it is shown in the UI as proof of live analysis.
        """
