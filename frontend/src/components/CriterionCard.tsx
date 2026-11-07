import { Body1, Button, Caption1, Link, Text, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { GavelRegular, WarningFilled } from "@fluentui/react-icons";
import type { CriterionResult, Evidence } from "../api/contract";
import { TYPE_LABEL, formatScore, snapshotLabel, stepMeaning, timeLabel, verdictLabel } from "../lib/format";
import { derived, eventColor, font, palette, radius, type } from "../theme";
import { ToneBadge } from "./ScoreBadge";

/** Below this share of agreeing votes a criterion is treated as disputed. */
export const LOW_CONFIDENCE = 0.7;
const VOTE_DOTS = 5;

export interface ReviewState {
  /** Disputed: should be checked by a person. */
  flagged: boolean;
  /** Human-readable reasons, for the tooltip and the summary. */
  reasons: string[];
  /** A reviewer already decided on it (appeal resolved / override). */
  resolved: boolean;
  /** Confidence counts (false for the demo provider, whose 0.5 is a placeholder). */
  confidenceKnown: boolean;
}

/**
 * Disputed = confidence < 0.7 (self-consistency agreement) or needs_review.
 * A criterion a reviewer already decided on is no longer disputed. The demo
 * keyword provider returns a fixed 0.5, so only needs_review counts there.
 */
export function reviewState(r: CriterionResult, demo = false): ReviewState {
  const resolved = !!r.overridden || r.appeal?.status === "resolved";
  const confidenceKnown = r.confidence != null && !demo;
  const reasons: string[] = [];
  if (confidenceKnown && r.confidence! < LOW_CONFIDENCE) {
    reasons.push(`голоса модели разошлись — согласие ${Math.round(r.confidence! * 100)}%`);
  }
  if (r.needs_review) {
    if (r.verdict === "uncertain") reasons.push("модель не смогла уверенно ответить");
    if (r.issues?.length) reasons.push("есть замечания к доказательству");
    if (r.verdict !== "uncertain" && !r.issues?.length) reasons.push("помечено «нужна проверка»");
  }
  return { flagged: !resolved && reasons.length > 0, reasons, resolved, confidenceKnown };
}

function ConfidenceMeter({ value, demo, low }: { value: number; demo: boolean; low: boolean }) {
  const s = useStyles();
  const filled = Math.round(value * VOTE_DOTS);
  const pct = Math.round(value * 100);
  const dotClass = demo ? s.dotDemo : low ? s.dotLow : value >= 0.9 ? s.dotHigh : s.dotMid;
  const hint = demo
    ? "Демо-провайдер не голосует — уверенность условная и на «проверить» не влияет."
    : `Модель отвечает ${VOTE_DOTS} раз (self-consistency). ${pct}% ответов совпали${low ? " — мало, нужна ручная проверка." : "."}`;
  return (
    <Tooltip content={hint} relationship="description">
      <span className={s.meter} tabIndex={0} aria-label={`Уверенность ИИ ${demo ? "условная" : `${pct}%`}`}>
        <span className={s.dots} aria-hidden>
          {Array.from({ length: VOTE_DOTS }, (_, k) => (
            <span key={k} className={mergeClasses(s.dot, k < filled ? dotClass : s.dotEmpty)} />
          ))}
        </span>
        <Caption1 className={low ? s.lowText : undefined}>
          уверенность {demo ? "— демо" : `${pct}%`}
        </Caption1>
      </span>
    </Tooltip>
  );
}

const useStyles = makeStyles({
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "14px 16px",
    backgroundColor: derived.raised,
    borderRadius: radius.panel,
    border: `1px solid ${palette.grid}`,
    borderLeftWidth: "3px",
    scrollMarginTop: "84px",
  },
  grossCard: { borderLeftColor: palette.violation },
  reviewCard: { borderLeftColor: palette.attention },
  flash: {
    animationName: {
      from: { boxShadow: `0 0 0 3px ${tokens.colorPaletteMarigoldBorderActive}` },
      to: { boxShadow: "0 0 0 3px transparent" },
    },
    animationDuration: "1.8s",
    animationTimingFunction: "ease-out",
  },
  meter: { display: "inline-flex", alignItems: "center", gap: "6px", cursor: "help", borderRadius: tokens.borderRadiusMedium },
  dots: { display: "inline-flex", gap: "3px" },
  dot: { width: "7px", height: "7px", borderRadius: "50%" },
  dotEmpty: { backgroundColor: tokens.colorNeutralStroke2 },
  dotHigh: { backgroundColor: palette.norm },
  dotMid: { backgroundColor: derived.normSoft },
  dotLow: { backgroundColor: tokens.colorPaletteMarigoldBorderActive },
  dotDemo: { backgroundColor: tokens.colorNeutralForeground4 },
  lowText: { color: tokens.colorPaletteMarigoldForeground2, fontWeight: tokens.fontWeightSemibold },
  head: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" },
  titleBox: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  title: { fontWeight: 600, fontSize: type.md, lineHeight: "1.3" },
  muted: { color: tokens.colorNeutralForeground3 },
  badges: { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 },
  numbers: { display: "flex", gap: "14px", flexWrap: "wrap", color: tokens.colorNeutralForeground2, fontVariantNumeric: "tabular-nums" },
  evidenceList: { display: "flex", flexDirection: "column", gap: "4px" },
  evidence: {
    justifyContent: "flex-start",
    textAlign: "left",
    ...shorthands.padding("4px", "8px"),
    borderLeft: `3px solid ${palette.grid}`,
    backgroundColor: palette.paper,
    borderRadius: radius.control,
    fontWeight: 400,
  },
  issue: { display: "flex", gap: "6px", alignItems: "center", color: tokens.colorPaletteDarkOrangeForeground1 },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  trail: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    ...shorthands.padding("6px", "8px"),
    backgroundColor: palette.paper,
    borderRadius: radius.control,
  },
  quote: { fontFamily: font.doc, fontSize: "15px", lineHeight: "1.5", color: palette.ink },
  quoteMeta: { fontFamily: font.ui, fontSize: type.xs, color: derived.graphiteStrong, fontVariantNumeric: "tabular-nums", marginRight: "6px" },
});

interface Props {
  result: CriterionResult;
  name: string;
  section?: string | null;
  onEvidence: (idx: number) => void;
  onRange: (range: [number, number]) => void;
  onAppeal?: () => void;
  /** Score came from the demo keyword provider (its confidence is a placeholder). */
  demo?: boolean;
  /** Briefly highlight the card (after jumping to it from the summary). */
  flash?: boolean;
}

export function CriterionCard({ result: r, name, section, onEvidence, onRange, onAppeal, demo = false, flash = false }: Props) {
  const s = useStyles();
  const v = verdictLabel(r);
  const evidence: Evidence[] = r.evidence_all?.length ? r.evidence_all : r.evidence ? [r.evidence] : [];
  const appeal = r.appeal;
  const range = r.checked_range && r.checked_range.length === 2 ? ([r.checked_range[0], r.checked_range[1]] as [number, number]) : null;
  const max = r.effective_weight;
  const review = reviewState(r, demo);
  const quoteColor = r.gross_error || v.tone === "danger" ? eventColor.violation.fill : v.tone === "success" ? eventColor.good.fill : eventColor.risk.fill;
  const lowConfidence = review.confidenceKnown && r.confidence! < LOW_CONFIDENCE;

  return (
    <section
      className={mergeClasses(s.card, r.gross_error ? s.grossCard : review.flagged && s.reviewCard, flash && s.flash)}
      id={`criterion-${r.criterion_id}`}
      aria-label={name}
    >
      <div className={s.head}>
        <div className={s.titleBox}>
          <Text className={s.title}>{name}</Text>
          <Caption1 className={s.muted}>
            {section ?? "Без секции"}
            {r.type ? ` · ${TYPE_LABEL[r.type]}` : ""}
            {r.weight != null ? ` · вес ${formatScore(r.weight)}` : ""}
          </Caption1>
        </div>
        <div className={s.badges}>
          {r.gross_error ? (
            <ToneBadge tone="danger" appearance="filled">
              Грубое нарушение
            </ToneBadge>
          ) : r.gross_error_if ? (
            <Tooltip
              content={r.gross_error_if === "yes" ? "Ответ «Да» = грубая ошибка" : "Ответ «Нет» = грубая ошибка"}
              relationship="description"
            >
              <span>
                <ToneBadge tone="subtle">Критерий грубых ошибок</ToneBadge>
              </span>
            </Tooltip>
          ) : null}
          {review.flagged ? (
            <Tooltip content={`Проверить вручную: ${review.reasons.join("; ")}`} relationship="description">
              <span>
                <ToneBadge tone="warning" appearance="filled">
                  Проверить
                </ToneBadge>
              </span>
            </Tooltip>
          ) : null}
          {r.overridden ? (
            <ToneBadge tone="informative">Изменено проверяющим</ToneBadge>
          ) : null}
          <ToneBadge tone={v.tone} appearance="filled">
            {v.text}
          </ToneBadge>
        </div>
      </div>

      <div className={s.numbers}>
        {r.weight === 0 ? (
          <Caption1>Без баллов — отмечается отдельно</Caption1>
        ) : (
          <>
            <Caption1>
              Баллы: <b>{r.points == null ? "—" : formatScore(r.points)}</b>
              {max != null ? ` из ${formatScore(max)}` : ""}
            </Caption1>
            <Caption1>Доля в итоге: {r.effective_weight == null ? "исключён" : `${formatScore(r.effective_weight)}%`}</Caption1>
          </>
        )}
        {r.confidence != null && !r.overridden ? <ConfidenceMeter value={r.confidence} demo={demo} low={lowConfidence} /> : null}
      </div>

      {stepMeaning(r) ? (
        <Caption1>
          <b>Ступень {formatScore(r.raw_score)}:</b> {stepMeaning(r)}
        </Caption1>
      ) : null}
      {r.explanation ? <Body1>{r.explanation.replace(/^\[mock\]\s*/, "")}</Body1> : null}
      {!r.applicable ? (
        <Caption1 className={s.muted}>
          <b>Почему N/A:</b> {r.na_reason || "не указано"} — вес перераспределён между применимыми критериями.
        </Caption1>
      ) : null}

      {evidence.length ? (
        <div className={s.evidenceList}>
          {evidence.map((ev, k) => (
            <Button
              key={k}
              appearance="transparent"
              className={s.evidence}
              style={{ borderLeftColor: quoteColor }}
              onClick={() => onEvidence(ev.turn_idx)}
              aria-label={`Показать реплику #${ev.turn_idx} в расшифровке`}
            >
              <span className={s.quote}>
                <span className={s.quoteMeta}>
                  #{ev.turn_idx} · {timeLabel(ev.timestamp)}
                </span>
                «{ev.quote}»
              </span>
            </Button>
          ))}
        </div>
      ) : null}

      {range && (r.verdict === "no" || !evidence.length) ? (
        <Caption1 className={s.muted}>
          Проверенный участок разговора:{" "}
          <Link onClick={() => onRange(range)}>
            реплики #{range[0]}–#{range[1]}
          </Link>
        </Caption1>
      ) : null}

      {(r.issues ?? []).map((issue, k) => (
        <Caption1 key={k} className={s.issue}>
          <WarningFilled /> {issue}
        </Caption1>
      ))}

      {r.overridden && r.original ? (
        <div className={s.trail}>
          <Caption1>
            <b>Исходная:</b> {snapshotLabel(r.original.verdict, r.original.raw_score, r.scale_max)} (
            {r.original.points == null ? "исключён" : `${formatScore(r.original.points)} б.`}) — {r.original.explanation.replace(/^\[mock\]\s*/, "")}
          </Caption1>
          {appeal?.review ? (
            <Caption1>
              <b>Решение:</b> {appeal.review.reviewer}: {appeal.review.reason}
            </Caption1>
          ) : null}
          <Caption1>
            <b>Финал:</b> {v.text} ({r.points == null ? "исключён" : `${formatScore(r.points)} б.`})
          </Caption1>
        </div>
      ) : null}

      {appeal && appeal.status === "resolved" && appeal.review?.decision === "confirm" ? (
        <Caption1 className={s.muted}>
          Апелляция #{appeal.appeal_id} «{appeal.comment}» → оценка подтверждена ({appeal.review.reviewer}: {appeal.review.reason})
        </Caption1>
      ) : null}

      <div className={s.footer}>
        {appeal?.status === "open" ? (
          <ToneBadge tone="warning">
            Апелляция #{appeal.appeal_id} на рассмотрении
          </ToneBadge>
        ) : (
          <span />
        )}
        {onAppeal ? (
          <Button size="small" icon={<GavelRegular />} disabled={appeal?.status === "open"} onClick={onAppeal}>
            Оспорить
          </Button>
        ) : null}
      </div>
    </section>
  );
}
