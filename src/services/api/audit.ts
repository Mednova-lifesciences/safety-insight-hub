import { apiRequest } from "./client";
import type { AuditEvent } from "@/types/pv";

/** Wraps pv_assist.audit. The audit trail is append-only server-side. */
export const audit = {
  list: (params: { entity?: string; entityId?: string; user?: string; limit?: number } = {}) =>
    apiRequest<AuditEvent[]>("/api/audit", { query: params }),
  record: (event: {
    action: string;
    entity: string;
    entityId: string;
    previousValue?: string | null;
    newValue?: string | null;
    reason?: string | null;
  }) => apiRequest<AuditEvent>("/api/audit", { method: "POST", body: event }),
};
