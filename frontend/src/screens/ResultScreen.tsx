import { Button, Link, MessageBar, MessageBarBody, MessageBarTitle, Select, Spinner, Text, makeStyles, mergeClasses } from "@fluentui/react-components";
import { ArrowLeftRegular, CodeRegular, ErrorCircleFilled } from "@fluentui/react-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/cqa";
import type { CriterionResult, ScoreResponse } from "../api/contract";
import { AppealDialog } from "../components/AppealDialog";
import { AudioPlayer, type AudioPlayerHandle } from "../components/AudioPlayer";
import { CriterionCard, LOW_CONFIDENCE, reviewState } from "../components/CriterionCard";
import { RecordingStrip } from "../components/RecordingStrip";
import { ScoreMark, ToneBadge } from "../components/ScoreBadge";
import { TraceDialog } from "../components/TraceDialog";
import { TranscriptView, type Focus } from "../components/TranscriptView";
import { buildEvents, clientTension, dialogFacts, turnTimes, type DialogEvent } from "../lib/events";
import { GROSS_FOCUS, cleanExplanation, grossCriteria, primaryGross } from "../lib/gross";
import { CHECKLIST_CHANNEL_LABEL, channelLabel, dateTime, formatScore, formatSeconds, isCall, pickChecklist, ratio, verdictLabel } from "../lib/format";
import { useProvider } from "../lib/provider";
import { activeTurn, offsets as computeOffsets } from "../lib/timeline";
import { href, navigate } from "../router";
import { derived, eventColor, palette, radius, type, type EventKind } from "../theme";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "14px" },

  /* header: number, facts, small score; actions on the right */
  head: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px 24px", flexWrap: "wrap" },
  titleBlock: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
  back: { alignSelf: "flex-start", marginLeft: "-8px", color: derived.graphiteStrong },
  titleRow: { display: "flex", alignItems: "baseline", gap: "10px 16px", flexWrap: "wrap" },
  title: { margin: 0, fontSize: type.xl, lineHeight: "1.15", fontWeight: 600, color: palette.ink, fontVariantNumeric: "tabular-nums" },
  meta: { margin: 0, fontSize: type.sm, color: derived.graphiteStrong, fontVariantNumeric: "tabular-nums" },
  actions: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  select: { maxWidth: "300px" },
  flagBtn: {
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    font: "inherit",
    borderRadius: radius.control,
  },

  /* gross-error banner: the reason is the first thing on screen */
  grossList: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" },
  grossItem: { display: "flex", flexDirection: "column", gap: "2px" },
  grossQuote: { fontStyle: "italic" },
  grossLinks: { display: "flex", gap: "14px", flexWrap: "wrap" },

  /* the strip: the one big element of the screen */
  strip: {
    backgroundColor: palette.paper,
    borderTop: `1px solid ${palette.ink}`,
    borderBottom: `1px solid ${palette.grid}`,
    padding: "10px 0 6px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  stripHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px 20px", flexWrap: "wrap" },
  stripTitle: { margin: 0, fontSize: type.sm, fontWeight: 600, color: palette.ink },
  legend: { display: "flex", gap: "4px 14px", flexWrap: "wrap", fontSize: type.xs, color: derived.graphiteStrong },
  legendItem: { display: "inline-flex", alignItems: "center", gap: "6px" },
  swatch: { width: "10px", height: "10px", display: "inline-block" },
  traceSwatch: { width: "16px", height: "0", borderTop: `1.2px solid ${palette.ink}`, display: "inline-block" },
  audio: { paddingTop: "4px" },

  /* two columns: transcript (wider) and the event panel */
  cols: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.55fr) minmax(320px, 1fr)",
    gap: "20px",
    alignItems: "start",
    "@media (max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  sheet: {
    position: "sticky",
    top: "72px",
    backgroundColor: derived.raised,
    border: `1px solid ${palette.grid}`,
    borderRadius: radius.panel,
    "@media (max-width: 1000px)": { position: "static" },
  },
  sheetHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "12px 16px 8px",
    borderBottom: `1px solid ${palette.grid}`,
  },
  sheetScroll: {
    maxHeight: "calc(100vh - 150px)",
    overflowY: "auto",
    "@media (max-width: 1000px)": { maxHeight: "65vh" },
  },
  h2: { margin: 0, fontSize: type.sm, fontWeight: 600, color: palette.ink },
  muted: { color: derived.graphiteStrong, fontSize: type.xs },

  panel: { display: "flex", flexDirection: "column", gap: "18px", minWidth: 0 },
  block: { display: "flex", flexDirection: "column", gap: "8px" },
  note: {
    margin: 0,
    fontSize: type.sm,
    lineHeight: "1.5",
    color: derived.graphiteStrong,
    paddingLeft: "10px",
    borderLeft: `2px solid ${palette.grid}`,
  },
  review: { margin: 0, paddingLeft: "10px", borderLeft: `2px solid ${palette.attention}`, fontSize: type.sm, lineHeight: "1.5", color: palette.ink },
  reviewLinks: { display: "flex", flexWrap: "wrap", gap: "2px 12px", marginTop: "4px" },
  ok: { margin: 0, paddingLeft: "10px", borderLeft: `2px solid ${palette.norm}`, fontSize: type.sm, color: palette.ink },
  pause: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "14px 16px",
    backgroundColor: derived.raised,
    border: `1px solid ${palette.grid}`,
    borderLeft: `3px solid ${palette.graphite}`,
    borderRadius: radius.panel,
  },
  pauseTitle: { margin: 0, fontSize: type.md, fontWeight: 600 },
  empty: { margin: 0, fontSize: type.md, lineHeight: "1.55", color: palette.ink },

  list: { listStyle: "none", margin: 0, padding: 0, borderTop: `1px solid ${palette.grid}` },
  row: {
    display: "grid",
    gridTemplateColumns: "10px minmax(0, 1fr) auto auto",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "8px 8px 8px 10px",
    background: "none",
    border: "none",
    borderBottom: `1px solid ${palette.grid}`,
    borderLeft: "2px solid transparent",
    textAlign: "left",
    font: "inherit",
    fontSize: type.sm,
    color: palette.ink,
    cursor: "pointer",
    ":hover": { backgroundColor: derived.raisedHover },
  },
  rowOn: { backgroundColor: derived.raised, borderLeftColor: palette.ink },
  dot: { width: "8px", height: "8px", borderRadius: "50%" },
  pts: { fontVariantNumeric: "tabular-nums", color: derived.graphiteStrong, fontSize: type.xs, minWidth: "64px", textAlign: "right" },

  sections: { display: "flex", flexDirection: "column", gap: "8px" },
  secRow: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px 70px", alignItems: "center", gap: "10px", fontSize: type.sm },
  bar: { position: "relative", height: "4px", backgroundColor: palette.grid },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: palette.norm },
  num: { fontVariantNumeric: "tabular-nums", textAlign: "right", color: derived.graphiteStrong, fontSize: type.xs },
  total: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: "8px",
    borderTop: `1px solid ${palette.ink}`,
    fontSize: type.sm,
  },
  runMeta: { margin: 0, fontSize: type.xs, lineHeight: "1.6", color: derived.graphiteStrong },
});

/** 1 критерий требует · 2 критерия требуют · 5 критериев требуют */
function criteriaPhrase(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} критерий требует`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} критерия требуют`;
  return `${n} критериев требуют`;
}

const LEGEND: EventKind[] = ["violation", "risk", "pause", "good"];
const fmtDate = (d: Date) =>
  d.toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function ResultScreen({ dialogId, focus: focusCriterion }: { dialogId: string; focus?: string }) {
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
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<DialogEvent | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const audio = useRef<AudioPlayerHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 1900);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const setScore = (r: ScoreResponse) => qc.setQueryData(["score", dialogId], r);

  const runScore = useMutation({
    mutationFn: () =>
      api.score({ dialog_id: dialogId, checklist_id: chosen === "auto" ? undefined : chosen, provider: provider?.id }),
    onSuccess: (r) => {
      setScore(r);
      setSelected(null);
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

  const axis = useMemo(() => (dialog ? turnTimes(dialog.transcript, offs) : { times: [], duration: 1, timed: false }), [dialog, offs]);
  const events = useMemo(
    () => (dialog ? buildEvents(dialog.transcript, axis.times, score, call, nameOf) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dialog, axis, score, call, criteriaById],
  );
  const tension = useMemo(() => (dialog ? clientTension(dialog.transcript, axis.times) : []), [dialog, axis]);
  const defaultEvent = useMemo(
    () => events.find((e) => e.kind === "violation") ?? events.find((e) => e.kind !== "good" && e.kind !== "pause") ?? null,
    [events],
  );
  // on open (and after re-scoring) show the first violation's phrase in the transcript
  useEffect(() => {
    if (!defaultEvent || selected) return;
    setFocus({ indices: [defaultEvent.turnIdx], range: null, nonce: Date.now(), kind: defaultEvent.kind });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultEvent?.id]);

  /** Highlight a turn in the transcript (and move the recording on calls). */
  const focusTurn = (idx: number, range?: [number, number], kind?: EventKind, instant = false, seekAudio = true) => {
    setFocus({ indices: range ? [] : [idx], range: range ?? null, nonce: Date.now(), kind, instant });
    const pos = dialog?.transcript.findIndex((t) => t.idx === (range ? range[0] : idx)) ?? -1;
    if (pos >= 0) setCursor(axis.times[pos]);
    const offset = pos >= 0 ? offs[pos] : null;
    if (seekAudio && call && offset != null) audio.current?.seek(offset);
  };

  // opened from «Грубые ошибки» (#/dialog/<id>?c=…): highlight the offending criterion and its quote
  // in the transcript. No page scroll — the red banner with the reason stays on top.
  const autoFocused = useRef(false);
  useEffect(() => {
    if (autoFocused.current || !focusCriterion || !score || !dialog) return;
    autoFocused.current = true;
    const target =
      focusCriterion === GROSS_FOCUS ? primaryGross(score.results) : score.results.find((r) => r.criterion_id === focusCriterion);
    if (!target) return;
    setFlashId(target.criterion_id);
    if (target.evidence) focusTurn(target.evidence.turn_idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCriterion, score, dialog]);

  if (dialogQ.isLoading) return <Spinner label="Загружаем диалог…" />;
  if (dialogQ.error || !dialog) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>
          Диалога {dialogId} нет в загруженных наборах. Вернитесь <Link href={href({ name: "dialogs" })}>к списку диалогов</Link> и выберите
          другой или загрузите набор заново.
        </MessageBarBody>
      </MessageBar>
    );
  }

  const busy = runScore.isPending;
  const demo = score?.provider === "mock";
  const flagged = score ? score.results.filter((r) => reviewState(r, demo).flagged) : [];
  const gross = score ? grossCriteria(score.results) : [];
  const confidenceShown = !!score && !demo && score.results.some((r) => r.confidence != null);
  const facts = dialogFacts(dialog.transcript, axis.duration, axis.timed);
  const kindByCriterion = new Map(events.filter((e) => e.criterionId).map((e) => [e.criterionId!, e.kind]));

  // selection: hovered mark previews, otherwise the chosen one; default = first violation
  const defaultId = defaultEvent?.id ?? events[0]?.id ?? (score?.results[0] ? `crit-${score.results[0].criterion_id}` : null);
  const selectedId = selected ?? defaultId;
  const shownId = hovered?.id ?? selectedId;
  const shownEvent = events.find((e) => e.id === shownId) ?? null;
  const shownCriterion = shownEvent?.criterionId ?? (shownId?.startsWith("crit-") ? shownId.slice(5) : null);
  const shownResult = score?.results.find((r) => r.criterion_id === shownCriterion) ?? null;

  const selectEvent = (e: DialogEvent) => {
    setSelected(e.id);
    setHovered(null);
    focusTurn(e.turnIdx, undefined, e.kind);
  };
  const selectCriterion = (r: CriterionResult) => {
    const ev = events.find((e) => e.criterionId === r.criterion_id);
    if (ev) return selectEvent(ev);
    setSelected(`crit-${r.criterion_id}`);
    const at = r.evidence_all?.[0]?.turn_idx ?? r.evidence?.turn_idx;
    if (at != null) focusTurn(at, undefined, "risk");
  };
  /** From the review summary: open the criterion in the panel and flash it. */
  const jumpTo = (criterionId: string) => {
    const r = score?.results.find((x) => x.criterion_id === criterionId);
    if (!r) return;
    selectCriterion(r);
    window.requestAnimationFrame(() => {
      panelRef.current?.querySelector(`#criterion-${criterionId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setFlashId(null);
      window.requestAnimationFrame(() => setFlashId(criterionId));
    });
  };
  const onHover = (e: DialogEvent | null) => {
    setHovered(e);
    if (e) setFocus({ indices: [e.turnIdx], range: null, nonce: Date.now(), kind: e.kind });
    else {
      const sel = events.find((x) => x.id === selectedId);
      if (sel) setFocus({ indices: [sel.turnIdx], range: null, nonce: Date.now(), kind: sel.kind, instant: true });
    }
  };
  const onScrub = (t: number, done: boolean) => {
    let pos = 0;
    for (let i = 0; i < axis.times.length; i++) if (axis.times[i] <= t + 1e-6) pos = i;
    const turn = dialog.transcript[pos];
    setCursor(t);
    setFocus({ indices: [turn.idx], range: null, nonce: Date.now(), kind: "pause", instant: !done });
    const offset = offs[pos];
    if (done && call && offset != null) audio.current?.seek(offset, false);
  };

  const metaParts = [
    channelLabel(dialog.channel),
    dialog.language,
    `${dialog.transcript.length} реплик`,
    facts.duration != null ? `длительность ${formatSeconds(facts.duration)}` : null,
    facts.operator ? `оператор ${facts.operator}` : null,
    facts.date ? fmtDate(facts.date) : null,
  ].filter(Boolean);

  return (
    <div className={s.root}>
      <header className={s.head}>
        <div className={s.titleBlock}>
          <Button className={s.back} size="small" appearance="transparent" icon={<ArrowLeftRegular />} onClick={() => navigate({ name: "dialogs" })}>
            Все диалоги
          </Button>
          <div className={s.titleRow}>
            <h1 className={s.title}>Диалог {dialog.conversation_id}</h1>
            {score ? <ScoreMark score={score.total} /> : <span className={s.muted}>ещё не оценён</span>}
            {score?.gross_error ? (
              <ToneBadge tone="danger" appearance="filled">
                Грубое нарушение
              </ToneBadge>
            ) : null}
            {flagged.length ? (
              <button className={s.flagBtn} data-focusable onClick={() => jumpTo(flagged[0].criterion_id)}>
                <ToneBadge tone="warning">Проверить: {flagged.length}</ToneBadge>
              </button>
            ) : null}
          </div>
          <p className={s.meta}>{metaParts.join(" · ")}</p>
        </div>
        <div className={s.actions}>
          <Select
            className={s.select}
            size="small"
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
          {score?.score_id ? (
            <Button appearance="subtle" size="small" icon={<CodeRegular />} onClick={() => setTraceOpen(true)}>
              Запрос к модели
            </Button>
          ) : null}
          <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : undefined} disabled={busy || !provider?.available} onClick={() => runScore.mutate()}>
            {busy ? "Идёт разбор…" : score ? "Оценить заново" : "Оценить диалог"}
          </Button>
        </div>
      </header>

      {score?.gross_error && !busy ? (
        <MessageBar intent="error" layout="multiline" icon={<ErrorCircleFilled />}>
          <MessageBarBody>
            <MessageBarTitle>Грубая ошибка{gross.length > 1 ? ` · ${gross.length} критерия` : ""}</MessageBarTitle>
            <div className={s.grossList}>
              {gross.length ? (
                gross.map((r) => (
                  <div key={r.criterion_id} className={s.grossItem}>
                    <Text>
                      <b>{nameOf(r)}:</b> {cleanExplanation(r.explanation) || "модель отметила грубое нарушение"}
                    </Text>
                    {r.evidence ? (
                      <Text className={s.grossQuote}>
                        {r.evidence.timestamp ? `${r.evidence.timestamp} · ` : ""}«{r.evidence.quote}»
                      </Text>
                    ) : null}
                    <div className={s.grossLinks}>
                      {r.evidence ? <Link onClick={() => focusTurn(r.evidence!.turn_idx)}>Показать в разговоре</Link> : null}
                      <Link onClick={() => jumpTo(r.criterion_id)}>К критерию</Link>
                    </div>
                  </div>
                ))
              ) : (
                <Text>Модель отметила грубое нарушение — см. критерии ниже.</Text>
              )}
            </div>
          </MessageBarBody>
        </MessageBar>
      ) : null}

      {runScore.error ? (
        <MessageBar intent="error">
          <MessageBarBody>
            Оценка не прошла: {(runScore.error as Error).message}. Проверьте, что выбранная модель подключена, или переключитесь на демо-модель в шапке.
          </MessageBarBody>
        </MessageBar>
      ) : null}

      <section className={s.strip} aria-labelledby="strip-title">
        <div className={s.stripHead}>
          <h2 id="strip-title" className={s.stripTitle}>
            Лента записи
          </h2>
          <div className={s.legend}>
            {LEGEND.map((k) => (
              <span key={k} className={s.legendItem}>
                <span
                  className={s.swatch}
                  style={k === "good" ? { backgroundColor: eventColor[k].fill, borderRadius: "50%", width: 8, height: 8 } : { backgroundColor: eventColor[k].fill }}
                />
                {eventColor[k].label}
              </span>
            ))}
            <span className={s.legendItem}>
              <span className={s.traceSwatch} />
              линия — напряжение клиента по тексту реплик
            </span>
          </div>
        </div>
        <RecordingStrip
          duration={axis.duration}
          timed={axis.timed}
          events={events}
          tension={tension}
          selectedId={selectedId}
          cursor={cursor}
          onHover={onHover}
          onSelect={selectEvent}
          onScrub={onScrub}
          stops={axis.times}
        />
        {call && dialog.audio_url ? (
          <div className={s.audio}>
            <AudioPlayer
              ref={audio}
              src={api.mediaUrl(dialog.audio_url)}
              originalUrl={dialog.audio_source_url}
              onTime={(t, playing) => {
                const pos = activeTurn(offs, t);
                setPlayingIdx(playing ? (dialog.transcript[pos ?? -1]?.idx ?? null) : null);
                if (playing && pos != null) setCursor(axis.times[pos]);
              }}
            />
          </div>
        ) : null}
      </section>

      <div className={s.cols}>
        <section className={s.sheet} aria-labelledby="transcript-title">
          <div className={s.sheetHead}>
            <h2 id="transcript-title" className={s.h2}>
              Расшифровка
            </h2>
            <span className={s.muted}>{call ? "клик по реплике — перемотка записи" : "клик по метке на ленте — к фразе"}</span>
          </div>
          <div className={s.sheetScroll} data-scroll-container>
            <TranscriptView
              turns={dialog.transcript}
              offsets={offs}
              focus={focus}
              playingIdx={playingIdx}
              onTurnClick={call ? (idx) => focusTurn(idx) : undefined}
            />
          </div>
        </section>

        <aside className={s.panel} ref={panelRef} aria-label="Разбор">
          {busy ? (
            <p className={s.note}>
              {provider?.name ?? "Модель"} разбирает диалог по {checklistQ.data?.criteria.length ?? "…"} критериям. Метки появятся на ленте.
            </p>
          ) : null}

          {scoreQ.isLoading ? (
            <Spinner size="small" label="Загружаем оценку…" />
          ) : !score ? (
            !busy && (
              <div className={s.block}>
                <h2 className={s.h2}>Разбор события</h2>
                <p className={s.empty}>
                  Диалог ещё не оценён. Нажмите «Оценить диалог» — {provider?.name ?? "выбранная модель"} разберёт его по чек-листу
                  {nextChecklist ? ` «${nextChecklist.name}»` : ""}, и на ленте появятся нарушения, риски и удачные действия. Паузы и линия
                  напряжения клиента уже на ленте.
                </p>
              </div>
            )
          ) : (
            <>
              {demo ? (
                <p className={s.note}>
                  Демо-провайдер: оценки по ключевым словам. Для живого разбора выберите Claude, Gemini или Qwen3 в шапке. Уверенность у демо
                  условная — «проверить» ставится только по признаку «нужна проверка».
                </p>
              ) : null}

              {flagged.length ? (
                <div className={s.review} role="note">
                  <b>{criteriaPhrase(flagged.length)} проверки.</b> ИИ отмечает, где не уверен: меньше {Math.round(LOW_CONFIDENCE * 100)}%
                  совпадающих голосов или противоречивые данные.
                  <div className={s.reviewLinks}>
                    {flagged.map((r) => {
                      const low = r.confidence != null && !demo && r.confidence < LOW_CONFIDENCE;
                      return (
                        <Link key={r.criterion_id} onClick={() => jumpTo(r.criterion_id)}>
                          {nameOf(r)} · {low ? `уверенность ${Math.round(r.confidence! * 100)}%` : reviewState(r, demo).reasons[0]}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : confidenceShown ? (
                <p className={s.ok}>ИИ уверен во всех критериях: согласие голосов модели не ниже {Math.round(LOW_CONFIDENCE * 100)}%.</p>
              ) : null}

              <div className={s.block}>
                <h2 className={s.h2}>Разбор события</h2>
                {shownEvent?.kind === "pause" ? (
                  <div className={s.pause}>
                    <p className={s.pauseTitle}>{shownEvent.title}</p>
                    <span className={s.muted}>
                      {formatSeconds(shownEvent.t)} — {formatSeconds(shownEvent.t2 ?? shownEvent.t)}
                    </span>
                    <p className={s.empty}>{shownEvent.detail}</p>
                    <Button size="small" appearance="secondary" style={{ alignSelf: "flex-start" }} onClick={() => focusTurn(shownEvent.turnIdx, undefined, "pause")}>
                      Показать в расшифровке
                    </Button>
                  </div>
                ) : shownResult ? (
                  <CriterionCard
                    result={shownResult}
                    name={shownEvent?.title && shownEvent.criterionId === shownResult.criterion_id ? `${shownEvent.title}` : nameOf(shownResult)}
                    section={`${nameOf(shownResult)}${sectionOf(shownResult) ? ` · ${sectionOf(shownResult)}` : ""}`}
                    onEvidence={(idx) => focusTurn(idx, undefined, kindByCriterion.get(shownResult.criterion_id) ?? "risk")}
                    onRange={(range) => focusTurn(range[0], range)}
                    onAppeal={() => {
                      appeal.reset();
                      setAppealFor({ result: shownResult, name: nameOf(shownResult) });
                    }}
                    demo={demo}
                    flash={flashId === shownResult.criterion_id}
                  />
                ) : (
                  <p className={s.empty}>Выберите метку на ленте или критерий в списке ниже.</p>
                )}
              </div>

              <div className={s.block}>
                <h2 className={s.h2}>Критерии</h2>
                <ul className={s.list}>
                  {score.results.map((r) => {
                    const kind = kindByCriterion.get(r.criterion_id);
                    const v = verdictLabel(r);
                    const on = shownCriterion === r.criterion_id;
                    return (
                      <li key={r.criterion_id}>
                        <button className={mergeClasses(s.row, on && s.rowOn)} onClick={() => selectCriterion(r)} aria-pressed={on}>
                          <span
                            className={s.dot}
                            style={kind ? { backgroundColor: eventColor[kind].fill } : { border: `1px solid ${palette.graphite}` }}
                            aria-hidden
                          />
                          <span>{nameOf(r)}</span>
                          <ToneBadge tone={v.tone}>{v.text}</ToneBadge>
                          <span className={s.pts}>
                            {r.weight === 0 ? "без баллов" : r.points == null ? "исключён" : `${formatScore(r.points)} из ${formatScore(r.effective_weight)}`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className={s.block}>
                <h2 className={s.h2}>Итог по разделам</h2>
                <div className={s.sections}>
                  {score.sections.map((sec) => {
                    const pct = ratio(sec.points, sec.max);
                    return (
                      <div key={sec.name} className={s.secRow}>
                        <span>{sec.name}</span>
                        <span className={s.bar} aria-hidden>
                          <span className={s.barFill} style={{ width: `${pct ?? 0}%` }} />
                        </span>
                        <span className={s.num}>{sec.max ? `${formatScore(sec.points)} / ${formatScore(sec.max)}` : "N/A"}</span>
                      </div>
                    );
                  })}
                  <div className={s.total}>
                    <span>
                      <b>Итог</b>
                      {score.original_total != null && score.original_total !== score.total ? (
                        <span className={s.muted}> · до апелляции {formatScore(score.original_total)}</span>
                      ) : null}
                    </span>
                    <ScoreMark score={score.total} />
                  </div>
                </div>
                <p className={s.runMeta}>
                  Модель: {score.provider}
                  {score.run ? ` (${score.run.model})` : ""} · чек-лист {checklistQ.data ? `«${checklistQ.data.name}»` : ""} #{score.checklist_id ?? "—"}
                  {score.created_at ? ` · ${dateTime(score.created_at)}` : ""}
                  <br />
                  {score.run ? (
                    <>
                      Живой разбор: {(score.run.duration_ms / 1000).toFixed(1).replace(".", ",")} с · вызовов модели: {score.run.calls}
                      {score.run.prompt_tokens != null ? ` · токены: ${score.run.prompt_tokens} / ${score.run.completion_tokens ?? "?"}` : ""} ·{" "}
                      <Link onClick={() => setTraceOpen(true)}>показать запрос и ответ модели</Link>
                      <br />
                    </>
                  ) : null}
                  Итог — сумма баллов; вес N/A-критериев перераспределён между применимыми.
                </p>
              </div>
            </>
          )}
        </aside>
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
