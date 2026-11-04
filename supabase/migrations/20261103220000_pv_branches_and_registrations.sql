-- Branch register and product registration register, for the staff side
-- (Field Associate, PV Coordinator, PV Manager).
--
-- pv_branches: the organisation's stores/branches — name, code, area, focal
-- person and phone. Each branch's public reporting link carries the branch
-- NAME (/r/<org>?branch=<name>), so anon never needs to read this table.
--
-- pv_registrations: NAFDAC registrations held for the organisation's
-- products — number, holder, issue/expiry dates, variations and commitments.
-- Kept out of pv_products on purpose: anon can read the drug catalog (for
-- the public picker), and registration details are internal.
--
-- Both: read by the three staff roles, written by Coordinators and Managers.
-- No delete policy — a branch or registration is retired (active = false or
-- a status), never removed, and every change is also in the audit trail.
--
-- Rollback: supabase/rollbacks/20261103220000_pv_branches_and_registrations.rollback.sql

create table if not exists public.pv_branches (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  data jsonb not null
);

create table if not exists public.pv_registrations (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  data jsonb not null
);

create index if not exists pv_branches_org on public.pv_branches (organization_id);
create index if not exists pv_registrations_org on public.pv_registrations (organization_id);

drop trigger if exists trg_set_org_id on public.pv_branches;
create trigger trg_set_org_id
  before insert on public.pv_branches
  for each row execute function public.set_pv_organization_id();

drop trigger if exists trg_set_org_id on public.pv_registrations;
create trigger trg_set_org_id
  before insert on public.pv_registrations
  for each row execute function public.set_pv_organization_id();

alter table public.pv_branches enable row level security;
alter table public.pv_registrations enable row level security;

revoke all on public.pv_branches from anon;
revoke all on public.pv_registrations from anon;
revoke delete, truncate on public.pv_branches from authenticated;
revoke delete, truncate on public.pv_registrations from authenticated;
grant select, insert, update on public.pv_branches to authenticated;
grant select, insert, update on public.pv_registrations to authenticated;

-- pv_branches
drop policy if exists branches_staff_read on public.pv_branches;
create policy branches_staff_read on public.pv_branches
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('FIELD_ASSOCIATE', 'PV_COORDINATOR', 'PV_MANAGER')
  );

drop policy if exists branches_staff_insert on public.pv_branches;
create policy branches_staff_insert on public.pv_branches
  for insert to authenticated
  with check (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('PV_COORDINATOR', 'PV_MANAGER')
  );

drop policy if exists branches_staff_update on public.pv_branches;
create policy branches_staff_update on public.pv_branches
  for update to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('PV_COORDINATOR', 'PV_MANAGER')
  )
  with check (organization_id = public.current_org_id());

-- pv_registrations
drop policy if exists registrations_staff_read on public.pv_registrations;
create policy registrations_staff_read on public.pv_registrations
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('FIELD_ASSOCIATE', 'PV_COORDINATOR', 'PV_MANAGER')
  );

drop policy if exists registrations_staff_insert on public.pv_registrations;
create policy registrations_staff_insert on public.pv_registrations
  for insert to authenticated
  with check (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('PV_COORDINATOR', 'PV_MANAGER')
  );

drop policy if exists registrations_staff_update on public.pv_registrations;
create policy registrations_staff_update on public.pv_registrations
  for update to authenticated
  using (
    organization_id = public.current_org_id()
    and (select role from public.profiles where id = auth.uid())
      in ('PV_COORDINATOR', 'PV_MANAGER')
  )
  with check (organization_id = public.current_org_id());
