-- What each OpenAI call disclosed: field names and counts, never values.
-- Written only by the backend (service role) from ai/disclosure.py after
-- de-identification; read by the organisation's administrators (the three
-- assessor roles and the PV Manager). Nobody can change or delete a row
-- from the app.
--
-- Rollback: drop table public.pv_ai_disclosures;

create table if not exists public.pv_ai_disclosures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid,
  created_at timestamptz not null default now(),
  data jsonb not null
);

create index if not exists pv_ai_disclosures_org_created
  on public.pv_ai_disclosures (organization_id, created_at desc);

alter table public.pv_ai_disclosures enable row level security;

revoke all on public.pv_ai_disclosures from anon;
revoke insert, update, delete, truncate on public.pv_ai_disclosures from authenticated;
grant select on public.pv_ai_disclosures to authenticated;

drop policy if exists ai_disclosures_admin_read on public.pv_ai_disclosures;
create policy ai_disclosures_admin_read on public.pv_ai_disclosures
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER', 'PV_MANAGER')
  );
