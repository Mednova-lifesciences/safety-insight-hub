-- Dismissals of batch and facility flags ("Batch and facility flags for
-- review"). Flags are worked out from the validated line lists each time,
-- so a dismissal is stored on its own: which flag, the cases it held when
-- it was dismissed, who, when and why. A flag that gains a case later is
-- shown again. Restoring keeps the record (active = false) — nothing is
-- deleted, and both actions are also written to the audit trail.
--
-- Read and written by the organisation's administrators (the three
-- assessor roles), like pv_pms_referrals. No delete policy.
--
-- Rollback: supabase/rollbacks/20261102120000_pv_cluster_flag_dismissals.rollback.sql

create table if not exists public.pv_cluster_flag_dismissals (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  data jsonb not null
);

create index if not exists pv_cluster_flag_dismissals_org_flag
  on public.pv_cluster_flag_dismissals (organization_id, (data->>'flagKey'));

drop trigger if exists trg_set_org_id on public.pv_cluster_flag_dismissals;
create trigger trg_set_org_id
  before insert on public.pv_cluster_flag_dismissals
  for each row execute function public.set_pv_organization_id();

alter table public.pv_cluster_flag_dismissals enable row level security;

revoke all on public.pv_cluster_flag_dismissals from anon;
revoke delete, truncate on public.pv_cluster_flag_dismissals from authenticated;
grant select, insert, update on public.pv_cluster_flag_dismissals to authenticated;

drop policy if exists flag_dismissals_admin_read on public.pv_cluster_flag_dismissals;
create policy flag_dismissals_admin_read on public.pv_cluster_flag_dismissals
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER')
  );

drop policy if exists flag_dismissals_admin_insert on public.pv_cluster_flag_dismissals;
create policy flag_dismissals_admin_insert on public.pv_cluster_flag_dismissals
  for insert to authenticated
  with check (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER')
  );

drop policy if exists flag_dismissals_admin_update on public.pv_cluster_flag_dismissals;
create policy flag_dismissals_admin_update on public.pv_cluster_flag_dismissals
  for update to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER')
  )
  with check (organization_id = public.current_org_id());
