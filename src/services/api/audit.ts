import { supabase } from "@/integrations/supabase/client";
import { recordAudit } from "./db";
import type { AuditEvent } from "@/types/pv";

/** The audit trail is append-only: rows are inserted, never updated. */
export const audit = {
  list: async (
    params: { entity?: string; entityId?: string; user?: string; limit?: number } = {},
  ): Promise<AuditEvent[]> => {
    const { data, error } = await supabase
      .from("pv_audit_events")
      .select("id,data")
      .order("occurred_at", { ascending: false })
      .limit(params.limit ?? 200);
    if (error) throw new Error(error.message);
    return (
      (data ?? [])
        // Events written by the C.1.7 database functions carry no id inside
        // `data`; the row's own id stands in, so every event in a list has
        // one (React keyed the timeline on it and warned on the blanks).
        .map((r) => {
          const e = r.data as unknown as AuditEvent;
          return e.id ? e : { ...e, id: r.id };
        })
        .filter((e) => {
          if (params.entity && e.entity !== params.entity) return false;
          if (params.entityId && e.entityId !== params.entityId) return false;
          if (params.user && e.user !== params.user) return false;
          return true;
        })
    );
  },
  record: recordAudit,
};
