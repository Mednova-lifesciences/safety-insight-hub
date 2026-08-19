import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import type { CodingHistoryEntry, CodingSuggestion } from "@/types/pv";

/** Candidate terms always come from the dictionary tables — never invented in
 *  the browser. Acceptance is an explicit, audited human action. */
export const coding = {
  getSuggestions: async (caseId: string): Promise<CodingSuggestion[]> => {
    const { data, error } = await supabase
      .from("pv_coding_suggestions")
      .select("data")
      .eq("case_id", caseId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.data as unknown as CodingSuggestion);
  },

  searchDictionary: async (
    dictionary: "MedDRA" | "WHODrug",
    query: string,
  ): Promise<CodingSuggestion[]> => {
    const { data, error } = await supabase.from("pv_coding_suggestions").select("data");
    if (error) throw new Error(error.message);
    const q = query.toLowerCase().trim();
    return (data ?? [])
      .map((r) => r.data as unknown as CodingSuggestion)
      .filter((s) => s.dictionary === dictionary && (!q || s.term.toLowerCase().includes(q)))
      .slice(0, 10);
  },

  accept: async (caseId: string, suggestionId: string, rationale?: string) =>
    setStatus(caseId, suggestionId, "ACCEPTED", rationale ?? "Accepted by reviewer"),

  reject: async (caseId: string, suggestionId: string, rationale: string) =>
    setStatus(caseId, suggestionId, "REJECTED", rationale),

  history: async (caseId: string): Promise<CodingHistoryEntry[]> => {
    const { data, error } = await supabase
      .from("pv_coding_history")
      .select("data")
      .eq("case_id", caseId);
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r) => r.data as unknown as CodingHistoryEntry)
      .sort((a, b) => b.at.localeCompare(a.at));
  },
};

async function setStatus(
  caseId: string,
  suggestionId: string,
  status: "ACCEPTED" | "REJECTED",
  rationale: string,
): Promise<CodingSuggestion> {
  const rowId = `${caseId}:${suggestionId}`;
  const { data, error } = await supabase
    .from("pv_coding_suggestions")
    .select("data")
    .eq("id", rowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Coding suggestion not found");
  const next = { ...(data.data as unknown as CodingSuggestion), status };
  const { error: upErr } = await supabase
    .from("pv_coding_suggestions")
    .update({ data: toJson(next) })
    .eq("id", rowId);
  if (upErr) throw new Error(upErr.message);

  const actor = currentActor();
  const entry: CodingHistoryEntry = {
    id: newId("ch"),
    at: new Date().toISOString(),
    user: actor.name,
    action: status === "ACCEPTED" ? "Accepted coding suggestion" : "Rejected coding suggestion",
    detail: `${next.dictionary} ${next.code} — ${next.term}. ${rationale}`,
  };
  await supabase
    .from("pv_coding_history")
    .insert({ id: entry.id, case_id: caseId, data: toJson(entry) });
  await recordAudit({
    action: status === "ACCEPTED" ? "CODING_ACCEPTED" : "CODING_REJECTED",
    entity: "Case",
    entityId: caseId,
    newValue: `${next.dictionary} ${next.code}`,
    reason: rationale,
  });
  return next;
}
