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
