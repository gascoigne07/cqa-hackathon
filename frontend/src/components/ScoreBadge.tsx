import { makeStyles, mergeClasses, shorthands } from "@fluentui/react-components";
import type { ReactNode } from "react";
import { formatScore, scoreTone, type Tone } from "../lib/format";
import { derived, palette, radius, type } from "../theme";

/* Small, quiet signals. Orange appears only for a violation verdict; a low
   total score is shown in ink, not orange (a score is not a violation). */

const useStyles = makeStyles({
  tag: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    height: "22px",
    padding: "0 8px",
    borderRadius: radius.control,
    fontSize: type.xs,
    fontWeight: 600,
    lineHeight: "1",
    whiteSpace: "nowrap",
    ...shorthands.border("1px", "solid", "transparent"),
  },
  success: { backgroundColor: derived.normTint, color: derived.normText, ...shorthands.borderColor("#B5D3C7") },
  warning: { backgroundColor: derived.attentionTint, color: derived.attentionText, ...shorthands.borderColor("#E7CD84") },
  danger: { backgroundColor: derived.violationTint, color: palette.violationText, ...shorthands.borderColor("#FFC2A8") },
  subtle: { backgroundColor: "transparent", color: derived.graphiteStrong, ...shorthands.borderColor(palette.grid) },
  informative: { backgroundColor: "transparent", color: palette.ink, ...shorthands.borderColor(palette.ink) },
  // "filled": the strong form, used for the verdict of the selected criterion
  successFilled: { backgroundColor: palette.norm, color: derived.onInk },
  warningFilled: { backgroundColor: palette.attention, color: palette.ink },
  dangerFilled: { backgroundColor: palette.violation, color: palette.ink },
  dot: { width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0 },

  score: { display: "inline-flex", alignItems: "center", gap: "8px", fontVariantNumeric: "tabular-nums" },
  num: { fontWeight: 600, fontSize: type.md, color: palette.ink, minWidth: "34px", textAlign: "right" },
  meter: { position: "relative", width: "44px", height: "4px", backgroundColor: palette.grid },
  fill: { position: "absolute", left: "0", top: "0", bottom: "0" },
  mark: { display: "inline-flex", alignItems: "baseline", gap: "4px", fontVariantNumeric: "tabular-nums" },
  markNum: { fontSize: type.lg, fontWeight: 600, color: palette.ink, lineHeight: "1" },
  markOf: { fontSize: type.xs, color: derived.graphiteStrong },
});

const FILL: Record<Tone, string> = {
  success: palette.norm,
  warning: palette.attention,
  danger: palette.ink,
  subtle: palette.grid,
  informative: palette.ink,
};

/** Verdict / status tag. */
export function ToneBadge({ tone, children, appearance = "tint" }: { tone: Tone; children: ReactNode; appearance?: "tint" | "filled" | "outline" | "ghost" }) {
  const s = useStyles();
  const filled = appearance === "filled" && (tone === "success" || tone === "warning" || tone === "danger");
  return <span className={mergeClasses(s.tag, filled ? s[`${tone}Filled` as const] : s[tone])}>{children}</span>;
}

/** Total score in a list row: number + a short meter. */
export function ScoreBadge({ score }: { score: number | null | undefined }) {
  const s = useStyles();
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <span className={s.score} aria-label={`Итог ${formatScore(score)} из 100`}>
      <span className={s.num}>{formatScore(score)}</span>
      <span className={s.meter} aria-hidden>
        <span className={s.fill} style={{ width: `${pct}%`, backgroundColor: FILL[scoreTone(score)] }} />
      </span>
    </span>
  );
}

/** Total score next to a title: small, not a hero number. */
export function ScoreMark({ score }: { score: number | null | undefined }) {
  const s = useStyles();
  return (
    <span className={s.mark} aria-label={`Итог ${formatScore(score)} из 100`}>
      <span className={s.markNum}>{formatScore(score)}</span>
      <span className={s.markOf}>из 100</span>
    </span>
  );
}
