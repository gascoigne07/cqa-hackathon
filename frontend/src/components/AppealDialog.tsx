import {
  Body1,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Textarea,
  makeStyles,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import type { CriterionResult } from "../api/contract";
import { verdictLabel } from "../lib/format";

const useStyles = makeStyles({ content: { display: "flex", flexDirection: "column", gap: "12px" } });

interface Props {
  target: { result: CriterionResult; name: string } | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (comment: string, author: string) => void;
}

export function AppealDialog({ target, busy, error, onClose, onSubmit }: Props) {
  const s = useStyles();
  const [comment, setComment] = useState("");
  const [author, setAuthor] = useState("Оператор");

  useEffect(() => {
    if (target) setComment("");
  }, [target]);

  return (
    <Dialog open={!!target} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (comment.trim()) onSubmit(comment.trim(), author.trim() || "Оператор");
          }}
        >
          <DialogBody>
            <DialogTitle>Оспорить оценку</DialogTitle>
            <DialogContent className={s.content}>
              {target ? (
                <Body1>
                  <b>{target.name}</b> — текущая оценка: <b>{verdictLabel(target.result).text}</b>
                </Body1>
              ) : null}
              <Field label="Комментарий: почему вы не согласны" required hint="Проверяющий увидит спорную оценку, комментарий и фрагмент диалога.">
                <Textarea value={comment} onChange={(_, d) => setComment(d.value)} rows={4} resize="vertical" />
              </Field>
              <Field label="Автор">
                <Input value={author} onChange={(_, d) => setAuthor(d.value)} />
              </Field>
              {error ? (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Отмена</Button>
              <Button appearance="primary" type="submit" disabled={busy || !comment.trim()}>
                {busy ? "Отправка…" : "Подать апелляцию"}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
