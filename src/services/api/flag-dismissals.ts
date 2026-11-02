import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import type { ClusterCase, ClusterFlag } from "./linelist-clusters";

/**
 * Dismissals of batch and facility flags. A flag is worked out from the
 * validated line lists each time, so a dismissal records which cases the
 * flag held when it was dismissed: the flag stays hidden only while it
 * holds no other case, and shows again the moment a new case joins it.
 * For the whole organisation; restoring keeps the record; both audited.
 * Stored in pv_cluster_flag_dismissals (RLS: the three assessor roles).
 */
export interface FlagDismissal {
  id: string;
  flagKey: string;
  label: string;
  /** The flag's cases when it was dismissed (jobId#row). */
  caseKeys: string[];
  reason?: string | undefined;
  by: string;
  role: string;
  at: string;
  active: boolean;
  restoredBy?: string | undefined;
  restoredAt?: string | undefined;
}

export const caseKeyOf = (c: Pick<ClusterCase, "jobId" | "row">) => `${c.jobId}#${c.row}`;

/** Cases in the flag now that were not in it when it was dismissed. */
export function casesSinceDismissal(flag: ClusterFlag, d: FlagDismissal | undefined): number {
  if (!d) return 0;
  const known = new Set(d.caseKeys);
  return flag.cases.filter((c) => !known.has(caseKeyOf(c))).length;
}

/** Hidden while dismissed and no case has joined it since. */
export function isDismissed(flag: ClusterFlag, d: FlagDismissal | undefined): boolean {
  return !!d?.active && casesSinceDismissal(flag, d) === 0;
}

const describe = (flag: ClusterFlag) =>
  `${flag.kind === "BATCH" ? `Batch ${flag.label}` : flag.label} — ${flag.cases.length} serious case(s), ${flag.from} to ${flag.to}`;

async function current(flagKey: string): Promise<{ id: string; data: FlagDismissal } | null> {
  const { data, error } = await supabase
    .from("pv_cluster_flag_dismissals")
    .select("id, data")
    .eq("data->>flagKey", flagKey)
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  return row ? { id: row.id, data: row.data as unknown as FlagDismissal } : null;
}

export const flagDismissals = {
  /** The organisation's dismissal record for each flag. */
  byFlag: async (): Promise<Map<string, FlagDismissal>> => {
    const { data, error } = await supabase.from("pv_cluster_flag_dismissals").select("data");
    if (error) throw new Error(error.message);
    const out = new Map<string, FlagDismissal>();
    for (const r of data ?? []) {
      const d = r.data as unknown as FlagDismissal;
      out.set(d.flagKey, d);
    }
    return out;
  },

  dismiss: async (flag: ClusterFlag, reason?: string): Promise<FlagDismissal> => {
    const actor = currentActor();
    const why = reason?.trim() || undefined;
    const existing = await current(flag.key);
    const record: FlagDismissal = {
      id: existing?.id ?? newId("flagdismiss"),
      flagKey: flag.key,
      label: flag.label,
      caseKeys: flag.cases.map(caseKeyOf),
      ...(why ? { reason: why } : {}),
      by: actor.name,
      role: actor.role,
      at: new Date().toISOString(),
      active: true,
    };
    const { error } = existing
      ? await supabase
          .from("pv_cluster_flag_dismissals")
          .update({ data: toJson(record) })
          .eq("id", existing.id)
      : await supabase
          .from("pv_cluster_flag_dismissals")
          .insert({ id: record.id, data: toJson(record) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "CLUSTER_FLAG_DISMISSED",
      entity: "ClusterFlag",
      entityId: flag.key,
      previousValue: describe(flag),
      newValue: "flag dismissed",
      ...(why ? { reason: why } : {}),
    });
    return record;
  },

  restore: async (flag: ClusterFlag): Promise<void> => {
    const existing = await current(flag.key);
    if (!existing?.data.active) return;
    const actor = currentActor();
    const record: FlagDismissal = {
      ...existing.data,
      active: false,
      restoredBy: actor.name,
      restoredAt: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("pv_cluster_flag_dismissals")
      .update({ data: toJson(record) })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "CLUSTER_FLAG_RESTORED",
      entity: "ClusterFlag",
      entityId: flag.key,
      previousValue: `dismissed by ${existing.data.by} on ${existing.data.at.slice(0, 10)}`,
      newValue: "flag shown again",
    });
  },
};
