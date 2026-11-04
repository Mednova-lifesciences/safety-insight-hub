-- PSUR drafts authored by the organisation for its own-brand products (the
-- MAH side). Each row holds the author's inputs, the per-section state
-- (from records / author / not applicable, reviewed by whom) and a snapshot
-- of the facts taken from the safety database when the draft was last
-- refreshed, so an exported draft can always be traced to its data.
--
-- Separate from pv_psur_documents, which holds periodic reports received for
-- REVIEW; a draft only reaches that queue when someone sends it to QC.
--
-- Read by the three staff roles, written by Coordinators and Managers, like
-- pv_branches. No delete policy: a draft is archived (status), not removed.
--
-- Rollback: supabase/rollbacks/20261103233000_pv_psur_drafts.rollback.sql

create table if not exists public.pv_psur_drafts (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null
);

create index if not exists pv_psur_drafts_org on public.pv_psur_drafts (organization_id);

drop trigger if exists trg_set_org_id on public.pv_psur_drafts;
create trigger trg_set_org_id
  before insert on public.pv_psur_drafts
  for each row execute function public.set_pv_organization_id();

alter table public.pv_psur_drafts enable row level security;

revoke all on public.pv_psur_drafts from anon;
revoke delete, truncate on public.pv_psur_drafts from authenticated;
grant select, insert, update on public.pv_psur_drafts to authenticated;

drop policy if exists psur_drafts_staff_read on public.pv_psur_drafts;
create policy psur_drafts_staff_read on public.pv_psur_drafts
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('FIELD_ASSOCIATE', 'PV_COORDINATOR', 'PV_MANAGER')
  );

drop policy if exists psur_drafts_staff_insert on public.pv_psur_drafts;
create policy psur_drafts_staff_insert on public.pv_psur_drafts
  for insert to authenticated
  with check (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('PV_COORDINATOR', 'PV_MANAGER')
  );

drop policy if exists psur_drafts_staff_update on public.pv_psur_drafts;
create policy psur_drafts_staff_update on public.pv_psur_drafts
  for update to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('PV_COORDINATOR', 'PV_MANAGER')
  )
  with check (organization_id = public.current_org_id());
