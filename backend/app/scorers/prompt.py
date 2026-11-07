"""Prompt builder + response parser for LLM providers.

The prompt is generated from the checklist JSON, never hardcoded, so a
criterion changed in the UI is picked up automatically.
"""

from __future__ import annotations

import json
import re

from ..schemas import Criterion, Dialog, JudgeEvidence, Judgment
from ..timeline import label

SYSTEM_PROMPT = """You are a strict, fair quality-assurance reviewer for a broker's contact center.
You evaluate ONLY the human operator (speaker "operator"). Turns from "bot" and "system"
are context: what happened before the operator joined, holds, transfers, etc.
The client's turns show what was asked and whether it was resolved.

Rules:
- Judge each criterion independently, using only the transcript.
- Every verdict must cite evidence: the turn index [N] and a short VERBATIM quote from that turn.
- If the required action is missing, answer "no" and give checked_range = [first_idx, last_idx] of the part you checked.
- Use status "na" only when the criterion allows N/A and it really does not apply; explain why in na_reason.
- If you genuinely cannot decide, use status "uncertain" and explain.
- Ignore the operator's name, gender, accent or language variety; judge behaviour only.
- Write explanations in {explanation_language}, 1–2 sentences, concrete.
- Return JSON only, matching the schema."""


OUTPUT_FORMAT = """Return ONLY a JSON object, one item per criterion id:
{"judgments": [{
  "criterion_id": "<id>",
  "status": "answered" | "na" | "uncertain",
  "answer": true | false | null,          // yes/no criteria
  "value": <one of the step values> | null, // scale criteria
  "evidence": [{"turn_idx": <N>, "quote": "<verbatim fragment of turn N>"}],
  "checked_range": [<first N>, <last N>] | null,  // when the action is missing
  "explanation": "<1–2 sentences>",
  "na_reason": "<why N/A>" | "",
  "confidence": <0..1>
}]}"""


def format_criterion(c: Criterion) -> str:
    lines = [f'- id: "{c.id}"', f"  name: {c.name}"]
    if c.guidance:
        lines.append(f"  guidance: {c.guidance}")
    if c.is_binary:
        lines.append('  answer: set "answer" to true (yes) or false (no)')
    else:
        if c.scale:
            lines.append('  answer: set "value" to ONE of these step values (no other numbers):')
            lines.extend(f"    {s.value:g} — {s.label}" if s.label else f"    {s.value:g}" for s in c.scale)
        else:
            lines.append(f'  answer: set "value" to a number from {c.scale_min:g} to {c.scale_max:g}')
    lines.append("  N/A allowed" if c.na_allowed else "  N/A NOT allowed")
    return "\n".join(lines)


def format_transcript(dialog: Dialog) -> str:
    return "\n".join(f"[{i}] ({label(m.timestamp)}) {m.speaker}: {m.text}" for i, m in enumerate(dialog.transcript))


def build_messages(dialog: Dialog, criteria: list[Criterion], instructions: str = "", explanation_language: str = "Russian") -> tuple[str, str]:
    system = SYSTEM_PROMPT.format(explanation_language=explanation_language)
    rules = f"GENERAL RULES OF THIS CHECKLIST:\n{instructions.strip()}\n\n" if instructions.strip() else ""
    user = (
        f"Channel: {dialog.channel}. Dialog language: {dialog.language}.\n\n"
        + rules
        + "CRITERIA:\n" + "\n".join(format_criterion(c) for c in criteria) + "\n\n"
        f"TRANSCRIPT:\n{format_transcript(dialog)}\n\n"
        + OUTPUT_FORMAT
    )
    return system, user


def response_json_schema(criteria: list[Criterion]) -> dict:
    """JSON Schema for structured-output APIs."""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["judgments"],
        "properties": {
            "judgments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["criterion_id", "status", "evidence", "explanation"],
                    "properties": {
                        "criterion_id": {"type": "string", "enum": [c.id for c in criteria]},
                        "status": {"type": "string", "enum": ["answered", "na", "uncertain"]},
                        "answer": {"type": ["boolean", "null"]},
                        "value": {"type": ["number", "null"]},
                        "evidence": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["turn_idx", "quote"],
                                "properties": {"turn_idx": {"type": "integer"}, "quote": {"type": "string"}},
                            },
                        },
                        "checked_range": {"type": ["array", "null"], "items": {"type": "integer"}},
                        "explanation": {"type": "string"},
                        "na_reason": {"type": "string"},
                        "confidence": {"type": ["number", "null"]},
                    },
                },
            }
        },
    }


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.M)
_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)


def parse_response(text: str, criteria: list[Criterion]) -> list[Judgment]:
    """Parse the model's JSON; unknown ids are dropped, missing ones become 'uncertain'."""
    cleaned = _FENCE.sub("", _THINK.sub("", text).strip())
    start, end = cleaned.find("{"), cleaned.rfind("}")
    data = json.loads(cleaned[start : end + 1]) if start != -1 else {"judgments": []}
    wanted = {c.id for c in criteria}
    out: dict[str, Judgment] = {}
    for item in data.get("judgments", []):
        try:
            item = dict(item)
            item["evidence"] = [
                JudgeEvidence(message_index=e.get("turn_idx", e.get("message_index", -1)), quote=e.get("quote", ""))
                for e in item.get("evidence") or []
            ]
            j = Judgment.model_validate(item)
        except Exception:  # noqa: BLE001 - one bad item must not kill the whole dialog
            continue
        if j.criterion_id in wanted:
            out[j.criterion_id] = j
    for cid in wanted - out.keys():
        out[cid] = Judgment(criterion_id=cid, status="uncertain", explanation="Модель не вернула оценку")
    return [out[c.id] for c in criteria]
