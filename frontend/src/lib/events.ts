/* Presentation-only model of the «recording strip»: events on a time axis,
   derived from data the app already has (model results + turn timestamps).
   Nothing here talks to the API or changes stored data. */
import type { CriterionResult, ScoreResponse, Turn } from "../api/contract";
import { reviewState } from "../components/CriterionCard";
import type { EventKind } from "../theme";
import { verdictLabel } from "./format";

export interface DialogEvent {
  id: string;
  kind: EventKind;
  /** seconds from the start (or turn position when timestamps are missing) */
  t: number;
  /** end of a span (pauses) */
  t2?: number;
  /** transcript turn to highlight */
  turnIdx: number;
  title: string;
  detail: string;
  criterionId?: string;
}

/** Concrete wording per official criterion id; other criteria fall back to «<name>: …». */
const TITLES: Record<string, { bad: string; partial?: string; good?: string }> = {
  contact: { bad: "Пропущено приветствие по скрипту", good: "Приветствие и представление" },
  needs: { bad: "Не уточнена потребность клиента", good: "Потребность уточнена" },
  identification: { bad: "Нет идентификации клиента", good: "Клиент идентифицирован" },
  consultation: { bad: "Вопрос клиента не решён", partial: "Консультация неполная", good: "Вопрос решён" },
  empathy: { bad: "Нет эмпатии к клиенту", good: "Проявлена эмпатия" },
  dialog_management: { bad: "Сбой в ведении диалога", partial: "Заминки в ведении диалога", good: "Диалог ведётся чётко" },
  closing: { bad: "Нет итога и прощания", good: "Итог и прощание" },
  gross_errors: { bad: "Грубое нарушение" },
};

/** Time of every turn: real offsets where known, otherwise evenly spaced by position. */
export function turnTimes(turns: Turn[], offs: (number | null)[]): { times: number[]; duration: number; timed: boolean } {
  const known = offs.filter((o): o is number => o != null);
  if (known.length < 2) {
    const times = turns.map((_, i) => i);
    return { times, duration: Math.max(1, turns.length - 1), timed: false };
  }
  const times: number[] = [];
  let last = 0;
  for (let i = 0; i < turns.length; i++) {
    const o = offs[i];
    last = o != null ? Math.max(o, last) : last;
    times.push(last);
  }
  return { times, duration: Math.max(1, times[times.length - 1]), timed: true };
}

function anchorTurn(r: CriterionResult): number | null {
  const ev = r.evidence_all?.[0] ?? r.evidence;
  if (ev && Number.isFinite(ev.turn_idx)) return ev.turn_idx;
  if (r.checked_range && r.checked_range.length === 2) return r.checked_range[0];
  return null;
}

function kindOf(r: CriterionResult, demo: boolean): EventKind | null {
  if (!r.applicable || r.verdict === "na") return null;
  if (r.gross_error) return "violation";
  const tone = verdictLabel(r).tone;
  if (tone === "danger") return "violation";
  if (tone === "warning" || reviewState(r, demo).flagged) return "risk";
  if (tone === "success") return r.gross_error_if === "yes" ? null : "good"; // «нет грубых нарушений» is not an event
  return null;
}

function titleOf(r: CriterionResult, kind: EventKind, name: string): string {
  const t = TITLES[r.criterion_id];
  if (kind === "violation") return t?.bad ?? `${name}: не выполнено`;
  if (kind === "good") return t?.good ?? `${name}: выполнено`;
  if (r.verdict === "uncertain") return `Модель не уверена: ${name.toLowerCase()}`;
  if (t?.partial && verdictLabel(r).tone === "warning") return t.partial;
  return `Нужна проверка: ${name.toLowerCase()}`;
}

export function formatPause(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s} сек.`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} мин ${String(rest).padStart(2, "0")} сек.` : `${m} мин`;
}

/** Client waited for the operator: client turn → next operator turn, no operator reply in between. */
function pauses(turns: Turn[], times: number[], call: boolean): DialogEvent[] {
  const min = call ? 8 : 45;
  const out: DialogEvent[] = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].speaker !== "client") continue;
    let j = i + 1;
    while (j < turns.length && turns[j].speaker !== "operator" && turns[j].speaker !== "client") j++;
    if (j >= turns.length || turns[j].speaker !== "operator") continue;
    const gap = times[j] - times[i];
    if (gap >= min) {
      out.push({
        id: `pause-${turns[i].idx}`,
        kind: "pause",
        t: times[i],
        t2: times[j],
        turnIdx: turns[j].idx,
        title: `Пауза ${formatPause(gap)}`,
        detail: `Клиент ждал ответа оператора после реплики #${turns[i].idx}; оператор ответил в реплике #${turns[j].idx}.`,
      });
    }
  }
  // keep the strip readable: the longest few
  return out.sort((a, b) => b.t2! - b.t - (a.t2! - a.t)).slice(0, 4);
}

export function buildEvents(
  turns: Turn[],
  times: number[],
  score: ScoreResponse | null,
  call: boolean,
  nameOf: (r: CriterionResult) => string,
): DialogEvent[] {
  const pos = new Map(turns.map((t, i) => [t.idx, i]));
  const events: DialogEvent[] = [];
  const demo = score?.provider === "mock";
  for (const r of score?.results ?? []) {
    const kind = kindOf(r, demo);
    const at = anchorTurn(r);
    if (!kind || at == null || !pos.has(at)) continue;
    events.push({
      id: `crit-${r.criterion_id}`,
      kind,
      t: times[pos.get(at)!],
      turnIdx: at,
      title: titleOf(r, kind, nameOf(r)),
      detail: r.explanation,
      criterionId: r.criterion_id,
    });
  }
  events.push(...pauses(turns, times, call));
  return events.sort((a, b) => a.t - b.t);
}

/* ---------------------------------------------------- client tension line */

const UPSET =
  /(сколько можно|опять|снова|до сих пор|уже (второй|третий)|почему|не работает|не могу|не получается|жалоб|верните|ужас|безобраз|недовол|обман|никто не|когда уже|срочно|why|still|again|complain|refund|terrible|ridiculous|can't|cannot|неге|әлі|қашан|болмайды)/i;

/**
 * «Напряжение клиента по тексту»: there is no audio tone analysis in the data,
 * so each client message gets a 0..1 estimate from its text — length, «!»,
 * repeated «?», capitals, words of frustration. Shown as such in the legend.
 */
export function clientTension(turns: Turn[], times: number[]): { t: number; v: number }[] {
  return turns
    .map((turn, i) => ({ turn, t: times[i] }))
    .filter(({ turn }) => turn.speaker === "client")
    .map(({ turn, t }) => {
      const text = turn.text;
      const excl = (text.match(/!/g) ?? []).length;
      const quest = (text.match(/\?/g) ?? []).length;
      const caps = /\b[A-ZА-ЯЁ]{4,}\b/.test(text);
      let v = 0.12 + Math.min(text.length / 260, 0.3) + Math.min(excl * 0.12, 0.24);
      if (quest >= 2) v += 0.08;
      if (caps) v += 0.18;
      if (UPSET.test(text)) v += 0.22;
      return { t, v: Math.min(1, v) };
    });
}

/** Header facts that exist in the data: operator name (if introduced), date (calls), duration. */
export function dialogFacts(turns: Turn[], duration: number, timed: boolean) {
  const firstOp = turns.find((t) => t.speaker === "operator");
  const m = firstOp?.text.match(/(?:меня зовут|^|[\s,.!])(?:я|i'm|i am|my name is|менің атым)\s+([A-ZА-ЯЁӘҒҚҢӨҰҮҺІ][a-zа-яёәғқңөұүһі]+)/);
  const operator = m && !/^(понимаю|вижу|уточню|проверю|сейчас)$/i.test(m[1]) ? m[1] : null;
  const iso = turns.find((t) => /^\d{4}-\d{2}-\d{2}T/.test(t.timestamp))?.timestamp;
  const date = iso ? new Date(iso.replace(/(\.\d{3})\d+/, "$1")) : null;
  return {
    operator,
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    duration: timed ? duration : null,
  };
}

/** Marks for the mini strip in the dialog journal: position = turn order (0..1), no timestamps needed. */
export function miniMarks(score: ScoreResponse | null | undefined, turns: number): { pos: number; kind: EventKind }[] {
  if (!score || turns < 1) return [];
  const demo = score.provider === "mock";
  const out: { pos: number; kind: EventKind }[] = [];
  for (const r of score.results) {
    const kind = kindOf(r, demo);
    const at = anchorTurn(r);
    if (!kind || at == null) continue;
    out.push({ pos: Math.min(1, Math.max(0, at / Math.max(1, turns - 1))), kind });
  }
  // draw good first so violations stay on top
  const order: Record<EventKind, number> = { good: 0, pause: 1, risk: 2, violation: 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
