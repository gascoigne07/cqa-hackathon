import {
  Body1,
  Button,
  Caption1,
  Card,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Subtitle1,
  Tab,
  TabList,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/cqa";
import type { AppealDetail, CriterionResult, ReviewCreate } from "../api/contract";
import { ToneBadge } from "../components/ScoreBadge";
import { font, palette, type } from "../theme";
import { TranscriptView } from "../components/TranscriptView";
import { dateTime, formatScore, verdictLabel } from "../lib/format";
import { href, navigate } from "../router";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px" },
  h1: { margin: 0, fontSize: type.xl, fontWeight: 600, lineHeight: "1.15", color: palette.ink },
  grid: {
    display: "grid",
    gridTemplateColumns: "340px minmax(0, 1fr)",
    gap: "16px",
    alignItems: "start",
    "@media (max-width: 900px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  list: { display: "flex", flexDirection: "column", gap: "8px" },
  item: { cursor: "pointer", padding: "10px 12px", gap: "4px" },
  selected: { outline: `1px solid ${palette.ink}`, boxShadow: `inset 3px 0 0 ${palette.ink}` },
  muted: { color: tokens.colorNeutralForeground3 },
  panel: { display: "flex", flexDirection: "column", gap: "12px", padding: "16px" },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  comment: { display: "flex", flexDirection: "column", gap: "4px", padding: "2px 0 2px 14px", borderLeft: `2px solid ${palette.graphite}` },
  quote: { fontFamily: font.doc, fontSize: type.md, lineHeight: "1.55", color: palette.ink },
  context: { maxHeight: "360px", overflowY: "auto" },
  form: { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "560px" },
  trail: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
});

export function AppealsScreen({ appealId }: { appealId?: number }) {
  const s = useStyles();
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const list = useQuery({ queryKey: ["appeals", tab], queryFn: () => api.appeals(tab) });

  useEffect(() => {
    if (!appealId && list.data?.length) navigate({ name: "appeals", id: list.data[0].appeal_id });
  }, [appealId, list.data]);

  return (
    <div className={s.root}>
      <h1 className={s.h1}>Апелляции</h1>
      <Caption1 className={s.muted}>Вид проверяющего: спорная оценка, комментарий и фрагмент диалога → решение.</Caption1>
      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "open" | "resolved")}>
        <Tab value="open">На рассмотрении</Tab>
        <Tab value="resolved">Рассмотренные</Tab>
      </TabList>
      {list.error ? (
        <MessageBar intent="error">
          <MessageBarBody>Не удалось загрузить апелляции: {(list.error as Error).message}</MessageBarBody>
        </MessageBar>
      ) : null}
      <div className={s.grid}>
        <div className={s.list}>
          {list.isLoading ? <Spinner size="small" label="Загрузка…" /> : null}
          {!list.isLoading && !list.data?.length ? (
            <Text className={s.muted}>
              {tab === "open" ? "Открытых апелляций нет. Подайте апелляцию кнопкой «Оспорить» в карточке диалога." : "Пока ничего не рассмотрено."}
            </Text>
          ) : null}
          {list.data?.map((a) => (
            <Card
              key={a.appeal_id}
              className={mergeClasses(s.item, a.appeal_id === appealId && s.selected)}
              onClick={() => navigate({ name: "appeals", id: a.appeal_id })}
            >
              <div className={s.row}>
                <Text weight="semibold">
                  #{a.appeal_id} · {a.dialog_id}
                </Text>
                {a.review ? (
                  <ToneBadge tone={a.review.decision === "change" ? "informative" : "subtle"}>
                    {a.review.decision === "change" ? "Изменено" : "Подтверждено"}
                  </ToneBadge>
                ) : null}
              </div>
              <Caption1>{a.criterion_name}</Caption1>
              <Caption1 className={s.muted}>
                {a.author} · {dateTime(a.created_at)}
              </Caption1>
            </Card>
          ))}
        </div>
        {appealId ? <AppealReview key={appealId} id={appealId} /> : null}
      </div>
    </div>
  );
}

function AppealReview({ id }: { id: number }) {
  const s = useStyles();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["appeal", id], queryFn: () => api.appeal(id) });

  if (detail.isLoading) return <Spinner label="Загрузка…" />;
  if (detail.error || !detail.data) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>Апелляция не найдена.</MessageBarBody>
      </MessageBar>
    );
  }
  const d = detail.data;
  const a = d.appeal;
  const r = d.result;
  const label = verdictLabel(r);

  return (
    <Card className={s.panel}>
      <div className={s.row}>
        <Subtitle1>{a.criterion_name}</Subtitle1>
        <ToneBadge tone={label.tone} appearance="filled">
          {label.text}
        </ToneBadge>
        <Link href={href({ name: "dialog", id: a.dialog_id })}>Открыть диалог {a.dialog_id}</Link>
      </div>
      <Caption1 className={s.muted}>
        Итог диалога сейчас {formatScore(d.total)} (исходный {formatScore(d.original_total)}) · баллы по критерию{" "}
        {r.points == null ? "—" : formatScore(r.points)}
        {r.effective_weight != null ? ` из ${formatScore(r.effective_weight)}` : ""}
      </Caption1>
      <Body1>
        <b>Спорная оценка — обоснование модели:</b> {r.explanation || "—"}
      </Body1>
      {!r.applicable && r.na_reason ? (
        <Body1>
          <b>N/A:</b> {r.na_reason}
        </Body1>
      ) : null}
      <div className={s.comment}>
        <Caption1>Комментарий апеллянта ({a.author}):</Caption1>
        <Body1 block className={s.quote}>«{a.comment}»</Body1>
      </div>

      <Subtitle1>Фрагмент диалога</Subtitle1>
      <div className={s.context}>
        {d.fragment.length && d.fragment[0].idx > 0 ? <Caption1 className={s.muted}>… реплики до #{d.fragment[0].idx} скрыты</Caption1> : null}
        <TranscriptView turns={d.fragment} focus={{ indices: d.evidence_idx, nonce: 0 }} />
      </div>

      {a.status === "open" ? (
        <ReviewForm
          detail={d}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["appeal", id] });
            qc.invalidateQueries({ queryKey: ["appeals"] });
            qc.invalidateQueries({ queryKey: ["score", a.dialog_id] });
            qc.invalidateQueries({ queryKey: ["dialogs"] });
          }}
        />
      ) : a.review ? (
        <MessageBar intent={a.review.decision === "change" ? "success" : "info"}>
          <MessageBarBody>
            <b>{a.review.decision === "change" ? "Оценка изменена" : "Оценка подтверждена"}</b> — {a.review.reviewer}:{" "}
            {a.review.reason.replace(/[.\s]+$/, "")}. Итог диалога: {formatScore(a.review.total_before)} → {formatScore(a.review.total_after)}.
          </MessageBarBody>
        </MessageBar>
      ) : null}
    </Card>
  );
}

function scaleOptions(r: CriterionResult): { value: number; label: string }[] {
  if (r.scale?.length) return r.scale.map((st) => ({ value: st.value, label: st.label ? `${st.value} — ${st.label}` : String(st.value) }));
  const max = r.scale_max ?? 5;
  return Array.from({ length: max + 1 }, (_, i) => ({ value: i, label: String(i) }));
}

function ReviewForm({ detail, onDone }: { detail: AppealDetail; onDone: () => void }) {
  const s = useStyles();
  const r = detail.result;
  const isScale = r.type ? r.type === "scale" : r.scale_max != null;
  const naAllowed = r.na_allowed ?? r.type === "yes_no_na";
  const [decision, setDecision] = useState<"confirm" | "change">("confirm");
  const [verdict, setVerdict] = useState<"yes" | "no" | "na">(r.verdict === "yes" ? "no" : "yes");
  const [score, setScore] = useState<string>(String(r.raw_score ?? scaleOptions(r)[0]?.value ?? 0));
  const [scaleNa, setScaleNa] = useState(false);
  const [reason, setReason] = useState("");
  const [reviewer, setReviewer] = useState("Проверяющий");

  const review = useMutation({
    mutationFn: (body: ReviewCreate) => api.review(body),
    onSuccess: onDone,
  });

  function submit() {
    const body: ReviewCreate = { appeal_id: detail.appeal.appeal_id, decision, reason: reason.trim(), reviewer: reviewer.trim() || "Проверяющий" };
    if (decision === "change") {
      if (isScale) {
        if (scaleNa) body.new_verdict = "na";
        else body.new_score = Number(score);
      } else body.new_verdict = verdict;
    }
    review.mutate(body);
  }

  return (
    <div className={s.form}>
      <Subtitle1>Решение проверяющего</Subtitle1>
      <RadioGroup value={decision} onChange={(_, d) => setDecision(d.value as "confirm" | "change")} layout="horizontal">
        <Radio value="confirm" label="Подтвердить оценку" />
        <Radio value="change" label="Изменить оценку" />
      </RadioGroup>
      {decision === "change" && !isScale ? (
        <Field label="Новый вердикт">
          <RadioGroup value={verdict} onChange={(_, d) => setVerdict(d.value as "yes" | "no" | "na")} layout="horizontal">
            <Radio value="yes" label="Да" />
            <Radio value="no" label="Нет" />
            {naAllowed ? <Radio value="na" label="N/A" /> : null}
          </RadioGroup>
        </Field>
      ) : null}
      {decision === "change" && isScale ? (
        <>
          {!scaleNa ? (
            <Field label="Новый балл">
              <Select value={score} onChange={(_, d) => setScore(d.value)}>
                {scaleOptions(r).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {naAllowed ? (
            <RadioGroup value={scaleNa ? "na" : "score"} onChange={(_, d) => setScaleNa(d.value === "na")} layout="horizontal">
              <Radio value="score" label="Выставить балл" />
              <Radio value="na" label="Признать N/A" />
            </RadioGroup>
          ) : null}
        </>
      ) : null}
      <Field label="Причина решения" required>
        <Textarea value={reason} onChange={(_, d) => setReason(d.value)} rows={3} resize="vertical" />
      </Field>
      <Field label="Проверяющий">
        <Input value={reviewer} onChange={(_, d) => setReviewer(d.value)} />
      </Field>
      {review.error ? (
        <MessageBar intent="error">
          <MessageBarBody>{(review.error as Error).message}</MessageBarBody>
        </MessageBar>
      ) : null}
      <div>
        <Button appearance="primary" disabled={!reason.trim() || review.isPending} onClick={submit}>
          {review.isPending ? "Сохранение…" : "Сохранить решение и пересчитать итог"}
        </Button>
      </div>
    </div>
  );
}
