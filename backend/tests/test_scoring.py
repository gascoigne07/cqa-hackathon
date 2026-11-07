import pytest

from app import evidence, timeline
from app.schemas import ChecklistIn, Criterion, Dialog, JudgeEvidence, Judgment, Message
from app.scoring import compute, round_half_up

D = Dialog(
    conversation_id="t1", channel="agent chat", language="RU",
    transcript=[Message(timestamp="00:00", speaker="client", text="Где мой тариф?"),
                Message(timestamp="00:10", speaker="operator", text="Здравствуйте! Меня зовут Алина.")],
)


def crit(cid, weight, **kw):
    return Criterion(id=cid, name=cid, weight=weight, **kw)


def yes(cid, ok=True, **kw):
    return Judgment(criterion_id=cid, status="answered", answer=ok, **kw)


def scale(cid, v):
    return Judgment(criterion_id=cid, status="answered", value=v)


def na(cid):
    return Judgment(criterion_id=cid, status="na", na_reason="не применимо")


STEPS = [{"value": 1, "label": "плохо"}, {"value": 3, "label": "частично"}, {"value": 5, "label": "отлично"}]


def test_weighted_total_and_contract_fields():
    cl = ChecklistIn(criteria=[crit("a", 50), crit("b", 50, type="scale", scale_max=5, scale=STEPS)])
    r = compute(cl, {"a": yes("a", evidence=[JudgeEvidence(message_index=1, quote="Меня зовут")]), "b": scale("b", 3)}, D)
    # a = 1.0, b = (3-1)/(5-1) = 0.5 -> 50*1 + 50*0.5 = 75
    assert r.total == 75
    a, b = r.results
    assert (a.verdict, a.raw_score, a.points, a.effective_weight) == ("yes", 1.0, 50, 50)
    assert a.evidence.turn_idx == 1 and a.evidence.timestamp == "00:10"
    assert (b.verdict, b.raw_score, b.scale_max, b.points) == ("частично", 3, 5, 25)


def test_na_redistributes_weight():
    cl = ChecklistIn(rounding=0, criteria=[crit("a", 20), crit("b", 30, type="yes_no_na"), crit("c", 50)])
    r = compute(cl, {"a": yes("a"), "b": na("b"), "c": yes("c", False)}, D)
    # b excluded -> 100 * 20 / 70 = 28.57 -> 29 (0 decimals, half-up)
    assert r.total == 29
    b = r.results[1]
    assert b.applicable is False and b.verdict == "na" and b.na_reason == "не применимо"
    assert b.points is None and b.effective_weight is None
    assert r.results[0].effective_weight == pytest.approx(28.57)


def test_yes_no_na_type_forces_na_allowed():
    assert crit("x", 1, type="yes_no_na").na_allowed is True


def test_na_not_allowed_goes_to_review():
    cl = ChecklistIn(criteria=[crit("a", 50), crit("b", 50)])
    r = compute(cl, {"a": yes("a"), "b": na("b")}, D)
    assert r.results[1].verdict == "uncertain" and r.results[1].needs_review
    assert r.needs_review and r.total == 100


def test_gross_error_flag_and_zero_policy():
    crits = [crit("a", 80), crit("g", 20, gross_error_if="no")]
    flag = compute(ChecklistIn(criteria=crits), {"a": yes("a"), "g": yes("g", False)}, D)
    assert flag.gross_error and flag.total == 80 and flag.results[1].gross_error
    zero = compute(ChecklistIn(criteria=crits, gross_error_policy="zero_total"), {"a": yes("a"), "g": yes("g", False)}, D)
    assert zero.gross_error and zero.total == 0


def test_zero_weight_gross_flag_yes_means_violation():
    # official checklist: «Грубые ошибки — Да/Нет, без баллов»
    cl = ChecklistIn(rounding=2, criteria=[crit("a", 10), crit("b", 30), crit("g", 0, section="Грубые", gross_error_if="yes")])
    clean = compute(cl, {"a": yes("a"), "b": yes("b", False), "g": yes("g", False)}, D)
    assert clean.total == 25.0 and not clean.gross_error
    g = clean.results[2]
    assert g.points is None and g.effective_weight is None and g.verdict == "no"
    assert [s.name for s in clean.sections] == []  # zero-weight section has no totals
    bad = compute(cl, {"a": yes("a"), "b": yes("b", False), "g": yes("g", True)}, D)
    assert bad.gross_error and bad.results[2].gross_error and bad.total == 25.0


def test_legacy_critical_maps_to_gross_error_if():
    assert Criterion(id="x", name="x", weight=1, critical=True).gross_error_if == "no"


def test_scale_value_snaps_to_step():
    steps = [{"value": 0, "label": "нет"}, {"value": 4, "label": ""}, {"value": 7, "label": ""}, {"value": 10, "label": "отлично"}]
    cl = ChecklistIn(criteria=[crit("m", 15, type="scale", scale_max=10, scale=steps)])
    r = compute(cl, {"m": scale("m", 8)}, D)
    assert r.results[0].raw_score == 7 and r.results[0].issues and r.total == 70


def test_official_rounding_two_decimals():
    # 20 of 70 applicable weight -> 28.5714... -> 28.57
    cl = ChecklistIn(rounding=2, criteria=[crit("a", 20), crit("b", 30, type="yes_no_na"), crit("c", 50)])
    assert compute(cl, {"a": yes("a"), "b": na("b"), "c": yes("c", False)}, D).total == 28.57


def test_sections_points_and_max():
    cl = ChecklistIn(rounding=1, criteria=[crit("a", 1, section="S1"), crit("b", 2, section="S1"), crit("c", 1, section="S2")])
    r = compute(cl, {"a": yes("a"), "b": yes("b", False), "c": yes("c")}, D)
    s1, s2 = r.sections
    assert (s1.name, s1.points, s1.max) == ("S1", 25.0, 75.0)
    assert (s2.points, s2.max) == (25.0, 25.0)
    assert r.total == 50.0


def test_order_is_normalized():
    cl = ChecklistIn(criteria=[crit("b", 1, order=5), crit("a", 1, order=2)])
    assert [(c.id, c.order) for c in cl.criteria] == [("a", 1), ("b", 2)]


def test_scale_validation():
    with pytest.raises(ValueError):
        crit("x", 1, type="scale")  # no scale_max
    with pytest.raises(ValueError):
        crit("x", 1, type="scale", scale_max=3, scale=[{"value": 5, "label": "too high"}])
    c = crit("x", 1, type="scale", scale=STEPS)  # scale_max derived from steps
    assert c.scale_max == 5 and c.scale_min == 1


def test_round_half_up():
    assert round_half_up(2.5, 0) == 3
    assert round_half_up(28.565, 2) == 28.57


def test_judging_hash_ignores_weight_but_not_wording():
    a = crit("x", 10, guidance="g")
    assert a.judging_hash() == crit("x", 99, guidance="g", order=7).judging_hash()
    assert a.judging_hash() != crit("x", 10, guidance="g2").judging_hash()


def test_evidence_validation():
    j = Judgment(criterion_id="a", status="answered", answer=True,
                 evidence=[JudgeEvidence(message_index=1, quote="Меня зовут Алина"), JudgeEvidence(message_index=9, quote="x"),
                           JudgeEvidence(message_index=0, quote="совсем другой текст про погоду")])
    clean, issues = evidence.validate(D, j)
    assert [e.message_index for e in clean.evidence] == [1]
    assert len(issues) == 2


def test_offsets_skip_recording_pauses():
    call = Dialog(conversation_id="c", channel="voice call", language="RU", transcript=[
        Message(timestamp="2026-11-03T13:10:00.0000000+00:00", speaker="system", text="Запись начата"),
        Message(timestamp="2026-11-03T13:10:10.0000000+00:00", speaker="system", text="Запись и транскрибирование приостановлены."),
        Message(timestamp="2026-11-03T13:10:40.0000000+00:00", speaker="system", text="Запись и транскрибирование возобновлены."),
        Message(timestamp="2026-11-03T13:10:50.1234567+00:00", speaker="operator", text="Здравствуйте"),
    ])
    assert timeline.offsets(call) == [0.0, 10.0, 10.0, 20.12]
