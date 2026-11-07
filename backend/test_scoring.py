"""Scoring-engine tests. Run: python3 backend/test_scoring.py  (no pytest needed)."""
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import scoring  # noqa: E402

with open(os.path.join(BASE, "checklists", "default.json"), encoding="utf-8") as f:
    CL = json.load(f)


def test_worked_example():
    """Brief example: c03 N/A, c04 scale 15, c06 scale 7, rest Да → 88.13."""
    j = {
        "c01": {"verdict": "yes"},
        "c02": {"verdict": "yes"},
        "c03": {"applicable": False, "na_reason": "Запрос не требовал идентификации."},
        "c04": {"raw_score": 15},
        "c05": {"verdict": "yes"},
        "c06": {"raw_score": 7},
        "c07": {"verdict": "yes"},
        "c08": {"flag": False},
    }
    r = scoring.score_dialog(CL, j)
    assert r["total"] == 88.13, f"total={r['total']}"
    assert r["gross_error"] is False
    c03 = next(x for x in r["results"] if x["criterion_id"] == "c03")
    assert c03["applicable"] is False and c03["points"] == 0.0


def test_perfect_no_na():
    """Everything Да / top of scale, no N/A → exactly 100.00."""
    j = {cid: {"verdict": "yes"} for cid in ("c01", "c02", "c03", "c05", "c07")}
    j["c04"] = {"raw_score": 20}
    j["c06"] = {"raw_score": 10}
    j["c08"] = {"flag": False}
    r = scoring.score_dialog(CL, j)
    assert r["total"] == 100.0, f"total={r['total']}"


def test_all_wrong():
    """Everything Нет / 0 → total 0.00 (criterion stays applicable, earns 0)."""
    j = {cid: {"verdict": "no"} for cid in ("c01", "c02", "c03", "c05", "c07")}
    j["c04"] = {"raw_score": 0}
    j["c06"] = {"raw_score": 0}
    r = scoring.score_dialog(CL, j)
    assert r["total"] == 0.0, f"total={r['total']}"


def test_gross_error_flag():
    j = {"c01": {"verdict": "yes"}, "c05": {"verdict": "yes"},
         "c06": {"raw_score": 10}, "c08": {"flag": True}}
    r = scoring.score_dialog(CL, j)
    assert r["gross_error"] is True


def test_na_redistribution_keeps_100():
    """With two N/A criteria, applicable effective weights still sum to 100."""
    j = {
        "c01": {"verdict": "yes"}, "c02": {"applicable": False},
        "c03": {"applicable": False}, "c04": {"raw_score": 20},
        "c05": {"verdict": "yes"}, "c06": {"raw_score": 10}, "c07": {"verdict": "yes"},
    }
    r = scoring.score_dialog(CL, j)
    eff_sum = round(sum(x["effective_weight"] for x in r["results"] if x["applicable"]), 2)
    assert eff_sum == 100.0, f"eff_sum={eff_sum}"
    assert r["total"] == 100.0, f"total={r['total']}"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  ok  {name}")
    print("\nALL SCORING TESTS PASSED\n")
    demo = scoring.score_dialog(CL, {
        "c01": {"verdict": "yes", "explanation": "Поздоровался и представился",
                "evidence": {"turn_idx": 0, "timestamp": "00:02", "quote": "Здравствуйте!"}},
        "c02": {"verdict": "yes"}, "c03": {"applicable": False},
        "c04": {"raw_score": 15}, "c05": {"verdict": "yes"},
        "c06": {"raw_score": 7}, "c07": {"verdict": "yes"}, "c08": {"flag": False},
    })
    print(json.dumps(demo, ensure_ascii=False, indent=2))
