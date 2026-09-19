import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit } from "./db";
import {
  REACTION_OUTCOMES,
  termKey,
  type OrgTermMapping,
  type TermKind,
} from "@/services/e2b-r3/term-mappings";

/**
 * Persistence for pv_term_mappings — the organization's memory of how line
 * list words map to E2B values (see e2b-r3/term-mappings.ts). Org isolation
 * is enforced by RLS; this module never filters by organization_id itself.
 * Discovery is passive and unaudited (nothing was decided); every human
 * decision is audited.
 */

interface TermMappingRow {
  id: string;
  kind: string;
  term: string;
  term_key: string;
  mapped_value: string | null;
  mapped_label: string | null;
  ai_suggestion: string | null;
  ai_suggestion_label: string | null;
  ai_confidence: number | null;
  ai_reason: string | null;
  first_seen_file: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

const COLUMNS =
  "id,kind,term,term_key,mapped_value,mapped_label,ai_suggestion,ai_suggestion_label,ai_confidence,ai_reason,first_seen_file,decided_by,decided_at,created_at";

function fromRow(row: TermMappingRow): OrgTermMapping {
  return {
    id: row.id,
    kind: row.kind as TermKind,
    term: row.term,
    termKey: row.term_key,
    mappedValue: row.mapped_value ?? undefined,
    mappedLabel: row.mapped_label ?? undefined,
    aiSuggestion: row.ai_suggestion ?? undefined,
    aiSuggestionLabel: row.ai_suggestion_label ?? undefined,
    aiConfidence: row.ai_confidence ?? undefined,
    aiReason: row.ai_reason ?? undefined,
    firstSeenFile: row.first_seen_file ?? undefined,
    decidedBy: row.decided_by ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    createdAt: row.created_at,
  };
}

export const termMappings = {
  /** Every mapping of the organization, both kinds — what the E2B engine
   *  needs to apply decided terms. */
  listAll: async (): Promise<OrgTermMapping[]> => {
    const { data, error } = await supabase.from("pv_term_mappings").select(COLUMNS);
    if (error) throw new Error(error.message);
    return ((data ?? []) as TermMappingRow[]).map(fromRow);
  },

  /** One page for Settings, newest first. */
  listPage: async (
    kind: TermKind,
    page: number,
    pageSize: number,
  ): Promise<{ items: OrgTermMapping[]; total: number; pending: number }> => {
    const from = (page - 1) * pageSize;
    const { data, error, count } = await supabase
      .from("pv_term_mappings")
      .select(COLUMNS, { count: "exact" })
      .eq("kind", kind)
      .order("created_at", { ascending: false })
      .order("term", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const { count: pending, error: pendingError } = await supabase
      .from("pv_term_mappings")
      .select("id", { count: "exact", head: true })
      .eq("kind", kind)
      .is("mapped_value", null);
    if (pendingError) throw new Error(pendingError.message);
    return {
      items: ((data ?? []) as TermMappingRow[]).map(fromRow),
      total: count ?? 0,
      pending: pending ?? 0,
    };
  },

  /** Records words a line list used that nothing could resolve, so they
   *  appear for a person to decide. Never touches an existing row. Returns
   *  the rows that were new. */
  discover: async (kind: TermKind, terms: string[], file: string): Promise<OrgTermMapping[]> => {
    const byKey = new Map<string, string>();
    for (const t of terms) {
      const trimmed = t.trim();
      if (trimmed) byKey.set(termKey(kind, trimmed), trimmed);
    }
    if (byKey.size === 0) return [];
    const rows = [...byKey.entries()].map(([key, term]) => ({
      id: newId("term"),
      kind,
      term,
      term_key: key,
      first_seen_file: file,
    }));
    const { data, error } = await supabase
      .from("pv_term_mappings")
      .upsert(rows, { onConflict: "organization_id,kind,term_key", ignoreDuplicates: true })
      .select(COLUMNS);
    if (error) throw new Error(error.message);
    return ((data ?? []) as TermMappingRow[]).map(fromRow);
  },

  /** Stores a model's proposal on a still-undecided row. Never applies it. */
  saveAiSuggestion: async (
    id: string,
    suggestion: { value: string; label?: string; confidence: number; reason: string },
  ): Promise<void> => {
    const { error } = await supabase
      .from("pv_term_mappings")
      .update({
        ai_suggestion: suggestion.value,
        ai_suggestion_label: suggestion.label ?? null,
        ai_confidence: suggestion.confidence,
        ai_reason: suggestion.reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .is("mapped_value", null);
    if (error) throw new Error(error.message);
  },

  /** A person's decision for one word; applies to every line list, current
   *  and future. */
  decide: async (
    mapping: Pick<OrgTermMapping, "id" | "kind" | "term" | "termKey" | "mappedValue">,
    value: string,
    label?: string,
  ): Promise<void> => {
    if (mapping.kind === "OUTCOME" && !(REACTION_OUTCOMES as readonly string[]).includes(value)) {
      throw new Error("Choose one of the six E2B outcomes.");
    }
    const actor = currentActor();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("pv_term_mappings")
      .update({
        mapped_value: value,
        mapped_label: label ?? null,
        decided_by: actor.name,
        decided_at: now,
        updated_at: now,
      })
      .eq("id", mapping.id);
    if (error) throw new Error(error.message);
    await recordAudit({
      action: mapping.kind === "OUTCOME" ? "OUTCOME_TERM_MAPPED" : "REACTION_TERM_CODED",
      entity: "TermMapping",
      entityId: `${mapping.kind}:${mapping.termKey}`,
      previousValue: mapping.mappedValue ?? "not mapped",
      newValue: label ? `${value} — ${label}` : value,
      reason: `"${mapping.term}"`,
    });
  },

  /** Returns a word to "not mapped" (e.g. chosen by mistake). */
  clear: async (
    mapping: Pick<OrgTermMapping, "id" | "kind" | "term" | "termKey" | "mappedValue">,
  ): Promise<void> => {
    const { error } = await supabase
      .from("pv_term_mappings")
      .update({
        mapped_value: null,
        mapped_label: null,
        decided_by: null,
        decided_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mapping.id);
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "TERM_MAPPING_CLEARED",
      entity: "TermMapping",
      entityId: `${mapping.kind}:${mapping.termKey}`,
      previousValue: mapping.mappedValue ?? null,
      newValue: "not mapped",
      reason: `"${mapping.term}"`,
    });
  },

  /** A word a person confirms directly (e.g. a reaction correction picked on
   *  the line-list page), creating the row if it was never discovered. */
  decideByTerm: async (
    kind: TermKind,
    term: string,
    value: string,
    label: string | undefined,
    file: string,
  ): Promise<void> => {
    const key = termKey(kind, term);
    await termMappings.discover(kind, [term], file);
    const { data, error } = await supabase
      .from("pv_term_mappings")
      .select(COLUMNS)
      .eq("kind", kind)
      .eq("term_key", key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`"${term}" could not be recorded.`);
    await termMappings.decide(fromRow(data as TermMappingRow), value, label);
  },
};
