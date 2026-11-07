import type { CriterionResult, CriterionType, Speaker } from "../api/contract";

export const SPEAKER_LABEL: Record<Speaker, string> = {
  client: "Клиент",
  operator: "Оператор",
  bot: "Бот",
  system: "Система",
};

export const TYPE_LABEL: Record<CriterionType, string> = {
  yes_no: "Да / Нет",
  yes_no_na: "Да / Нет / N/A",
  scale: "Шкала",
};

export const channelLabel = (channel: string) => (channel.startsWith("voice") ? "Звонок" : "Чат");
export const isCall = (channel: string) => channel.startsWith("voice");

export const CHECKLIST_CHANNEL_LABEL: Record<string, string> = { chat: "для чатов", call: "для звонков", all: "для всех диалогов" };

/** Newest checklist for a dialog channel ("agent chat" / "voice call"), like the backend's auto-pick. */
export function pickChecklist<T extends { channel?: string }>(lists: T[] | undefined, dialogChannel: string): T | undefined {
  if (!lists) return undefined;
  const ch = isCall(dialogChannel) ? "call" : "chat";
  return lists.find((c) => c.channel === ch) ?? lists.find((c) => (c.channel ?? "all") === "all");
}

/** "00:15" for chats, "13:10:15" for ISO call timestamps. */
export function timeLabel(ts: string): string {
  if (ts.includes("T")) return ts.split("T")[1]?.slice(0, 8) ?? ts;
  return ts;
}

export function formatSeconds(s: number | null | undefined): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export type Tone = "success" | "warning" | "danger" | "informative" | "subtle";

export function scoreTone(score: number | null | undefined): Tone {
  if (score == null) return "subtle";
  if (score >= 85) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export function formatScore(score: number | null | undefined): string {
  if (score == null) return "—";
  return Number.isInteger(score) ? String(score) : score.toFixed(1).replace(/\.0$/, "");
}

export function ratio(points: number | null | undefined, max: number | null | undefined): number | null {
  if (points == null || !max) return null;
  return (100 * points) / max;
}

/** Human-readable verdict badge for one criterion result. */
export function verdictLabel(r: CriterionResult): { text: string; tone: Tone } {
  if (!r.applicable || r.verdict === "na") return { text: "N/A", tone: "subtle" };
  if (r.verdict === "uncertain") return { text: "Нужна проверка", tone: "warning" };
  // for a flag like «Грубые ошибки», "Да" is the bad outcome
  const yesIsBad = r.gross_error_if === "yes";
  if (r.verdict === "yes") return { text: "Да", tone: yesIsBad ? "danger" : "success" };
  if (r.verdict === "no") return { text: "Нет", tone: yesIsBad ? "success" : "danger" };
  // scale
  const s = r.scale_max && r.raw_score != null ? r.raw_score / r.scale_max : null;
  const tone: Tone = s == null ? "subtle" : s >= 0.75 ? "success" : s >= 0.5 ? "warning" : "danger";
  const raw = r.raw_score != null && r.scale_max != null ? `${formatScore(r.raw_score)} из ${formatScore(r.scale_max)}` : "";
  return { text: raw || r.verdict || "—", tone };
}

/** The meaning of the chosen scale step (e.g. «Основной вопрос решён…»), if any. */
export function stepMeaning(r: CriterionResult): string | null {
  if (r.type !== "scale" || !r.applicable || r.raw_score == null) return null;
  const step = r.scale?.find((st) => st.value === r.raw_score);
  return step?.label || (r.verdict && r.verdict !== String(r.raw_score) && r.verdict !== "uncertain" ? r.verdict : null);
}

export function snapshotLabel(verdict: string | null, raw: number | null, scaleMax: number | null): string {
  if (verdict === "na") return "N/A";
  if (verdict === "yes") return "Да";
  if (verdict === "no") return "Нет";
  if (verdict === "uncertain") return "Нужна проверка";
  if (raw != null && scaleMax != null) return `${formatScore(raw)} из ${formatScore(scaleMax)}`;
  return verdict ?? "—";
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
