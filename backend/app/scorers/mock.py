"""Deterministic keyword scorer so the website works before the real model.

NOT a quality model. It exists so the UI, scoring math, appeals and the
checklist swap can be built and demoed in parallel with the ML work.
Every explanation is prefixed with "[mock]".
"""

from __future__ import annotations

import asyncio
import os
import re

from ..schemas import Criterion, Dialog, JudgeEvidence, Judgment
from .base import Scorer

I = re.I  # noqa: E741

GREET = re.compile(r"здравствуй|добр(ый|ое) (день|вечер|утро)|приветству|сәлеметсіз|қайырлы|hello|\bhi\b|good (morning|afternoon|evening)", I)
NAME = re.compile(r"меня зовут|менің атым|атым|my name is|\bi'?m [a-zа-я]|this is [a-z]|с вами [а-я]|на связи", I)
VERIFY_SYS = re.compile(r"личность клиента подтверждена|identity verified|жеке басы расталды", I)
VERIFY_OP = re.compile(r"кодов(ое|ым) слов|дат[уы] рождения|\bиин\b|верификац|подтвердите личность|паспорт|date of birth|verify your identity|security question|туған күн|жеке куәлік", I)
ACCOUNT = re.compile(r"сч[её]т|баланс|вывод|пополн|списан|комисси|ордер|позици|account|balance|withdraw|deposit|order|шот|қаражат", I)
QUESTION_WORDS = re.compile(r"\?|уточните|подскажите|какой|какую|қандай|қай|which|what|could you", I)
INSTR = re.compile(r"откройте|перейдите|нажмите|выберите|зайдите|укажите|open|go to|click|tap|select|ашыңыз|басыңыз|өтіңіз|таңдаңыз", I)
RESOLVED = re.compile(r"спасибо|нашла|нашёл|нашел|понятно|получилось|рақмет|түсінікті|таптым|көрдім|thanks|thank you|found it|got it", I)
UNRESOLVED = re.compile(r"не помогло|не работает|не понимаю|так и не|doesn'?t work|not working|still not|көмектеспеді|түсінбедім", I)
POLITE = re.compile(r"пожалуйста|спасибо|извините|прошу прощения|понимаю|благодар|рақмет|кешіріңіз|өтінемін|түсінемін|please|thank|sorry|apolog|understand|appreciate", I)
RUDE = re.compile(r"\bдура|идиот|тупой|заткнись|отстаньте|не мои проблемы|stupid|shut up|not my problem|ақымақ", I)
HOLD_SYS = re.compile(r"удержан|on hold|ұстап", I)
HOLD_WARN = re.compile(r"подожд|ожидайте|минут|секунд|уточню|проверю|wait|moment|hold on|let me check|күте тұр|тексерем", I)
FAREWELL = re.compile(r"до свидания|хорошего|всего доброго|всего хорошего|удачи|сау болыңыз|қош|goodbye|\bbye\b|have a (nice|good|great)|take care", I)
OUT_OF_COMPANY = re.compile(r"переведите (мне|на мою карту) лично|на мой личный|ваш личный номер|дайте (ваш )?личный номер|частн(ую|ым) консультаци|personal number|transfer (it )?to me personally", I)
CONFUSED = re.compile(r"не понял|не поняла|повторите|что вы имеете в виду|непонятно|в смысле\?|what do you mean|didn'?t understand|түсінбедім|қайталаңыз", I)
ENDED = re.compile(r"клиент покинул|клиент завершил|customer left|клиент чаттан шықты", I)
MORE_HELP = re.compile(r"остались вопрос|чем[- ]?(то|нибудь)? ещ[её]|могу (ли я )?(ещ[её] )?помочь|что-то ещ[её]|тағы сұра|басқа сұра|anything else|other questions|further questions", I)

STOP = {"оператор", "клиент", "клиента", "клиенту", "который", "которые", "operator", "client", "customer", "should", "оператора"}


def _quote(text: str) -> str:
    return text[:90]


def _ev(dialog: Dialog, idx: int) -> JudgeEvidence:
    return JudgeEvidence(message_index=idx, quote=_quote(dialog.transcript[idx].text))


class MockScorer(Scorer):
    id = "mock"
    name = "Демо · ключевые слова"
    kind = "demo"

    def __init__(self) -> None:
        self.delay = float(os.environ.get("CQA_MOCK_DELAY", "0.15"))

    def model_name(self) -> str:
        return "keywords-v1"

    async def judge(self, dialog: Dialog, criteria: list[Criterion], instructions: str = "",
                    trace: list[dict] | None = None) -> list[Judgment]:
        await asyncio.sleep(self.delay)
        out = [self._judge_one(dialog, c) for c in criteria]
        if trace is not None:
            trace.append({"provider": self.id, "model": self.model_name(), "criteria": [c.id for c in criteria],
                          "system": "", "user": "", "raw": "", "duration_ms": int(self.delay * 1000), "usage": {},
                          "note": "Демо-оценщик: правила на ключевых словах, модель не вызывается."})
        return out

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _idx(dialog: Dialog, speaker: str) -> list[int]:
        return [i for i, m in enumerate(dialog.transcript) if m.speaker == speaker]

    @staticmethod
    def _first(dialog: Dialog, idxs: list[int], rx: re.Pattern) -> int | None:
        return next((i for i in idxs if rx.search(dialog.transcript[i].text)), None)

    def _range(self, idxs: list[int]) -> list[int] | None:
        return [idxs[0], idxs[-1]] if idxs else None

    def _j(self, c: Criterion, **kw) -> Judgment:  # noqa: ANN003
        kw["explanation"] = "[mock] " + kw.get("explanation", "")
        kw.setdefault("confidence", 0.5)
        return Judgment(criterion_id=c.id, **kw)

    # ------------------------------------------------------------------- rules

    def _judge_one(self, d: Dialog, c: Criterion) -> Judgment:
        op = self._idx(d, "operator")
        if not op:
            if c.na_allowed:
                return self._j(c, status="na", na_reason="В диалоге нет реплик оператора", explanation="Оператор не участвовал.")
            return self._j(c, status="uncertain", explanation="В диалоге нет реплик оператора.")
        rule = getattr(self, f"_rule_{c.id}", None)
        return rule(d, c, op) if rule else self._generic(d, c, op)

    def _rule_greeting(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        i = op[0]
        text = d.transcript[i].text
        g, n = bool(GREET.search(text)), bool(NAME.search(text))
        if g and n:
            return self._j(c, status="answered", answer=True, evidence=[_ev(d, i)], explanation="В первой реплике есть приветствие и имя оператора.")
        miss = "приветствия" if not g else "имени оператора"
        return self._j(c, status="answered", answer=False, evidence=[_ev(d, i)], checked_range=[i, i], explanation=f"В первой реплике оператора нет {miss}.")

    def _rule_verification(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        all_idx = list(range(len(d.transcript)))
        sys_i = self._first(d, self._idx(d, "system"), VERIFY_SYS)
        op_i = self._first(d, op, VERIFY_OP)
        if sys_i is not None or op_i is not None:
            i = op_i if op_i is not None else sys_i
            return self._j(c, status="answered", answer=True, evidence=[_ev(d, i)], explanation="Личность клиента подтверждена до работы со счётом.")
        human = [i for i in all_idx if d.transcript[i].speaker in ("client", "operator")]
        acc = self._first(d, human, ACCOUNT)
        if acc is None and c.na_allowed:
            return self._j(c, status="na", na_reason="Вопрос не касается счёта или персональных данных.", explanation="Идентификация не требовалась.")
        return self._j(c, status="answered", answer=False, checked_range=self._range(all_idx), evidence=[_ev(d, acc)] if acc is not None else [], explanation="Вопрос касается счёта, но подтверждения личности не найдено.")

    def _rule_needs(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        i = self._first(d, op, QUESTION_WORDS)
        if i is not None:
            return self._j(c, status="answered", answer=True, evidence=[_ev(d, i)], explanation="Оператор задал уточняющий вопрос.")
        bot = self._idx(d, "bot")
        if bot and c.na_allowed:
            return self._j(c, status="na", na_reason="Запрос был понятен из диалога с ботом.", explanation="Уточнение не требовалось.")
        return self._j(c, status="answered", answer=False, checked_range=self._range(op), explanation="Уточняющих вопросов не найдено.")

    def _rule_accuracy(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        lo, hi = c.scale_min, float(c.scale_max)
        mid = round((lo + hi) / 2)
        cl = self._idx(d, "client")
        instr = self._first(d, op, INSTR)
        last_client = [i for i in cl if i > op[0]]
        resolved = self._first(d, last_client, RESOLVED)
        unresolved = self._first(d, last_client, UNRESOLVED)
        value = mid + (1 if instr is not None else 0) + (1 if resolved is not None else 0) - (2 if unresolved is not None else 0)
        value = max(lo, min(hi, value))
        ev = [_ev(d, i) for i in (instr, resolved, unresolved) if i is not None]
        parts = []
        if instr is not None:
            parts.append("дана пошаговая инструкция")
        if resolved is not None:
            parts.append("клиент подтвердил решение")
        if unresolved is not None:
            parts.append("клиент сообщил, что вопрос не решён")
        return self._j(c, status="answered", value=value, evidence=ev or [_ev(d, op[0])], explanation=("; ".join(parts) or "явных признаков решения нет").capitalize() + ".")

    def _rule_politeness(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        lo, hi = c.scale_min, float(c.scale_max)
        rude = self._first(d, op, RUDE)
        if rude is not None:
            return self._j(c, status="answered", value=lo, evidence=[_ev(d, rude)], explanation="Найдена грубая формулировка.")
        polite = [i for i in op if POLITE.search(d.transcript[i].text)]
        value = max(lo, min(hi, hi - 2 + min(2, len(polite))))
        return self._j(c, status="answered", value=value, evidence=[_ev(d, i) for i in polite[:2]] or [_ev(d, op[0])], explanation=f"Вежливых формулировок: {len(polite)}.")

    def _rule_hold(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        hold = self._first(d, self._idx(d, "system"), HOLD_SYS)
        if hold is None:
            if c.na_allowed:
                return self._j(c, status="na", na_reason="В разговоре не было удержания.", explanation="Удержания не было.")
            return self._j(c, status="answered", answer=True, explanation="Удержания не было.")
        before = [i for i in op if i < hold][-3:]
        warn = self._first(d, before, HOLD_WARN)
        if warn is not None:
            return self._j(c, status="answered", answer=True, evidence=[_ev(d, warn), _ev(d, hold)], explanation="Оператор предупредил клиента перед удержанием.")
        rng = [before[0], hold] if before else [hold, hold]
        return self._j(c, status="answered", answer=False, evidence=[_ev(d, hold)], checked_range=rng, explanation="Перед удержанием нет предупреждения клиента.")

    def _rule_closing(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        tail = op[-3:]
        bye = self._first(d, tail, FAREWELL)
        more = self._first(d, tail, MORE_HELP)
        if bye is not None:
            ev = [_ev(d, i) for i in dict.fromkeys([more, bye]) if i is not None]
            extra = " и уточнил, остались ли вопросы" if more is not None else ""
            return self._j(c, status="answered", answer=True, evidence=ev, explanation=f"Оператор попрощался{extra}.")
        ended = self._first(d, self._idx(d, "system"), ENDED)
        if c.na_allowed and ended is not None and op and op[-1] < ended and not self._first(d, tail, MORE_HELP):
            return self._j(c, status="na", na_reason="Диалог оборвался до возможности его завершить.", explanation="Клиент ушёл раньше.")
        return self._j(c, status="answered", answer=False, checked_range=self._range(tail), explanation="В последних репликах оператора нет прощания.")

    def _rule_no_gross_errors(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        rude = self._first(d, op, RUDE)
        if rude is not None:
            return self._j(c, status="answered", answer=False, evidence=[_ev(d, rude)], explanation="Грубая формулировка оператора.")
        return self._j(c, status="answered", answer=True, checked_range=self._range(op), explanation="Во всех репликах оператора грубых ошибок не найдено.")

    # ------------------------------------------- official checklist (chat/call)

    def _step(self, c: Criterion, frac: float) -> float:
        """Nearest scale step to a 0..1 fraction of the scale."""
        target = c.scale_min + frac * (float(c.scale_max) - c.scale_min)
        steps = [st.value for st in c.scale] or [target]
        return min(steps, key=lambda v: abs(v - target))

    def _rule_contact(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        return self._rule_greeting(d, c, op)

    def _rule_identification(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        return self._rule_verification(d, c, op)

    def _rule_consultation(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        client = [i for i in self._idx(d, "client") if i > op[0]]
        instr = self._first(d, op, INSTR)
        resolved = self._first(d, client, RESOLVED)
        unresolved = self._first(d, client, UNRESOLVED)
        frac = 0.5 + (0.25 if instr is not None else 0) + (0.25 if resolved is not None else 0) - (0.5 if unresolved is not None else 0)
        value = self._step(c, max(0.0, min(1.0, frac)))
        ev = [_ev(d, i) for i in (instr, resolved, unresolved) if i is not None] or [_ev(d, op[0])]
        parts = [p for p, i in (("дан конкретный следующий шаг", instr), ("клиент подтвердил решение", resolved),
                                ("клиент сообщил, что вопрос не решён", unresolved)) if i is not None]
        return self._j(c, status="answered", value=value, evidence=ev,
                       explanation=("; ".join(parts) or "явных признаков решения нет").capitalize() + ".")

    def _rule_empathy(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        rude = self._first(d, op, RUDE)
        if rude is not None:
            return self._j(c, status="answered", answer=False, evidence=[_ev(d, rude)], explanation="Грубая формулировка оператора.")
        polite = self._first(d, op, POLITE)
        if polite is not None or self._first(d, op[:1], GREET) is not None:
            i = polite if polite is not None else op[0]
            return self._j(c, status="answered", answer=True, evidence=[_ev(d, i)], explanation="Оператор вежлив.")
        return self._j(c, status="answered", answer=False, checked_range=self._range(op), explanation="Вежливых формулировок не найдено.")

    def _rule_dialog_management(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        client = [i for i in self._idx(d, "client") if i > op[0]]
        confused = self._first(d, client, CONFUSED)
        hold = self._first(d, self._idx(d, "system"), HOLD_SYS)
        warned = hold is None or self._first(d, [i for i in op if i < hold][-3:], HOLD_WARN) is not None
        frac = 1.0 - (0.6 if confused is not None else 0) - (0.3 if not warned else 0)
        value = self._step(c, max(0.0, frac))
        ev = [_ev(d, i) for i in (confused, hold) if i is not None] or [_ev(d, op[0])]
        note = []
        if confused is not None:
            note.append("клиенту пришлось переспросить")
        if not warned:
            note.append("ожидание без предупреждения")
        return self._j(c, status="answered", value=value, evidence=ev,
                       explanation=("; ".join(note) or "ответы ясные и последовательные").capitalize() + ".")

    def _rule_gross_errors(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        hit = self._first(d, op, RUDE)
        if hit is None:
            hit = self._first(d, op, OUT_OF_COMPANY)
        if hit is not None:
            return self._j(c, status="answered", answer=True, evidence=[_ev(d, hit)], explanation="Выявлено грубое нарушение.")
        return self._j(c, status="answered", answer=False, checked_range=self._range(op),
                       explanation="Оскорблений, предложений в обход компании и раскрытия данных не найдено.")

    # ----------------------------------------------------------------- fallback

    def _generic(self, d: Dialog, c: Criterion, op: list[int]) -> Judgment:
        """Criteria added in the UI: look for the criterion's own key words."""
        words = {w[:5] for w in re.findall(r"[\wёәғқңөұүһі]{6,}", f"{c.name} {c.guidance}".lower()) if w not in STOP}
        hit = next((i for i in op if any(w in d.transcript[i].text.lower() for w in words)), None)
        if c.is_binary:
            if hit is not None:
                return self._j(c, status="answered", answer=True, evidence=[_ev(d, hit)], explanation="Найдены ключевые слова критерия.")
            return self._j(c, status="answered", answer=False, checked_range=self._range(op), explanation="Ключевых слов критерия в репликах оператора нет.")
        return self._j(c, status="answered", value=float(c.scale_max) if hit is not None else c.scale_min,
                       evidence=[_ev(d, hit)] if hit is not None else [], checked_range=None if hit is not None else self._range(op),
                       explanation="Оценка по ключевым словам критерия.")
