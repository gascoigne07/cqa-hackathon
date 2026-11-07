import {
  Button,
  Caption1,
  Card,
  Field,
  Link,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Subtitle1,
  Text,
  Title3,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ArrowTrendingDownRegular, ErrorCircleFilled, LocalLanguageRegular } from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/cqa";
import type { ResultRow } from "../api/contract";
import { channelLabel, formatScore, scoreTone } from "../lib/format";
import { href, navigate } from "../router";

/**
 * ⊕ «Обзор»: where the points are lost and how quality differs by language / channel.
 * Built from the latest score of each dialog (one request — the JSON export); plain divs, no chart library.
 */

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "16px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  kpis: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px" },
  kpi: { padding: "12px 16px", gap: "2px" },
  kpiValue: { fontSize: tokens.fontSizeBase600, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: "tabular-nums" },
  kpiDanger: { color: tokens.colorPaletteRedForeground1 },
  kpiLink: { cursor: "pointer", borderLeft: `4px solid ${tokens.colorPaletteRedBorder2}`, ":hover": { boxShadow: tokens.shadow8 } },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)",
    gap: "16px",
    alignItems: "start",
    "@media (max-width: 1000px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  panel: { padding: "16px", gap: "12px" },
  panelHead: { display: "flex", alignItems: "center", gap: "8px" },
  headIcon: { fontSize: "20px", color: tokens.colorNeutralForeground3 },
  // «Где теряются баллы»
  lossRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 64px",
    columnGap: "12px",
    rowGap: "4px",
    alignItems: "center",
  },
  lossName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  lossValue: { textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: tokens.fontWeightSemibold },
  track: { height: "10px", borderRadius: "5px", backgroundColor: tokens.colorNeutralBackground3, overflow: "hidden" },
  fill: { height: "100%", borderRadius: "5px", backgroundColor: tokens.colorPaletteRedBackground3 },
  fillTop: { backgroundColor: tokens.colorPaletteRedForeground1 },
  list: { display: "flex", flexDirection: "column", gap: "14px" },
  grossLine: { display: "flex", gap: "6px", alignItems: "flex-start", color: tokens.colorPaletteRedForeground1, "& > svg": { flexShrink: 0, marginTop: "3px" } },
  // breakdown tables
  table: { width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" },
  th: {
    textAlign: "left",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    padding: "4px 8px 6px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  td: { padding: "8px 8px 8px 0", borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, verticalAlign: "middle" },
  scoreCell: { display: "flex", alignItems: "center", gap: "8px", minWidth: "120px" },
  scoreTrack: { flexGrow: 1, height: "8px", borderRadius: "4px", backgroundColor: tokens.colorNeutralBackground3, overflow: "hidden" },
  success: { backgroundColor: tokens.colorPaletteGreenBackground3 },
  warning: { backgroundColor: tokens.colorPaletteMarigoldBackground3 },
  danger: { backgroundColor: tokens.colorPaletteRedBackground3 },
  subtle: { backgroundColor: tokens.colorNeutralBackground5 },
  informative: { backgroundColor: tokens.colorNeutralBackground5 },
  scoreNum: { width: "40px", textAlign: "right", fontWeight: tokens.fontWeightSemibold },
  weak: { color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  grossNum: { color: tokens.colorPaletteRedForeground1, fontWeight: tokens.fontWeightSemibold },
  empty: { padding: "24px", display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-start" },
});

const LANG_ORDER = ["RU", "KZ", "EN"];
const LANG_LABEL: Record<string, string> = { RU: "Русский", KZ: "Қазақша", EN: "English" };

interface Loss {
  id: string;
  name: string;
  lost: number; // Σ points lost over scored dialogs
  applicable: number; // dialogs where the criterion was applicable
  failed: number; // … and not fully met
}

interface Group {
  key: string;
  label: string;
  dialogs: number;
  scored: number;
  avg: number | null;
  gross: number;
  review: number;
  weakest: { name: string; avgLost: number } | null;
}

const one = (n: number) => formatScore(Math.round(n * 10) / 10);

function lossesOf(rows: ResultRow[]): Loss[] {
  const m = new Map<string, Loss>();
  for (const row of rows) {
    for (const r of row.score?.results ?? []) {
      const w = r.effective_weight;
      if (!r.applicable || w == null || w <= 0 || r.points == null) continue; // N/A, flag (weight 0), unanswered
      const l = m.get(r.criterion_id) ?? { id: r.criterion_id, name: r.name || r.criterion_id, lost: 0, applicable: 0, failed: 0 };
      const lost = Math.max(0, w - r.points);
      l.lost += lost;
      l.applicable += 1;
      if (lost > 1e-6) l.failed += 1;
      m.set(r.criterion_id, l);
    }
  }
  return [...m.values()];
}

function groupBy(rows: ResultRow[], keyOf: (r: ResultRow) => string, labelOf: (k: string) => string, order: string[] = []): Group[] {
  const m = new Map<string, ResultRow[]>();
  for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...m.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, list]) => {
      const scored = list.filter((r) => r.score);
      const totals = scored.map((r) => r.score!.total).filter((t): t is number => t != null);
      const top = lossesOf(scored).sort((a, b) => b.lost - a.lost)[0];
      return {
        key,
        label: labelOf(key),
        dialogs: list.length,
        scored: scored.length,
        avg: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null,
        gross: scored.filter((r) => r.score!.gross_error).length,
        review: scored.filter((r) => r.score!.needs_review).length,
        weakest: top && top.lost > 0 ? { name: top.name, avgLost: top.lost / scored.length } : null,
      };
    });
}

export function OverviewScreen() {
  const s = useStyles();
  const [dataset, setDataset] = useState("");
  const dialogs = useQuery({ queryKey: ["dialogs"], queryFn: api.dialogs });
  // refetch whenever any dialog gets a new score
  const sig = (dialogs.data ?? []).map((d) => d.last_score?.score_id ?? 0).join(",");
  const results = useQuery({ queryKey: ["overview-results", sig], queryFn: () => api.results(), enabled: !!dialogs.data, staleTime: Infinity });

  const all = results.data ?? [];
  const datasets = [...new Set(all.map((r) => r.dataset).filter(Boolean))];
  const rows = dataset ? all.filter((r) => r.dataset === dataset) : all;
  const scored = rows.filter((r) => r.score);

  const view = useMemo(() => {
    const totals = scored.map((r) => r.score!.total).filter((t): t is number => t != null);
    const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
    const losses = lossesOf(scored)
      .filter((l) => l.lost > 0)
      .sort((a, b) => b.lost - a.lost);
    const lostTotal = losses.reduce((a, l) => a + l.lost, 0) / (scored.length || 1);
    // which flag criteria produced the gross errors
    const grossBy = new Map<string, { name: string; n: number }>();
    for (const r of scored)
      for (const c of r.score!.results)
        if (c.gross_error) grossBy.set(c.criterion_id, { name: c.name || c.criterion_id, n: (grossBy.get(c.criterion_id)?.n ?? 0) + 1 });
    const providers = new Map<string, number>();
    for (const r of scored) providers.set(r.score!.provider, (providers.get(r.score!.provider) ?? 0) + 1);
    return {
      avg,
      losses,
      lostTotal,
      grossBy: [...grossBy.values()].sort((a, b) => b.n - a.n),
      gross: scored.filter((r) => r.score!.gross_error).length,
      review: scored.filter((r) => r.score!.needs_review).length,
      providers: [...providers.entries()].sort((a, b) => b[1] - a[1]),
      byLang: groupBy(rows, (r) => r.language, (k) => LANG_LABEL[k] ?? k, LANG_ORDER),
      byChannel: groupBy(rows, (r) => channelLabel(r.channel), (k) => k, ["Чат", "Звонок"]),
    };
  }, [rows, scored]);

  const maxLost = view.losses[0]?.lost ?? 0;
  const loading = dialogs.isLoading || results.isLoading;
  const error = (dialogs.error ?? results.error) as Error | null;

  return (
    <div className={s.root}>
      <div className={s.header}>
        <div>
          <Title3>Обзор</Title3>
          <Caption1 className={s.muted} block>
            По последней оценке каждого диалога
            {view.providers.length ? ` · модель: ${view.providers.map(([p, n]) => (view.providers.length > 1 ? `${p} (${n})` : p)).join(", ")}` : ""}
          </Caption1>
        </div>
        <Field label="Набор">
          <Select value={dataset} onChange={(_, d) => setDataset(d.value)}>
            <option value="">Все ({all.length})</option>
            {datasets.map((n) => (
              <option key={n} value={n}>
                {n} ({all.filter((r) => r.dataset === n).length})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {error ? (
        <MessageBar intent="error">
          <MessageBarBody>Не удалось загрузить оценки: {error.message}</MessageBarBody>
        </MessageBar>
      ) : null}
      {view.providers.length > 1 ? (
        <MessageBar intent="warning">
          <MessageBarBody>
            В выборке оценки разных моделей — сравнение неточное. Переоцените набор одной моделью на вкладке «Диалоги».
          </MessageBarBody>
        </MessageBar>
      ) : null}

      {loading ? (
        <Spinner label="Считаем обзор…" />
      ) : !scored.length ? (
        <Card className={s.empty}>
          <Text weight="semibold">{rows.length ? "Пока ничего не оценено" : "Диалогов пока нет"}</Text>
          <Text>Оцените диалоги на вкладке «Диалоги» — обзор посчитается по их результатам.</Text>
          <Button appearance="primary" onClick={() => navigate({ name: "dialogs" })}>
            К диалогам
          </Button>
        </Card>
      ) : (
        <>
          <div className={s.kpis}>
            <Card className={s.kpi}>
              <Caption1 className={s.muted}>Оценено</Caption1>
              <span className={s.kpiValue}>
                {scored.length} <Caption1 className={s.muted}>из {rows.length}</Caption1>
              </span>
            </Card>
            <Card className={s.kpi}>
              <Caption1 className={s.muted}>Средний балл</Caption1>
              <span className={s.kpiValue}>{view.avg == null ? "—" : Math.round(view.avg)}</span>
            </Card>
            <Card
              className={mergeClasses(s.kpi, view.gross > 0 && s.kpiLink)}
              onClick={view.gross ? () => navigate({ name: "dialogs", gross: true }) : undefined}
              role={view.gross ? "link" : undefined}
              tabIndex={view.gross ? 0 : undefined}
              onKeyDown={(e) => view.gross && e.key === "Enter" && navigate({ name: "dialogs", gross: true })}
              title={view.gross ? "Открыть список диалогов с грубыми ошибками" : undefined}
            >
              <Caption1 className={s.muted}>Грубых ошибок</Caption1>
              <span className={mergeClasses(s.kpiValue, view.gross > 0 && s.kpiDanger)}>
                {view.gross} <Caption1 className={s.muted}>· {Math.round((100 * view.gross) / scored.length)}%</Caption1>
              </span>
            </Card>
            <Card className={s.kpi}>
              <Caption1 className={s.muted}>Нужна проверка</Caption1>
              <span className={s.kpiValue}>{view.review}</span>
            </Card>
          </div>

          <div className={s.grid}>
            <Card className={s.panel}>
              <div className={s.panelHead}>
                <ArrowTrendingDownRegular className={s.headIcon} />
                <Subtitle1>Где теряются баллы</Subtitle1>
              </div>
              <Caption1 className={s.muted}>
                В среднем диалог теряет <b>{one(view.lostTotal)}</b> из 100 баллов. Полоса — сколько из них приходится на критерий.
              </Caption1>
              {view.losses.length ? (
                <div className={s.list}>
                  {view.losses.map((l, i) => (
                    <div key={l.id} className={s.lossRow}>
                      <Text className={s.lossName} title={l.name}>
                        {l.name}
                      </Text>
                      <Text className={s.lossValue}>−{one(l.lost / scored.length)}</Text>
                      <div className={s.track}>
                        <div className={mergeClasses(s.fill, i === 0 && s.fillTop)} style={{ width: `${(100 * l.lost) / maxLost}%` }} />
                      </div>
                      <span />
                      <Caption1 className={s.muted} style={{ gridColumn: "1 / -1", marginTop: -2 }}>
                        не выполнен полностью в {l.failed} из {l.applicable} диалогов ({Math.round((100 * l.failed) / l.applicable)}%)
                      </Caption1>
                    </div>
                  ))}
                </div>
              ) : (
                <Text>Баллы нигде не теряются — все критерии выполнены.</Text>
              )}
              {view.grossBy.length ? (
                <div className={s.grossLine}>
                  <ErrorCircleFilled />
                  <Text>
                    Грубые ошибки по критериям: {view.grossBy.map((g) => `«${g.name}» — ${g.n}`).join(", ")} ·{" "}
                    <Link href={href({ name: "dialogs", gross: true })}>показать диалоги</Link>
                  </Text>
                </div>
              ) : null}
            </Card>

            <Card className={s.panel}>
              <div className={s.panelHead}>
                <LocalLanguageRegular className={s.headIcon} />
                <Subtitle1>По языкам и каналам</Subtitle1>
              </div>
              <Breakdown title="Язык" groups={view.byLang} />
              <Breakdown title="Канал" groups={view.byChannel} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Breakdown({ title, groups }: { title: string; groups: Group[] }) {
  const s = useStyles();
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th className={s.th}>{title}</th>
          <th className={s.th}>Оценено</th>
          <th className={s.th}>Средний балл</th>
          <th className={s.th} title="Диалогов с грубой ошибкой">
            Грубых
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const tone = scoreTone(g.avg);
          return (
            <tr key={g.key}>
              <td className={s.td}>
                <Text weight="semibold">{g.label}</Text>
                {g.weakest ? (
                  <div className={s.weak} title="Критерий, на котором в этой группе теряется больше всего баллов">
                    слабое место: {g.weakest.name} (−{one(g.weakest.avgLost)})
                  </div>
                ) : null}
              </td>
              <td className={s.td}>
                {g.scored}
                {g.scored !== g.dialogs ? <Caption1 className={s.muted}> / {g.dialogs}</Caption1> : null}
              </td>
              <td className={s.td}>
                <div className={s.scoreCell}>
                  <div className={s.scoreTrack}>
                    <div className={mergeClasses(s.fill, s[tone])} style={{ width: `${g.avg ?? 0}%` }} />
                  </div>
                  <Text className={s.scoreNum}>{g.avg == null ? "—" : one(g.avg)}</Text>
                </div>
              </td>
              <td className={s.td}>{g.gross ? <span className={s.grossNum}>{g.gross}</span> : <Caption1 className={s.muted}>0</Caption1>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
