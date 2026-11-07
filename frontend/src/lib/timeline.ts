import type { Turn } from "../api/contract";

/**
 * Turn timestamps -> seconds from the start of the recording.
 * Chats use "MM:SS"; calls use ISO 8601. During holds the call recording is
 * paused ("Запись … приостановлены" … "возобновлены"), so paused time is
 * subtracted to keep the audio position close to the right moment.
 */
const PAUSE = /приостановлен|paused|тоқтатыл/i;
const RESUME = /возобновлен|resumed|жалғастырыл|қайта бастал/i;

export function parseSeconds(ts: string): number | null {
  const t = ts.trim();
  if (/^\d{1,3}:\d{2}(:\d{2})?(\.\d+)?$/.test(t)) {
    return t.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
  }
  // trim fractional seconds beyond milliseconds, which Date.parse rejects
  const ms = Date.parse(t.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(ms) ? null : ms / 1000;
}

export function offsets(turns: Turn[], isCall: boolean): (number | null)[] {
  const raw = turns.map((t) => parseSeconds(t.timestamp));
  const first = raw.find((r): r is number => r != null);
  if (first == null) return raw.map(() => null);
  let pausedTotal = 0;
  let pausedSince: number | null = null;
  return turns.map((t, i) => {
    const r = raw[i];
    if (r == null) return null;
    if (isCall && t.speaker === "system") {
      if (PAUSE.test(t.text) && pausedSince == null) pausedSince = r;
      else if (RESUME.test(t.text) && pausedSince != null) {
        pausedTotal += Math.max(0, r - pausedSince);
        pausedSince = null;
      }
    }
    const current = pausedSince != null ? r - pausedSince : 0;
    return Math.round(Math.max(0, r - first - pausedTotal - current) * 100) / 100;
  });
}

/** Index of the turn being played at `time` (last turn whose offset <= time). */
export function activeTurn(offs: (number | null)[], time: number): number | null {
  let found: number | null = null;
  for (let i = 0; i < offs.length; i++) {
    const o = offs[i];
    if (o != null && o <= time + 0.05) found = i;
  }
  return found;
}
