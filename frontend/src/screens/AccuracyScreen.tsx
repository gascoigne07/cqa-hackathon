import {
  Caption1,
  Card,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { InfoRegular } from "@fluentui/react-icons";
import { useMemo } from "react";
import { ToneBadge } from "../components/ScoreBadge";
import calib from "../data/calibration.json";
import { href } from "../router";
import { derived, palette, radius, type } from "../theme";

/* ------------------------------------------------------------------ */
/* Data: frontend/src/data/calibration.json                            */
/* ------------------------------------------------------------------ */

interface CriterionAgreement {
  id: string;
  name: string;
  /** Exact match with the gold standard, 0–100. */
  agreement_pct: number;
  /** Scale criteria only: AI within one scale step of the gold standard, 0–100. */
  within_step_pct?: number;
}

interface DialogComparison {
  id: string;
  lang: string;
  /** "call" for phone calls; absent for chats. */
  channel?: string;
  human: number;
  ai: number;
}

interface CalibrationData {
  model: string;
  gold_dialogs: number;
  mae: number;
  within_10: number;
  within_1_pct: number; // adjacent agreement across all criteria (the honest metric for subjective scales)
  gross_error_match: string;
  note: string;
  criteria: CriterionAgreement[];
  dialogs: DialogComparison[];
}

const data = calib as CalibrationData;

/** |Δ| ≤ CLOSE — the AI total agrees with the human one (same threshold as the «±10» card). */
const CLOSE = 10;
/** |Δ| > FAR — a large divergence. Between CLOSE and FAR — a noticeable one. */
const FAR = 20;

type Band = "close" | "mid" | "far";
const BANDS: Band[] = ["close", "mid", "far"];
const bandOf = (absDelta: number): Band => (absDelta <= CLOSE ? "close" : absDelta <= FAR ? "mid" : "far");

const BAND_LABEL: Record<Band, string> = {
  close: `|Δ| ≤ ${CLOSE} — совпадает`,
  mid: `${CLOSE} < |Δ| ≤ ${FAR}`,
  far: `|Δ| > ${FAR} — расхождение`,
};

/** One colour per band. A divergence is not a violation, so no orange here:
    close = norm, noticeable = attention, large = ink. */
const BAND_COLOR: Record<Band, string> = {
  close: palette.norm,
  mid: palette.attention,
  far: palette.ink,
};
/** Same bands as text (Δ numbers) — darker tones that keep 4.5:1 on panels. */
const BAND_TEXT: Record<Band, string> = {
  close: derived.normText,
  mid: derived.attentionText,
  far: palette.ink,
};

/** Calibration figures keep two decimals: columns line up and nothing is hidden by rounding. */
const num2 = (n: number) => n.toFixed(2).replace(".", ",");
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const isCallChannel = (channel?: string) => channel === "call" || (channel ?? "").startsWith("voice");

/** Russian plural: plural(5, ["диалог", "диалога", "диалогов"]) → "диалогов". */
function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** "8/8" → { matched: 8, total: 8 } */
function parseRatio(text: string): { matched: number; total: number } {
  const [a, b] = text.split("/").map((x) => Number(x.trim()));
  return { matched: Number.isFinite(a) ? a : 0, total: Number.isFinite(b) ? b : 0 };
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const PHONE = "@media (max-width: 600px)";
const PHONE_Q = PHONE;

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "16px" },
  muted: { color: tokens.colorNeutralForeground3 },
  num: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },

  h1: { margin: "0 0 4px", fontSize: type.xl, fontWeight: 600, lineHeight: "1.15", color: palette.ink },
  h2: { margin: 0, fontSize: type.md, fontWeight: 600, color: palette.ink },

  /* one lead figure (MAE), the rest quieter beside it */
  stats: {
    display: "grid",
    gridTemplateColumns: "minmax(240px, 1.3fr) repeat(3, minmax(0, 1fr))",
    backgroundColor: derived.raised,
    border: `1px solid ${palette.grid}`,
    borderRadius: radius.panel,
    "@media (max-width: 1000px)": { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
    [PHONE_Q]: { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  lead: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "16px 18px",
    borderRight: `1px solid ${palette.grid}`,
    "@media (max-width: 1000px)": { gridColumn: "1 / -1", borderRight: "none", borderBottom: `1px solid ${palette.grid}` },
  },
  leadValue: { fontSize: "44px", lineHeight: "1", fontWeight: 600, color: palette.ink, fontVariantNumeric: "tabular-nums" },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "16px 18px",
    borderRight: `1px solid ${palette.grid}`,
    ":last-child": { borderRight: "none" },
    [PHONE_Q]: { borderRight: "none", borderBottom: `1px solid ${palette.grid}`, ":last-child": { borderBottom: "none" } },
  },
  statLabel: { fontSize: type.xs, color: derived.graphiteStrong },
  statValue: { fontSize: type.lg, lineHeight: "1.2", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: palette.ink },
  statUnit: { fontSize: type.sm, fontWeight: 400, color: derived.graphiteStrong },
  statHint: { fontSize: type.xs, color: derived.graphiteStrong, lineHeight: "1.4" },

  columns: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
    gap: "16px",
    "@media (max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  section: { padding: "16px", gap: "14px" },
  sectionHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px 12px", flexWrap: "wrap" },

  legend: { display: "flex", gap: "6px 14px", flexWrap: "wrap", alignItems: "center" },
  legendItem: { display: "inline-flex", alignItems: "center", gap: "6px" },
  swatch: { width: "10px", height: "10px", borderRadius: radius.control, flexShrink: 0 },

  // Grows to the height of the neighbouring chart and spreads the rows evenly.
  bars: { display: "flex", flexDirection: "column", gap: "16px", flexGrow: 1, justifyContent: "space-evenly" },
  barRow: {
    display: "grid",
    gridTemplateColumns: "minmax(150px, 330px) minmax(0, 1fr)",
    gap: "12px",
    alignItems: "center",
    [PHONE]: { gridTemplateColumns: "minmax(0, 1fr)", gap: "4px" },
  },
  barLabel: { display: "flex", gap: "6px", alignItems: "baseline", minWidth: 0 },
  barId: { color: tokens.colorNeutralForeground3, fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  barStack: { display: "flex", flexDirection: "column", gap: "4px" },
  barLine: { display: "flex", alignItems: "center", gap: "10px" },
  track: {
    position: "relative",
    flexGrow: 1,
    minWidth: "60px",
    height: "10px",
    borderRadius: radius.strip,
    backgroundColor: derived.sunken,
    overflow: "hidden",
  },
  trackThin: { height: "5px" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "inherit" },
  barValue: { minWidth: "44px", textAlign: "right", fontVariantNumeric: "tabular-nums" },

  scatterBox: { width: "100%", maxWidth: "420px", alignSelf: "center" },
  scatter: { width: "100%", height: "auto", display: "block" },

  tableWrap: { overflowX: "auto", borderRadius: tokens.borderRadiusMedium },
  // Desktop: fixed columns. Phone: columns shrink to their content so Δ stays on screen.
  table: { minWidth: "520px", [PHONE]: { minWidth: "0", tableLayout: "auto" } },
  colLang: { width: "80px", [PHONE]: { width: "auto" } },
  // Phone: halve Fluent's 8px cell padding so all five columns fit on a 390px screen.
  cell: { [PHONE]: { paddingLeft: "4px", paddingRight: "4px" } },
  colNum: { width: "110px", [PHONE]: { width: "auto" } },
  idCell: { display: "inline-flex", alignItems: "center", gap: "4px 8px", flexWrap: "wrap" },
  nowrap: { whiteSpace: "nowrap" },
  right: { textAlign: "right" },
  headRight: { "& > *": { justifyContent: "flex-end", width: "100%" } },
  delta: { display: "inline-flex", alignItems: "center", gap: "6px", fontVariantNumeric: "tabular-nums", fontWeight: 600, whiteSpace: "nowrap" },
  deltaDot: { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0 },

  method: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "12px 22px",
    padding: "14px 16px",
    backgroundColor: derived.raised,
    border: `1px solid ${palette.grid}`,
    borderRadius: radius.panel,
  },
  methodTitle: { margin: 0, fontSize: type.sm, fontWeight: 600, color: palette.ink, gridColumn: "1 / -1" },
  methodItem: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  methodHead: { fontSize: type.sm, fontWeight: 600, color: palette.ink },
  methodBody: { fontSize: type.xs, lineHeight: "1.45", color: derived.graphiteStrong },

  note: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "4px 0 4px 14px",
    borderLeft: `2px solid ${palette.ink}`,
    maxWidth: "90ch",
  },
  noteIcon: { color: derived.graphiteStrong, fontSize: "18px", flexShrink: 0, marginTop: "2px" },
  empty: { padding: "8px 0" },
});

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function Stat({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint: string }) {
  const s = useStyles();
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>
        {value}
        {unit ? <span className={s.statUnit}> {unit}</span> : null}
      </span>
      <span className={s.statHint}>{hint}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agreement by criterion — plain div bars                             */
/* ------------------------------------------------------------------ */

const EXACT_COLOR = palette.norm;
const STEP_COLOR = derived.normSoft;

function Bar({ value, color, label, thin }: { value: number; color: string; label: string; thin?: boolean }) {
  const s = useStyles();
  const width = Math.max(0, Math.min(100, value));
  return (
    <div
      className={mergeClasses(s.track, thin && s.trackThin)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
    >
      <div className={s.fill} style={{ width: `${width}%`, backgroundColor: color }} />
    </div>
  );
}

function CriteriaBars({ criteria }: { criteria: CriterionAgreement[] }) {
  const s = useStyles();
  return (
    <Card className={s.section}>
      <div className={s.sectionHead}>
        <h2 className={s.h2}>Совпадение с эталоном по критериям</h2>
        <div className={s.legend}>
          <span className={s.legendItem}>
            <span className={s.swatch} style={{ backgroundColor: EXACT_COLOR }} />
            <Caption1>точное совпадение</Caption1>
          </span>
          <span className={s.legendItem}>
            <span className={s.swatch} style={{ backgroundColor: STEP_COLOR }} />
            <Caption1>в пределах одной ступени шкалы</Caption1>
          </span>
        </div>
      </div>
      {criteria.length === 0 ? (
        <Text className={s.empty}>Нет данных по критериям.</Text>
      ) : (
        <div className={s.bars}>
          {criteria.map((c) => (
            <div key={c.id} className={s.barRow}>
              <div className={s.barLabel}>
                <Caption1 className={s.barId}>{Number(c.id.replace(/^c/i, "")) || c.id}</Caption1>
                <Text size={300} truncate wrap={false} title={c.name}>
                  {c.name}
                </Text>
              </div>
              <div className={s.barStack}>
                <div className={s.barLine}>
                  <Bar value={c.agreement_pct} color={EXACT_COLOR} label={`${c.name}: точное совпадение`} />
                  <Text weight="semibold" className={s.barValue}>
                    {c.agreement_pct}%
                  </Text>
                </div>
                {c.within_step_pct != null ? (
                  <div className={s.barLine}>
                    <Bar value={c.within_step_pct} color={STEP_COLOR} label={`${c.name}: в пределах одной ступени`} thin />
                    <Caption1 className={mergeClasses(s.barValue, s.muted)}>{c.within_step_pct}%</Caption1>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* AI vs human scatter — inline SVG, no chart library                  */
/* ------------------------------------------------------------------ */

const SIZE = 320;
const PAD = 36;
const INNER = SIZE - PAD * 2;
const clamp100 = (v: number) => Math.max(0, Math.min(100, v));
const sx = (v: number) => PAD + (clamp100(v) / 100) * INNER;
const sy = (v: number) => SIZE - PAD - (clamp100(v) / 100) * INNER;

type Box = [number, number, number, number]; // x1, y1, x2, y2
const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

interface PointLabel {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  text: string;
}

interface ScatterPoint {
  key: string;
  human: number;
  ai: number;
  ids: string[];
  cx: number;
  cy: number;
  r: number;
  band: Band;
  label?: PointLabel;
}

/** Dialogs with identical scores share one dot with a «×N» label; labels avoid other dots and labels. */
function layoutPoints(dialogs: DialogComparison[]): ScatterPoint[] {
  const groups = new Map<string, ScatterPoint>();
  for (const d of dialogs) {
    const key = `${d.human}|${d.ai}`;
    const g = groups.get(key);
    if (g) g.ids.push(d.id);
    else
      groups.set(key, {
        key,
        human: d.human,
        ai: d.ai,
        ids: [d.id],
        cx: sx(d.human),
        cy: sy(d.ai),
        r: 5,
        band: bandOf(Math.abs(d.ai - d.human)),
      });
  }
  const points = [...groups.values()];
  for (const p of points) if (p.ids.length > 1) p.r = 6;

  const dotBoxes = points.map((p) => ({ key: p.key, box: [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r] as Box }));
  const labelBoxes: Box[] = [];
  const labelled = points.filter((p) => p.ids.length > 1).sort((a, b) => b.ids.length - a.ids.length);

  for (const p of labelled) {
    const text = `×${p.ids.length}`;
    const w = text.length * 6.5;
    const candidates: PointLabel[] = [
      { x: p.cx, y: p.cy - p.r - 4, anchor: "middle", text }, // above
      { x: p.cx - p.r - 4, y: p.cy + 3.5, anchor: "end", text }, // left
      { x: p.cx + p.r + 4, y: p.cy + 3.5, anchor: "start", text }, // right
      { x: p.cx, y: p.cy + p.r + 12, anchor: "middle", text }, // below
    ];
    const boxOf = (c: PointLabel): Box => {
      const x1 = c.anchor === "middle" ? c.x - w / 2 : c.anchor === "end" ? c.x - w : c.x;
      return [x1, c.y - 9, x1 + w, c.y + 2];
    };
    const free = candidates.find((c) => {
      const b = boxOf(c);
      const inside = b[0] >= 0 && b[1] >= 0 && b[2] <= SIZE && b[3] <= SIZE;
      return inside && !dotBoxes.some((d) => d.key !== p.key && overlaps(b, d.box)) && !labelBoxes.some((l) => overlaps(b, l));
    });
    p.label = free ?? candidates[0];
    labelBoxes.push(boxOf(p.label));
  }
  return points;
}

function Scatter({ dialogs }: { dialogs: DialogComparison[] }) {
  const s = useStyles();
  const ticks = [0, 25, 50, 75, 100];
  const points = useMemo(() => layoutPoints(dialogs), [dialogs]);

  // Band |AI − human| ≤ CLOSE around the diagonal, clipped to the 0..100 square.
  const band = [
    [0, CLOSE],
    [100 - CLOSE, 100],
    [100, 100],
    [100, 100 - CLOSE],
    [CLOSE, 0],
    [0, 0],
  ]
    .map(([h, a]) => `${sx(h)},${sy(a)}`)
    .join(" ");

  return (
    <Card className={s.section}>
      <div className={s.sectionHead}>
        <h2 className={s.h2}>ИИ против человека</h2>
        <Caption1 className={s.muted}>точка — итог одного диалога</Caption1>
      </div>
      <div className={s.scatterBox}>
        <svg className={s.scatter} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Итог человека (ось X) против итога ИИ (ось Y) по каждому диалогу">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={sx(t)} y1={sy(0)} x2={sx(t)} y2={sy(100)} stroke={palette.grid} strokeWidth={1} />
              <line x1={sx(0)} y1={sy(t)} x2={sx(100)} y2={sy(t)} stroke={palette.grid} strokeWidth={1} />
              <text x={sx(t)} y={SIZE - PAD + 16} fontSize={10} textAnchor="middle" fill={tokens.colorNeutralForeground3}>
                {t}
              </text>
              <text x={PAD - 8} y={sy(t) + 3} fontSize={10} textAnchor="end" fill={tokens.colorNeutralForeground3}>
                {t}
              </text>
            </g>
          ))}
          <polygon points={band} fill={derived.normTint} />
          <line x1={sx(0)} y1={sy(0)} x2={sx(100)} y2={sy(100)} stroke={palette.ink} strokeWidth={1} strokeDasharray="4 3" />
          {points.map((p) => (
            <circle key={p.key} cx={p.cx} cy={p.cy} r={p.r} fill={BAND_COLOR[p.band]} stroke={derived.raised} strokeWidth={1.5}>
              <title>{`${p.ids.join(", ")} — человек ${num2(p.human)}, ИИ ${num2(p.ai)}`}</title>
            </circle>
          ))}
          {points.map((p) =>
            p.label ? (
              <text
                key={`${p.key}-n`}
                x={p.label.x}
                y={p.label.y}
                fontSize={10}
                fontWeight={600}
                textAnchor={p.label.anchor}
                fill={tokens.colorNeutralForeground2}
              >
                {p.label.text}
              </text>
            ) : null,
          )}
          <text x={SIZE / 2} y={SIZE - 4} fontSize={11} textAnchor="middle" fill={tokens.colorNeutralForeground2}>
            Человек (эталон)
          </text>
          <text x={10} y={SIZE / 2} fontSize={11} textAnchor="middle" fill={tokens.colorNeutralForeground2} transform={`rotate(-90 10 ${SIZE / 2})`}>
            ИИ
          </text>
        </svg>
      </div>
      <div className={s.legend}>
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ backgroundColor: derived.normTint, border: `1px solid ${palette.norm}` }} />
          <Caption1>зона ±{CLOSE}</Caption1>
        </span>
        {BANDS.map((b) => (
          <span key={b} className={s.legendItem}>
            <span className={s.swatch} style={{ backgroundColor: BAND_COLOR[b] }} />
            <Caption1>{BAND_LABEL[b]}</Caption1>
          </span>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Per-dialog table: id | язык | human | ai | Δ                        */
/* ------------------------------------------------------------------ */

function DialogsTable({ dialogs }: { dialogs: DialogComparison[] }) {
  const s = useStyles();
  const rows = useMemo(
    () =>
      dialogs
        .map((d) => ({ ...d, delta: d.ai - d.human }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.id.localeCompare(b.id)),
    [dialogs],
  );

  return (
    <Card className={s.section}>
      <div className={s.sectionHead}>
        <h2 className={s.h2}>ИИ и человек по каждому диалогу</h2>
        <div className={s.legend}>
          {BANDS.map((b) => (
            <span key={b} className={s.legendItem}>
              <span className={s.swatch} style={{ backgroundColor: BAND_COLOR[b] }} />
              <Caption1>{BAND_LABEL[b]}</Caption1>
            </span>
          ))}
        </div>
      </div>
      <Caption1 className={s.muted}>Сначала самые большие расхождения. Δ = ИИ − человек: минус — ИИ строже эталона, плюс — мягче.</Caption1>
      {rows.length === 0 ? (
        <Text className={s.empty}>Нет диалогов для сравнения.</Text>
      ) : (
        <div className={s.tableWrap}>
          <Table size="small" className={s.table} aria-label="Итог ИИ против итога человека по каждому диалогу">
            <TableHeader>
              <TableRow>
                <TableHeaderCell className={s.cell}>Диалог</TableHeaderCell>
                <TableHeaderCell className={mergeClasses(s.cell, s.colLang)}>Язык</TableHeaderCell>
                <TableHeaderCell className={mergeClasses(s.cell, s.colNum, s.headRight)}>Человек</TableHeaderCell>
                <TableHeaderCell className={mergeClasses(s.cell, s.colNum, s.headRight)}>ИИ</TableHeaderCell>
                <TableHeaderCell className={mergeClasses(s.cell, s.colNum, s.headRight)}>Δ</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => {
                const abs = Math.abs(d.delta);
                const b = bandOf(abs);
                const sign = d.delta > 0 ? "+" : d.delta < 0 ? "−" : "";
                return (
                  <TableRow key={d.id} data-band={b}>
                    <TableCell className={s.cell}>
                      <span className={s.idCell}>
                        <Link className={s.nowrap} href={href({ name: "dialog", id: d.id })}>
                          {d.id}
                        </Link>
                        {isCallChannel(d.channel) ? <ToneBadge tone="subtle">звонок</ToneBadge> : null}
                      </span>
                    </TableCell>
                    <TableCell className={s.cell}>{d.lang}</TableCell>
                    <TableCell className={mergeClasses(s.cell, s.right, s.num)}>{num2(d.human)}</TableCell>
                    <TableCell className={mergeClasses(s.cell, s.right, s.num)}>{num2(d.ai)}</TableCell>
                    <TableCell className={mergeClasses(s.cell, s.right)}>
                      <span className={s.delta} style={{ color: BAND_TEXT[b] }}>
                        <span className={s.deltaDot} style={{ backgroundColor: BAND_COLOR[b] }} aria-hidden />
                        {sign}
                        {num2(abs)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export function AccuracyScreen() {
  const s = useStyles();
  const gross = parseRatio(data.gross_error_match);
  const allGrossFound = gross.total > 0 && gross.matched === gross.total;
  const calls = data.dialogs.filter((d) => isCallChannel(d.channel)).length;
  const chats = data.dialogs.length - calls;
  const languages = [...new Set(data.dialogs.map((d) => d.lang))].join(", ");
  const composition = [
    chats ? `${chats} ${plural(chats, ["чат", "чата", "чатов"])}` : "",
    calls ? `${calls} ${plural(calls, ["звонок", "звонка", "звонков"])}` : "",
  ]
    .filter(Boolean)
    .join(" и ");

  return (
    <div className={s.root}>
      <div>
        <h1 className={s.h1}>Точность</h1>
        <Caption1 className={s.muted} block>
          Насколько итоговые оценки ИИ совпадают с эталоном, размеченным по чек-листу · модель: {data.model}
        </Caption1>
      </div>

      <div className={s.stats}>
        <div className={s.lead}>
          <span className={s.statLabel}>Средняя ошибка итога (MAE)</span>
          <span className={s.leadValue}>
            {String(data.mae).replace(".", ",")}
            <span className={s.statUnit}> из 100</span>
          </span>
          <span className={s.statHint}>на столько баллов в среднем итог ИИ отличается от эталона</span>
        </div>
        <Stat
          label={`В пределах ±${CLOSE} баллов`}
          value={`${data.within_10}/${data.gold_dialogs}`}
          unit={`(${percent(data.within_10, data.gold_dialogs)}%)`}
          hint="диалогов, где итог ИИ близок к эталону"
        />
        <Stat
          label="Совпадение по критериям (±1 шаг)"
          value={`${String(data.within_1_pct).replace(".", ",")}%`}
          hint="вердикт в пределах одного шага шкалы — стандартная метрика для субъективной оценки"
        />
        <Stat
          label="Грубые ошибки"
          value={data.gross_error_match}
          unit={`(${percent(gross.matched, gross.total)}%)`}
          hint={allGrossFound ? "ИИ нашёл все грубые ошибки из эталона" : "совпадение флага грубой ошибки с эталоном"}
        />
        <Stat
          label="Эталон"
          value={String(data.gold_dialogs)}
          unit={plural(data.gold_dialogs, ["диалог", "диалога", "диалогов"])}
          hint={[composition, languages].filter(Boolean).join(" · ") || "размечены по чек-листу"}
        />
      </div>

      <div className={s.columns}>
        <CriteriaBars criteria={data.criteria} />
        <Scatter dialogs={data.dialogs} />
      </div>

      <DialogsTable dialogs={data.dialogs} />

      <div className={s.method}>
        <p className={s.methodTitle}>Как мы это меряем — и почему этому можно верить</p>
        <div className={s.methodItem}>
          <span className={s.methodHead}>Честно против эксперта</span>
          <span className={s.methodBody}>Оценки ИИ сверяются с эталоном, размеченным вручную по чек-листу. Это не самооценка модели.</span>
        </div>
        <div className={s.methodItem}>
          <span className={s.methodHead}>Воспроизводимо</span>
          <span className={s.methodBody}>Каждый диалог — голосование из 5 прогонов (self-consistency); уверенность и флаг «проверить» на спорных.</span>
        </div>
        <div className={s.methodItem}>
          <span className={s.methodHead}>Правильная метрика</span>
          <span className={s.methodBody}>На субъективных шкалах exact-match искажён. Показываем и точное совпадение, и согласие в пределах одного шага — стандарт надёжности.</span>
        </div>
        <div className={s.methodItem}>
          <span className={s.methodHead}>Прозрачно</span>
          <span className={s.methodBody}>Каждый вердикт — с цитатой из диалога; спорную оценку можно оспорить и пересмотреть.</span>
        </div>
      </div>

      <div className={s.note}>
        <InfoRegular className={s.noteIcon} />
        <Text>{data.note}</Text>
      </div>
    </div>
  );
}
