import {
  Badge,
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
  Title3,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  BookOpenRegular,
  CheckmarkCircleRegular,
  InfoRegular,
  ShieldErrorRegular,
  TargetArrowRegular,
} from "@fluentui/react-icons";
import { useMemo } from "react";
import calib from "../data/calibration.json";
import { href } from "../router";
import { BRAND_GREEN, BRAND_TEXT, freedomBrand } from "../theme";

/* ---------- data shape (calibration.json) ---------- */

interface CriterionAgreement {
  id: string;
  name: string;
  agreement_pct: number;
  within_step_pct?: number;
}

interface DialogComparison {
  id: string;
  lang: string;
  channel?: string;
  human: number;
  ai: number;
}

interface CalibrationData {
  model: string;
  gold_dialogs: number;
  mae: number;
  within_10: number;
  gross_error_match: string;
  note: string;
  criteria: CriterionAgreement[];
  dialogs: DialogComparison[];
}

const data = calib as CalibrationData;

/** |Δ| up to this many points counts as agreement (matches the "±10" card). */
const CLOSE = 10;
/** |Δ| above this is a large divergence (red). Between CLOSE and FAR — yellow. */
const FAR = 20;

type Band = "close" | "mid" | "far";
const bandOf = (absDelta: number): Band => (absDelta <= CLOSE ? "close" : absDelta <= FAR ? "mid" : "far");

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** "8/8" -> { matched: 8, total: 8 } */
function parseRatio(s: string): { matched: number; total: number } {
  const [a, b] = s.split("/").map((x) => Number(x.trim()));
  return { matched: Number.isFinite(a) ? a : 0, total: Number.isFinite(b) ? b : 0 };
}

/* ---------- styles ---------- */

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "16px" },
  header: { display: "flex", flexDirection: "column", gap: "4px" },
  muted: { color: tokens.colorNeutralForeground3 },
  num: { fontVariantNumeric: "tabular-nums" },

  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "12px" },
  stat: { padding: "14px 16px", gap: "6px", borderTop: `3px solid ${BRAND_GREEN}` },
  statHead: { display: "flex", alignItems: "center", gap: "6px", color: tokens.colorNeutralForeground3 },
  statIcon: { color: BRAND_TEXT, fontSize: "18px" },
  statValue: {
    fontSize: tokens.fontSizeHero800,
    lineHeight: tokens.lineHeightHero800,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
    color: tokens.colorNeutralForeground1,
  },
  statUnit: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightRegular, color: tokens.colorNeutralForeground3 },

  grid2: { display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: "16px", "@media (max-width: 1000px)": { gridTemplateColumns: "1fr" } },
  section: { padding: "16px", gap: "12px" },
  sectionHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", flexWrap: "wrap" },

  legend: { display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "center" },
  legendItem: { display: "inline-flex", alignItems: "center", gap: "6px" },
  swatch: { width: "12px", height: "12px", borderRadius: "3px", flexShrink: 0 },

  bars: { display: "flex", flexDirection: "column", gap: "16px" },
  barRow: { display: "grid", gridTemplateColumns: "minmax(140px, 330px) 1fr", gap: "12px", alignItems: "center", "@media (max-width: 600px)": { gridTemplateColumns: "1fr", gap: "4px" } },
  barLabel: { display: "flex", gap: "6px", alignItems: "baseline", minWidth: 0 },
  barId: { color: tokens.colorNeutralForeground3, fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  barStack: { display: "flex", flexDirection: "column", gap: "4px" },
  track: { position: "relative", flexGrow: 1, minWidth: "60px", height: "14px", borderRadius: "7px", backgroundColor: tokens.colorNeutralBackground3, overflow: "hidden" },
  trackThin: { height: "8px" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: "7px", transitionProperty: "width", transitionDuration: tokens.durationSlow },
  barValue: { display: "flex", alignItems: "center", gap: "10px" },

  scatterWrap: { width: "100%", maxWidth: "420px", alignSelf: "center" },
  scatter: { width: "100%", height: "auto", display: "block" },

  tableWrap: { overflowX: "auto", backgroundColor: tokens.colorNeutralBackground1, borderRadius: tokens.borderRadiusLarge },
  close: { backgroundColor: tokens.colorPaletteGreenBackground1 },
  mid: { backgroundColor: tokens.colorPaletteYellowBackground1 },
  far: { backgroundColor: tokens.colorPaletteRedBackground1 },
  right: { textAlign: "right" },
  headRight: { textAlign: "right", "& > *": { justifyContent: "flex-end", width: "100%" } },
  deltaCell: { display: "inline-flex", alignItems: "center", gap: "6px", fontVariantNumeric: "tabular-nums", fontWeight: tokens.fontWeightSemibold },

  note: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "12px 16px",
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground2,
    borderLeft: `4px solid ${BRAND_GREEN}`,
  },
  noteIcon: { color: BRAND_TEXT, fontSize: "20px", flexShrink: 0, marginTop: "1px" },
});

/* ---------- pieces ---------- */

function Stat({ icon, label, value, unit, hint }: { icon: React.ReactNode; label: string; value: string; unit?: string; hint: string }) {
  const s = useStyles();
  return (
    <Card className={s.stat}>
      <div className={s.statHead}>
        <span className={s.statIcon}>{icon}</span>
        <Caption1>{label}</Caption1>
      </div>
      <div className={s.statValue}>
        {value}
        {unit ? <span className={s.statUnit}> {unit}</span> : null}
      </div>
      <Caption1 className={s.muted}>{hint}</Caption1>
    </Card>
  );
}

function Bar({ value, color, thin }: { value: number; color: string; thin?: boolean }) {
  const s = useStyles();
  const w = Math.max(0, Math.min(100, value));
  return (
    <div
      className={mergeClasses(s.track, thin && s.trackThin)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={w}
    >
      <div className={s.fill} style={{ width: `${w}%`, backgroundColor: color }} />
    </div>
  );
}

const EXACT_COLOR = freedomBrand[70];
const STEP_COLOR = freedomBrand[110];

function CriteriaBars({ criteria }: { criteria: CriterionAgreement[] }) {
  const s = useStyles();
  return (
    <Card className={s.section}>
      <div className={s.sectionHead}>
        <Text weight="semibold" size={400}>
          Совпадение с эталоном по критериям
        </Text>
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
      <div className={s.bars}>
        {criteria.map((c) => (
          <div key={c.id} className={s.barRow}>
            <div className={s.barLabel}>
              <Caption1 className={s.barId}>{c.id.replace(/^c/, "")}</Caption1>
              <Text size={300} truncate wrap={false} title={c.name}>
                {c.name}
              </Text>
            </div>
            <div className={s.barStack}>
              <div className={s.barValue}>
                <Bar value={c.agreement_pct} color={EXACT_COLOR} />
                <Text weight="semibold" className={s.num} style={{ minWidth: "44px", textAlign: "right" }}>
                  {c.agreement_pct}%
                </Text>
              </div>
              {c.within_step_pct != null ? (
                <div className={s.barValue}>
                  <Bar value={c.within_step_pct} color={STEP_COLOR} thin />
                  <Caption1 className={mergeClasses(s.num, s.muted)} style={{ minWidth: "44px", textAlign: "right" }}>
                    {c.within_step_pct}%
                  </Caption1>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Lightweight SVG scatter: human (x) vs AI (y), diagonal and ±10 band. */
function Scatter({ dialogs }: { dialogs: DialogComparison[] }) {
  const s = useStyles();
  const size = 320;
  const pad = 36;
  const inner = size - pad * 2;
  const x = (v: number) => pad + (v / 100) * inner;
  const y = (v: number) => size - pad - (v / 100) * inner;
  const ticks = [0, 25, 50, 75, 100];
  const dotColor: Record<Band, string> = {
    close: freedomBrand[70],
    mid: tokens.colorPaletteMarigoldForeground2,
    far: tokens.colorPaletteRedForeground1,
  };
  // ±CLOSE band around the diagonal, clipped to the 0..100 square
  const band = [
    [0, CLOSE],
    [100 - CLOSE, 100],
    [100, 100],
    [100, 100 - CLOSE],
    [CLOSE, 0],
    [0, 0],
  ]
    .map(([h, a]) => `${x(h)},${y(a)}`)
    .join(" ");

  return (
    <Card className={s.section}>
      <div className={s.sectionHead}>
        <Text weight="semibold" size={400}>
          ИИ против человека
        </Text>
        <Caption1 className={s.muted}>каждая точка — диалог</Caption1>
      </div>
      <div className={s.scatterWrap}>
        <svg className={s.scatter} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Диаграмма рассеяния: оценка человека против оценки ИИ">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} y1={y(0)} x2={x(t)} y2={y(100)} stroke={tokens.colorNeutralStroke3} strokeWidth={1} />
              <line x1={x(0)} y1={y(t)} x2={x(100)} y2={y(t)} stroke={tokens.colorNeutralStroke3} strokeWidth={1} />
              <text x={x(t)} y={size - pad + 16} fontSize={10} textAnchor="middle" fill={tokens.colorNeutralForeground3}>
                {t}
              </text>
              <text x={pad - 8} y={y(t) + 3} fontSize={10} textAnchor="end" fill={tokens.colorNeutralForeground3}>
                {t}
              </text>
            </g>
          ))}
          <polygon points={band} fill={freedomBrand[150]} />
          <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} stroke={freedomBrand[80]} strokeWidth={1.5} strokeDasharray="4 3" />
          {dialogs.map((d) => {
            const b = bandOf(Math.abs(d.ai - d.human));
            return (
              <circle key={d.id} cx={x(d.human)} cy={y(d.ai)} r={5} fill={dotColor[b]} fillOpacity={0.85} stroke="#fff" strokeWidth={1}>
                <title>{`${d.id}: человек ${fmt(d.human)}, ИИ ${fmt(d.ai)}`}</title>
              </circle>
            );
          })}
          <text x={size / 2} y={size - 4} fontSize={11} textAnchor="middle" fill={tokens.colorNeutralForeground2}>
            Человек (эталон)
          </text>
          <text x={10} y={size / 2} fontSize={11} textAnchor="middle" fill={tokens.colorNeutralForeground2} transform={`rotate(-90 10 ${size / 2})`}>
            ИИ
          </text>
        </svg>
      </div>
      <div className={s.legend}>
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ backgroundColor: freedomBrand[150], border: `1px solid ${freedomBrand[120]}` }} />
          <Caption1>зона ±{CLOSE}</Caption1>
        </span>
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ backgroundColor: dotColor.close }} />
          <Caption1>|Δ| ≤ {CLOSE}</Caption1>
        </span>
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ backgroundColor: dotColor.mid }} />
          <Caption1>
            {CLOSE}–{FAR}
          </Caption1>
        </span>
        <span className={s.legendItem}>
          <span className={s.swatch} style={{ backgroundColor: dotColor.far }} />
          <Caption1>&gt; {FAR}</Caption1>
        </span>
      </div>
    </Card>
  );
}

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
        <Text weight="semibold" size={400}>
          Итог по каждому диалогу
        </Text>
        <Caption1 className={s.muted}>сначала самые большие расхождения · Δ = ИИ − человек</Caption1>
      </div>
      <div className={s.tableWrap}>
        <Table size="small" aria-label="Сравнение итоговых оценок ИИ и эталона">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Диалог</TableHeaderCell>
              <TableHeaderCell>Язык</TableHeaderCell>
              <TableHeaderCell>Канал</TableHeaderCell>
              <TableHeaderCell className={s.headRight}>Человек</TableHeaderCell>
              <TableHeaderCell className={s.headRight}>ИИ</TableHeaderCell>
              <TableHeaderCell className={s.headRight}>Δ</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => {
              const abs = Math.abs(d.delta);
              const b = bandOf(abs);
              const sign = d.delta > 0 ? "+" : d.delta < 0 ? "−" : "";
              return (
                <TableRow key={d.id} className={s[b]}>
                  <TableCell>
                    <Link href={href({ name: "dialog", id: d.id })}>{d.id}</Link>
                  </TableCell>
                  <TableCell>{d.lang}</TableCell>
                  <TableCell>{d.channel === "call" ? "Звонок" : "Чат"}</TableCell>
                  <TableCell className={mergeClasses(s.right, s.num)}>{fmt(d.human)}</TableCell>
                  <TableCell className={mergeClasses(s.right, s.num)}>{fmt(d.ai)}</TableCell>
                  <TableCell className={s.right}>
                    <span className={s.deltaCell}>
                      {sign}
                      {fmt(Math.round(abs * 100) / 100)}
                      {b === "close" ? (
                        <Badge appearance="tint" color="success" shape="rounded" size="small">
                          совпадает
                        </Badge>
                      ) : b === "far" ? (
                        <Badge appearance="tint" color="danger" shape="rounded" size="small">
                          расхождение
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* ---------- screen ---------- */

export function AccuracyScreen() {
  const s = useStyles();
  const gross = parseRatio(data.gross_error_match);
  const total = data.dialogs.length || data.gold_dialogs;

  return (
    <div className={s.root}>
      <div className={s.header}>
        <Title3>Точность ИИ против эталона</Title3>
        <Caption1 className={s.muted}>Модель: {data.model}</Caption1>
      </div>

      <div className={s.stats}>
        <Stat
          icon={<TargetArrowRegular />}
          label="Средняя ошибка (MAE)"
          value={fmt(data.mae)}
          unit="/ 100"
          hint="на сколько баллов в среднем итог ИИ отличается от человека"
        />
        <Stat
          icon={<CheckmarkCircleRegular />}
          label={`В пределах ±${CLOSE} баллов`}
          value={`${data.within_10}/${total}`}
          unit={`(${pct(data.within_10, total)}%)`}
          hint="диалогов, где итог ИИ близок к эталону"
        />
        <Stat
          icon={<ShieldErrorRegular />}
          label="Грубые ошибки найдены"
          value={data.gross_error_match}
          unit={`(${pct(gross.matched, gross.total)}%)`}
          hint={gross.total > 0 && gross.matched === gross.total ? "ИИ не пропустил ни одного случая из эталона" : "совпадение флага с эталоном"}
        />
        <Stat
          icon={<BookOpenRegular />}
          label="Эталон"
          value={String(data.gold_dialogs)}
          unit="диалогов"
          hint="размечены вручную по чек-листу: RU, KZ, EN, чаты и звонки"
        />
      </div>

      <div className={s.grid2}>
        <CriteriaBars criteria={data.criteria} />
        <Scatter dialogs={data.dialogs} />
      </div>

      <DialogsTable dialogs={data.dialogs} />

      <div className={s.note}>
        <InfoRegular className={s.noteIcon} />
        <Text>{data.note}</Text>
      </div>
    </div>
  );
}
