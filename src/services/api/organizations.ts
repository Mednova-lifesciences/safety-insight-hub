import { supabase } from "@/integrations/supabase/client";

export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
}

/**
 * Resolves a company's public slug to its id/name for the unauthenticated
 * field-associate flow (`/r/:orgSlug`). Relies on the pre-existing
 * `org_public_read` policy on `organizations` (readable by anyone, no
 * session required) — no new RLS needed for this lookup.
 */
export async function getOrganizationBySlug(slug: string): Promise<PublicOrganization | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PublicOrganization | null) ?? null;
}

/**
 * `invite_code` has no SELECT grant for any client role (see
 * 013_restrict_invite_code_and_audit_integrity.sql) — the only way back to
 * it is this SECURITY DEFINER RPC, which itself only returns a value when
 * the caller is a PV_MANAGER/ADMIN of their own organization.
 */
export async function getMyOrganizationInviteCode(): Promise<string> {
  const { data, error } = await supabase.rpc("get_organization_invite_code");
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You don't have permission to view the invite code.");
  return data;
}

/**
 * Permanently deletes the caller's organization and every row scoped to
 * it (cases, drug catalog, audit trail, team members, …) via a single
 * SECURITY DEFINER transaction — see delete_my_organization() in
 * 014_settings_rpcs_and_profile_hardening.sql for the exact cascade
 * order and the manager-only check. Irreversible.
 */
export async function deleteMyOrganization(): Promise<void> {
  const { error } = await supabase.rpc("delete_my_organization");
  if (error) throw new Error(error.message);
}
