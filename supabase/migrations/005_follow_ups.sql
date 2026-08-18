-- Migration 005: protected reporter follow-up requests
create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  case_id uuid not null references cases on delete cascade,
  requested_information text not null,
  channel text not null check (channel in ('EMAIL', 'PHONE', 'WHATSAPP', 'PORTAL')),
  requested_by uuid not null references profiles(id) on delete restrict,
  requested_at timestamp with time zone not null default now(),
  due_at timestamp with time zone,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESPONDED', 'OVERDUE', 'CLOSED')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_follow_ups_org on follow_ups(organization_id);
create index if not exists idx_follow_ups_case on follow_ups(case_id);
create index if not exists idx_follow_ups_status on follow_ups(status);

alter table follow_ups enable row level security;

drop policy if exists "follow_ups_own_org" on follow_ups;
create policy "follow_ups_own_org" on follow_ups for select
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "follow_ups_create" on follow_ups;
create policy "follow_ups_create" on follow_ups for insert
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and requested_by = auth.uid()
  );

drop policy if exists "follow_ups_update" on follow_ups;
create policy "follow_ups_update" on follow_ups for update
  using (organization_id = (select organization_id from profiles where id = auth.uid()));
