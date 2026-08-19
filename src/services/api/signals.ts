import { supabase } from "@/integrations/supabase/client";
import { currentActor, recordAudit, toJson } from "./db";
import type { Signal } from "@/types/pv";

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
};
