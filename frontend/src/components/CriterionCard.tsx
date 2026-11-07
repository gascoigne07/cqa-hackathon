import { Badge, Body1, Button, Caption1, Card, Link, Text, Tooltip, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { GavelRegular, WarningFilled } from "@fluentui/react-icons";
import type { CriterionResult, Evidence } from "../api/contract";
import { TYPE_LABEL, formatScore, snapshotLabel, stepMeaning, timeLabel, verdictLabel } from "../lib/format";
import { ToneBadge } from "./ScoreBadge";

const useStyles = makeStyles({
  card: { ...shorthands.padding("12px", "14px"), gap: "8px" },
  grossCard: { ...shorthands.borderLeft("4px", "solid", tokens.colorPaletteRedBorder2) },
  head: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" },
  titleBox: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  title: { fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3 },
  badges: { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 },
  numbers: { display: "flex", gap: "14px", flexWrap: "wrap", color: tokens.colorNeutralForeground2, fontVariantNumeric: "tabular-nums" },
  evidenceList: { display: "flex", flexDirection: "column", gap: "4px" },
  evidence: {
    justifyContent: "flex-start",
    textAlign: "left",
    ...shorthands.padding("4px", "8px"),
    ...shorthands.borderLeft("3px", "solid", tokens.colorPaletteMarigoldBorderActive),
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    fontWeight: tokens.fontWeightRegular,
  },
  issue: { display: "flex", gap: "6px", alignItems: "center", color: tokens.colorPaletteDarkOrangeForeground1 },
  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  trail: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    ...shorthands.padding("6px", "8px"),
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
});

interface Props {
  result: CriterionResult;
  name: string;
  section?: string | null;
  onEvidence: (idx: number) => void;
  onRange: (range: [number, number]) => void;
  onAppeal?: () => void;
}

export function CriterionCard({ result: r, name, section, onEvidence, onRange, onAppeal }: Props) {
  const s = useStyles();
  const v = verdictLabel(r);
  const evidence: Evidence[] = r.evidence_all?.length ? r.evidence_all : r.evidence ? [r.evidence] : [];
  const appeal = r.appeal;
  const range = r.checked_range && r.checked_range.length === 2 ? ([r.checked_range[0], r.checked_range[1]] as [number, number]) : null;
  const max = r.effective_weight;

  return (
    <Card className={r.gross_error ? `${s.card} ${s.grossCard}` : s.card} id={`criterion-${r.criterion_id}`}>
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
            <Badge appearance="filled" color="danger" shape="rounded">
              Грубая ошибка
            </Badge>
          ) : r.gross_error_if ? (
            <Tooltip
              content={r.gross_error_if === "yes" ? "Ответ «Да» = грубая ошибка" : "Ответ «Нет» = грубая ошибка"}
              relationship="description"
            >
              <Badge appearance="outline" color="danger" shape="rounded">
                Грубые нарушения
              </Badge>
            </Tooltip>
          ) : null}
          {r.overridden ? (
            <Badge appearance="tint" color="brand" shape="rounded">
              Изменено проверяющим
            </Badge>
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
        {r.confidence != null ? <Caption1>Уверенность: {Math.round(r.confidence * 100)}%</Caption1> : null}
      </div>

      {stepMeaning(r) ? (
        <Caption1>
          <b>Ступень {formatScore(r.raw_score)}:</b> {stepMeaning(r)}
        </Caption1>
      ) : null}
      {r.explanation ? <Body1>{r.explanation}</Body1> : null}
      {!r.applicable ? (
        <Caption1 className={s.muted}>
          <b>Почему N/A:</b> {r.na_reason || "не указано"} — вес перераспределён между применимыми критериями.
        </Caption1>
      ) : null}

      {evidence.length ? (
        <div className={s.evidenceList}>
          {evidence.map((ev, k) => (
            <Button key={k} appearance="transparent" className={s.evidence} onClick={() => onEvidence(ev.turn_idx)}>
              <Caption1>
                <b>
                  #{ev.turn_idx} · {timeLabel(ev.timestamp)}
                </b>{" "}
                «{ev.quote}»
              </Caption1>
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
            {r.original.points == null ? "исключён" : `${formatScore(r.original.points)} б.`}) — {r.original.explanation}
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
          <Badge appearance="tint" color="warning" shape="rounded">
            Апелляция #{appeal.appeal_id} на рассмотрении
          </Badge>
        ) : (
          <span />
        )}
        {onAppeal ? (
          <Button size="small" icon={<GavelRegular />} disabled={appeal?.status === "open"} onClick={onAppeal}>
            Оспорить
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
