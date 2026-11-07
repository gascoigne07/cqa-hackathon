import {
  Badge,
  Button,
  Caption1,
  Card,
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
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { ArrowDownloadRegular, ArrowUploadRegular, CloudArrowDownRegular, TaskListLtrRegular } from "@fluentui/react-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../api/cqa";
import type { DialogListItem } from "../api/contract";
import { BatchProgress } from "../components/BatchProgress";
import { ScoreBadge } from "../components/ScoreBadge";
import { channelLabel, formatScore, pickChecklist } from "../lib/format";
import { useProvider } from "../lib/provider";
import { useBatchJob } from "../lib/useBatchJob";
import { href, navigate } from "../router";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "16px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" },
  stats: { display: "flex", gap: "12px", flexWrap: "wrap" },
  stat: { padding: "10px 14px", minWidth: "130px", gap: "2px" },
  statValue: { fontSize: tokens.fontSizeBase600, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: "tabular-nums" },
  muted: { color: tokens.colorNeutralForeground3 },
  toolbar: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
  grow: { flexGrow: 1 },
  tableWrap: { overflowX: "auto", backgroundColor: tokens.colorNeutralBackground1, borderRadius: tokens.borderRadiusLarge },
  row: { cursor: "pointer", ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover } },
  preview: {
    display: "-webkit-box",
    WebkitLineClamp: "2",
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    color: tokens.colorNeutralForeground2,
  },
  status: { display: "flex", gap: "4px", flexWrap: "wrap" },
  num: { fontVariantNumeric: "tabular-nums" },
  empty: { padding: "24px", display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" },
});

type SortKey = "order" | "score";

export function DialogsScreen() {
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
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (d) => d.conversation_id.toLowerCase().includes(q) || d.preview.toLowerCase().includes(q) || (d.dataset ?? "").toLowerCase().includes(q),
      );
    }
    if (sort === "score") list = [...list].sort((a, b) => (a.last_score?.total ?? 999) - (b.last_score?.total ?? 999));
    return list;
  }, [all, dataset, language, channel, search, sort]);

  const scored = all.filter((d) => d.last_score);
  const totals = scored.map((d) => d.last_score!.total).filter((t): t is number => t != null);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const openAppeals = scored.reduce((n, d) => n + (d.last_score?.open_appeals ?? 0), 0);
  const languages = [...new Set(all.map((d) => d.language))];
  const channels = [...new Set(all.map((d) => d.channel))];
  const datasets = [...new Set(all.map((d) => d.dataset ?? "").filter(Boolean))];
  const datasetCount = (name: string) => all.filter((d) => d.dataset === name).length;
  // Export takes each dialog's latest score: flag rows not scored by the selected model (e.g. an old mock score).
  const stale = provider ? rows.filter((d) => d.last_score?.provider !== provider.id) : [];
  const showStale = stale.length > 0 && rows.some((d) => d.last_score);

  async function runImport() {
    setBusy(true);
    try {
      const r = await api.importGroup(groupId.trim());
      setNotice({ intent: "success", text: `Набор ${r.dataset}: новых ${r.imported}, обновлено ${r.updated}. Фильтр «Набор» переключён на ${r.dataset}.` });
      setDataset(r.dataset);
      setImportOpen(false);
      await qc.invalidateQueries({ queryKey: ["dialogs"] });
    } catch (e) {
      setNotice({ intent: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function runUpload(file: File) {
    setBusy(true);
    try {
      const r = await api.upload(file);
      setNotice({ intent: "success", text: `Загружено: новых ${r.imported}, обновлено ${r.updated} (набор ${r.dataset}). Фильтр «Набор» переключён на него.` });
      setDataset(r.dataset);
      await qc.invalidateQueries({ queryKey: ["dialogs"] });
    } catch (e) {
      setNotice({ intent: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className={s.root}>
      <div className={s.header}>
        <div>
          <Title3>Диалоги</Title3>
          <Caption1 className={s.muted} block>
            Чаты — {chatChecklist ? `«${chatChecklist.name}» (#${chatChecklist.id})` : "…"} · звонки —{" "}
            {callChecklist ? `«${callChecklist.name}» (#${callChecklist.id})` : "…"} · модель: {provider?.name ?? "—"}
          </Caption1>
        </div>
        <div className={s.stats}>
          <Card className={s.stat}>
            <Caption1 className={s.muted}>Диалогов</Caption1>
            <span className={s.statValue}>{dialogs.data ? all.length : "—"}</span>
          </Card>
          <Card className={s.stat}>
            <Caption1 className={s.muted}>Оценено</Caption1>
            <span className={s.statValue}>{scored.length}</span>
          </Card>
          <Card className={s.stat}>
            <Caption1 className={s.muted}>Средний балл</Caption1>
            <span className={s.statValue}>{formatScore(avg == null ? null : Math.round(avg * 10) / 10)}</span>
          </Card>
          <Card className={s.stat}>
            <Caption1 className={s.muted}>Открытых апелляций</Caption1>
            <span className={s.statValue}>{openAppeals}</span>
          </Card>
        </div>
      </div>

      <div className={s.toolbar}>
        <Field label="Поиск">
          <Input value={search} onChange={(_, d) => setSearch(d.value)} placeholder="ID или текст" />
        </Field>
        <Field label="Набор">
          <Select value={dataset} onChange={(_, d) => setDataset(d.value)}>
            <option value="">Все ({all.length})</option>
            {datasets.map((n) => (
              <option key={n} value={n}>
                {n} ({datasetCount(n)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Язык">
          <Select value={language} onChange={(_, d) => setLanguage(d.value)}>
            <option value="">Все</option>
            {languages.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Канал">
          <Select value={channel} onChange={(_, d) => setChannel(d.value)}>
            <option value="">Все</option>
            {channels.map((c) => (
              <option key={c} value={c}>
                {channelLabel(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Сортировка">
          <Select value={sort} onChange={(_, d) => setSort(d.value as SortKey)}>
            <option value="order">По порядку</option>
            <option value="score">Сначала низкий балл</option>
          </Select>
        </Field>
        <span className={s.grow} />
        <Button icon={<CloudArrowDownRegular />} onClick={() => setImportOpen(true)} disabled={busy}>
          Импорт из API
        </Button>
        <Button
          as="a"
          icon={<ArrowDownloadRegular />}
          href={api.exportUrl("csv", rows.length === all.length ? undefined : rows.map((r) => r.conversation_id))}
          download
          title="Последняя оценка каждого диалога из списка (с учётом фильтров)"
        >
          CSV
        </Button>
        <Button
          as="a"
          icon={<ArrowDownloadRegular />}
          href={api.exportUrl("json", rows.length === all.length ? undefined : rows.map((r) => r.conversation_id))}
          download
          title="Полные результаты в JSON (с учётом фильтров)"
        >
          JSON
        </Button>
        <Button icon={<ArrowUploadRegular />} onClick={() => fileInput.current?.click()} disabled={busy}>
          Загрузить JSON
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => e.target.files?.[0] && runUpload(e.target.files[0])}
        />
        <Button
          appearance="primary"
          icon={<TaskListLtrRegular />}
          disabled={batch.running || !rows.length || !provider?.available}
          onClick={() =>
            batch.start({ dialog_ids: rows.map((r) => r.conversation_id), provider: provider?.id })
          }
        >
          {batch.running ? "Оценка…" : rows.length === all.length ? "Оценить все" : `Оценить выбранные (${rows.length})`}
        </Button>
      </div>

      <BatchProgress job={batch.job} error={batch.error} />
      {showStale ? (
        <MessageBar intent="warning">
          <MessageBarBody>
            {stale.length} из {rows.length} диалогов в списке не оценены моделью «{provider?.name}» — в CSV/JSON попадёт их последняя
            оценка другой модели или пустая строка: {stale.slice(0, 5).map((d) => d.conversation_id).join(", ")}
            {stale.length > 5 ? "…" : ""}. Переоцените их перед выгрузкой.
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {notice ? (
        <MessageBar intent={notice.intent}>
          <MessageBarBody>{notice.text}</MessageBarBody>
        </MessageBar>
      ) : null}
      {dialogs.error ? (
        <MessageBar intent="error">
          <MessageBarBody>Не удалось загрузить диалоги: {(dialogs.error as Error).message}</MessageBarBody>
        </MessageBar>
      ) : null}

      <div className={s.tableWrap}>
        {dialogs.isLoading ? (
          <div className={s.empty}>
            <Spinner label="Загрузка диалогов…" />
          </div>
        ) : !all.length ? (
          <div className={s.empty}>
            <Text weight="semibold">Диалогов пока нет</Text>
            <Text>Импортируйте набор из API организаторов (group_id = DEV) или загрузите JSON.</Text>
            <Button icon={<CloudArrowDownRegular />} onClick={() => setImportOpen(true)}>
              Импорт из API
            </Button>
          </div>
        ) : (
          <Table size="small" aria-label="Диалоги" style={{ minWidth: 900 }}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell style={{ width: 130 }}>ID</TableHeaderCell>
                <TableHeaderCell style={{ width: 96 }}>Канал</TableHeaderCell>
                <TableHeaderCell style={{ width: 64 }}>Язык</TableHeaderCell>
                <TableHeaderCell style={{ width: 72 }}>Реплик</TableHeaderCell>
                <TableHeaderCell>Превью</TableHeaderCell>
                <TableHeaderCell style={{ width: 72 }}>Итог</TableHeaderCell>
                <TableHeaderCell style={{ width: 230 }}>Статус</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <DialogRow key={d.conversation_id} d={d} />
              ))}
            </TableBody>
          </Table>
        )}
        {all.length > 0 && !rows.length ? <Text block style={{ padding: 16 }}>Ничего не найдено по фильтрам.</Text> : null}
      </div>

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

function DialogRow({ d }: { d: DialogListItem }) {
  const s = useStyles();
  const sc = d.last_score;
  const open = () => navigate({ name: "dialog", id: d.conversation_id });
  return (
    <TableRow className={s.row} onClick={open}>
      <TableCell>
        <Link href={href({ name: "dialog", id: d.conversation_id })} onClick={(e) => e.stopPropagation()}>
          {d.conversation_id}
        </Link>
        {d.dataset && d.dataset !== "DEV" ? <Caption1 className={s.muted}> · {d.dataset}</Caption1> : null}
      </TableCell>
      <TableCell>
        {channelLabel(d.channel)}
        {d.has_audio ? " 🎧" : ""}
      </TableCell>
      <TableCell>{d.language}</TableCell>
      <TableCell className={s.num}>{d.turns}</TableCell>
      <TableCell>
        <span className={s.preview} title={d.preview}>
          {d.preview}
        </span>
      </TableCell>
      <TableCell>{sc ? <ScoreBadge score={sc.total} /> : <Caption1 className={s.muted}>—</Caption1>}</TableCell>
      <TableCell>
        <div className={s.status}>
          {!sc ? (
            <Badge appearance="outline" color="subtle">
              Не оценён
            </Badge>
          ) : null}
          {sc?.gross_error ? <Badge color="danger">Грубая ошибка</Badge> : null}
          {sc?.needs_review ? (
            <Badge color="warning" appearance="tint">
              Нужна проверка
            </Badge>
          ) : null}
          {sc?.open_appeals ? (
            <Badge color="important" appearance="tint">
              Апелляций: {sc.open_appeals}
            </Badge>
          ) : null}
          {sc && sc.total !== sc.original_total ? (
            <Badge color="brand" appearance="tint">
              Пересмотрено
            </Badge>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
