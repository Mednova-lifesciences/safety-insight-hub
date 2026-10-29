-- Restores the grant hardening the live project lost when it was rebuilt.
--
-- Found on 29 Oct 2026 (Phase 2 RLS check): the project recreated on
-- 4 Oct has no migration history, and three hardening steps were missing
-- from it:
--
--   1. 013 — organizations.invite_code had a SELECT grant for anon. With
--      the public "org_public_read" policy, anyone holding the publishable
--      key could list every organisation's invite code and join it.
--      Verified: GET /rest/v1/organizations?select=invite_code returned all
--      five codes to an anonymous request.
--   2. 015/016 — anon could EXECUTE every SECURITY DEFINER RPC
--      (delete_my_organization, get_organization_invite_code, the C.1.7
--      finalize/save functions) and the trigger-only functions.
--   3. Migration ORDER: 006_pv_tables_org_isolation.sql drops the open
--      "demo workspace access" policies, but 20260819002606_….sql sorts
--      after it and creates them again, so a fresh `db reset` or branch
--      would come up with every pv_ table open to anon. This migration
--      runs last and drops them for good.
--
-- Idempotent. Reversible with supabase/rollbacks/20261029120000_restore_grant_hardening.rollback.sql
-- (not run automatically).

-- 3. No open "demo workspace access" policy, on any table.
do $$
declare r record;
begin
  for r in
    select tablename from pg_policies
    where schemaname = 'public' and policyname = 'demo workspace access'
  loop
    execute format('drop policy if exists %I on public.%I', 'demo workspace access', r.tablename);
  end loop;
end $$;

-- 1. invite_code is readable by no client role. Pages read id, name and
--    slug; a member reads their own code through get_organization_invite_code().
revoke select on public.organizations from anon, authenticated;
grant select (id, name, slug) on public.organizations to anon, authenticated;

-- The public field-associate link never writes the audit table itself;
-- trg_log_public_case_audit does (013).
revoke insert on public.pv_audit_events from anon;

-- 2. RPCs: signed-in users only. current_org_id() stays callable by anon:
--    the legacy tables' policies call it for every role, and for anon it
--    returns null.
revoke execute on function public.delete_my_organization() from anon, public;
revoke execute on function public.get_organization_invite_code() from anon, public;
revoke execute on function public.e2b_c17_assert_actor() from anon, public;
revoke execute on function public.finalize_e2b_c17_as_recommended(text[], text) from anon, public;
revoke execute on function public.finalize_e2b_c17_assessment(text, text, text) from anon, public;
revoke execute on function public.finalize_e2b_c17_assessments_bulk(text[], text, text) from anon, public;
revoke execute on function public.save_e2b_c17_ai_assessment(text, text, text, text, text, text, text, text, text, text, text, text, jsonb) from anon, public;
revoke execute on function public.save_e2b_c17_recommendation(text, text, text, jsonb, text) from anon, public;
revoke execute on function public.save_e2b_c17_rule(jsonb, text) from anon, public;

-- Trigger and event-trigger functions are never called as RPCs. A trigger
-- runs its function whatever the caller's EXECUTE grant.
revoke execute on function public.protect_profile_privileged_columns() from anon, authenticated, public;
revoke execute on function public.log_public_case_audit() from anon, authenticated, public;
revoke execute on function public.set_pv_organization_id() from anon, authenticated, public;
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;

-- Advisor 0011: pin the search_path of the two line-list trigger functions.
alter function public.pv_linelist_identifiers_immutable() set search_path = public;
alter function public.pv_linelist_cells_server_only() set search_path = public;
