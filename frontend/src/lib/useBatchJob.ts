import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/cqa";
import type { BatchJob } from "../api/contract";
import { ApiError } from "../api/transport";

/** Starts a batch scoring job (⊕ /api/score/batch) and follows it over Server-Sent Events. */
export function useBatchJob() {
  const qc = useQueryClient();
  const [job, setJob] = useState<BatchJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useRef<(() => void) | null>(null);

  useEffect(() => () => close.current?.(), []);

  const start = useCallback(
    async (opts: { dialog_ids?: string[]; checklist_id?: number; provider?: string; reuse_unchanged?: boolean }) => {
      setError(null);
      close.current?.();
      try {
        const started = await api.startBatch(opts);
        setJob(started);
        close.current = api.batchEvents(
          started.job_id,
          (event, data) => {
            setJob(data);
            if (event === "done") {
              qc.invalidateQueries({ queryKey: ["dialogs"] });
              qc.invalidateQueries({ queryKey: ["score"] });
            }
          },
          () => setError("Поток прогресса прервался — обновите страницу, результаты сохраняются на сервере."),
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setError("Бэкенд не поддерживает пакетную оценку (⊕ /api/score/batch).");
        else setError(e instanceof Error ? e.message : String(e));
      }
    },
    [qc],
  );

  return { job, error, start, running: job?.status === "running" };
}
