-- Migration 003: Case Submission Lifecycle and Signal Detection Framework
-- Implements proper E2B submission state machine and signal detection infrastructure

-- Case Submissions table
-- Tracks the lifecycle of a case from intake through regulatory submission
create table if not exists case_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  case_id uuid not null references cases on delete cascade,
  
  -- Submission state machine
  state text not null check (state in (
    'DRAFT',              -- Initial state after case creation
    'VALIDATION_IN_PROGRESS',
    'VALIDATION_FAILED',
    'VALIDATION_PASSED',
    'READY_FOR_RELEASE',
    'RELEASED',           -- Human has authorized transmission
    'TRANSMISSION_IN_PROGRESS',
    'TRANSMITTED',        -- External acknowledgement received
    'ACKNOWLEDGED',
    'REJECTED',           -- Regulatory rejection
    'REJECTED_FOR_AMENDMENT',
    'FAILED'              -- Transmission failure
  )) default 'DRAFT',
  
  -- Submission versions
  submission_version integer default 1,
  amendment_reason text,
  
  -- E2B(R3) details
  e2b_xml text,         -- Generated E2B(R3) XML
  e2b_version text,     -- E2B version used
  validation_errors jsonb, -- Array of validation issues if any
  validation_timestamp timestamp with time zone,
  
  -- Release information
  released_by uuid references profiles(id) on delete set null,
  released_at timestamp with time zone,
  release_rationale text,
  
  -- Transmission information
  transmission_gateway text, -- e.g. 'LFPV', 'NAFDAC', 'VigiFlow', 'TEST_SANDBOX'
  transmission_request_id text,
  transmission_timestamp timestamp with time zone,
  transmission_response jsonb,
  
  -- Regulatory acknowledgement
  acknowledgement_received_at timestamp with time zone,
  acknowledgement_response jsonb,
  
  -- Metadata
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  -- Ensure one active submission per case (or versioned series)
  unique(case_id, submission_version)
);

-- Signal Detection Runs (frozen dataset snapshots)
-- Each run is immutable once created, enabling reproducible signal detection
create table if not exists signal_detection_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  
  -- Detection period
  start_date date not null,
  end_date date not null,
  
  -- Detection configuration
  detection_method text not null check (detection_method in (
    'CASE_SERIES_SCREENING',     -- Qualitative signal screening
    'DISPROPORTIONALITY_PRR',     -- Proportional Reporting Ratio
    'DISPROPORTIONALITY_ROR',     -- Reporting Odds Ratio
    'DISPROPORTIONALITY_IC',      -- Information Component
    'BAYESIAN_CONFIDENCE_INTERVAL' -- Bayesian approach
  )) default 'CASE_SERIES_SCREENING',
  
  -- Dataset state at detection time
  dictionary_version text,      -- e.g., 'MedDRA 27.0'
  total_cases_in_period integer,
  cases_after_deduplication integer,
  cases_included_in_detection integer,
  exclusion_criteria jsonb,     -- Applied filters
  
  -- Detection thresholds
  threshold_config jsonb,       -- Stored for reproducibility
  
  -- Results
  candidates_generated integer,
  
  -- Metadata
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamp with time zone default now(),
  
  -- Immutable: no update/delete policies
  constraint detection_run_immutable check (true)
);

-- Signal Candidates
-- Individual signals identified in a detection run
create table if not exists signal_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  detection_run_id uuid not null references signal_detection_runs on delete restrict,
  
  -- Signal identification
  product_name text not null,
  reaction_term text not null,
  reaction_soc text,            -- Standard Organizational Class
  
  -- Detection metrics
  case_count integer not null,
  cases_serious integer,
  cases_fatal integer,
  detection_method text,        -- From the parent run
  statistical_metric jsonb,     -- Numeric result if applicable
  confidence_level text check (confidence_level in ('LOW', 'MEDIUM', 'HIGH') or confidence_level is null),
  
  -- Evidence list (case IDs that comprise this signal)
  evidence_case_ids text[],     -- Array of case UUIDs as strings
  
  -- Lifecycle state
  state text not null check (state in (
    'DETECTED',
    'UNDER_REVIEW',
    'VALIDATED',
    'CONFIRMED',
    'REFUTED',
    'WITHDRAWN'
  )) default 'DETECTED',
  
  -- Metadata
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Signal Assessment (human review and decision)
-- One or more assessments per candidate (versioned as review proceeds)
create table if not exists signal_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  signal_candidate_id uuid not null references signal_candidates on delete cascade,
  
  -- Assessment details
  evidence_for text,
  evidence_against text,
  confounders text,
  alternative_explanations text,
  
  -- Clinical/regulatory context
  regulatory_context text,      -- e.g. 'Known ADR', 'Unexpected', 'Emerging'
  lit_search_performed boolean default false,
  lit_search_result text,
  
  -- Decision
  recommendation text check (recommendation in (
    'NO_ACTION',
    'CONTINUE_MONITORING',
    'INVESTIGATION_NEEDED',
    'EXPEDITED_REVIEW',
    'SUBMISSION_TO_AUTHORITY',
    'MARKET_ACTION_RECOMMENDED'
  ) or recommendation is null),
  
  decision text check (decision in (
    'CONFIRMED_SIGNAL',
    'POTENTIAL_SIGNAL',
    'NOT_A_SIGNAL',
    'INSUFFICIENT_DATA'
  ) or decision is null),
  
  action text,
  next_review_date date,
  
  -- Closure
  closure_rationale text,
  
  -- Metadata
  assessed_by uuid not null references profiles(id) on delete restrict,
  assessed_at timestamp with time zone default now(),
  version integer default 1,
  created_at timestamp with time zone default now()
);

-- Create indexes
create index if not exists idx_case_submissions_case on case_submissions(case_id);
create index if not exists idx_case_submissions_org on case_submissions(organization_id);
create index if not exists idx_case_submissions_state on case_submissions(state);
create index if not exists idx_case_submissions_released_by on case_submissions(released_by);
create index if not exists idx_detection_runs_org on signal_detection_runs(organization_id);
create index if not exists idx_detection_runs_period on signal_detection_runs(start_date, end_date);
create index if not exists idx_signal_candidates_run on signal_candidates(detection_run_id);
create index if not exists idx_signal_candidates_org on signal_candidates(organization_id);
create index if not exists idx_signal_candidates_state on signal_candidates(state);
create index if not exists idx_signal_candidates_product_reaction on signal_candidates(product_name, reaction_term);
create index if not exists idx_signal_assessments_candidate on signal_assessments(signal_candidate_id);
create index if not exists idx_signal_assessments_assessed_by on signal_assessments(assessed_by);
create index if not exists idx_signal_assessments_org on signal_assessments(organization_id);

-- Enable RLS
alter table case_submissions enable row level security;
alter table signal_detection_runs enable row level security;
alter table signal_candidates enable row level security;
alter table signal_assessments enable row level security;

-- RLS Policies: Case Submissions
drop policy if exists "case_submissions_own_org" on case_submissions;
create policy "case_submissions_own_org" on case_submissions for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "case_submissions_create" on case_submissions;
create policy "case_submissions_create" on case_submissions for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and created_by = auth.uid()
  );

drop policy if exists "case_submissions_update" on case_submissions;
create policy "case_submissions_update" on case_submissions for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

-- RLS Policies: Signal Detection Runs
drop policy if exists "detection_runs_own_org" on signal_detection_runs;
create policy "detection_runs_own_org" on signal_detection_runs for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "detection_runs_create" on signal_detection_runs;
create policy "detection_runs_create" on signal_detection_runs for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and created_by = auth.uid()
  );

-- RLS Policies: Signal Candidates
drop policy if exists "signal_candidates_own_org" on signal_candidates;
create policy "signal_candidates_own_org" on signal_candidates for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "signal_candidates_create" on signal_candidates;
create policy "signal_candidates_create" on signal_candidates for insert 
  with check (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "signal_candidates_update" on signal_candidates;
create policy "signal_candidates_update" on signal_candidates for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

-- RLS Policies: Signal Assessments
drop policy if exists "signal_assessments_own_org" on signal_assessments;
create policy "signal_assessments_own_org" on signal_assessments for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "signal_assessments_create" on signal_assessments;
create policy "signal_assessments_create" on signal_assessments for insert 
  with check (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "signal_assessments_update" on signal_assessments;
create policy "signal_assessments_update" on signal_assessments for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

-- Audit Trail enhancement: Record case submission state changes
-- Note: This is handled by application-level triggers via _write_audit_event
