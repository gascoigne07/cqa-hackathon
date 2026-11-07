"""CQA scoring engine — deterministic math from the checklist (p.2 rules).

Pure functions, no LLM, no I/O. The LLM only produces per-criterion *judgments*;
this module turns judgments + checklist config into points/total EXACTLY per the
rubric. All arithmetic is Decimal so the half-up rounding is deterministic and
matches Ground Truth (float would drift at the .xx5 boundary).

judgment shape (per criterion id):
  bool / bool_na : {"verdict": "yes"|"no"|"na", "applicable": bool, ...}
  scale          : {"raw_score": int, ...}
  flag           : {"flag": bool}  (or {"verdict": "yes"})
Optional on any: "explanation", "evidence", "na_reason".
"""
from decimal import Decimal, ROUND_HALF_UP

D = Decimal
HUNDRED = D(100)


def _q(value: Decimal, ndigits: int = 2) -> float:
    """Round half-up to ndigits, return float for JSON."""
    return float(value.quantize(D(1).scaleb(-ndigits), rounding=ROUND_HALF_UP))


def _fraction(criterion: dict, judgment: dict) -> Decimal:
    """Fraction of the criterion's weight earned (0..1), as Decimal."""
    ctype = criterion["type"]
    if ctype in ("bool", "bool_na"):
        return D(1) if judgment.get("verdict") == "yes" else D(0)
    if ctype == "scale":
        raw = judgment.get("raw_score")
        smax = criterion.get("scale_max") or 0
        if raw is None or smax == 0:
            return D(0)
        frac = D(str(raw)) / D(str(smax))
        return max(D(0), min(D(1), frac))
    return D(0)  # flag: no points


def _is_na(criterion: dict, judgment: dict) -> bool:
    if not criterion.get("na_allowed"):
        return False
    return judgment.get("applicable") is False or judgment.get("verdict") == "na"


def score_dialog(checklist: dict, judgments: dict) -> dict:
    """Return {total, gross_error, results[], sections[]}.

    total is None when no applicable weighted criterion remains (rubric rule 5).
    gross_error is a separate flag and is NOT subtracted from the 100 points.
    """
    criteria = checklist["criteria"]
    ndigits = checklist.get("rounding", 2)

    # Rule 5 tail: gross-error flag (separate, no points)
    gross_error = False
    for c in criteria:
        if c["type"] == "flag" or c.get("is_gross_error"):
            j = judgments.get(c["id"], {})
            if j.get("flag") is True or j.get("verdict") == "yes":
                gross_error = True

    # Weighted, non-flag criteria
    scored = [c for c in criteria if c["type"] != "flag" and c.get("weight", 0) > 0]

    # Rule 1 + 4: drop N/A where allowed, then redistribute weights to sum 100
    applicable = [c for c in scored if not _is_na(c, judgments.get(c["id"], {}))]
    sum_w = sum((D(str(c["weight"])) for c in applicable), D(0))

    results, sections, total_raw = [], {}, D(0)

    for c in scored:
        j = judgments.get(c["id"], {})
        if _is_na(c, j):
            results.append({
                "criterion_id": c["id"], "applicable": False,
                "na_reason": j.get("na_reason"),
                "verdict": None, "raw_score": None, "scale_max": c.get("scale_max"),
                "points": 0.0, "effective_weight": 0.0,
                "explanation": j.get("explanation"), "evidence": j.get("evidence"),
            })
            continue
        eff = (D(str(c["weight"])) / sum_w * HUNDRED) if sum_w else D(0)
        earned = _fraction(c, j) * eff
        total_raw += earned
        results.append({
            "criterion_id": c["id"], "applicable": True, "na_reason": None,
            "verdict": j.get("verdict"), "raw_score": j.get("raw_score"),
            "scale_max": c.get("scale_max"),
            "points": _q(earned, ndigits), "effective_weight": _q(eff, ndigits),
            "explanation": j.get("explanation"), "evidence": j.get("evidence"),
        })
        sec = sections.setdefault(c["section"],
                                  {"name": c["section"], "_p": D(0), "_m": D(0)})
        sec["_p"] += earned
        sec["_m"] += eff

    total = None if sum_w == 0 else _q(total_raw, ndigits)
    section_list = [{"name": s["name"], "points": _q(s["_p"], ndigits),
                     "max": _q(s["_m"], ndigits)} for s in sections.values()]

    return {"total": total, "gross_error": gross_error,
            "results": results, "sections": section_list}
