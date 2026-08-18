-- Organizations (multi-tenant support)
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Profiles (user accounts in the system)
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  full_name text,
  email text,
  role text not null check (role in ('FIELD_ASSOCIATE', 'PV_COORDINATOR', 'PV_MANAGER', 'ADMIN')),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Cases (ICSR records)
create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  case_id text not null,
  
  -- Reporter
  reporter_name text,
  reporter_qualification text,
  reporter_country text,
  reporter_contact text,
  reporter_consent_to_contact boolean,
  
  -- Patient
  patient_identifier text,
  patient_age text,
  patient_sex text,
  patient_weight_kg text,
  patient_medical_history text,
  
  -- Product
  product_name text,
  product_active_ingredient text,
  product_dose text,
  product_route text,
  product_indication text,
  product_therapy_start date,
  product_action text,
  
  -- Reaction
  reaction_term text,
  reaction_onset_date date,
  reaction_outcome text,
  
  -- Assessment
  narrative text,
  reported_seriousness text,
  seriousness_criteria text[], -- array of criteria selected by user
  
  -- Workflow
  workflow_step text default 'INTAKE' check (workflow_step in ('INTAKE', 'TRIAGE', 'CODING', 'REVIEW', 'QC', 'REGULATORY_READY', 'CLOSED')),
  assigned_to uuid references profiles(id),
  
  -- Metadata
  source text check (source in ('MANUAL', 'WHATSAPP', 'LINELIST', 'EMAIL', 'INTAKE')),
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  unique(organization_id, case_id)
);

-- Seriousness Assessments
create table if not exists seriousness_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  case_id uuid not null references cases on delete cascade,
  
  reported_seriousness text,
  narrative_assessment text,
  mismatch boolean,
  criteria jsonb, -- array of {criterion, detected, evidence}
  rationale text,
  engine_version text,
  
  review_state text default 'PENDING_REVIEW' check (review_state in ('PENDING_REVIEW', 'REVIEWED')),
  reviewed_by uuid references profiles(id),
  review_decision text check (review_decision in ('ACCEPT_REPORTED', 'MARK_SERIOUS', 'REQUEST_INFO') or review_decision is null),
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Coding Suggestions
create table if not exists coding_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  case_id uuid not null references cases on delete cascade,
  
  source_text text not null,
  kind text not null check (kind in ('DRUG', 'REACTION')),
  term text,
  code text,
  dictionary text check (dictionary in ('MedDRA', 'WHODrug')),
  dictionary_version text,
  match_type text check (match_type in ('EXACT', 'SYNONYM', 'FUZZY', 'LLM_RANKED_CANDIDATE')),
  confidence float,
  evidence text,
  
  status text default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'REJECTED')),
  accepted_by uuid references profiles(id),
  accepted_at timestamp with time zone,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Audit Trail
create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  
  action text not null,
  entity_type text,
  entity_id text,
  
  previous_value jsonb,
  new_value jsonb,
  reason text,
  
  created_at timestamp with time zone default now()
);

-- Duplicate Matches (Phase 2.1)
create table if not exists duplicate_matches (
  id text primary key,
  organization_id uuid not null references organizations on delete cascade,
  case_id uuid not null references cases on delete cascade,
  duplicate_case_id uuid not null references cases on delete cascade,
  confidence float not null check (confidence >= 0 and confidence <= 100),
  matched_fields jsonb,
  evidence jsonb,
  status text not null default 'OPEN' check (status in ('OPEN', 'REVIEWED', 'MERGED', 'KEEP_SEPARATE')),
  resolution_action text check (resolution_action in ('REVIEWED', 'MERGED', 'KEEP_SEPARATE') or resolution_action is null),
  resolved_by uuid references profiles(id),
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Consistency Checks (Phase 2.2)
create table if not exists consistency_checks (
  id text primary key,
  organization_id uuid not null references organizations on delete cascade,
  case_id uuid not null references cases on delete cascade,
  check_type text not null,
  severity text not null check (severity in ('INFO', 'WARNING', 'ERROR')),
  message text not null,
  evidence jsonb,
  suggested_resolution text,
  status text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Create indexes for common queries
create index if not exists idx_profiles_org on profiles(organization_id);
create index if not exists idx_profiles_email on profiles(email);
create index if not exists idx_cases_org on cases(organization_id);
create index if not exists idx_cases_created_by on cases(created_by);
create index if not exists idx_cases_workflow on cases(workflow_step);
create index if not exists idx_seriousness_case on seriousness_assessments(case_id);
create index if not exists idx_coding_case on coding_suggestions(case_id);
create index if not exists idx_audit_org on audit_events(organization_id);
create index if not exists idx_audit_created on audit_events(created_at);
create index if not exists idx_duplicate_matches_case on duplicate_matches(case_id);
create index if not exists idx_duplicate_matches_org on duplicate_matches(organization_id);
create index if not exists idx_duplicate_matches_status on duplicate_matches(status);
create index if not exists idx_duplicate_matches_confidence on duplicate_matches(confidence);
create index if not exists idx_consistency_checks_case on consistency_checks(case_id);
create index if not exists idx_consistency_checks_org on consistency_checks(organization_id);
create index if not exists idx_consistency_checks_status on consistency_checks(status);

-- Enable RLS
alter table organizations enable row level security;
alter table profiles enable row level security;
alter table cases enable row level security;
alter table seriousness_assessments enable row level security;
alter table coding_suggestions enable row level security;
alter table audit_events enable row level security;
alter table duplicate_matches enable row level security;
alter table consistency_checks enable row level security;

-- RLS Policies: Organizations (public read for authenticated)
drop policy if exists "org_public_read" on organizations;
create policy "org_public_read" on organizations for select using (true);

-- RLS Policies: Profiles (users can see their own org members)
drop policy if exists "profiles_own_org" on profiles;
create policy "profiles_own_org" on profiles for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "profiles_own_update" on profiles;
create policy "profiles_own_update" on profiles for update 
  using (id = auth.uid());

-- RLS Policies: Cases (users see org cases + role-based restrictions)
drop policy if exists "cases_own_org" on cases;
create policy "cases_own_org" on cases for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "cases_create" on cases;
create policy "cases_create" on cases for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and created_by = auth.uid()
  );

drop policy if exists "cases_update_own_org" on cases;
create policy "cases_update_own_org" on cases for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

-- RLS Policies: Seriousness Assessments
drop policy if exists "seriousness_own_org" on seriousness_assessments;
create policy "seriousness_own_org" on seriousness_assessments for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "seriousness_create" on seriousness_assessments;
create policy "seriousness_create" on seriousness_assessments for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
  );

-- RLS Policies: Coding Suggestions
drop policy if exists "coding_own_org" on coding_suggestions;
create policy "coding_own_org" on coding_suggestions for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "coding_create" on coding_suggestions;
create policy "coding_create" on coding_suggestions for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
  );

-- RLS Policies: Audit Events (all org users can read)
drop policy if exists "audit_own_org" on audit_events;
create policy "audit_own_org" on audit_events for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "audit_create" on audit_events;
create policy "audit_create" on audit_events for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and (user_id = auth.uid() or user_id is null)
  );

-- RLS Policies: Duplicate Matches (Phase 2.1)
drop policy if exists "duplicate_matches_own_org" on duplicate_matches;
create policy "duplicate_matches_own_org" on duplicate_matches for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "duplicate_matches_create" on duplicate_matches;
create policy "duplicate_matches_create" on duplicate_matches for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
  );

drop policy if exists "duplicate_matches_update" on duplicate_matches;
create policy "duplicate_matches_update" on duplicate_matches for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

-- RLS Policies: Consistency Checks (Phase 2.2)
drop policy if exists "consistency_checks_own_org" on consistency_checks;
create policy "consistency_checks_own_org" on consistency_checks for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "consistency_checks_create" on consistency_checks;
create policy "consistency_checks_create" on consistency_checks for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
  );

drop policy if exists "consistency_checks_update" on consistency_checks;
create policy "consistency_checks_update" on consistency_checks for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));
