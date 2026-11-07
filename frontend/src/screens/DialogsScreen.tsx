import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Switch,
  makeStyles,
  mergeClasses,
} from "@fluentui/react-components";
import { ArrowDownloadRegular, ArrowUploadRegular, CloudArrowDownRegular, ErrorCircleFilled, MicRegular, SearchRegular } from "@fluentui/react-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api/cqa";
import type { CriterionResult, DialogListItem, ScoreResponse } from "../api/contract";
import { BatchProgress } from "../components/BatchProgress";
import { MiniStrip } from "../components/MiniStrip";
import { ScoreBadge, ToneBadge } from "../components/ScoreBadge";
import { miniMarks } from "../lib/events";
import { GROSS_FOCUS, cleanExplanation, primaryGross, useGrossReasons } from "../lib/gross";
import { channelLabel, formatScore, pickChecklist } from "../lib/format";
import { useProvider } from "../lib/provider";
import { useBatchJob } from "../lib/useBatchJob";
import { href, navigate } from "../router";
import { derived, palette, radius, type } from "../theme";

const NARROW = "@media (max-width: 700px)";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "14px" },
  head: { display: "flex", flexDirection: "column", gap: "4px" },
  h1: { margin: 0, fontSize: type.xl, fontWeight: 600, lineHeight: "1.15", color: palette.ink },
  summary: { margin: 0, fontSize: type.md, color: palette.ink, fontVariantNumeric: "tabular-nums" },
  sub: { margin: 0, fontSize: type.xs, color: derived.graphiteStrong },

  toolbar: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
    paddingTop: "10px",
    borderTop: `1px solid ${palette.ink}`,
  },
  search: { width: "240px", "@media (max-width: 600px)": { width: "100%" } },
  grow: { flexGrow: 1 },
  quiet: { display: "flex", gap: "2px", flexWrap: "wrap" },

  /* the journal: one dense row per dialog */
  journal: { backgroundColor: derived.raised, border: `1px solid ${palette.grid}`, borderRadius: radius.panel, overflowX: "auto" },
  table: {
    width: "100%",
    minWidth: "860px",
    borderCollapse: "collapse",
    fontSize: type.sm,
    // phone: each dialog becomes a two-line card instead of a sideways-scrolling table
    [NARROW]: { minWidth: "0", display: "block", "& thead": { display: "none" }, "& tbody": { display: "block" } },
  },
  th: {
    position: "sticky",
    top: 0,
    textAlign: "left",
    fontWeight: 500,
    fontSize: type.xs,
    color: derived.graphiteStrong,
    padding: "9px 12px",
    borderBottom: `1px solid ${palette.grid}`,
    backgroundColor: derived.raised,
    whiteSpace: "nowrap",
  },
  tr: {
    cursor: "pointer",
    ":hover": { backgroundColor: derived.raisedHover },
    ":focus-within": { backgroundColor: derived.raisedHover },
    [NARROW]: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: "12px", padding: "10px 14px", borderBottom: `1px solid ${palette.grid}` },
  },
  td: {
    padding: "7px 12px",
    borderBottom: `1px solid ${palette.grid}`,
    verticalAlign: "middle",
    [NARROW]: { display: "block", padding: "2px 0", borderBottom: "none", ":empty": { display: "none" } },
  },
  tdMain: { [NARROW]: { flexBasis: "100%", minWidth: 0 } },
  tdChan: { [NARROW]: { flexGrow: 1 } },
  tdScore: { [NARROW]: { order: 2 } },
  tdStrip: { [NARROW]: { order: 3, flexBasis: "100%", paddingTop: "4px" } },
  tdTags: { [NARROW]: { order: 4, flexBasis: "100%" } },
  id: { fontWeight: 600, color: palette.ink, textDecorationLine: "none", fontVariantNumeric: "tabular-nums", ":hover": { textDecorationLine: "underline" } },
  preview: {
    display: "block",
    maxWidth: "420px",
    [NARROW]: { maxWidth: "100%" },
    marginTop: "2px",
    color: derived.graphiteStrong,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chan: { display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" },
  tags: { display: "flex", gap: "4px", flexWrap: "wrap" },
  muted: { color: derived.graphiteStrong, fontSize: type.xs },
  empty: { padding: "22px 20px", display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" },
  emptyText: { margin: 0, fontSize: type.md, lineHeight: "1.5", maxWidth: "62ch" },

  /* gross errors */
  grossLink: { color: palette.violationText, cursor: "pointer", textDecorationLine: "underline", ":hover": { color: palette.violation } },
  grossRow: { backgroundColor: derived.violationTint, ":hover": { backgroundColor: derived.violationTint } },
  grossMark: { boxShadow: `inset 4px 0 0 ${palette.violation}` },
  reason: {
    display: "flex",
    gap: "6px",
    alignItems: "flex-start",
    marginTop: "3px",
    maxWidth: "420px",
    color: palette.violationText,
    fontSize: type.xs,
    lineHeight: "1.35",
    [NARROW]: { maxWidth: "100%" },
  },
  reasonIcon: { flexShrink: 0, marginTop: "1px", color: palette.violation },
  reasonText: { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
});

type SortKey = "order" | "score";

interface ExportRow {
  conversation_id: string;
  score: ScoreResponse | null;
}

export function DialogsScreen({ grossOnly = false }: { grossOnly?: boolean }) {
  const s = useStyles();
  const qc = useQueryClient();
  const dialogs = useQuery({ queryKey: ["dialogs"], queryFn: api.dialogs });
  const checklists = useQuery({ queryKey: ["checklists"], queryFn: api.checklists });
  const { provider } = useProvider();
  const batch = useBatchJob();

  const [dataset, setDataset] = useState(""); // ⊕ "" = all datasets
  const [language, setLanguage] = useState("");
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("order");
  const [importOpen, setImportOpen] = useState(false);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [groupId, setGroupId] = useState("DEV");
  const [notice, setNotice] = useState<{ intent: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const chatChecklist = pickChecklist(checklists.data, "agent chat");
  const callChecklist = pickChecklist(checklists.data, "voice call");
  const all = dialogs.data ?? [];
  const rows = useMemo(() => {
    let list = all;
    if (dataset) list = list.filter((d) => (d.dataset ?? "") === dataset);
    if (language) list = list.filter((d) => d.language === language);
    if (channel) list = list.filter((d) => d.channel === channel);
    if (grossOnly) list = list.filter((d) => d.last_score?.gross_error);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (d) => d.conversation_id.toLowerCase().includes(q) || d.preview.toLowerCase().includes(q) || (d.dataset ?? "").toLowerCase().includes(q),
      );
    }
    if (sort === "score") list = [...list].sort((a, b) => (a.last_score?.total ?? 999) - (b.last_score?.total ?? 999));
    return list;
  }, [all, dataset, language, channel, grossOnly, search, sort]);

  const scored = all.filter((d) => d.last_score);
  const totals = scored.map((d) => d.last_score!.total).filter((t): t is number => t != null);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const openAppeals = scored.reduce((n, d) => n + (d.last_score?.open_appeals ?? 0), 0);
  const gross = scored.filter((d) => d.last_score?.gross_error).length;
  const languages = [...new Set(all.map((d) => d.language))];
  const channels = [...new Set(all.map((d) => d.channel))];
  const datasets = [...new Set(all.map((d) => d.dataset ?? "").filter(Boolean))];
  const datasetCount = (name: string) => all.filter((d) => d.dataset === name).length;
  // Export takes each dialog's latest score: flag rows not scored by the selected model (e.g. an old mock score).
  const stale = provider ? rows.filter((d) => d.last_score?.provider !== provider.id) : [];
  const showStale = stale.length > 0 && rows.some((d) => d.last_score);

  // mini strips: one read of the existing export endpoint (latest results of every dialog)
  const signature = scored.map((d) => d.last_score!.score_id).join(",");
  const strips = useQuery({
    queryKey: ["journal-strips", signature],
    enabled: scored.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch(api.exportUrl("json"));
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as ExportRow[];
      return new Map(data.map((row) => [row.conversation_id, row.score]));
    },
  });

  const setGrossOnly = (on: boolean) => navigate({ name: "dialogs", gross: on || undefined }); // URL state: shareable, Back works
  const reasons = useGrossReasons(all);

  /** After an import show exactly the new set: other filters off, so the button reads «Оценить выбранные (10)». */
  function showOnlyDataset(name: string) {
    setDataset(name);
    setSearch("");
    setLanguage("");
    setChannel("");
    if (grossOnly) setGrossOnly(false);
  }

  function startBatch() {
    setBatchConfirm(false);
    batch.start({ dialog_ids: rows.map((r) => r.conversation_id), provider: provider?.id });
  }

  async function runImport() {
    setBusy(true);
    try {
      const r = await api.importGroup(groupId.trim());
      setNotice({ intent: "success", text: `Набор ${r.dataset}: новых ${r.imported}, обновлено ${r.updated}. Показан только этот набор (остальные фильтры сброшены).` });
      showOnlyDataset(r.dataset);
      setImportOpen(false);
      await qc.invalidateQueries({ queryKey: ["dialogs"] });
    } catch (e) {
      setNotice({ intent: "error", text: `Импорт не прошёл: ${e instanceof Error ? e.message : String(e)}. Проверьте group_id и что CQA_API_URL задан на сервере.` });
    } finally {
      setBusy(false);
    }
  }

  async function runUpload(file: File) {
    setBusy(true);
    try {
      const r = await api.upload(file);
      setNotice({ intent: "success", text: `Загружено: новых ${r.imported}, обновлено ${r.updated} (набор ${r.dataset}). Показан только этот набор.` });
      showOnlyDataset(r.dataset);
      await qc.invalidateQueries({ queryKey: ["dialogs"] });
    } catch (e) {
      setNotice({ intent: "error", text: `Файл не загрузился: ${e instanceof Error ? e.message : String(e)}. Нужен JSON в формате API организаторов.` });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const filtered = rows.length !== all.length;
  const resetFilters = () => {
    setDataset("");
    setSearch("");
    setLanguage("");
    setChannel("");
  };

  return (
    <div className={s.root}>
      <div className={s.head}>
        <h1 className={s.h1}>Диалоги</h1>
        <p className={s.summary}>
          {dialogs.data ? `${all.length} диалогов` : "—"} · оценено {scored.length} · средний балл{" "}
          {formatScore(avg == null ? null : Math.round(avg))} ·{" "}
          {gross > 0 ? (
            <Link className={s.grossLink} onClick={() => setGrossOnly(!grossOnly)} title={grossOnly ? "Показать все диалоги" : "Показать только диалоги с грубыми ошибками"}>
              грубых ошибок {gross}
            </Link>
          ) : (
            <>грубых ошибок {gross}</>
          )}{" "}
          · открытых апелляций {openAppeals}
        </p>
        <p className={s.sub}>
          Чаты — {chatChecklist ? `«${chatChecklist.name}» (#${chatChecklist.id})` : "…"} · звонки —{" "}
          {callChecklist ? `«${callChecklist.name}» (#${callChecklist.id})` : "…"} · модель: {provider?.name ?? "—"}
        </p>
      </div>

      <div className={s.toolbar}>
        <Input
          className={s.search}
          size="small"
          contentBefore={<SearchRegular />}
          value={search}
          onChange={(_, d) => setSearch(d.value)}
          placeholder="Поиск по ID или тексту"
          aria-label="Поиск по ID или тексту"
        />
        <Select size="small" value={dataset} onChange={(_, d) => setDataset(d.value)} aria-label="Набор">
          <option value="">Все наборы ({all.length})</option>
          {datasets.map((n) => (
            <option key={n} value={n}>
              {n} ({datasetCount(n)})
            </option>
          ))}
        </Select>
        <Select size="small" value={language} onChange={(_, d) => setLanguage(d.value)} aria-label="Язык">
          <option value="">Все языки</option>
          {languages.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </Select>
        <Select size="small" value={channel} onChange={(_, d) => setChannel(d.value)} aria-label="Канал">
          <option value="">Чаты и звонки</option>
          {channels.map((c) => (
            <option key={c} value={c}>
              {channelLabel(c)}
            </option>
          ))}
        </Select>
        <Select size="small" value={sort} onChange={(_, d) => setSort(d.value as SortKey)} aria-label="Сортировка">
          <option value="order">По порядку</option>
          <option value="score">Сначала низкий балл</option>
        </Select>
        {scored.length > 0 ? (
          <Switch
            checked={grossOnly}
            onChange={(_, d) => setGrossOnly(d.checked)}
            label={`Только грубые ошибки (${gross})`}
          />
        ) : null}
        <span className={s.grow} />
        <div className={s.quiet}>
          <Button size="small" appearance="subtle" icon={<CloudArrowDownRegular />} onClick={() => setImportOpen(true)} disabled={busy}>
            Импорт из API
          </Button>
          <Button size="small" appearance="subtle" icon={<ArrowUploadRegular />} onClick={() => fileInput.current?.click()} disabled={busy}>
            Загрузить JSON
          </Button>
          <Button
            size="small"
            appearance="subtle"
            as="a"
            icon={<ArrowDownloadRegular />}
            href={api.exportUrl("csv", filtered ? rows.map((r) => r.conversation_id) : undefined)}
            download
            title="Последняя оценка каждого диалога из списка (с учётом фильтров)"
          >
            CSV
          </Button>
          <Button
            size="small"
            appearance="subtle"
            as="a"
            icon={<ArrowDownloadRegular />}
            href={api.exportUrl("json", filtered ? rows.map((r) => r.conversation_id) : undefined)}
            download
            title="Полные результаты в JSON (с учётом фильтров)"
          >
            JSON
          </Button>
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && runUpload(e.target.files[0])} />
        <Button
          appearance="primary"
          size="small"
          disabled={batch.running || !rows.length || !provider?.available}
          onClick={() => (provider?.kind === "cloud" ? setBatchConfirm(true) : startBatch())}
        >
          {batch.running ? "Идёт оценка…" : filtered ? `Оценить выбранные (${rows.length})` : "Оценить все"}
        </Button>
      </div>

      <BatchProgress job={batch.job} error={batch.error} />
      {showStale ? (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>
            {stale.length} из {rows.length} диалогов в списке не оценены моделью «{provider?.name}» — в CSV/JSON попадёт их последняя
            оценка другой модели или пустая строка: {stale.slice(0, 5).map((d) => d.conversation_id).join(", ")}
            {stale.length > 5 ? "…" : "."} Переоцените их перед выгрузкой.
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {notice ? (
        <MessageBar intent={notice.intent} layout="multiline">
          <MessageBarBody>{notice.text}</MessageBarBody>
        </MessageBar>
      ) : null}
      {grossOnly && reasons.error ? (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>Не удалось загрузить причины грубых ошибок: {reasons.error.message}. Откройте диалог — причина в разборе.</MessageBarBody>
        </MessageBar>
      ) : null}
      {dialogs.error ? (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>Список диалогов не загрузился: {(dialogs.error as Error).message}. Проверьте, что сервер запущен, и обновите страницу.</MessageBarBody>
        </MessageBar>
      ) : null}

      <div className={s.journal}>
        {dialogs.isLoading ? (
          <div className={s.empty}>
            <Spinner size="small" label="Загружаем диалоги…" />
          </div>
        ) : !all.length ? (
          <div className={s.empty}>
            <p className={s.emptyText}>
              Диалогов пока нет. Загрузите набор из API организаторов (group_id = DEV) или JSON-файл в том же формате.
            </p>
            <Button appearance="primary" size="small" onClick={() => setImportOpen(true)}>
              Импортировать набор
            </Button>
          </div>
        ) : !rows.length ? (
          grossOnly && !gross ? (
            <div className={s.empty}>
              <p className={s.emptyText}>Грубых ошибок нет: ни в одном из {scored.length} оценённых диалогов модель не нашла грубой ошибки.</p>
              <Button size="small" onClick={() => setGrossOnly(false)}>
                Показать все диалоги
              </Button>
            </div>
          ) : (
            <div className={s.empty}>
              <p className={s.emptyText}>Под фильтры не подошёл ни один диалог. Сбросьте поиск или выберите другой набор, язык или канал.</p>
              <Button size="small" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            </div>
          )
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>Диалог</th>
                <th className={s.th}>Канал</th>
                <th className={s.th}>Ход диалога</th>
                <th className={s.th}>Итог</th>
                <th className={s.th}>Отметки</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <DialogRow
                  key={d.conversation_id}
                  d={d}
                  score={strips.data?.get(d.conversation_id) ?? null}
                  loading={strips.isLoading}
                  reasons={reasons.byId.get(d.conversation_id)}
                  reasonsLoading={reasons.isLoading}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={batchConfirm} onOpenChange={(_, d) => setBatchConfirm(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Оценить {rows.length} диалогов через «{provider?.name}»?</DialogTitle>
            <DialogContent>
              Это платная облачная модель — будет сделано {rows.length} оценок (каждая — несколько вызовов). Для бесплатного прогона
              переключитесь на «Демо» в шапке. Продолжить на «{provider?.name}»?
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setBatchConfirm(false)}>Отмена</Button>
              <Button appearance="primary" onClick={startBatch}>
                Оценить {rows.length} на «{provider?.name}»
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(_, d) => setImportOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Импорт из API организаторов</DialogTitle>
            <DialogContent>
              <Field label="group_id" hint="DEV для разработки. Для контрольного набора организаторы сообщат другое значение.">
                <Input value={groupId} onChange={(_, d) => setGroupId(d.value)} />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setImportOpen(false)}>Отмена</Button>
              <Button appearance="primary" disabled={busy || !groupId.trim()} onClick={runImport}>
                {busy ? "Загрузка…" : "Импортировать"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

function DialogRow({
  d,
  score,
  loading,
  reasons,
  reasonsLoading,
}: {
  d: DialogListItem;
  score: ScoreResponse | null;
  loading: boolean;
  reasons?: CriterionResult[];
  reasonsLoading: boolean;
}) {
  const s = useStyles();
  const sc = d.last_score;
  const gross = !!sc?.gross_error;
  // a gross-error dialog opens scrolled to the reason (first offending criterion)
  const target = { name: "dialog" as const, id: d.conversation_id, focus: gross ? primaryGross(reasons)?.criterion_id ?? GROSS_FOCUS : undefined };
  const open = () => navigate(target);
  return (
    <tr className={mergeClasses(s.tr, gross && s.grossRow)} onClick={open}>
      <td className={mergeClasses(s.td, s.tdMain, gross && s.grossMark)}>
        <Link className={s.id} href={href(target)} onClick={(e) => e.stopPropagation()} aria-label={`Открыть диалог ${d.conversation_id}`}>
          {d.conversation_id}
        </Link>
        {d.dataset && d.dataset !== "DEV" ? <span className={s.muted}> · {d.dataset}</span> : null}
        <span className={s.preview} title={d.preview}>
          {d.preview}
        </span>
        {gross ? <GrossReason reasons={reasons} loading={reasonsLoading} /> : null}
      </td>
      <td className={mergeClasses(s.td, s.tdChan)}>
        <span className={s.chan}>
          {channelLabel(d.channel)}
          {d.has_audio ? <MicRegular aria-label="есть запись" /> : null}
        </span>
        <span className={s.muted}> {d.language} · {d.turns} реплик</span>
      </td>
      <td className={mergeClasses(s.td, s.tdStrip)}>
        {sc ? <MiniStrip marks={miniMarks(score, d.turns)} empty={loading ? "События загружаются" : "Событий нет"} /> : null}
      </td>
      <td className={mergeClasses(s.td, s.tdScore)}>{sc ? <ScoreBadge score={sc.total} /> : <span className={s.muted}>не оценён</span>}</td>
      <td className={mergeClasses(s.td, s.tdTags)}>
        {sc && (sc.gross_error || sc.needs_review || sc.open_appeals || sc.total !== sc.original_total) ? (
          <div className={s.tags}>
            {sc.gross_error ? <ToneBadge tone="danger">Грубая ошибка</ToneBadge> : null}
            {sc.needs_review ? <ToneBadge tone="warning">Проверить</ToneBadge> : null}
            {sc.open_appeals ? <ToneBadge tone="informative">Апелляций: {sc.open_appeals}</ToneBadge> : null}
            {sc.total !== sc.original_total ? <ToneBadge tone="subtle">Пересмотрено</ToneBadge> : null}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

/** "⛔ критерий: объяснение «цитата»" under the preview of a gross-error row. */
function GrossReason({ reasons, loading }: { reasons?: CriterionResult[]; loading: boolean }) {
  const s = useStyles();
  if (!reasons?.length) {
    return (
      <span className={s.reason}>
        <ErrorCircleFilled className={s.reasonIcon} />
        <span>{loading ? "Загрузка причины…" : "Причина — в разборе диалога"}</span>
      </span>
    );
  }
  const text = reasons
    .map((r) => `${r.name ?? r.criterion_id}: ${cleanExplanation(r.explanation)}${r.evidence?.quote ? ` «${r.evidence.quote}»` : ""}`)
    .join(" · ");
  return (
    <span className={s.reason} title={text}>
      <ErrorCircleFilled className={s.reasonIcon} />
      <span className={s.reasonText}>
        {reasons.map((r, i) => (
          <span key={r.criterion_id}>
            {i ? " · " : ""}
            <b>{r.name ?? r.criterion_id}:</b> {cleanExplanation(r.explanation)}
            {r.evidence?.quote ? <i> «{r.evidence.quote}»</i> : null}
          </span>
        ))}
      </span>
    </span>
  );
}
