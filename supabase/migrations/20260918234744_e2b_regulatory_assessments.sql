-- E2B-only regulatory assessment records.
-- This migration intentionally does not alter PSUR tables, policies, or data.

create table if not exists public.pv_e2b_regulatory_assessments (
  id text primary key,
  organization_id uuid not null references public.organizations(id),
  job_id text not null,
  case_id text not null,
  assessment_type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pv_e2b_assessments_job
  on public.pv_e2b_regulatory_assessments(organization_id, job_id);
create index if not exists idx_pv_e2b_assessments_case
  on public.pv_e2b_regulatory_assessments(organization_id, case_id);

drop trigger if exists trg_set_org_id on public.pv_e2b_regulatory_assessments;
create trigger trg_set_org_id before insert on public.pv_e2b_regulatory_assessments
  for each row execute function public.set_pv_organization_id();

alter table public.pv_e2b_regulatory_assessments enable row level security;

create policy "org_isolation_select" on public.pv_e2b_regulatory_assessments
  for select to authenticated using (organization_id = public.current_org_id());
create policy "org_isolation_insert" on public.pv_e2b_regulatory_assessments
  for insert to authenticated with check (organization_id = public.current_org_id());
create policy "org_isolation_update" on public.pv_e2b_regulatory_assessments
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
create policy "org_isolation_delete" on public.pv_e2b_regulatory_assessments
  for delete to authenticated using (organization_id = public.current_org_id());

revoke all on public.pv_e2b_regulatory_assessments from anon;
