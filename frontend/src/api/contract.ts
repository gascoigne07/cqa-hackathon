/**
 * The team's API contract (see CONTRACT.md at the repo root).
 * Fields marked ⊕ are extensions; they are optional here so the UI keeps
 * working against a backend that implements only the base contract.
 */

export type Speaker = "client" | "operator" | "bot" | "system";

// ----------------------------------------------------------------- dialogs

export interface LastScore {
  score_id: number;
  total: number | null;
  original_total: number | null;
  gross_error: boolean;
  needs_review: boolean;
  open_appeals: number;
  checklist_id: number;
  provider: string;
  created_at: string;
}

export interface DialogListItem {
  conversation_id: string;
  channel: string;
  language: string;
  turns: number;
  preview: string;
  dataset?: string; // ⊕
  has_audio?: boolean; // ⊕
  last_score?: LastScore | null; // ⊕
}

export interface Turn {
  idx: number;
  timestamp: string;
  speaker: Speaker;
  text: string;
}

export interface DialogOut {
  conversation_id: string;
  channel: string;
  language: string;
  audio_url: string | null;
  audio_source_url?: string | null; // ⊕
  transcript: Turn[];
}

// --------------------------------------------------------------- checklist

export type CriterionType = "yes_no" | "yes_no_na" | "scale";

export interface ScaleStep {
  value: number;
  label: string;
}

export interface Criterion {
  id: string;
  order: number;
  section: string | null;
  name: string;
  type: CriterionType;
  weight: number;
  na_allowed: boolean;
  scale_max: number | null;
  scale: ScaleStep[];
  guidance: string;
  gross_error_if?: "yes" | "no" | null; // ⊕ verdict that means a gross error
}

export type Channel = "chat" | "call" | "all";

export interface ChecklistIn {
  name: string;
  rounding: number;
  criteria: Criterion[];
  channel?: Channel; // ⊕ which dialogs it applies to
  instructions?: string; // ⊕ general rules sent to the model
  gross_error_policy?: "flag" | "zero_total"; // ⊕
  note?: string; // ⊕
  seed_key?: string; // ⊕ built-in checklist marker
}

export interface Checklist extends ChecklistIn {
  id: number;
  created_at?: string; // ⊕
}

export interface ChecklistListItem {
  id: number;
  name: string;
  criteria_count?: number;
  created_at?: string;
  channel?: Channel; // ⊕
}

// ------------------------------------------------------------------- score

export interface Evidence {
  turn_idx: number;
  timestamp: string;
  quote: string;
}

export interface ResultSnapshot {
  applicable: boolean;
  verdict: string | null;
  raw_score: number | null;
  points: number | null;
  explanation: string;
}

export interface ReviewOut {
  decision: "confirm" | "change";
  new_verdict: string | null;
  new_score: number | null;
  reason: string;
  reviewer: string;
  decided_at: string;
  total_before: number | null;
  total_after: number | null;
}

export interface AppealBrief {
  appeal_id: number;
  status: "open" | "resolved";
  comment: string;
  author: string;
  created_at: string;
  review?: ReviewOut | null;
}

export interface CriterionResult {
  criterion_id: string;
  applicable: boolean;
  na_reason: string | null;
  verdict: string | null; // "yes" | "no" | "na" | "uncertain" | scale step label
  raw_score: number | null;
  scale_max: number | null;
  points: number | null;
  effective_weight: number | null;
  explanation: string;
  evidence: Evidence | null;
  // ⊕ extensions
  name?: string;
  section?: string | null;
  type?: CriterionType;
  weight?: number;
  gross_error_if?: "yes" | "no" | null;
  na_allowed?: boolean;
  scale?: ScaleStep[];
  gross_error?: boolean;
  needs_review?: boolean;
  checked_range?: [number, number] | number[] | null;
  evidence_all?: Evidence[];
  issues?: string[];
  confidence?: number | null;
  overridden?: boolean;
  original?: ResultSnapshot | null;
  appeal?: AppealBrief | null;
}

export interface SectionResult {
  name: string;
  points: number;
  max: number;
}

export interface RunInfo {
  model: string;
  started_at: string;
  duration_ms: number;
  calls: number;
  reused?: number;
  judged?: number;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export interface TraceEntry {
  provider: string;
  model: string;
  criteria: string[];
  system: string;
  user: string;
  raw: string;
  duration_ms: number;
  usage: Record<string, unknown>;
  note?: string;
}

export interface ScoreResponse {
  dialog_id: string;
  provider: string;
  total: number | null;
  gross_error: boolean;
  sections: SectionResult[];
  results: CriterionResult[];
  // ⊕ extensions
  score_id?: number;
  checklist_id?: number;
  created_at?: string | null;
  original_total?: number | null;
  needs_review?: boolean;
  run?: RunInfo | null; // ⊕ proof of live analysis
}

export interface ScoreRequest {
  dialog_id: string;
  checklist_id?: number;
  provider?: string;
}

// --------------------------------------------------------------- providers

export interface ProviderInfo {
  id: string;
  name: string;
  kind: "cloud" | "local" | "demo";
  available: boolean;
  note?: string;
  optional?: boolean; // hidden in the toggle unless available
  model?: string;
}

// ---------------------------------------------------------------- appeals

export interface AppealCreate {
  dialog_id: string;
  criterion_id: string;
  comment: string;
  author?: string; // ⊕
  score_id?: number; // ⊕
}

export interface AppealListItem {
  appeal_id: number;
  score_id: number;
  dialog_id: string;
  criterion_id: string;
  criterion_name: string;
  comment: string;
  author: string;
  status: "open" | "resolved";
  created_at: string;
  review?: ReviewOut | null;
}

export interface AppealDetail {
  appeal: AppealListItem;
  result: CriterionResult;
  fragment: Turn[];
  evidence_idx: number[];
  total: number | null;
  original_total: number | null;
}

export interface ReviewCreate {
  appeal_id: number;
  decision: "confirm" | "change";
  new_verdict?: "yes" | "no" | "na" | null;
  new_score?: number | null;
  reason: string;
  reviewer?: string; // ⊕
}

// ------------------------------------------------------------------ batch ⊕

export interface BatchJob {
  job_id: string;
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  reused: number;
  judged: number;
  errors: string[];
  checklist_id: number | null; // null = picked per dialog by channel
  provider: string;
}

export interface ImportResult {
  dataset: string;
  imported: number;
  updated: number;
}
