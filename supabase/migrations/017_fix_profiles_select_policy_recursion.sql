-- Fixes a dormant bug present since 001_initial_schema.sql: the
-- `profiles_own_org` SELECT policy queries `profiles` from inside its own
-- USING clause ("select organization_id from profiles where id =
-- auth.uid()"), which re-triggers the same policy on itself —
-- `infinite recursion detected in policy for relation "profiles"`
-- (Postgres error 42P17). It never fired before because nothing had done
-- a client-side write to `profiles` with RLS active until the new
-- Settings page's profile-name update — Postgres applies SELECT-policy
-- visibility checks as part of UPDATE/DELETE row selection too, not just
-- plain reads, so this broke every profile update, not just selects.
--
-- 006_pv_tables_org_isolation.sql already solved this exact problem for
-- the pv_* tables by introducing current_org_id(), a SECURITY DEFINER
-- helper whose internal query bypasses RLS instead of re-triggering it.
-- Using that same helper here instead of the raw subquery.

drop policy if exists "profiles_own_org" on profiles;
create policy "profiles_own_org" on profiles for select
  using (organization_id = public.current_org_id());
