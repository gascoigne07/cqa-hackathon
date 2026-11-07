import { Badge, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { formatScore, scoreTone, type Tone } from "../lib/format";

const toneColor: Record<Tone, "success" | "warning" | "danger" | "informative" | "subtle"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  informative: "informative",
  subtle: "subtle",
};

export function ToneBadge({ tone, children, appearance = "tint" }: { tone: Tone; children: React.ReactNode; appearance?: "tint" | "filled" | "outline" | "ghost" }) {
  return (
    <Badge appearance={appearance} color={toneColor[tone]} shape="rounded">
      {children}
    </Badge>
  );
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  return (
    <Badge appearance="filled" color={toneColor[scoreTone(score)]} shape="rounded" size="large">
      {formatScore(score)}
    </Badge>
  );
}

const useStyles = makeStyles({
  big: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "4px",
    fontSize: "44px",
    lineHeight: "48px",
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
  },
  success: { color: tokens.colorPaletteGreenForeground1 },
  warning: { color: tokens.colorPaletteMarigoldForeground2 },
  danger: { color: tokens.colorPaletteRedForeground1 },
  subtle: { color: tokens.colorNeutralForeground3 },
  informative: { color: tokens.colorNeutralForeground1 },
  of: { fontSize: tokens.fontSizeBase400, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular },
});

export function BigScore({ score }: { score: number | null | undefined }) {
  const s = useStyles();
  return (
    <span className={mergeClasses(s.big, s[scoreTone(score)])}>
      {formatScore(score)}
      <span className={s.of}>/ 100</span>
    </span>
  );
}
