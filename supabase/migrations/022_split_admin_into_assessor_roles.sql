-- Split the single ADMIN role into NAFDAC's three assessor roles.
--
-- NAFDAC assesses a periodic safety report through three people in
-- sequence: a Review Officer screens an incoming report and decides whether
-- it proceeds to scientific review or goes back to the MAH, an Evaluator
-- performs the scientific review against the V4 template, and a Peer
-- Reviewer checks that review and countersigns it. One ADMIN role did all
-- three jobs, which meant one person could screen a report, review it, and
-- approve their own review.
--
-- ADMIN is REPLACED, not supplemented: leaving it in place would leave a
-- role that still bypasses the separation this migration exists to create.
-- The three MAH-side staff roles (FIELD_ASSOCIATE, PV_COORDINATOR,
-- PV_MANAGER) are untouched.
--
-- Ordering matters throughout. The CHECK constraint must accept the new
-- names BEFORE any row is migrated onto them, and must only be narrowed to
-- exclude 'ADMIN' AFTER the last such row is gone.

begin;

-- ---------------------------------------------------------------------
-- 1. Widen the constraint so both vocabularies are briefly legal.
--
-- The constraint in migration 001 is an INLINE, unnamed column check, so
-- PostgreSQL named it itself. `profiles_role_check` is the name it derives
-- for `profiles.role`, but a plain `drop constraint if exists` on a guessed
-- name fails SILENTLY if the guess is wrong — and the old constraint would
-- then still be there, rejecting every new role name while this migration
-- reports success. So drop by what the constraint DOES rather than by what
-- it is called: any check constraint on profiles that mentions the old
-- vocabulary.
-- ---------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'profiles'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%FIELD_ASSOCIATE%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.profiles add constraint profiles_role_check check (
  role in (
    'FIELD_ASSOCIATE', 'PV_COORDINATOR', 'PV_MANAGER',
    'REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER',
    'ADMIN'
  )
);

-- ---------------------------------------------------------------------
-- 2. Move existing administrators to REVIEW_OFFICER.
--
-- There is no way to tell from the data which of the three steps an
-- existing ADMIN actually performs, so every one of them lands on the
-- first step of the process. REVIEW_OFFICER is the safe default because it
-- is the narrowest of the three with respect to the report itself: an
-- officer can triage and correspond, but cannot write a scientific review
-- or sign one off. Promoting someone afterwards is a deliberate act;
-- silently granting sign-off authority would not be.
--
-- The trigger has to come off first. trg_protect_profile_privileged_columns
-- (migration 014) raises whenever profiles.role changes and
-- `coalesce(auth.role(), '') <> 'service_role'`. auth.role() reads the JWT
-- claims of an HTTP request; a migration has no request, so it returns NULL
-- and the guard fires — the trigger would reject this UPDATE even though it
-- is running with full privileges. Disabling it around the statement is
-- explicit about that, and does not depend on faking request-local settings
-- that Supabase is free to change.
--
-- DISABLE TRIGGER takes an ACCESS EXCLUSIVE lock and is transactional, so
-- the trigger is never off outside this transaction, even if it aborts.
-- ---------------------------------------------------------------------
alter table public.profiles disable trigger trg_protect_profile_privileged_columns;

update public.profiles set role = 'REVIEW_OFFICER' where role = 'ADMIN';

alter table public.profiles enable trigger trg_protect_profile_privileged_columns;

-- ---------------------------------------------------------------------
-- 3. Narrow the constraint now that no row uses the old name.
-- ---------------------------------------------------------------------
alter table public.profiles drop constraint profiles_role_check;

alter table public.profiles add constraint profiles_role_check check (
  role in (
    'FIELD_ASSOCIATE', 'PV_COORDINATOR', 'PV_MANAGER',
    'REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER'
  )
);

-- ---------------------------------------------------------------------
-- 4. Re-point every policy and RPC that named ADMIN.
-- ---------------------------------------------------------------------

-- Dictionaries are MAH-side reference data maintained by the PV team, not
-- by NAFDAC's assessors. This policy previously required 'ADMIN'; the right
-- successor is PV_MANAGER, the staff role that already holds catalog.manage
-- and regulatory.manage — not one of the assessor roles, none of which has
-- any reason to write dictionary entries.
drop policy if exists "dictionaries_admin_only" on dictionaries;
create policy "dictionaries_manager_only" on dictionaries for insert
  with check (
    organization_id = (select organization_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) = 'PV_MANAGER'
  );

-- Revealing the organisation's private invite code is an account-ownership
-- action. Assessors do not invite staff into an organisation, so ADMIN is
-- dropped rather than replaced by the three roles.
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
  where p.id = auth.uid() and p.role = 'PV_MANAGER'
$$;

grant execute on function public.get_organization_invite_code() to authenticated;

-- Same reasoning, and higher stakes: deleting the organisation destroys
-- every case, report and audit record in it. No step of assessing a
-- periodic report requires it. The old ADMIN role only had this because one
-- role did every job at once.
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
  if caller_role <> 'PV_MANAGER' then
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

commit;

-- ---------------------------------------------------------------------
-- Not done here, deliberately: creating the assessor accounts themselves.
--
-- Signup (src/server/routes/auth.py) only ever grants PV_MANAGER,
-- PV_COORDINATOR or FIELD_ASSOCIATE, so the three assessor roles are
-- unreachable through it — exactly as ADMIN was. They are provisioned out
-- of band, by creating the Supabase Auth user and then setting
-- profiles.role as the service role. The demo accounts the sign-in page
-- prefills (officer@ / evaluator@ / peer@demo.safetyinsighthub.com, see
-- src/lib/auth-portal.ts) need the same treatment.
--
-- Also not done: nothing touches pv_psur_documents. The new workflowStage
-- lives inside that table's `data` jsonb blob and needs no schema change,
-- and documents written before it exists are handled in code by
-- deriveWorkflowStage() in src/services/psur/workflow.ts.
-- ---------------------------------------------------------------------
