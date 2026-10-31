import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import type { Signal } from "@/types/pv";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Standard disproportionality screening (Evans et al.): a product/reaction
 * pair is a signal candidate when, across a 2x2 contingency table built
 * from every other case in the system, it has at least MIN_CASES reports,
 * a Proportional Reporting Ratio >= MIN_PRR, and a (Yates-corrected)
 * chi-square >= MIN_CHI_SQUARE. This is the actual textbook rule of thumb
 * used for first-pass signal screening — not a demo threshold.
 */
const MIN_CASES = 3;
const MIN_PRR = 2;
const MIN_CHI_SQUARE = 4;

interface SignalCandidate {
  product: string;
  reaction: string;
  caseIds: string[];
  prr: number;
  chiSquare: number;
}

function computeCandidates(
  cases: { id: string; product: string; reaction: string }[],
): SignalCandidate[] {
  const total = cases.length;
  const productCounts = new Map<string, number>();
  const reactionCounts = new Map<string, number>();
  const pairs = new Map<
    string,
    { product: string; reaction: string; normProduct: string; normReaction: string; ids: string[] }
  >();

  for (const c of cases) {
    const p = norm(c.product);
    const r = norm(c.reaction);
    productCounts.set(p, (productCounts.get(p) ?? 0) + 1);
    reactionCounts.set(r, (reactionCounts.get(r) ?? 0) + 1);
    // A pipe-joined key is enough here since product/reaction text in
    // practice never contains a literal pipe; normProduct/normReaction are
    // also kept directly on the entry so nothing needs to be parsed back
    // out of the key.
    const key = `${p}|${r}`;
    const entry = pairs.get(key) ?? {
      product: c.product,
      reaction: c.reaction,
      normProduct: p,
      normReaction: r,
      ids: [] as string[],
    };
    entry.ids.push(c.id);
    pairs.set(key, entry);
  }

  const candidates: SignalCandidate[] = [];
  for (const entry of pairs.values()) {
    const p = entry.normProduct;
    const r = entry.normReaction;
    const a = entry.ids.length;
    if (a < MIN_CASES) continue;

    const b = (productCounts.get(p) ?? 0) - a;
    const cCount = (reactionCounts.get(r) ?? 0) - a;
    const d = total - a - b - cCount;
    if (a + b <= 0 || cCount + d <= 0) continue;

    const prr = a / (a + b) / (cCount / (cCount + d));
    if (!Number.isFinite(prr) || prr < MIN_PRR) continue;

    const n = a + b + cCount + d;
    const ad = a * d;
    const bc = b * cCount;
    const chiDenominator = (a + b) * (cCount + d) * (a + cCount) * (b + d);
    const chiSquare =
      chiDenominator > 0 ? (n * (Math.abs(ad - bc) - n / 2) ** 2) / chiDenominator : 0;
    if (chiSquare < MIN_CHI_SQUARE) continue;

    candidates.push({
      product: entry.product,
      reaction: entry.reaction,
      caseIds: entry.ids,
      prr,
      chiSquare,
    });
  }
  return candidates;
}

async function readSignal(signalId: string): Promise<Signal> {
  const { data, error } = await supabase
    .from("pv_signals")
    .select("data")
    .eq("id", signalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Signal not found");
  return data.data as unknown as Signal;
}

async function saveSignal(signal: Signal): Promise<Signal> {
  const { error } = await supabase
    .from("pv_signals")
    .update({ data: toJson(signal) })
    .eq("id", signal.id);
  if (error) throw new Error(error.message);
  return signal;
}

/**
 * Automated detection can only flag a candidate (POTENTIAL). Only a human
 * with signal.decide permission can move a signal to CONFIRMED or REFUTED —
 * enforced client-side via usePermission today; org membership (who can act
 * on this signal at all) is enforced server-side by RLS.
 */
export const signals = {
  list: async (status?: string): Promise<Signal[]> => {
    const { data, error } = await supabase.from("pv_signals").select("data");
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map((r) => r.data as unknown as Signal);
    return status ? rows.filter((s) => s.status === status) : rows;
  },

  get: (signalId: string) => readSignal(signalId),

  startReview: async (signalId: string): Promise<Signal> => {
    const signal = await readSignal(signalId);
    if (signal.status !== "POTENTIAL") return signal;
    const next: Signal = { ...signal, status: "UNDER_REVIEW", reviewer: currentActor().name };
    await saveSignal(next);
    await recordAudit({
      action: "SIGNAL_REVIEW_STARTED",
      entity: "Signal",
      entityId: signalId,
      previousValue: "POTENTIAL",
      newValue: "UNDER_REVIEW",
    });
    return next;
  },

  decide: async (
    signalId: string,
    decision: "CONFIRMED" | "REFUTED",
    rationale: string,
  ): Promise<Signal> => {
    const signal = await readSignal(signalId);
    const actor = currentActor();
    const next: Signal = {
      ...signal,
      status: decision,
      reviewer: actor.name,
      rationale,
      decidedAt: new Date().toISOString(),
    };
    await saveSignal(next);
    await recordAudit({
      action: "SIGNAL_DECIDED",
      entity: "Signal",
      entityId: signalId,
      previousValue: signal.status,
      newValue: decision,
      reason: rationale,
    });
    return next;
  },

  /**
   * Raises a POTENTIAL signal from a flagged local-literature article
   * (the weekly NAFDAC GVP screening duty). Literature signals carry no
   * supporting cases of their own — the article's provenance rides along
   * in `literature` so the Signal review page can triage without leaving
   * the app. Only a human with signal.decide can ever confirm or refute
   * it afterwards, same as any other signal.
   */
  createLiteratureSignal: async (payload: {
    product: string;
    reaction: string;
    literature: NonNullable<Signal["literature"]>;
  }): Promise<Signal> => {
    const today = new Date().toISOString();
    const row: Signal = {
      id: newId("sig"),
      reference: `SIG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      product: payload.product,
      reaction: payload.reaction,
      detectionMethod: "Local literature screening (keyword match)",
      detectionPeriod: `Screened ${today.slice(0, 10)}`,
      caseCount: 0,
      statistic: [{ name: "Risk level", value: payload.literature.riskLevel }],
      supportingCaseIds: [],
      status: "POTENTIAL",
      literature: payload.literature,
    };
    const { error } = await supabase.from("pv_signals").insert({ id: row.id, data: toJson(row) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "SIGNAL_LITERATURE_CREATED",
      entity: "Signal",
      entityId: row.id,
      newValue: `${row.reference} — ${payload.literature.publication}: ${payload.literature.headline}`,
      reason: `Keywords: ${payload.literature.keywords.join(", ")}`,
    });
    return row;
  },

  /**
   * Actually scans pv_cases for disproportionate product/reaction pairs
   * (see computeCandidates) instead of relying on hand-seeded rows. Existing
   * signals are matched by (product, reaction) and refreshed in place —
   * case count, supporting case IDs and statistics update, but status,
   * reviewer, and rationale are left untouched, since those represent a
   * human decision this engine must never silently overwrite. A pair with
   * no existing signal becomes a new POTENTIAL one.
   */
  runDetection: async (): Promise<{
    scanned: number;
    candidates: number;
    created: number;
    refreshed: number;
  }> => {
    const { data, error } = await supabase.from("pv_cases").select("data");
    if (error) throw new Error(error.message);
    const caseRows = (data ?? [])
      .map((r) => r.data as unknown as { id: string; product: string; reaction: string })
      .filter(
        (c) =>
          !!c.product &&
          !!c.reaction &&
          norm(c.product) !== "unspecified product" &&
          norm(c.reaction) !== "unspecified reaction",
      );

    const candidates = computeCandidates(caseRows);
    const existing = await signals.list();
    const existingByKey = new Map(
      existing.map((s) => [`${norm(s.product)}|${norm(s.reaction)}`, s]),
    );

    let created = 0;
    let refreshed = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const cand of candidates) {
      const key = `${norm(cand.product)}|${norm(cand.reaction)}`;
      const existingSignal = existingByKey.get(key);
      const statistic = [
        { name: "PRR", value: cand.prr.toFixed(2) },
        { name: "Chi-square", value: cand.chiSquare.toFixed(2) },
      ];
      if (existingSignal) {
        await saveSignal({
          ...existingSignal,
          caseCount: cand.caseIds.length,
          supportingCaseIds: cand.caseIds,
          statistic,
          detectionMethod: "Disproportionality (PRR, Evans criteria)",
          detectionPeriod: `Recomputed ${today}`,
        });
        refreshed++;
      } else {
        const row: Signal = {
          id: newId("sig"),
          reference: `SIG-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
          product: cand.product,
          reaction: cand.reaction,
          detectionMethod: "Disproportionality (PRR, Evans criteria)",
          detectionPeriod: `Computed ${today}`,
          caseCount: cand.caseIds.length,
          statistic,
          supportingCaseIds: cand.caseIds,
          status: "POTENTIAL",
        };
        const { error: insertError } = await supabase
          .from("pv_signals")
          .insert({ id: row.id, data: toJson(row) });
        if (insertError) throw new Error(insertError.message);
        created++;
      }
    }

    await recordAudit({
      action: "SIGNAL_DETECTION_RUN",
      entity: "Signal",
      entityId: "bulk",
      newValue: `${candidates.length} candidate(s) found (${created} new, ${refreshed} refreshed)`,
      reason: `Scanned ${caseRows.length} case(s); threshold N>=${MIN_CASES}, PRR>=${MIN_PRR}, chi-square>=${MIN_CHI_SQUARE}`,
    });

    return { scanned: caseRows.length, candidates: candidates.length, created, refreshed };
  },
};
