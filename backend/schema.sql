create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key,
  organisation_id uuid references organizations(id) on delete set null,
  email text not null unique,
  name text not null,
  role text not null check (role in ('FIELD_ASSOCIATE', 'COORDINATOR', 'MANAGER')),
  initials text not null,
  created_at timestamptz not null default now()
);

create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organizations(id) on delete cascade,
  case_number text not null unique,
  patient_identifier text not null,
  product text not null,
  reaction text not null,
  seriousness text not null default 'UNASSESSED',
  outcome text not null default 'UNKNOWN',
  workflow_step text not null default 'INTAKE',
  assigned_to text not null default 'unassigned',
  received_date timestamptz not null default now(),
  due_date timestamptz not null default now() + interval '2 days',
  priority text not null default 'MEDIUM',
  flags text[] not null default '{}',
  source text not null default 'MANUAL',
  reporter jsonb not null default '{}',
  patient jsonb not null default '{}',
  suspect_products jsonb not null default '[]',
  reactions jsonb not null default '[]',
  narrative text not null default '',
  reported_seriousness_criteria text[] not null default '{}',
  follow_up_requests jsonb not null default '[]',
  workflow_state jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references organizations(id) on delete cascade,
  case_id uuid references cases(id) on delete cascade,
  actor text not null,
  role text not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  previous_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id) on delete cascade,
  requested_information text not null,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  due_at timestamptz not null default now() + interval '1 day',
  status text not null default 'OPEN',
  channel text not null default 'EMAIL'
);

create index if not exists idx_cases_organisation on cases(organisation_id);
create index if not exists idx_cases_workflow on cases(workflow_step);
create index if not exists idx_audit_case on audit_events(case_id);
