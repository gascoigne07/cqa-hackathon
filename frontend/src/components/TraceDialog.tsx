import {
  Badge,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/cqa";
import type { TraceEntry } from "../api/contract";

const useStyles = makeStyles({
  surface: { maxWidth: "980px", width: "calc(100vw - 32px)" },
  content: { display: "flex", flexDirection: "column", gap: "14px" },
  call: { display: "flex", flexDirection: "column", gap: "8px" },
  head: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  pre: {
    margin: 0,
    maxHeight: "48vh",
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    padding: "10px 12px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
  },
});

type Part = "user" | "system" | "raw";

function prettyJson(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) return text;
  try {
    const head = text.slice(0, start).trim();
    const body = JSON.stringify(JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)), null, 2);
    return head ? `${head}\n\n${body}` : body;
  } catch {
    return text;
  }
}

function Call({ entry, n }: { entry: TraceEntry; n: number }) {
  const s = useStyles();
  const [part, setPart] = useState<Part>("raw");
  const usage = entry.usage as { prompt_tokens?: number; completion_tokens?: number };
  if (entry.note) {
    return (
      <MessageBar intent="info">
        <MessageBarBody>{entry.note}</MessageBarBody>
      </MessageBar>
    );
  }
  return (
    <div className={s.call}>
      <div className={s.head}>
        <b>Вызов {n}</b>
        <Badge appearance="tint">{entry.model || entry.provider}</Badge>
        <Caption1 className={s.muted}>
          {(entry.duration_ms / 1000).toFixed(1)} с
          {usage?.prompt_tokens != null ? ` · токены: ${usage.prompt_tokens} → ${usage.completion_tokens ?? "?"}` : ""} · критерии:{" "}
          {entry.criteria.join(", ")}
        </Caption1>
      </div>
      <TabList size="small" selectedValue={part} onTabSelect={(_, d) => setPart(d.value as Part)}>
        <Tab value="raw">Ответ модели</Tab>
        <Tab value="user">Запрос (критерии и транскрипт)</Tab>
        <Tab value="system">Системный промпт</Tab>
      </TabList>
      <pre className={s.pre}>{part === "raw" ? prettyJson(entry.raw) : part === "user" ? entry.user : entry.system}</pre>
    </div>
  );
}

/** Shows exactly what was sent to the model and what it answered — proof of live analysis. */
export function TraceDialog({ scoreId, open, onClose }: { scoreId: number | undefined; open: boolean; onClose: () => void }) {
  const s = useStyles();
  const q = useQuery({ queryKey: ["trace", scoreId], queryFn: () => api.trace(scoreId!), enabled: open && scoreId != null });
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle>Запрос к модели и её ответ</DialogTitle>
          <DialogContent className={s.content}>
            <Caption1 className={s.muted}>
              Каждый вызов модели для этой оценки: что именно отправлено (критерии из чек-листа и транскрипт) и сырой ответ.
              Повторный вызов появляется, если цитаты в первом ответе не прошли проверку.
            </Caption1>
            {q.isLoading ? <Spinner label="Загрузка…" /> : null}
            {q.error ? (
              <MessageBar intent="error">
                <MessageBarBody>{(q.error as Error).message}</MessageBarBody>
              </MessageBar>
            ) : null}
            {q.data && !q.data.length ? <Caption1>Модель не вызывалась: все суждения взяты из прошлой оценки.</Caption1> : null}
            {q.data?.map((e, i) => <Call key={i} entry={e} n={i + 1} />)}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Закрыть</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
