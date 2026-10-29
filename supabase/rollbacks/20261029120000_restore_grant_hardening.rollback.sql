-- ROLLBACK for 20261029120000_restore_grant_hardening.sql. Not a migration:
-- run by hand only if the hardening breaks something, and fix forward as
-- soon as possible — this re-exposes every organisation's invite code.
-- (The "demo workspace access" policies are deliberately NOT recreated.)

grant select on public.organizations to anon, authenticated;
grant insert on public.pv_audit_events to anon;

grant execute on function public.delete_my_organization() to anon;
grant execute on function public.get_organization_invite_code() to anon;
grant execute on function public.e2b_c17_assert_actor() to anon;
grant execute on function public.finalize_e2b_c17_as_recommended(text[], text) to anon;
grant execute on function public.finalize_e2b_c17_assessment(text, text, text) to anon;
grant execute on function public.finalize_e2b_c17_assessments_bulk(text[], text, text) to anon;
grant execute on function public.save_e2b_c17_ai_assessment(text, text, text, text, text, text, text, text, text, text, text, text, jsonb) to anon;
grant execute on function public.save_e2b_c17_recommendation(text, text, text, jsonb, text) to anon;
grant execute on function public.save_e2b_c17_rule(jsonb, text) to anon;

grant execute on function public.protect_profile_privileged_columns() to anon, authenticated;
grant execute on function public.log_public_case_audit() to anon, authenticated;
grant execute on function public.set_pv_organization_id() to anon, authenticated;
grant execute on function public.rls_auto_enable() to anon, authenticated;

alter function public.pv_linelist_identifiers_immutable() reset search_path;
alter function public.pv_linelist_cells_server_only() reset search_path;
