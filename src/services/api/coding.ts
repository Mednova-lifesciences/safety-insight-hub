import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import { ai } from "./ai";
import type { CodingHistoryEntry, CodingSuggestion } from "@/types/pv";

/** Placeholder code/version used for an AI-suggested candidate — deliberately
 *  never a real-looking code, so it can never be mistaken for an actual
 *  MedDRA/WHODrug dictionary hit at a glance or in a downloaded/exported
 *  record. The AI backend (ai_coding.py) never returns a code at all;
 *  this is filled in client-side, not by the model. */
const AI_SUGGESTED_CODE = "AI-SUGGESTED";
const AI_SUGGESTED_VERSION = "AI-SUGGESTED — not a licensed dictionary version";

/**
 * Best-effort call to the AI coding-suggestion endpoint — never throws.
 * Any failure (AI not configured, request error, unusable output) resolves
 * to an empty candidate list so callers can always treat this the same way
 * as "the model had nothing responsible to suggest," matching how AI is
 * used as an enhancement (never a hard dependency) everywhere else in this
 * app.
 */
async function aiCandidates(
  dictionary: "MedDRA" | "WHODrug",
  text: string,
): Promise<{ term: string; rationale: string; confidence: number }[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const result = await ai.coding.suggest({ dictionary, text: trimmed });
    return result.ai_used ? result.candidates : [];
  } catch {
    return [];
  }
}

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

    // The demo dictionary only has a handful of terms — AI candidates fill
    // the gap for everything else, always additive and always clearly
    // labelled (see aiCandidates' doc comment and AI_SUGGESTED_CODE), never
    // replacing a real dictionary hit. A term the demo dictionary already
    // matched isn't duplicated as an AI suggestion too.
    const [drugAi, reactionAi] = await Promise.all([
      aiCandidates("WHODrug", drugText),
      aiCandidates("MedDRA", reactionText),
    ]);
    const notAlreadyMatched =
      (hits: { row: DictionaryTermRow }[]) => (candidate: { term: string }) =>
        !hits.some((h) => h.row.term.toLowerCase() === candidate.term.toLowerCase());

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
      ...drugAi.filter(notAlreadyMatched(drugHits)).map((c) => ({
        id: newId("cs"),
        sourceText: detail.product,
        kind: "DRUG" as const,
        term: c.term,
        code: AI_SUGGESTED_CODE,
        dictionary: "WHODrug" as const,
        dictionaryVersion: AI_SUGGESTED_VERSION,
        matchType: "AI_SUGGESTED" as const,
        confidence: c.confidence,
        evidence: `AI-suggested candidate, not verified against the licensed dictionary — ${c.rationale}`,
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
      ...reactionAi.filter(notAlreadyMatched(reactionHits)).map((c) => ({
        id: newId("cs"),
        sourceText: detail.reaction,
        kind: "REACTION" as const,
        term: c.term,
        code: AI_SUGGESTED_CODE,
        dictionary: "MedDRA" as const,
        dictionaryVersion: AI_SUGGESTED_VERSION,
        matchType: "AI_SUGGESTED" as const,
        confidence: c.confidence,
        evidence: `AI-suggested candidate, not verified against the licensed dictionary — ${c.rationale}`,
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

  /** Real dictionary matches (source "dictionary") come straight from
   *  pv_dictionary_terms, same as always. When the query text is non-empty,
   *  AI candidates (source "ai") are appended for terms the small demo
   *  dictionary doesn't have — never a real code, never mixed in
   *  indistinguishably (see aiCandidates' doc comment). */
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
      source: "dictionary" | "ai";
    }[]
  > => {
    let request = supabase.from("pv_dictionary_terms").select("*").eq("dictionary", dictionary);
    const q = query.trim();
    if (q) request = request.ilike("term", `%${q}%`);
    const { data, error } = await request.limit(20);
    if (error) throw new Error(error.message);
    const dictionaryResults = (data ?? []).map((r) => {
      const row = r as unknown as DictionaryTermRow;
      return {
        term: row.term,
        code: row.code,
        dictionary: row.dictionary,
        dictionaryVersion: row.dictionary_version,
        synonyms: row.synonyms,
        source: "dictionary" as const,
      };
    });

    if (!q) return dictionaryResults;
    const candidates = await aiCandidates(dictionary, q);
    const aiResults = candidates
      .filter((c) => !dictionaryResults.some((d) => d.term.toLowerCase() === c.term.toLowerCase()))
      .map((c) => ({
        term: c.term,
        code: AI_SUGGESTED_CODE,
        dictionary,
        dictionaryVersion: AI_SUGGESTED_VERSION,
        synonyms: [],
        source: "ai" as const,
      }));
    return [...dictionaryResults, ...aiResults];
  },

  /** Adds a dictionary/AI search result as a pending coding candidate for a
   *  case — matchType and evidence reflect which one it actually was. */
  addCandidate: async (
    caseId: string,
    kind: "DRUG" | "REACTION",
    sourceText: string,
    term: {
      term: string;
      code: string;
      dictionary: "MedDRA" | "WHODrug";
      dictionaryVersion: string;
      source: "dictionary" | "ai";
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
      matchType: term.source === "ai" ? "AI_SUGGESTED" : "LLM_RANKED_CANDIDATE",
      confidence: term.source === "ai" ? 0.6 : 1,
      evidence:
        term.source === "ai"
          ? "AI-suggested candidate, not verified against the licensed dictionary — added from dictionary search."
          : "Added manually from dictionary search.",
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

  if (status === "ACCEPTED") {
    // Accepting isn't just a status flag on the suggestion row — it has to
    // actually change the case, or "accepted" doesn't mean anything to a
    // reviewer reading the case detail page afterwards.
    const { cases } = await import("./cases");
    await cases.applyCodedTerm(caseId, next.kind, {
      term: next.term,
      code: next.code,
      dictionary: next.dictionary,
      dictionaryVersion: next.dictionaryVersion,
      acceptedBy: actor.name,
      acceptedAt: new Date().toISOString(),
    });
  }
  return next;
}
