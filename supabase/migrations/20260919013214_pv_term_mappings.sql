-- Organization-wide memory of how line-list words map to E2B values:
-- outcome words (E.i.7) decided in Settings, reaction corrections (MedDRA
-- LLT, E.i.2.1b) confirmed on the line-list page. Same trust model as
-- pv_reporter_qualification_mappings. No PSUR objects are changed.

create table if not exists public.pv_term_mappings (
  id text primary key,
  organization_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('OUTCOME', 'REACTION')),
  term text not null,
  term_key text not null,
  mapped_value text,
  mapped_label text,
  ai_suggestion text,
  ai_suggestion_label text,
  ai_confidence numeric,
  ai_reason text,
  first_seen_file text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pv_term_mappings_org_kind_key unique (organization_id, kind, term_key),
  constraint pv_term_mappings_outcome_value check (
    kind <> 'OUTCOME' or mapped_value is null or mapped_value in
      ('RECOVERED', 'RECOVERING', 'NOT_RECOVERED', 'RECOVERED_WITH_SEQUELAE', 'FATAL', 'UNKNOWN')
  )
);

create index if not exists idx_pv_term_mappings_org_kind_created
  on public.pv_term_mappings(organization_id, kind, created_at desc);

drop trigger if exists trg_set_org_id on public.pv_term_mappings;
create trigger trg_set_org_id before insert on public.pv_term_mappings
  for each row execute function public.set_pv_organization_id();

alter table public.pv_term_mappings enable row level security;

create policy "org_isolation_select" on public.pv_term_mappings
  for select to authenticated using (organization_id = public.current_org_id());
create policy "org_isolation_insert" on public.pv_term_mappings
  for insert to authenticated with check (organization_id = public.current_org_id());
create policy "org_isolation_update" on public.pv_term_mappings
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
create policy "org_isolation_delete" on public.pv_term_mappings
  for delete to authenticated using (organization_id = public.current_org_id());

revoke all on public.pv_term_mappings from anon;
