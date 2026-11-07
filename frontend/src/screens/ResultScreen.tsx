import {
  Badge,
  Button,
  Caption1,
  Card,
  Divider,
  Link,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  ProgressBar,
  Select,
  Spinner,
  Subtitle1,
  Text,
  Title3,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownRegular, ArrowLeftRegular, CodeRegular, SparkleRegular } from "@fluentui/react-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/cqa";
import type { CriterionResult, ScoreResponse } from "../api/contract";
import { AppealDialog } from "../components/AppealDialog";
import { AudioPlayer, type AudioPlayerHandle } from "../components/AudioPlayer";
import { CriterionCard, LOW_CONFIDENCE, reviewState } from "../components/CriterionCard";
import { BigScore, ToneBadge } from "../components/ScoreBadge";
import { TraceDialog } from "../components/TraceDialog";
import { TranscriptView, type Focus } from "../components/TranscriptView";
import { CHECKLIST_CHANNEL_LABEL, channelLabel, dateTime, formatScore, isCall, pickChecklist, ratio, scoreTone } from "../lib/format";
import { useProvider } from "../lib/provider";
import { activeTurn, offsets as computeOffsets } from "../lib/timeline";
import { href, navigate } from "../router";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px" },
  top: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" },
  grow: { flexGrow: 1 },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: "16px",
    alignItems: "start",
    "@media (max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  panel: { display: "flex", flexDirection: "column", gap: "10px", padding: "14px" },
  leftPanel: {
    position: "sticky",
    top: "68px",
    maxHeight: "calc(100vh - 88px)",
    "@media (max-width: 1000px)": { position: "static", maxHeight: "none" },
  },
  transcript: { flexGrow: 1, minHeight: "240px", overflowY: "auto", paddingRight: "4px", "@media (max-width: 1000px)": { maxHeight: "60vh" } },
  right: { display: "flex", flexDirection: "column", gap: "10px" },
  criteria: { display: "flex", flexDirection: "column", gap: "10px" },
  summary: { display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap" },
  summaryMeta: { display: "flex", flexDirection: "column", gap: "6px" },
  badges: { display: "flex", gap: "6px", flexWrap: "wrap" },
  sections: { display: "flex", flexDirection: "column", gap: "8px" },
  sectionRow: { display: "grid", gridTemplateColumns: "150px 1fr 96px", alignItems: "center", gap: "10px" },
  num: { fontVariantNumeric: "tabular-nums", textAlign: "right" },
  muted: { color: tokens.colorNeutralForeground3 },
  scoring: { display: "flex", gap: "12px", alignItems: "center", padding: "18px" },
  pill: { display: "flex", gap: "6px", alignItems: "center" },
  reviewList: { display: "flex", flexWrap: "wrap", columnGap: "12px", rowGap: "2px", marginTop: "4px" },
  reviewTitle: { cursor: "pointer", ":hover": { textDecorationLine: "underline" } },
});

/** 1 критерий требует · 2 критерия требуют · 5 критериев требуют */
function criteriaPhrase(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} критерий требует`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} критерия требуют`;
  return `${n} критериев требуют`;
}

export function ResultScreen({ dialogId }: { dialogId: string }) {
  const s = useStyles();
  const qc = useQueryClient();
  const { provider } = useProvider();
  const dialogQ = useQuery({ queryKey: ["dialog", dialogId], queryFn: () => api.dialog(dialogId) });
  const scoreQ = useQuery({ queryKey: ["score", dialogId], queryFn: () => api.lastScore(dialogId) });
  const checklistsQ = useQuery({ queryKey: ["checklists"], queryFn: api.checklists });
  const score = scoreQ.data ?? null;
  // "auto" = the backend picks the newest checklist for the dialog's channel (chat / call)
  const [chosen, setChosen] = useState<number | "auto">("auto");
  const autoChecklist = dialogQ.data ? pickChecklist(checklistsQ.data, dialogQ.data.channel) : undefined;
  const nextChecklist = chosen === "auto" ? autoChecklist : checklistsQ.data?.find((c) => c.id === chosen);
  const checklistId = score?.checklist_id ?? nextChecklist?.id;
  const checklistQ = useQuery({ queryKey: ["checklist", checklistId], queryFn: () => api.checklist(checklistId!), enabled: checklistId != null });

  const [focus, setFocus] = useState<Focus | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [appealFor, setAppealFor] = useState<{ result: CriterionResult; name: string } | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const audio = useRef<AudioPlayerHandle>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 1900);
    return () => window.clearTimeout(t);
  }, [flashId]);
  /** Scroll to a criterion card and highlight it briefly. */
  const jumpTo = (criterionId: string) => {
    document.getElementById(`criterion-${criterionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFlashId(null);
    window.requestAnimationFrame(() => setFlashId(criterionId));
  };

  const setScore = (r: ScoreResponse) => qc.setQueryData(["score", dialogId], r);

  const runScore = useMutation({
    mutationFn: () =>
      api.score({ dialog_id: dialogId, checklist_id: chosen === "auto" ? undefined : chosen, provider: provider?.id }),
    onSuccess: (r) => {
      setScore(r);
      qc.invalidateQueries({ queryKey: ["dialogs"] });
    },
  });

  const appeal = useMutation({
    mutationFn: ({ comment, author }: { comment: string; author: string }) =>
      api.createAppeal({ dialog_id: dialogId, criterion_id: appealFor!.result.criterion_id, comment, author, score_id: score?.score_id }),
    onSuccess: () => {
      setAppealFor(null);
      qc.invalidateQueries({ queryKey: ["score", dialogId] });
      qc.invalidateQueries({ queryKey: ["dialogs"] });
      qc.invalidateQueries({ queryKey: ["appeals"] });
    },
  });

  const dialog = dialogQ.data;
  const call = dialog ? isCall(dialog.channel) : false;
  const offs = useMemo(() => (dialog ? computeOffsets(dialog.transcript, call) : []), [dialog, call]);
  const criteriaById = useMemo(() => new Map((checklistQ.data?.criteria ?? []).map((c) => [c.id, c])), [checklistQ.data]);
  const nameOf = (r: CriterionResult) => r.name || criteriaById.get(r.criterion_id)?.name || r.criterion_id;
  const sectionOf = (r: CriterionResult) => r.section ?? criteriaById.get(r.criterion_id)?.section ?? null;

  const focusTurn = (idx: number, range?: [number, number]) => {
    setFocus({ indices: range ? [] : [idx], range: range ?? null, nonce: Date.now() });
    const pos = dialog?.transcript.findIndex((t) => t.idx === (range ? range[0] : idx)) ?? -1;
    const offset = pos >= 0 ? offs[pos] : null;
    if (call && offset != null) audio.current?.seek(offset);
  };

  if (dialogQ.isLoading) return <Spinner label="Загрузка диалога…" />;
  if (dialogQ.error || !dialog) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          Диалог не найден. <Link href={href({ name: "dialogs" })}>К списку</Link>
        </MessageBarBody>
      </MessageBar>
    );
  }

  const busy = runScore.isPending;
  const demo = score?.provider === "mock";
  const flagged = score ? score.results.filter((r) => reviewState(r, demo).flagged) : [];
  const confidenceShown = !!score && !demo && score.results.some((r) => r.confidence != null);

  return (
    <div className={s.root}>
      <div className={s.top}>
        <Button icon={<ArrowLeftRegular />} appearance="subtle" onClick={() => navigate({ name: "dialogs" })}>
          Диалоги
        </Button>
        <Title3>{dialog.conversation_id}</Title3>
        <Badge appearance="outline">{channelLabel(dialog.channel)}</Badge>
        <Badge appearance="outline">{dialog.language}</Badge>
        <Caption1 className={s.muted}>{dialog.transcript.length} реплик</Caption1>
        <span className={s.grow} />
        <Select
          value={String(chosen)}
          onChange={(_, d) => setChosen(d.value === "auto" ? "auto" : Number(d.value))}
          aria-label="Чек-лист для оценки"
          title="Чек-лист для следующей оценки"
        >
          <option value="auto">Чек-лист: авто{autoChecklist ? ` — ${autoChecklist.name}` : ""}</option>
          {(checklistsQ.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              #{c.id} · {c.name.slice(0, 40)} ({CHECKLIST_CHANNEL_LABEL[c.channel ?? "all"]})
            </option>
          ))}
        </Select>
        {score ? (
          <span className={s.pill}>
            <Caption1 className={s.muted}>Итог</Caption1>
            <ToneBadge tone={scoreTone(score.total)} appearance="filled">
              {formatScore(score.total)}
            </ToneBadge>
            {score.run ? (
              <Caption1 className={s.muted}>
                {score.run.model} · {(score.run.duration_ms / 1000).toFixed(1)} с
              </Caption1>
            ) : null}
          </span>
        ) : null}
        {score?.score_id ? (
          <Button appearance="subtle" icon={<CodeRegular />} onClick={() => setTraceOpen(true)}>
            Запрос к модели
          </Button>
        ) : null}
        <Button
          appearance="primary"
          icon={busy ? <Spinner size="tiny" /> : <SparkleRegular />}
          disabled={busy || !provider?.available}
          onClick={() => runScore.mutate()}
        >
          {busy ? "Анализ…" : score ? "Оценить заново" : "Оценить"}
        </Button>
      </div>

      {runScore.error ? (
        <MessageBar intent="error">
          <MessageBarBody>{(runScore.error as Error).message}</MessageBarBody>
        </MessageBar>
      ) : null}

      <div className={s.grid}>
        <Card className={mergeClasses(s.panel, s.leftPanel)}>
          <Subtitle1>Транскрипт</Subtitle1>
          {call && dialog.audio_url ? (
            <AudioPlayer
              ref={audio}
              src={api.mediaUrl(dialog.audio_url)}
              originalUrl={dialog.audio_source_url}
              onTime={(t, playing) => setPlayingIdx(playing ? (dialog.transcript[activeTurn(offs, t) ?? -1]?.idx ?? null) : null)}
            />
          ) : null}
          <div className={s.transcript} data-scroll-container>
            <TranscriptView
              turns={dialog.transcript}
              offsets={offs}
              focus={focus}
              playingIdx={playingIdx}
              onTurnClick={call ? (idx) => focusTurn(idx) : undefined}
            />
          </div>
        </Card>

        <div className={s.right}>
          {busy ? (
            <Card className={s.scoring}>
              <Spinner size="small" />
              <Text>
                {provider?.name ?? "Модель"} анализирует диалог по {checklistQ.data?.criteria.length ?? "…"} критериям…
              </Text>
            </Card>
          ) : null}

          {scoreQ.isLoading ? (
            <Spinner label="Загрузка оценки…" />
          ) : !score ? (
            !busy && (
              <Card className={s.panel}>
                <Text weight="semibold">Диалог ещё не оценён</Text>
                <Text>
                  Нажмите «Оценить» — {provider?.name ?? "выбранная модель"} разберёт диалог по чек-листу
                  {nextChecklist ? ` «${nextChecklist.name}»` : ""}.
                </Text>
              </Card>
            )
          ) : (
            <>
              {score.provider === "mock" ? (
                <MessageBar intent="info">
                  <MessageBarBody>
                    <MessageBarTitle>Демо-провайдер</MessageBarTitle>
                    Оценки по ключевым словам. Для живого разбора выберите Claude, Gemini или Qwen3 в переключателе модели.
                    Уверенность у демо условная — «проверить» ставится только по признаку «нужна проверка».
                  </MessageBarBody>
                </MessageBar>
              ) : null}

              {flagged.length ? (
                <MessageBar intent="warning" layout="multiline">
                  <MessageBarBody>
                    <MessageBarTitle>
                      <span
                        className={s.reviewTitle}
                        role="link"
                        tabIndex={0}
                        onClick={() => jumpTo(flagged[0].criterion_id)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && jumpTo(flagged[0].criterion_id)}
                      >
                        {criteriaPhrase(flagged.length)} проверки
                      </span>
                    </MessageBarTitle>
                    ИИ честно отмечает, где не уверен (меньше {Math.round(LOW_CONFIDENCE * 100)}% совпадающих голосов или
                    противоречивые данные) — эти критерии стоит посмотреть вручную или оспорить.
                    <div className={s.reviewList}>
                      {flagged.map((r) => {
                        const low = r.confidence != null && !demo && r.confidence < LOW_CONFIDENCE;
                        return (
                          <Link key={r.criterion_id} onClick={() => jumpTo(r.criterion_id)}>
                            {nameOf(r)} · {low ? `уверенность ${Math.round(r.confidence! * 100)}%` : reviewState(r, demo).reasons[0]}
                          </Link>
                        );
                      })}
                    </div>
                  </MessageBarBody>
                  <MessageBarActions>
                    <Button size="small" icon={<ArrowDownRegular />} onClick={() => jumpTo(flagged[0].criterion_id)}>
                      К первому
                    </Button>
                  </MessageBarActions>
                </MessageBar>
              ) : confidenceShown ? (
                <MessageBar intent="success">
                  <MessageBarBody>
                    ИИ уверен во всех критериях: согласие голосов модели не ниже {Math.round(LOW_CONFIDENCE * 100)}%.
                  </MessageBarBody>
                </MessageBar>
              ) : null}

              <div className={s.criteria}>
                {score.results.map((r) => (
                  <CriterionCard
                    key={r.criterion_id}
                    result={r}
                    name={nameOf(r)}
                    section={sectionOf(r)}
                    onEvidence={(idx) => focusTurn(idx)}
                    onRange={(range) => focusTurn(range[0], range)}
                    onAppeal={() => {
                      appeal.reset();
                      setAppealFor({ result: r, name: nameOf(r) });
                    }}
                    demo={demo}
                    flash={flashId === r.criterion_id}
                  />
                ))}
              </div>

              <Card className={s.panel}>
                <Subtitle1>Итог</Subtitle1>
                {score.sections.length ? (
                  <div className={s.sections}>
                    {score.sections.map((sec) => {
                      const pct = ratio(sec.points, sec.max);
                      return (
                        <div key={sec.name} className={s.sectionRow}>
                          <Caption1>{sec.name}</Caption1>
                          <ProgressBar
                            value={(pct ?? 0) / 100}
                            thickness="large"
                            color={scoreTone(pct) === "success" ? "success" : scoreTone(pct) === "danger" ? "error" : "warning"}
                          />
                          <Caption1 className={s.num}>
                            {sec.max ? `${formatScore(sec.points)} / ${formatScore(sec.max)}` : "N/A"}
                          </Caption1>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <Divider />
                <div className={s.summary}>
                  <BigScore score={score.total} />
                  <div className={s.summaryMeta}>
                    <div className={s.badges}>
                      {score.gross_error ? (
                        <Badge color="danger" appearance="filled">
                          Грубая ошибка
                        </Badge>
                      ) : null}
                      {flagged.length ? (
                        <Badge color="warning" appearance="tint" className={s.reviewTitle} onClick={() => jumpTo(flagged[0].criterion_id)}>
                          Нужна проверка: {flagged.length}
                        </Badge>
                      ) : score.needs_review ? (
                        <Badge color="warning" appearance="tint">
                          Нужна проверка
                        </Badge>
                      ) : null}
                      {score.original_total != null && score.original_total !== score.total ? (
                        <Badge color="brand" appearance="tint">
                          Исходный итог {formatScore(score.original_total)} → финал {formatScore(score.total)}
                        </Badge>
                      ) : null}
                    </div>
                    <Caption1 className={s.muted}>
                      Модель: {score.provider}
                      {score.run ? ` (${score.run.model})` : ""} · чек-лист {checklistQ.data ? `«${checklistQ.data.name}»` : ""} #
                      {score.checklist_id ?? "—"}
                      {score.created_at ? ` · ${dateTime(score.created_at)}` : ""}
                    </Caption1>
                    {score.run ? (
                      <Caption1 className={s.muted}>
                        Живой разбор: {(score.run.duration_ms / 1000).toFixed(1)} с · вызовов модели: {score.run.calls}
                        {score.run.prompt_tokens != null
                          ? ` · токены: ${score.run.prompt_tokens} → ${score.run.completion_tokens ?? "?"}`
                          : ""}{" "}
                        · <Link onClick={() => setTraceOpen(true)}>показать запрос и ответ модели</Link>
                      </Caption1>
                    ) : null}
                    <Caption1 className={s.muted}>Итог = Σ баллов; вес N/A-критериев перераспределён между применимыми.</Caption1>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      <TraceDialog scoreId={score?.score_id} open={traceOpen} onClose={() => setTraceOpen(false)} />
      <AppealDialog
        target={appealFor}
        busy={appeal.isPending}
        error={appeal.error ? (appeal.error as Error).message : null}
        onClose={() => setAppealFor(null)}
        onSubmit={(comment, author) => appeal.mutate({ comment, author })}
      />
    </div>
  );
}
