import { useQuery } from "@tanstack/react-query";
import { api } from "../api/cqa";
import type { CriterionResult, DialogListItem } from "../api/contract";

/** The criteria that triggered a gross error (verdict == gross_error_if). */
export const grossCriteria = (results: CriterionResult[] | undefined) => (results ?? []).filter((r) => r.gross_error);

/** The gross criterion to open first: one with a quote to show in the transcript, else the first. */
export const primaryGross = (results: CriterionResult[] | undefined) => {
  const g = grossCriteria(results);
  return g.find((r) => r.evidence) ?? g[0];
};

/** Route focus value meaning "the primary gross-error criterion of this dialog". */
export const GROSS_FOCUS = "gross";

/** The model's explanation without the demo scorer's "[mock] " prefix. */
export const cleanExplanation = (text: string | null | undefined) => (text ?? "").replace(/^\[mock\]\s*/, "");

/**
 * Why each dialog of the list has a gross error: dialog id → offending criteria.
 * One request (the JSON export, limited to those dialogs). The key includes every
 * score_id, so a rescore refetches automatically instead of showing a stale reason.
 */
export function useGrossReasons(dialogs: DialogListItem[]) {
  const gross = dialogs.filter((d) => d.last_score?.gross_error);
  const key = gross.map((d) => `${d.conversation_id}:${d.last_score!.score_id}`).join(",");
  const q = useQuery({
    queryKey: ["gross-reasons", key],
    queryFn: () => api.results(gross.map((d) => d.conversation_id)),
    enabled: gross.length > 0,
    staleTime: Infinity,
  });
  const byId = new Map<string, CriterionResult[]>();
  for (const row of q.data ?? []) {
    const last = gross.find((d) => d.conversation_id === row.conversation_id)?.last_score;
    // ignore a reason from another score than the one the list shows
    if (row.score && last && row.score.score_id === last.score_id) byId.set(row.conversation_id, grossCriteria(row.score.results));
  }
  return { byId, isLoading: q.isLoading && gross.length > 0, error: q.error as Error | null };
}
