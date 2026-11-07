import { createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

/* ==========================================================================
   Design tokens — the ONLY place colours, radii, fonts and motion are defined.
   Concept: «чёрный ящик диалога» — a flight-recorder chart. Colour carries
   meaning: orange = violation, yellow = attention, green = done, graphite =
   secondary / pauses. Everything else is ink on recorder paper.
   ========================================================================== */

/** The brief's palette, as given. */
export const palette = {
  paper: "#E3E8E1", // бумага самописца — page background
  ink: "#14201C", // чернила — text, primary actions
  norm: "#1E7A66", // норма — done / ok
  violation: "#FF5A1F", // нарушение — fills and marks only
  violationText: "#C23B0A", // нарушение — text (on raised surfaces, 4.7:1)
  attention: "#D9A21B", // внимание — risk, needs review (fills only)
  graphite: "#5E6B65", // графит — secondary text on raised surfaces, pauses
  grid: "#C5CEC6", // линии сетки
} as const;

/**
 * Derived tones (documented, not new hues): a raised panel surface, a sunken
 * step, darker graphite/green for small text directly on paper (≥5:1), and
 * light tints for highlighting a phrase by event kind.
 */
export const derived = {
  raised: "#EEF2EC", // panels, transcript sheet, inputs
  raisedHover: "#E7ECE5",
  sunken: "#D9DFD7",
  graphiteStrong: "#56625C", // 5.1:1 on paper
  normText: "#1A6B59", // 5.1:1 on paper
  attentionText: "#6B500A", // dark yellow for text on the attention tint
  normTint: "#D6E7DF",
  attentionTint: "#F4E7C4",
  violationTint: "#FFE2D5",
  inkHover: "#25332E",
  inkPressed: "#0B1310",
  onInk: "#F2F5F0",
  normSoft: "#8DBFB0", // "close, within one step" next to exact match (norm)
} as const;

/** Radius by role — not one radius for everything. */
export const radius = { strip: "0", control: "2px", panel: "6px", pill: "999px" } as const;

export const font = {
  ui: '"Onest", system-ui, -apple-system, "Segoe UI", sans-serif',
  doc: '"Literata", Georgia, "Times New Roman", serif',
} as const;

/** Type scale (px): caption · ui · body · transcript · section · title. */
export const type = { xs: "12px", sm: "13px", md: "15px", doc: "17px", lg: "20px", xl: "26px" } as const;

export const motion = { sweepMs: 1400, reactMs: 160 } as const;

export type EventKind = "violation" | "risk" | "pause" | "good";

/** Event colours on the recording strip (fills) and in the transcript (tints). */
export const eventColor: Record<EventKind, { fill: string; tint: string; text: string; label: string }> = {
  violation: { fill: palette.violation, tint: derived.violationTint, text: palette.violationText, label: "нарушение" },
  risk: { fill: palette.attention, tint: derived.attentionTint, text: derived.attentionText, label: "риск" },
  pause: { fill: palette.graphite, tint: derived.sunken, text: derived.graphiteStrong, label: "пауза" },
  good: { fill: palette.norm, tint: derived.normTint, text: derived.normText, label: "выполнено" },
};

/** CSS custom properties for anything that is not a Fluent component (SVG strip, global focus). */
export const cssVars: Record<string, string> = {
  "--cqa-paper": palette.paper,
  "--cqa-ink": palette.ink,
  "--cqa-norm": palette.norm,
  "--cqa-violation": palette.violation,
  "--cqa-violation-text": palette.violationText,
  "--cqa-attention": palette.attention,
  "--cqa-graphite": palette.graphite,
  "--cqa-grid": palette.grid,
  "--cqa-raised": derived.raised,
  "--cqa-sunken": derived.sunken,
  "--cqa-graphite-strong": derived.graphiteStrong,
  "--cqa-font-ui": font.ui,
  "--cqa-font-doc": font.doc,
};

/* ---------------------------------------------------------------- Fluent */

/** Brand ramp built on ink: primary actions, selected tab, checkboxes are ink, not a colour. */
const inkRamp: BrandVariants = {
  10: "#050807",
  20: "#0B1310",
  30: "#101A16",
  40: "#14201C",
  50: "#1B2924",
  60: "#22322C",
  70: "#2A3C35",
  80: "#14201C",
  90: "#25332E",
  100: "#3B4C45",
  110: "#53635C",
  120: "#6E7C76",
  130: "#8D9993",
  140: "#AEB8B2",
  150: "#CDD5CF",
  160: "#E3E8E1",
};

const base = createLightTheme(inkRamp);
const hairline = `0 0 0 1px ${palette.grid}`;
const float = `0 6px 18px rgba(20, 32, 28, 0.14), 0 0 0 1px ${palette.grid}`;

export const appTheme: Theme = {
  ...base,
  // type
  fontFamilyBase: font.ui,
  fontFamilyNumeric: font.ui,
  fontWeightBold: 600,
  // brand = ink
  colorBrandBackground: palette.ink,
  colorBrandBackgroundHover: derived.inkHover,
  colorBrandBackgroundPressed: derived.inkPressed,
  colorBrandBackgroundSelected: derived.inkHover,
  colorCompoundBrandBackground: palette.ink,
  colorCompoundBrandBackgroundHover: derived.inkHover,
  colorCompoundBrandBackgroundPressed: derived.inkPressed,
  colorCompoundBrandForeground1: palette.ink,
  colorCompoundBrandStroke: palette.ink,
  colorBrandStroke1: palette.ink,
  colorBrandStroke2: palette.grid,
  colorBrandForeground1: palette.ink,
  colorBrandForeground2: derived.inkHover,
  colorBrandForegroundLink: palette.ink,
  colorBrandForegroundLinkHover: derived.inkHover,
  colorBrandForegroundLinkPressed: derived.inkPressed,
  colorBrandBackground2: derived.raisedHover,
  colorNeutralForegroundOnBrand: derived.onInk,
  // surfaces: paper page, raised panels
  colorNeutralBackground1: derived.raised,
  colorNeutralBackground1Hover: derived.raisedHover,
  colorNeutralBackground1Pressed: derived.sunken,
  colorNeutralBackground1Selected: derived.raisedHover,
  colorNeutralBackground2: palette.paper,
  colorNeutralBackground2Hover: derived.raisedHover,
  colorNeutralBackground3: derived.raisedHover,
  colorNeutralBackground3Hover: derived.sunken,
  colorNeutralBackground4: derived.sunken,
  colorNeutralBackground5: derived.sunken,
  colorNeutralBackground6: derived.sunken,
  colorSubtleBackgroundHover: derived.raisedHover,
  colorSubtleBackgroundPressed: derived.sunken,
  colorSubtleBackgroundSelected: derived.raisedHover,
  colorTransparentBackgroundHover: derived.raisedHover,
  // text
  colorNeutralForeground1: palette.ink,
  colorNeutralForeground2: "#2C3934",
  colorNeutralForeground3: derived.graphiteStrong,
  colorNeutralForeground4: palette.graphite,
  // lines
  colorNeutralStroke1: "#A9B4AD",
  colorNeutralStroke1Hover: palette.graphite,
  colorNeutralStroke2: palette.grid,
  colorNeutralStroke3: "#D3DAD4",
  colorNeutralStrokeAccessible: palette.graphite,
  colorNeutralStrokeAccessibleHover: palette.ink,
  // semantic palette: red = violation, yellow/marigold = attention, green = norm
  colorPaletteRedBackground1: derived.violationTint,
  colorPaletteRedBackground2: derived.violationTint,
  colorPaletteRedBackground3: palette.violation,
  colorPaletteRedForeground1: palette.violationText,
  colorPaletteRedForeground2: palette.violationText,
  colorPaletteRedForeground3: palette.violationText,
  colorPaletteRedBorder1: palette.violation,
  colorPaletteRedBorder2: palette.violation,
  colorPaletteRedBorderActive: palette.violation,
  colorPaletteDarkOrangeForeground1: derived.attentionText, // issues = attention, not violations
  colorPaletteDarkOrangeBorderActive: palette.attention,
  colorPaletteYellowBackground1: derived.attentionTint,
  colorPaletteYellowBackground2: derived.attentionTint,
  colorPaletteYellowBackground3: palette.attention,
  colorPaletteYellowForeground1: derived.attentionText,
  colorPaletteYellowForeground2: derived.attentionText,
  colorPaletteYellowBorderActive: palette.attention,
  colorPaletteMarigoldBackground1: derived.attentionTint,
  colorPaletteMarigoldBackground2: derived.attentionTint,
  colorPaletteMarigoldBackground3: palette.attention,
  colorPaletteMarigoldForeground1: derived.attentionText,
  colorPaletteMarigoldForeground2: derived.attentionText,
  colorPaletteMarigoldBorderActive: palette.attention,
  colorPaletteGreenBackground1: derived.normTint,
  colorPaletteGreenBackground2: derived.normTint,
  colorPaletteGreenBackground3: palette.norm,
  colorPaletteGreenForeground1: derived.normText,
  colorPaletteGreenForeground2: derived.normText,
  colorPaletteGreenForeground3: derived.normText,
  colorPaletteGreenBorder1: palette.norm,
  colorPaletteGreenBorder2: palette.norm,
  colorPaletteGreenBorderActive: palette.norm,
  colorPaletteLightGreenBorderActive: "#5E9E8C",
  // status: errors are not violations — ink on raised, no orange
  colorStatusDangerBackground1: derived.raised,
  colorStatusDangerBackground2: derived.sunken,
  colorStatusDangerBackground3: palette.ink,
  colorStatusDangerForeground1: palette.ink,
  colorStatusDangerForeground2: palette.ink,
  colorStatusDangerForeground3: palette.ink,
  colorStatusDangerBorder1: palette.ink,
  colorStatusDangerBorder2: palette.ink,
  colorStatusDangerBorderActive: palette.ink,
  colorStatusWarningBackground1: derived.attentionTint,
  colorStatusWarningBackground2: derived.attentionTint,
  colorStatusWarningBackground3: palette.attention,
  colorStatusWarningForeground1: derived.attentionText,
  colorStatusWarningForeground2: derived.attentionText,
  colorStatusWarningForeground3: derived.attentionText,
  colorStatusWarningBorder1: palette.attention,
  colorStatusWarningBorder2: palette.attention,
  colorStatusWarningBorderActive: palette.attention,
  colorStatusSuccessBackground1: derived.normTint,
  colorStatusSuccessBackground2: derived.normTint,
  colorStatusSuccessBackground3: palette.norm,
  colorStatusSuccessForeground1: derived.normText,
  colorStatusSuccessForeground2: derived.normText,
  colorStatusSuccessForeground3: derived.normText,
  colorStatusSuccessBorder1: palette.norm,
  colorStatusSuccessBorder2: palette.norm,
  colorStatusSuccessBorderActive: palette.norm,
  // radius by role, hairlines instead of grey shadows
  borderRadiusSmall: radius.control,
  borderRadiusMedium: radius.control,
  borderRadiusLarge: radius.panel,
  borderRadiusXLarge: "8px",
  shadow2: hairline,
  shadow4: hairline,
  shadow8: float,
  shadow16: float,
  shadow28: float,
  shadow64: float,
  durationFast: `${motion.reactMs}ms`,
};
