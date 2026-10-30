-- Referrals to NAFDAC post-market surveillance (PMS) raised from a batch or
-- facility flag on the line lists: the batch, product, cases, facilities,
-- dates, quality warning signs and the reviewer's note, as one record.
-- A referral asks for laboratory testing of a possible quality concern; it
-- is never a finding that a product is falsified.
--
-- Raised and read by the organisation's administrators (the three assessor
-- roles). There is no delete policy: a referral, once made, stays on record.
--
-- Rollback: supabase/rollbacks/20261030130000_pv_pms_referrals.rollback.sql

create table if not exists public.pv_pms_referrals (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  data jsonb not null
);

create index if not exists pv_pms_referrals_org_created
  on public.pv_pms_referrals (organization_id, created_at desc);

drop trigger if exists trg_set_org_id on public.pv_pms_referrals;
create trigger trg_set_org_id
  before insert on public.pv_pms_referrals
  for each row execute function public.set_pv_organization_id();

alter table public.pv_pms_referrals enable row level security;

revoke all on public.pv_pms_referrals from anon;
revoke delete, truncate on public.pv_pms_referrals from authenticated;
grant select, insert, update on public.pv_pms_referrals to authenticated;

drop policy if exists pms_referrals_admin_read on public.pv_pms_referrals;
create policy pms_referrals_admin_read on public.pv_pms_referrals
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER')
  );

drop policy if exists pms_referrals_admin_insert on public.pv_pms_referrals;
create policy pms_referrals_admin_insert on public.pv_pms_referrals
  for insert to authenticated
  with check (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER')
  );

drop policy if exists pms_referrals_admin_update on public.pv_pms_referrals;
create policy pms_referrals_admin_update on public.pv_pms_referrals
  for update to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER')
  )
  with check (organization_id = public.current_org_id());
