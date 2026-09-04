-- Supports the new Settings page: viewing the org invite code again
-- (manager-only, password-gated in the UI) and deleting an organization
-- (manager-only, red "danger zone" with a typed confirmation in the UI).
--
-- Both need SECURITY DEFINER RPCs rather than direct table access:
-- `invite_code` has no SELECT grant for any client role as of migration
-- 013 (by design), and a full org deletion has to cascade across every
-- pv_* table plus `profiles` inside one transaction, in FK-safe order —
-- not something to hand to the client as a sequence of separate deletes.
--
-- Also closes a privilege-escalation hole found while building this:
-- `profiles_own_update` (001_initial_schema.sql) lets a user update their
-- own profile row with no restriction on *which* columns — so any signed
-- in user could self-promote by PATCHing their own `role` to PV_MANAGER,
-- or hop organizations by changing `organization_id`. A trigger (not a
-- policy `with check`, which can't reliably compare old/new values on a
-- self-referencing update) now blocks changes to those two columns from
-- anything but a service-role connection.

create or replace function public.get_organization_invite_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select o.invite_code
  from public.organizations o
  join public.profiles p on p.organization_id = o.id
  where p.id = auth.uid() and p.role in ('PV_MANAGER', 'ADMIN')
$$;

grant execute on function public.get_organization_invite_code() to authenticated;

create or replace function public.delete_my_organization()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_org_id uuid;
  caller_role text;
begin
  select organization_id, role into target_org_id, caller_role
  from public.profiles where id = auth.uid();

  if target_org_id is null then
    raise exception 'No organization found for the current user';
  end if;
  if caller_role not in ('PV_MANAGER', 'ADMIN') then
    raise exception 'Only a manager can delete the organization';
  end if;

  -- Children before parents, so no FK (organization_id references
  -- organizations, case_id/job_id/document_id references within pv_*)
  -- ever blocks a later delete in this same transaction.
  delete from public.pv_follow_ups where organization_id = target_org_id;
  delete from public.pv_notifications where organization_id = target_org_id;
  delete from public.pv_audit_events where organization_id = target_org_id;
  delete from public.pv_intake_conversations where organization_id = target_org_id;
  delete from public.pv_seriousness where organization_id = target_org_id;
  delete from public.pv_coding_suggestions where organization_id = target_org_id;
  delete from public.pv_coding_history where organization_id = target_org_id;
  delete from public.pv_linelist_issues where organization_id = target_org_id;
  delete from public.pv_linelist_jobs where organization_id = target_org_id;
  delete from public.pv_psur_findings where organization_id = target_org_id;
  delete from public.pv_psur_documents where organization_id = target_org_id;
  delete from public.pv_signals where organization_id = target_org_id;
  delete from public.pv_products where organization_id = target_org_id;
  delete from public.pv_cases where organization_id = target_org_id;
  delete from public.profiles where organization_id = target_org_id;
  delete from public.organizations where id = target_org_id;
end;
$$;

grant execute on function public.delete_my_organization() to authenticated;

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.organization_id is distinct from old.organization_id)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'role and organization_id cannot be changed directly';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_privileged_columns on public.profiles;
create trigger trg_protect_profile_privileged_columns
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();
