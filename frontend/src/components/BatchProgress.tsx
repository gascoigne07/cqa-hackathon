import { Caption1, MessageBar, MessageBarBody, ProgressBar, makeStyles, tokens } from "@fluentui/react-components";
import type { BatchJob } from "../api/contract";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "6px", minWidth: "280px" },
  meta: { color: tokens.colorNeutralForeground3 },
});

export function BatchProgress({ job, error }: { job: BatchJob | null; error?: string | null }) {
  const s = useStyles();
  if (error) {
    return (
      <MessageBar intent="error">
        <MessageBarBody>{error}</MessageBarBody>
      </MessageBar>
    );
  }
  if (!job) return null;
  const done = job.status !== "running";
  return (
    <div className={s.root} aria-live="polite">
      <ProgressBar
        value={job.total ? job.done / job.total : 1}
        thickness="large"
        color={job.errors.length ? "warning" : done ? "success" : "brand"}
      />
      <Caption1 className={s.meta}>
        {done ? "Готово" : "Оценка…"} {job.done} из {job.total} · {job.checklist_id == null ? "чек-листы по каналу" : `чек-лист #${job.checklist_id}`} · модель {job.provider}
        {job.reused ? ` · без изменений: ${job.reused}` : ""} · новых оценок: {job.judged}
        {job.errors.length ? ` · ошибок: ${job.errors.length} (${job.errors[0]})` : ""}
      </Caption1>
    </div>
  );
}
