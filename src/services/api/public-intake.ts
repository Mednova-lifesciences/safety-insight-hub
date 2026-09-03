import { supabase } from "@/integrations/supabase/client";
import { buildCaseDetail, type NewIcsrPayload } from "./cases";
import { newId, toJson } from "./db";
import type { AuditEvent } from "@/types/pv";

/**
 * Unauthenticated ICSR submission for the public field-associate link
 * (`/r/:orgSlug`). Deliberately separate from `cases.create()`:
 *
 * - `organization_id` must be supplied explicitly on every insert — the
 *   `set_pv_organization_id` trigger only fills it from the caller's own
 *   session, and an anonymous caller has none.
 * - The case id can't come from a `pv_cases` row count the way the
 *   authenticated flow does it, since anon has no SELECT grant on
 *   `pv_cases` (write-only, by design — see the 012 migration).
 * - No push notification is sent; there's no signed-in workspace to
 *   attribute it to.
 */
export async function createPublicCase(
  organizationId: string,
  payload: NewIcsrPayload,
): Promise<{ caseId: string }> {
  const caseId = newId("MN");
  const detail = buildCaseDetail(caseId, payload, "Field Associate");

  const { error } = await supabase
    .from("pv_cases")
    .insert({ id: caseId, data: toJson(detail), organization_id: organizationId });
  if (error) throw new Error(error.message);

  const auditEvent: AuditEvent = {
    id: newId("ae"),
    timestamp: new Date().toISOString(),
    user: "Field Associate",
    role: "FIELD_ASSOCIATE",
    action: "CASE_CREATED",
    entity: "Case",
    entityId: caseId,
    newValue: `${detail.product} / ${detail.reaction}`,
    reason: "ICSR captured through the public field-associate link",
  };
  const { error: auditError } = await supabase.from("pv_audit_events").insert({
    id: auditEvent.id,
    occurred_at: auditEvent.timestamp,
    data: toJson(auditEvent),
    organization_id: organizationId,
  });
  // The case itself is already saved at this point — a failed audit write
  // must never be reported to the reporter as a failed submission.
  if (auditError) console.error("Failed to record public intake audit event:", auditError.message);

  return { caseId };
}
