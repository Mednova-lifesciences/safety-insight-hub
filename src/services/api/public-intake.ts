import { supabase } from "@/integrations/supabase/client";
import { buildCaseDetail, type NewIcsrPayload } from "./cases";
import { newId, toJson } from "./db";

/**
 * Unauthenticated ICSR submission for the public field-associate link
 * (`/r/:orgSlug`). Deliberately separate from `cases.create()`:
 *
 * - `organization_id` must be supplied explicitly on the insert — the
 *   `set_pv_organization_id` trigger only fills it from the caller's own
 *   session, and an anonymous caller has none.
 * - The case id can't come from a `pv_cases` row count the way the
 *   authenticated flow does it, since anon has no SELECT grant on
 *   `pv_cases` (write-only, by design — see the 012 migration).
 * - The audit trail entry for this submission is written server-side by a
 *   DB trigger on `pv_cases` insert (see 013_restrict_invite_code_and_
 *   audit_integrity.sql), not by this client — anon has no INSERT on
 *   `pv_audit_events` at all, so a submission's own audit record can't be
 *   spoofed or forged with arbitrary content.
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

  return { caseId };
}
