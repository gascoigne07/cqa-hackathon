import {
  Badge,
  Body1,
  Button,
  Caption1,
  Card,
  Checkbox,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Select,
  Spinner,
  SpinButton,
  Switch,
  Text,
  Textarea,
  Title3,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowDownRegular,
  ArrowUpRegular,
  ChevronDownRegular,
  ChevronRightRegular,
  DeleteRegular,
  ErrorCircleFilled,
  SaveRegular,
  TaskListLtrRegular,
} from "@fluentui/react-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { api } from "../api/cqa";
import type { Channel, Checklist, ChecklistIn, Criterion, CriterionType, ScaleStep } from "../api/contract";
import { BatchProgress } from "../components/BatchProgress";
import { CHECKLIST_CHANNEL_LABEL, TYPE_LABEL, dateTime, formatScore } from "../lib/format";
import { useProvider } from "../lib/provider";
import { useBatchJob } from "../lib/useBatchJob";
import { BRAND_GREEN } from "../theme";

/** № · criterion · type · weight · share · flags · actions */
const COLS = "28px minmax(0, 1fr) 118px 96px 70px 128px 124px";
const COLS_NARROW = "24px minmax(0, 1fr) 96px 124px";
const SECTION_COLORS = [BRAND_GREEN, "#5b9bd5", "#e8b04a", "#a97fd6", "#e8846a", "#3bb5ab"];

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px", paddingBottom: "8px" },
  top: { display: "flex", gap: "12px 24px", alignItems: "flex-end", flexWrap: "wrap" },
  intro: { flex: "1 1 420px", minWidth: 0 },
  version: { flex: "0 1 520px", minWidth: 0, maxWidth: "100%", "& .fui-Select, & select": { width: "100%", minWidth: 0 } },
  grow: { flexGrow: 1 },
  muted: { color: tokens.colorNeutralForeground3 },
  settings: { padding: "12px 14px", gap: "10px" },
  settingsRow: { display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" },
  nameField: { flexGrow: 1, minWidth: "240px" },
  roundField: { width: "120px" },

  table: { padding: "0", gap: "0", overflow: "hidden" },
  summary: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px 14px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  bar: { display: "flex", height: "8px", borderRadius: "4px", overflow: "hidden", gap: "2px" },
  legend: { display: "flex", gap: "6px 16px", flexWrap: "wrap" },
  legendItem: { display: "inline-flex", alignItems: "center", gap: "6px" },
  dot: { width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0 },

  grid: {
    display: "grid",
    gridTemplateColumns: COLS,
    columnGap: "10px",
    alignItems: "center",
    padding: "0 14px",
    "@media (max-width: 900px)": { gridTemplateColumns: COLS_NARROW },
  },
  head: {
    minHeight: "32px",
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 14px 4px",
    color: tokens.colorNeutralForeground2,
  },
  row: {
    minHeight: "44px",
    cursor: "pointer",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  rowOpen: { backgroundColor: tokens.colorNeutralBackground3, ":hover": { backgroundColor: tokens.colorNeutralBackground3 } },
  num: { color: tokens.colorNeutralForeground3, fontVariantNumeric: "tabular-nums" },
  nameCell: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0, padding: "6px 0" },
  nameText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  idText: { color: tokens.colorNeutralForeground4, whiteSpace: "nowrap", "@media (max-width: 1100px)": { display: "none" } },
  weight: { width: "88px" },
  share: { fontVariantNumeric: "tabular-nums" },
  flags: { display: "flex", gap: "4px", flexWrap: "wrap" },
  actions: { display: "flex", justifyContent: "flex-end", gap: "2px" },
  hideNarrow: { "@media (max-width: 900px)": { display: "none" } },
  errorIcon: { color: tokens.colorPaletteRedForeground1, flexShrink: 0 },

  details: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "10px 12px",
    padding: "12px 14px 14px 52px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    "@media (max-width: 900px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))", paddingLeft: "14px" },
  },
  span2: { gridColumn: "span 2" },
  wide: { gridColumn: "1 / -1" },
  naNote: { alignSelf: "end", paddingBottom: "6px", color: tokens.colorNeutralForeground3 },
  steps: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "6px 12px" },
  stepRow: { display: "grid", gridTemplateColumns: "84px 1fr auto", gap: "6px", alignItems: "center" },
  addRow: { padding: "10px 14px" },

  sticky: {
    position: "sticky",
    bottom: "0",
    display: "flex",
    gap: "12px",
    alignItems: "center",
    flexWrap: "wrap",
    padding: "10px 14px",
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow16,
    borderRadius: tokens.borderRadiusLarge,
    zIndex: 1,
  },
  progressRow: { flexBasis: "100%" },
});

const DEFAULT_STEPS: ScaleStep[] = [
  { value: 0, label: "не выполнено" },
  { value: 1, label: "частично" },
  { value: 2, label: "полностью" },
];

const blank = (n: number, section: string | null): Criterion => ({
  id: `custom_${n}`,
  order: n,
  section,
  name: "Новый критерий",
  type: "yes_no",
  weight: 5,
  na_allowed: false,
  scale_max: null,
  scale: [],
  guidance: "",
  gross_error_if: null,
});

const toBody = (c: Checklist): ChecklistIn => ({
  name: c.name,
  rounding: c.rounding,
  criteria: [...c.criteria].sort((a, b) => a.order - b.order),
  channel: c.channel ?? "all",
  instructions: c.instructions ?? "",
  gross_error_policy: c.gross_error_policy ?? "flag",
  note: c.note ?? "",
});

/** Keep order/scale_max/na_allowed consistent with the contract before saving. */
function normalize(body: ChecklistIn): ChecklistIn {
  return {
    ...body,
    criteria: body.criteria.map((c, i) => {
      const scale = c.type === "scale" ? [...c.scale].sort((a, b) => a.value - b.value) : [];
      return {
        ...c,
        order: i + 1,
        na_allowed: c.type === "yes_no_na" ? true : c.type === "yes_no" ? false : c.na_allowed,
        scale,
        scale_max: c.type === "scale" ? (scale.length ? Math.max(...scale.map((st) => st.value)) : c.scale_max) : null,
      };
    }),
  };
}

interface Problem {
  /** criterion index, or null for the whole checklist */
  i: number | null;
  msg: string;
}

function validate(body: ChecklistIn): Problem[] {
  const out: Problem[] = [];
  const ids = new Set<string>();
  body.criteria.forEach((c, i) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(c.id)) out.push({ i, msg: "id — латиница, цифры, _ или -" });
    if (ids.has(c.id)) out.push({ i, msg: `id «${c.id}» повторяется` });
    ids.add(c.id);
    if (!c.name.trim()) out.push({ i, msg: "нужно название" });
    if (!(c.weight >= 0)) out.push({ i, msg: "вес не может быть отрицательным" });
    if (c.type === "scale") {
      if (c.scale.length < 2) out.push({ i, msg: "у шкалы нужно минимум 2 ступени" });
      const values = c.scale.map((st) => st.value);
      if (new Set(values).size !== values.length) out.push({ i, msg: "значения ступеней повторяются" });
    }
  });
  if (!body.criteria.length) out.push({ i: null, msg: "Нужен хотя бы один критерий" });
  else if (!body.criteria.some((c) => c.weight > 0)) out.push({ i: null, msg: "Хотя бы у одного критерия вес должен быть больше 0" });
  return out;
}

const num = (v: number | null | undefined, fallback: string | undefined) => Number(v ?? fallback ?? 0) || 0;
const stop = (e: MouseEvent) => e.stopPropagation();

export function ChecklistScreen() {
  const s = useStyles();
  const qc = useQueryClient();
  const { provider } = useProvider();
  const list = useQuery({ queryKey: ["checklists"], queryFn: api.checklists });
  const [viewId, setViewId] = useState<number | null>(null);
  const currentId = viewId ?? list.data?.[0]?.id;
  const viewing = useQuery({ queryKey: ["checklist", currentId], queryFn: () => api.checklist(currentId!), enabled: currentId != null });

  const [draft, setDraft] = useState<ChecklistIn | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [saved, setSaved] = useState<Checklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const batch = useBatchJob();

  useEffect(() => {
    if (viewing.data) {
      setDraft(toBody(viewing.data));
      setOpen(null);
    }
  }, [viewing.data]);

  const base = viewing.data ? JSON.stringify(normalize(toBody(viewing.data))) : "";
  const normalized = draft ? normalize(draft) : null;
  const dirty = useMemo(() => !!normalized && JSON.stringify(normalized) !== base, [normalized, base]);
  const problems = normalized ? validate(normalized) : [];
  const totalWeight = draft?.criteria.reduce((a, c) => a + (c.weight || 0), 0) ?? 0;
  const viewingChannel = viewing.data?.channel ?? "all";
  // the checklist used for a channel is the newest one with that channel
  const isLatest = list.data?.find((c) => (c.channel ?? "all") === viewingChannel)?.id === currentId;

  // sections in order of first appearance, with their colour and weight
  const sections = useMemo(() => {
    const m = new Map<string, { name: string; color: string; weight: number }>();
    for (const c of draft?.criteria ?? []) {
      const name = c.section?.trim() || "Без секции";
      if (!m.has(name)) m.set(name, { name, color: SECTION_COLORS[m.size % SECTION_COLORS.length], weight: 0 });
      m.get(name)!.weight += c.weight || 0;
    }
    return [...m.values()];
  }, [draft]);
  const sectionOf = (c: Criterion) => sections.find((x) => x.name === (c.section?.trim() || "Без секции"))!;
  const pct = (w: number) => (totalWeight ? formatScore(Math.round((w / totalWeight) * 1000) / 10) : "0");

  const update = (i: number, patch: Partial<Criterion>) =>
    setDraft((d) => (d ? { ...d, criteria: d.criteria.map((c, k) => (k === i ? { ...c, ...patch } : c)) } : d));
  const move = (i: number, delta: number) => {
    if (!draft) return;
    const j = i + delta;
    if (j < 0 || j >= draft.criteria.length) return;
    const next = [...draft.criteria];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft({ ...draft, criteria: next });
    setOpen((o) => (o === i ? j : o === j ? i : o));
  };
  const remove = (i: number) => {
    if (!draft) return;
    setDraft({ ...draft, criteria: draft.criteria.filter((_, k) => k !== i) });
    setOpen((o) => (o === null || o === i ? null : o > i ? o - 1 : o));
  };
  const add = () => {
    if (!draft) return;
    const last = draft.criteria[draft.criteria.length - 1];
    setDraft({ ...draft, criteria: [...draft.criteria, blank(draft.criteria.length + 1, last?.section ?? null)] });
    setOpen(draft.criteria.length);
  };
  const setSteps = (i: number, steps: ScaleStep[]) => update(i, { scale: steps });

  async function save() {
    if (!normalized || problems.length) return;
    setSaving(true);
    setError(null);
    try {
      const cl = await api.saveChecklist(normalized);
      setSaved(cl);
      setViewId(null);
      await qc.invalidateQueries({ queryKey: ["checklists"] });
      qc.setQueryData(["checklist", cl.id], cl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (list.isLoading || viewing.isLoading || !draft) return <Spinner label="Загрузка чек-листа…" />;
  if (list.error || viewing.error) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>Не удалось загрузить чек-лист: {((list.error || viewing.error) as Error).message}</MessageBarBody>
      </MessageBar>
    );
  }

  const sectionNames = sections.map((x) => x.name).filter((n) => n !== "Без секции");

  return (
    <div className={s.root}>
      <div className={s.top}>
        <div className={s.intro}>
          <Title3>Чек-лист</Title3>
          <Caption1 className={s.muted} block>
            {draft.note || "Всё берётся из конфигурации."} Сохранение создаёт новую версию; для чатов и звонков используется самая новая.
          </Caption1>
        </div>
        <Field label="Версия" className={s.version}>
          <Select value={String(currentId)} onChange={(_, d) => setViewId(Number(d.value))}>
            {list.data!.map((v, k) => (
              <option key={v.id} value={v.id}>
                #{v.id} · {v.name.slice(0, 40)} ({CHECKLIST_CHANNEL_LABEL[v.channel ?? "all"]})
                {list.data!.findIndex((x) => (x.channel ?? "all") === (v.channel ?? "all")) === k ? " · используется" : ""}
                {v.created_at ? ` · ${dateTime(v.created_at)}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {!isLatest ? (
        <MessageBar intent="info">
          <MessageBarBody>
            Это не текущая версия {CHECKLIST_CHANNEL_LABEL[viewingChannel]}. Сохраните её, чтобы снова сделать актуальной (создастся новый
            чек-лист).
          </MessageBarBody>
        </MessageBar>
      ) : null}

      <Card className={s.settings}>
        <div className={s.settingsRow}>
          <Field label="Название" className={s.nameField}>
            <Input value={draft.name} onChange={(_, d) => setDraft({ ...draft, name: d.value })} />
          </Field>
          <Field label="Применяется к">
            <Select value={draft.channel ?? "all"} onChange={(_, d) => setDraft({ ...draft, channel: d.value as Channel })}>
              <option value="chat">Чатам</option>
              <option value="call">Звонкам</option>
              <option value="all">Всем диалогам</option>
            </Select>
          </Field>
          <Field label="Знаков в итоге" className={s.roundField}>
            <SpinButton value={draft.rounding} min={0} max={4} onChange={(_, d) => setDraft({ ...draft, rounding: num(d.value, d.displayValue) })} />
          </Field>
          <Button
            appearance="subtle"
            icon={rulesOpen ? <ChevronDownRegular /> : <ChevronRightRegular />}
            aria-expanded={rulesOpen}
            onClick={() => setRulesOpen((v) => !v)}
          >
            Общие правила для модели
            {draft.instructions ? ` · ${draft.instructions.length} симв.` : " · не заданы"}
          </Button>
        </div>
        {rulesOpen ? (
          <Field hint="Отправляются модели вместе с каждым критерием: чем «Нет» отличается от N/A, что считать доказательством и т. п.">
            <Textarea value={draft.instructions ?? ""} onChange={(_, d) => setDraft({ ...draft, instructions: d.value })} resize="vertical" rows={6} />
          </Field>
        ) : null}
      </Card>

      <Card className={s.table}>
        <div className={s.summary}>
          <Body1>
            <b>{draft.criteria.length}</b> критериев · сумма весов <b>{formatScore(totalWeight)}</b>
            <Caption1 className={s.muted}> — доли считаются до исключения N/A, затем веса перераспределяются</Caption1>
          </Body1>
          <div className={s.bar} role="img" aria-label="Распределение весов по секциям">
            {sections
              .filter((x) => x.weight > 0)
              .map((x) => (
                <Tooltip key={x.name} content={`${x.name}: ${pct(x.weight)}%`} relationship="description">
                  <span style={{ flexGrow: x.weight, backgroundColor: x.color }} />
                </Tooltip>
              ))}
          </div>
          <div className={s.legend}>
            {sections.map((x) => (
              <Caption1 key={x.name} className={s.legendItem}>
                <span className={s.dot} style={{ backgroundColor: x.color }} />
                {x.name} · {x.weight > 0 ? `${pct(x.weight)}%` : "без баллов"}
              </Caption1>
            ))}
          </div>
        </div>

        <div className={mergeClasses(s.grid, s.head)}>
          <Caption1>№</Caption1>
          <Caption1>Критерий</Caption1>
          <Caption1 className={s.hideNarrow}>Тип</Caption1>
          <Caption1>Вес</Caption1>
          <Caption1 className={s.hideNarrow}>Доля</Caption1>
          <Caption1 className={s.hideNarrow}>Отметки</Caption1>
          <span />
        </div>

        {draft.criteria.map((c, i) => {
          const sec = sectionOf(c);
          const prev = draft.criteria[i - 1];
          const newSection = i === 0 || (prev.section?.trim() || "Без секции") !== sec.name;
          const rowProblems = problems.filter((p) => p.i === i);
          const isOpen = open === i;
          return (
            <div key={`${currentId}-${i}`}>
              {newSection ? (
                <div className={s.sectionRow}>
                  <span className={s.dot} style={{ backgroundColor: sec.color }} />
                  <Caption1>
                    <b>{sec.name}</b>
                  </Caption1>
                </div>
              ) : null}

              <div className={mergeClasses(s.grid, s.row, isOpen && s.rowOpen)} onClick={() => setOpen(isOpen ? null : i)}>
                <Caption1 className={s.num}>{i + 1}</Caption1>
                <div className={s.nameCell}>
                  {rowProblems.length ? (
                    <Tooltip content={rowProblems.map((p) => p.msg).join("; ")} relationship="description">
                      <ErrorCircleFilled className={s.errorIcon} />
                    </Tooltip>
                  ) : null}
                  <Text weight="semibold" className={s.nameText}>
                    {c.name || "Без названия"}
                  </Text>
                  <Caption1 className={s.idText}>{c.id}</Caption1>
                </div>
                <Caption1 className={s.hideNarrow}>{TYPE_LABEL[c.type]}</Caption1>
                <div onClick={stop}>
                  <SpinButton
                    size="small"
                    className={s.weight}
                    aria-label={`Вес: ${c.name}`}
                    value={c.weight}
                    min={0}
                    step={0.5}
                    onChange={(_, d) => update(i, { weight: num(d.value, d.displayValue) })}
                  />
                </div>
                <Caption1 className={mergeClasses(s.share, s.hideNarrow)}>{c.weight === 0 ? "—" : `${pct(c.weight)}%`}</Caption1>
                <div className={mergeClasses(s.flags, s.hideNarrow)}>
                  {c.weight === 0 ? (
                    <Badge size="small" appearance="tint" color="informative">
                      без баллов
                    </Badge>
                  ) : null}
                  {c.na_allowed || c.type === "yes_no_na" ? (
                    <Badge size="small" appearance="outline" color="informative">
                      N/A
                    </Badge>
                  ) : null}
                  {c.gross_error_if ? (
                    <Badge size="small" appearance="filled" color="danger">
                      грубая
                    </Badge>
                  ) : null}
                </div>
                <div className={s.actions} onClick={stop}>
                  <Tooltip content="Выше" relationship="label">
                    <Button size="small" appearance="subtle" icon={<ArrowUpRegular />} disabled={i === 0} onClick={() => move(i, -1)} />
                  </Tooltip>
                  <Tooltip content="Ниже" relationship="label">
                    <Button
                      size="small"
                      appearance="subtle"
                      icon={<ArrowDownRegular />}
                      disabled={i === draft.criteria.length - 1}
                      onClick={() => move(i, 1)}
                    />
                  </Tooltip>
                  <Tooltip content="Удалить критерий" relationship="label">
                    <Button size="small" appearance="subtle" icon={<DeleteRegular />} onClick={() => remove(i)} />
                  </Tooltip>
                  <Tooltip content={isOpen ? "Свернуть" : "Подробнее"} relationship="label">
                    <Button
                      size="small"
                      appearance="subtle"
                      aria-expanded={isOpen}
                      icon={isOpen ? <ChevronDownRegular /> : <ChevronRightRegular />}
                      onClick={() => setOpen(isOpen ? null : i)}
                    />
                  </Tooltip>
                </div>
              </div>

              {isOpen ? (
                <div className={s.details}>
                  <Field label="Название" className={s.span2} required size="small">
                    <Input value={c.name} onChange={(_, d) => update(i, { name: d.value })} />
                  </Field>
                  <Field label="ID" size="small">
                    <Input value={c.id} onChange={(_, d) => update(i, { id: d.value })} />
                  </Field>
                  <Field label="Секция" size="small">
                    <Input value={c.section ?? ""} list="cqa-sections" onChange={(_, d) => update(i, { section: d.value || null })} />
                  </Field>
                  <Field label="Тип" size="small">
                    <Select
                      value={c.type}
                      onChange={(_, d) => {
                        const type = d.value as CriterionType;
                        update(i, {
                          type,
                          na_allowed: type === "yes_no_na" ? true : type === "yes_no" ? false : c.na_allowed,
                          scale: type === "scale" ? (c.scale.length ? c.scale : DEFAULT_STEPS) : [],
                        });
                      }}
                    >
                      <option value="yes_no">{TYPE_LABEL.yes_no}</option>
                      <option value="yes_no_na">{TYPE_LABEL.yes_no_na}</option>
                      <option value="scale">{TYPE_LABEL.scale}</option>
                    </Select>
                  </Field>
                  {c.type === "scale" ? (
                    <Switch checked={c.na_allowed} label="Разрешить N/A" onChange={(_, d) => update(i, { na_allowed: d.checked })} />
                  ) : (
                    <Caption1 className={s.naNote}>{c.type === "yes_no_na" ? "N/A разрешён" : "N/A запрещён"}</Caption1>
                  )}
                  <Field label="Грубая ошибка" size="small" hint={c.weight === 0 ? "Вес 0 — только отметка, без баллов" : undefined}>
                    <Select
                      value={c.gross_error_if ?? ""}
                      onChange={(_, d) => update(i, { gross_error_if: (d.value || null) as Criterion["gross_error_if"] })}
                    >
                      <option value="">не отмечать</option>
                      <option value="yes">если ответ «Да»</option>
                      <option value="no">если ответ «Нет» / 0</option>
                    </Select>
                  </Field>
                  <span />
                  <Field label="Инструкция для модели" className={s.wide} size="small">
                    <Textarea value={c.guidance} onChange={(_, d) => update(i, { guidance: d.value })} resize="vertical" rows={3} />
                  </Field>

                  {c.type === "scale" ? (
                    <div className={s.wide}>
                      <Caption1 block>
                        Ступени шкалы · максимум {c.scale.length ? formatScore(Math.max(...c.scale.map((st) => st.value))) : "—"}
                      </Caption1>
                      <div className={s.steps}>
                        {c.scale.map((st, k) => (
                          <div key={k} className={s.stepRow}>
                            <SpinButton
                              size="small"
                              value={st.value}
                              aria-label="Значение ступени"
                              onChange={(_, d) =>
                                setSteps(i, c.scale.map((x, n) => (n === k ? { ...x, value: num(d.value, d.displayValue) } : x)))
                              }
                            />
                            <Input
                              size="small"
                              value={st.label}
                              placeholder="подпись, например «частично»"
                              onChange={(_, d) => setSteps(i, c.scale.map((x, n) => (n === k ? { ...x, label: d.value } : x)))}
                            />
                            <Button
                              size="small"
                              appearance="subtle"
                              icon={<DeleteRegular />}
                              aria-label="Удалить ступень"
                              onClick={() => setSteps(i, c.scale.filter((_, n) => n !== k))}
                            />
                          </div>
                        ))}
                      </div>
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<AddRegular />}
                        onClick={() =>
                          setSteps(i, [...c.scale, { value: (c.scale.length ? Math.max(...c.scale.map((x) => x.value)) : -1) + 1, label: "" }])
                        }
                      >
                        Добавить ступень
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className={s.addRow}>
          <Button appearance="subtle" icon={<AddRegular />} onClick={add}>
            Добавить критерий
          </Button>
        </div>
        <datalist id="cqa-sections">
          {sectionNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Card>

      {problems.length && dirty ? (
        <MessageBar intent="warning">
          <MessageBarBody>
            <MessageBarTitle>Исправьте перед сохранением</MessageBarTitle>
            {problems
              .slice(0, 4)
              .map((p) => (p.i === null ? p.msg : `№${p.i + 1}: ${p.msg}`))
              .join(" · ")}
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {error ? (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      ) : null}

      <div className={s.sticky}>
        <Body1>{dirty ? "Есть несохранённые изменения" : isLatest ? "Это текущая версия" : "Старая версия"}</Body1>
        <span className={s.grow} />
        {saved && !dirty && isLatest ? (
          <>
            <Caption1>
              Сохранено как #{saved.id} — используется {CHECKLIST_CHANNEL_LABEL[saved.channel ?? "all"]}.
            </Caption1>
            <Checkbox checked={onlyChanged} onChange={(_, d) => setOnlyChanged(!!d.checked)} label="Переоценить только изменённые критерии" />
            <Button
              appearance="primary"
              icon={<TaskListLtrRegular />}
              disabled={batch.running || !provider?.available}
              onClick={() => batch.start({ provider: provider?.id, reuse_unchanged: onlyChanged })}
            >
              Применить ко всем диалогам
            </Button>
          </>
        ) : null}
        <Button
          appearance={dirty || !isLatest ? "primary" : "secondary"}
          icon={<SaveRegular />}
          disabled={(!dirty && isLatest) || saving || problems.length > 0}
          onClick={save}
        >
          {saving ? "Сохранение…" : "Сохранить чек-лист"}
        </Button>
        {batch.job || batch.error ? (
          <div className={s.progressRow}>
            <BatchProgress job={batch.job} error={batch.error} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
