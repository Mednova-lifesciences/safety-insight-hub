import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import type { ReactionCoding, ScreenPair, ScreenResult } from "./linelist-signals";
import type { Signal } from "@/types/pv";

/**
 * Persistence for the administrator-side signal screen. The screen itself
 * is computed live from the validated line lists (linelist-signals.ts);
 * only a person's decision on a candidate is stored, as a pv_signals row
 * marked source "LINE_LIST" — the same table, status vocabulary, rationale
 * and audit trail as the other side's Signal review, but kept out of that
 * page (signals.list filters these out). Org isolation is RLS on pv_signals.
 */

export type ScreenDecision = "CONFIRMED" | "REFUTED" | "MONITOR";

export const SCREEN_DECISION_LABELS: Record<ScreenDecision, string> = {
  CONFIRMED: "Accepted as a signal",
  REFUTED: "Declined — not a signal",
  MONITOR: "Monitor",
};

const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(2));

/** The organisation's decided MedDRA codings of reaction words. */
export async function loadReactionCodings(): Promise<ReactionCoding[]> {
  const { data, error } = await supabase
    .from("pv_term_mappings")
    .select("term_key,mapped_value,mapped_label")
    .eq("kind", "REACTION")
    .not("mapped_value", "is", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    termKey: r.term_key,
    code: r.mapped_value as string,
    label: (r.mapped_label as string | null) ?? (r.mapped_value as string),
  }));
}

export const signalScreen = {
  /** Every decision recorded on the screen, keyed by the pair's screen key. */
  decisions: async (): Promise<Map<string, Signal>> => {
    const { data, error } = await supabase
      .from("pv_signals")
      .select("data")
      .eq("data->>source", "LINE_LIST");
    if (error) throw new Error(error.message);
    const out = new Map<string, Signal>();
    for (const r of data ?? []) {
      const s = r.data as unknown as Signal;
      if (s.screenKey) out.set(s.screenKey, s);
    }
    return out;
  },

  /** Records (or revises) a person's decision on one screened pair, with the
   *  statistics and cases as they stood when they decided. */
  decide: async (
    pair: ScreenPair,
    pool: Pick<ScreenResult, "totalReports" | "smallPool">,
    decision: ScreenDecision,
    rationale: string,
    existing?: Signal,
  ): Promise<Signal> => {
    if (rationale.trim().length < 10)
      throw new Error("A rationale of at least 10 characters is required.");
    const actor = currentActor();
    const now = new Date().toISOString();
    const statistic = [
      { name: "N", value: String(pair.a) },
      {
        name: "PRR",
        value: fmt(pair.prr.value),
        ci: `95% CI ${fmt(pair.prr.lower)}–${fmt(pair.prr.upper)}`,
      },
      {
        name: "ROR",
        value: fmt(pair.ror.value),
        ci: `95% CI ${fmt(pair.ror.lower)}–${fmt(pair.ror.upper)}`,
      },
      { name: "Chi-square", value: pair.chiSquare.toFixed(2) },
    ];
    const record: Signal = {
      ...(existing ?? {
        id: newId("sig"),
        reference: `SCR-${now.slice(0, 4)}-${Math.floor(1000 + Math.random() * 9000)}`,
      }),
      source: "LINE_LIST",
      screenKey: pair.key,
      product: pair.product,
      reaction: pair.reaction,
      detectionMethod: "Disproportionality on validated line lists (PRR, ROR, χ²)",
      detectionPeriod: `Screened ${now.slice(0, 10)}${pool.smallPool ? " — small pool" : ""}`,
      caseCount: pair.a,
      statistic,
      supportingCaseIds: pair.cases.map((c) => c.caseId ?? `${c.filename} row ${c.row}`),
      lineListCases: pair.cases,
      poolSize: pool.totalReports,
      status: decision,
      reviewer: actor.name,
      rationale: rationale.trim(),
      decidedAt: now,
    };
    const { error } = existing
      ? await supabase
          .from("pv_signals")
          .update({ data: toJson(record) })
          .eq("id", record.id)
      : await supabase.from("pv_signals").insert({ id: record.id, data: toJson(record) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "SIGNAL_SCREEN_DECIDED",
      entity: "Signal",
      entityId: record.id,
      previousValue: existing?.status ?? "NOT DECIDED",
      newValue: `${decision} — ${pair.product} / ${pair.reaction} (N=${pair.a}, PRR ${fmt(pair.prr.value)}, pool ${pool.totalReports})`,
      reason: rationale.trim(),
    });
    return record;
  },
};
