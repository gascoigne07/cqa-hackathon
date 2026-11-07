import { httpTransport } from "./httpTransport";
import { ApiError, type Transport } from "./transport";
import type {
  AppealCreate,
  AppealDetail,
  AppealListItem,
  BatchJob,
  Checklist,
  ChecklistIn,
  ChecklistListItem,
  DialogListItem,
  DialogOut,
  ImportResult,
  ProviderInfo,
  ReviewCreate,
  ScoreRequest,
  ScoreResponse,
  TraceEntry,
} from "./contract";

/** Swap this for another Transport implementation (e.g. Dynamics 365) in one place. */
let transport: Transport = httpTransport;
export const setTransport = (t: Transport) => {
  transport = t;
};

/** Shown when the backend implements only the base contract. */
export const FALLBACK_PROVIDERS: ProviderInfo[] = [
  { id: "gemini", name: "Облако · Gemini", kind: "cloud", available: true },
  { id: "qwen", name: "Локально · Qwen3", kind: "local", available: true },
];

const enc = encodeURIComponent;

export const api = {
  // ---- base contract
  dialogs: () => transport.get<DialogListItem[]>("/api/dialogs"),
  dialog: (id: string) => transport.get<DialogOut>(`/api/dialogs/${enc(id)}`),
  checklists: () => transport.get<ChecklistListItem[]>("/api/checklists"),
  checklist: (id: number) => transport.get<Checklist>(`/api/checklists/${id}`),
  saveChecklist: (body: ChecklistIn) => transport.post<Checklist>("/api/checklists", body),
  score: (body: ScoreRequest) => transport.post<ScoreResponse>("/api/score", body),
  createAppeal: (body: AppealCreate) => transport.post<{ appeal_id: number }>("/api/appeals", body),
  review: (body: ReviewCreate) => transport.post<{ result: ScoreResponse }>("/api/reviews", body),

  // ---- ⊕ extensions
  async providers(): Promise<ProviderInfo[]> {
    try {
      return await transport.get<ProviderInfo[]>("/api/providers");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return FALLBACK_PROVIDERS;
      throw e;
    }
  },
  /** Latest saved score of a dialog, or null if it was never scored. */
  async lastScore(dialogId: string): Promise<ScoreResponse | null> {
    try {
      return await transport.get<ScoreResponse>(`/api/dialogs/${enc(dialogId)}/score`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  appeals: (status?: "open" | "resolved") =>
    transport.get<AppealListItem[]>(`/api/appeals${status ? `?status=${status}` : ""}`),
  appeal: (id: number) => transport.get<AppealDetail>(`/api/appeals/${id}`),
  startBatch: (body: { dialog_ids?: string[]; checklist_id?: number; provider?: string; reuse_unchanged?: boolean }) =>
    transport.post<BatchJob>("/api/score/batch", body),
  batchEvents: (jobId: string, onEvent: (event: string, job: BatchJob) => void, onError?: () => void) =>
    transport.stream<BatchJob>(`/api/score/batch/${jobId}/events`, { onEvent, onError }),
  importGroup: (group_id: string) => transport.post<ImportResult>("/api/datasets/import", { group_id }),
  upload: (file: File) => transport.upload<ImportResult>("/api/dialogs/upload", file),
  /** ⊕ Header logo dropped into branding/ on the server; null when absent or unsupported. */
  async branding(): Promise<{ logo_url: string | null }> {
    try {
      return await transport.get<{ logo_url: string | null }>("/api/branding");
    } catch {
      return { logo_url: null };
    }
  },
  trace: (scoreId: number) => transport.get<TraceEntry[]>(`/api/scores/${scoreId}/trace`),
  exportUrl: (format: "csv" | "json", ids?: string[]) =>
    transport.url(`/api/export?format=${format}${ids?.length ? `&ids=${ids.map(enc).join(",")}` : ""}`),
  /** Resolves a backend-relative audio_url to an absolute URL. */
  mediaUrl: (url: string) => (/^https?:/i.test(url) ? url : transport.url(url)),
};
