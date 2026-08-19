import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import type { CodingHistoryEntry, CodingSuggestion } from "@/types/pv";

interface DictionaryTermRow {
  id: string;
  dictionary: "MedDRA" | "WHODrug";
  dictionary_version: string;
  kind: "DRUG" | "REACTION";
  term: string;
  code: string;
  synonyms: string[];
}

function matchTerms(
  rows: DictionaryTermRow[],
  text: string,
): { row: DictionaryTermRow; matchType: CodingSuggestion["matchType"]; confidence: number }[] {
  const haystack = text.toLowerCase();
  const hits: {
    row: DictionaryTermRow;
    matchType: CodingSuggestion["matchType"];
    confidence: number;
  }[] = [];
  for (const row of rows) {
    if (haystack.includes(row.term.toLowerCase())) {
      hits.push({ row, matchType: "EXACT", confidence: 0.95 });
      continue;
    }
    const synonymHit = row.synonyms.find((s) => haystack.includes(s.toLowerCase()));
    if (synonymHit) {
      hits.push({ row, matchType: "SYNONYM", confidence: 0.85 });
      continue;
    }
    const words = row.term.toLowerCase().split(/\s+/);
    if (words.length > 0 && words.every((w) => haystack.includes(w))) {
      hits.push({ row, matchType: "FUZZY", confidence: 0.6 });
    }
  }
  return hits;
}

async function fetchDictionaryTerms(kind?: "DRUG" | "REACTION"): Promise<DictionaryTermRow[]> {
  let query = supabase.from("pv_dictionary_terms").select("*");
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DictionaryTermRow[];
}

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

  /**
   * Matches the case's product and reaction text against the dictionary
   * tables and persists any hits as coding suggestions for the case. Only
   * runs once per case — if suggestions already exist, they're returned
   * unchanged rather than regenerated.
   */
  suggest: async (caseId: string): Promise<CodingSuggestion[]> => {
    const existing = await coding.getSuggestions(caseId);
    if (existing.length > 0) return existing;

    const { cases } = await import("./cases");
    const detail = await cases.get(caseId);

    const drugTerms = await fetchDictionaryTerms("DRUG");
    const reactionTerms = await fetchDictionaryTerms("REACTION");

    const drugText = [detail.product, ...detail.suspectProducts.map((p) => p.reportedName)].join(
      " ",
    );
    const reactionText = [detail.reaction, ...detail.reactions.map((r) => r.reportedTerm)].join(
      " ",
    );

    const drugHits = matchTerms(drugTerms, drugText);
    const reactionHits = matchTerms(reactionTerms, reactionText);

    const suggestions: CodingSuggestion[] = [
      ...drugHits.map(({ row, matchType, confidence }) => ({
        id: newId("cs"),
        sourceText: detail.product,
        kind: "DRUG" as const,
        term: row.term,
        code: row.code,
        dictionary: row.dictionary,
        dictionaryVersion: row.dictionary_version,
        matchType,
        confidence,
        evidence: `Matched against demo dictionary term "${row.term}".`,
        status: "PENDING" as const,
      })),
      ...reactionHits.map(({ row, matchType, confidence }) => ({
        id: newId("cs"),
        sourceText: detail.reaction,
        kind: "REACTION" as const,
        term: row.term,
        code: row.code,
        dictionary: row.dictionary,
        dictionaryVersion: row.dictionary_version,
        matchType,
        confidence,
        evidence: `Matched against demo dictionary term "${row.term}".`,
        status: "PENDING" as const,
      })),
    ];

    if (suggestions.length === 0) return [];

    const { error } = await supabase
      .from("pv_coding_suggestions")
      .insert(
        suggestions.map((s) => ({ id: `${caseId}:${s.id}`, case_id: caseId, data: toJson(s) })),
      );
    if (error) throw new Error(error.message);

    await recordAudit({
      action: "CODING_SUGGESTED",
      entity: "Case",
      entityId: caseId,
      newValue: `${suggestions.length} candidate(s) generated`,
    });

    return suggestions;
  },

  searchDictionary: async (
    dictionary: "MedDRA" | "WHODrug",
    query: string,
  ): Promise<
    {
      term: string;
      code: string;
      dictionary: "MedDRA" | "WHODrug";
      dictionaryVersion: string;
      synonyms: string[];
    }[]
  > => {
    let request = supabase.from("pv_dictionary_terms").select("*").eq("dictionary", dictionary);
    const q = query.trim();
    if (q) request = request.ilike("term", `%${q}%`);
    const { data, error } = await request.limit(20);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => {
      const row = r as unknown as DictionaryTermRow;
      return {
        term: row.term,
        code: row.code,
        dictionary: row.dictionary,
        dictionaryVersion: row.dictionary_version,
        synonyms: row.synonyms,
      };
    });
  },

  /** Adds a dictionary search result as a pending coding candidate for a case. */
  addCandidate: async (
    caseId: string,
    kind: "DRUG" | "REACTION",
    sourceText: string,
    term: {
      term: string;
      code: string;
      dictionary: "MedDRA" | "WHODrug";
      dictionaryVersion: string;
    },
  ): Promise<CodingSuggestion> => {
    const suggestion: CodingSuggestion = {
      id: newId("cs"),
      sourceText,
      kind,
      term: term.term,
      code: term.code,
      dictionary: term.dictionary,
      dictionaryVersion: term.dictionaryVersion,
      matchType: "LLM_RANKED_CANDIDATE",
      confidence: 1,
      evidence: "Added manually from dictionary search.",
      status: "PENDING",
    };
    const { error } = await supabase
      .from("pv_coding_suggestions")
      .insert({ id: `${caseId}:${suggestion.id}`, case_id: caseId, data: toJson(suggestion) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "CODING_CANDIDATE_ADDED",
      entity: "Case",
      entityId: caseId,
      newValue: `${term.dictionary} ${term.code} — ${term.term}`,
    });
    return suggestion;
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
