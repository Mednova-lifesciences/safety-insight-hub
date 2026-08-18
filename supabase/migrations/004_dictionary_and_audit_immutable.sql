-- Migration 004: Dictionary Management and Audit Trail Immutability
-- Supports MedDRA/WHODrug licensing and enforces audit append-only semantics

-- Dictionary versions (MedDRA, WHODrug, etc.)
-- Tracks licensed dictionary imports
create table if not exists dictionaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  
  -- Dictionary identification
  name text not null check (name in ('MedDRA', 'WHODrug', 'ICD10', 'ICD11', 'CUSTOM')),
  version text not null,
  edition date,                 -- e.g. MedDRA 27.0 release date
  
  -- Status
  status text not null check (status in ('DRAFT', 'ACTIVE', 'DEPRECATED', 'RETIRED')) default 'ACTIVE',
  
  -- Source
  source text,                  -- 'OFFICIAL_EXPORT', 'VENDOR_IMPORT', 'SAMPLE_DATA', 'CUSTOM'
  import_file_hash text,        -- SHA256 of imported file for audit
  
  -- Metadata
  imported_by uuid not null references profiles(id) on delete restrict,
  imported_at timestamp with time zone default now(),
  notes text,
  
  unique(name, version, organization_id)
);

-- Dictionary Terms
-- Individual terms/codes within a dictionary
create table if not exists dictionary_terms (
  id uuid primary key default gen_random_uuid(),
  dictionary_id uuid not null references dictionaries on delete cascade,
  
  -- Code and hierarchy
  code text not null,
  preferred_term text not null,
  
  -- MedDRA-specific hierarchy
  llt text,                     -- Lowest Level Term
  pt text,                      -- Preferred Term
  hlgt text,                    -- High Level Group Term
  hlt text,                     -- High Level Term
  soc text,                     -- System Organ Class
  
  -- WHODrug-specific
  trade_name text,
  ingredient text,
  
  -- Language
  language text default 'en',
  
  -- Status
  active boolean default true,
  
  -- Metadata
  created_at timestamp with time zone default now(),
  
  unique(dictionary_id, code)
);

-- Synonyms and aliases for dictionary terms
create table if not exists dictionary_synonyms (
  id uuid primary key default gen_random_uuid(),
  dictionary_term_id uuid not null references dictionary_terms on delete cascade,
  
  synonym text not null,
  type text check (type in ('EXACT_SYNONYM', 'RELATED_TERM', 'ABBREVIATION', 'HISTORICAL')) default 'EXACT_SYNONYM',
  
  unique(dictionary_term_id, synonym)
);

-- Case Codings (improved version)
-- Links case reactions to dictionary codes
create table if not exists case_codings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  case_id uuid not null references cases on delete cascade,
  
  -- What was coded
  entity_type text check (entity_type in ('REACTION', 'PRODUCT', 'INDICATION')) default 'REACTION',
  entity_id uuid,               -- Reference to reaction_id or product_id
  source_text text not null,
  
  -- Dictionary and code
  dictionary_id uuid references dictionaries on delete restrict,
  dictionary_term_id uuid references dictionary_terms on delete restrict,
  code text not null,
  coded_term text not null,
  
  -- Coding process
  coding_method text check (coding_method in (
    'EXACT_MATCH',
    'SYNONYM_MATCH',
    'FUZZY_MATCH',
    'MANUAL_SELECTION',
    'LLM_RANKED_CANDIDATE',
    'LEGACY_IMPORT'
  )) default 'MANUAL_SELECTION',
  
  confidence float check (confidence >= 0 and confidence <= 1),
  evidence text,                -- Why this code was selected
  
  -- Workflow state
  status text check (status in ('PENDING', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')) default 'PENDING',
  
  -- Review
  reviewed_by uuid references profiles(id) on delete set null,
  review_comment text,
  accepted_at timestamp with time zone,
  
  -- Versioning
  version integer default 1,
  superseded_by uuid references case_codings on delete set null,
  
  -- Metadata
  created_by uuid not null references profiles(id) on delete restrict,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Audit Trail - Make truly append-only and immutable
-- Recreate with stricter constraints
create table if not exists audit_trail_immutable (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  
  -- Actor
  user_id uuid references profiles(id) on delete set null,
  
  -- What changed
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  
  -- State change
  previous_value jsonb,
  new_value jsonb,
  
  -- Context
  reason text,
  source_system text,           -- 'UI', 'API', 'IMPORT', 'SYSTEM'
  workflow_step text,           -- What workflow step was this action taken in?
  
  -- Immutable timestamp
  created_at timestamp with time zone default now() NOT NULL,
  
  -- Ensure no updates or deletes
  constraint audit_trail_no_modification check (created_at is not null)
);

-- Create indexes for audit trail
create index if not exists idx_audit_immutable_org on audit_trail_immutable(organization_id);
create index if not exists idx_audit_immutable_entity on audit_trail_immutable(entity_type, entity_id);
create index if not exists idx_audit_immutable_user on audit_trail_immutable(user_id);
create index if not exists idx_audit_immutable_action on audit_trail_immutable(action);
create index if not exists idx_audit_immutable_created on audit_trail_immutable(created_at);

-- Create indexes for dictionary tables
create index if not exists idx_dictionaries_org on dictionaries(organization_id);
create index if not exists idx_dictionaries_status on dictionaries(status);
create index if not exists idx_dictionary_terms_code on dictionary_terms(code);
create index if not exists idx_dictionary_terms_dict on dictionary_terms(dictionary_id);
create index if not exists idx_dictionary_synonyms_term on dictionary_synonyms(dictionary_term_id);

-- Create indexes for case codings
create index if not exists idx_case_codings_case on case_codings(case_id);
create index if not exists idx_case_codings_org on case_codings(organization_id);
create index if not exists idx_case_codings_dictionary on case_codings(dictionary_id);
create index if not exists idx_case_codings_status on case_codings(status);
create index if not exists idx_case_codings_code on case_codings(code);

-- Enable RLS
alter table dictionaries enable row level security;
alter table dictionary_terms enable row level security;
alter table dictionary_synonyms enable row level security;
alter table case_codings enable row level security;
alter table audit_trail_immutable enable row level security;

-- RLS Policies: Dictionaries
drop policy if exists "dictionaries_own_org" on dictionaries;
create policy "dictionaries_own_org" on dictionaries for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "dictionaries_admin_only" on dictionaries;
create policy "dictionaries_admin_only" on dictionaries for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and (select role from profiles where id = auth.uid()) = 'ADMIN'
  );

-- RLS Policies: Dictionary Terms (read-only via org)
drop policy if exists "dictionary_terms_own_org" on dictionary_terms;
create policy "dictionary_terms_own_org" on dictionary_terms for select 
  using (
    exists (select 1 from dictionaries d 
      where d.id = dictionary_id 
      and d.organization_id = (select organization_id from profiles where id = auth.uid()))
  );

-- RLS Policies: Dictionary Synonyms (read-only via org)
drop policy if exists "dictionary_synonyms_own_org" on dictionary_synonyms;
create policy "dictionary_synonyms_own_org" on dictionary_synonyms for select 
  using (
    exists (select 1 from dictionary_terms dt 
      join dictionaries d on dt.dictionary_id = d.id
      where dt.id = dictionary_term_id
      and d.organization_id = (select organization_id from profiles where id = auth.uid()))
  );

-- RLS Policies: Case Codings
drop policy if exists "case_codings_own_org" on case_codings;
create policy "case_codings_own_org" on case_codings for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "case_codings_create" on case_codings;
create policy "case_codings_create" on case_codings for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and created_by = auth.uid()
  );

drop policy if exists "case_codings_update" on case_codings;
create policy "case_codings_update" on case_codings for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

-- RLS Policies: Audit Trail Immutable (append-only, no update/delete)
drop policy if exists "audit_immutable_own_org" on audit_trail_immutable;
create policy "audit_immutable_own_org" on audit_trail_immutable for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "audit_immutable_create" on audit_trail_immutable;
create policy "audit_immutable_create" on audit_trail_immutable for insert 
  with check (
    organization_id = (select organization_id from profiles where id = auth.uid())
    and (user_id = auth.uid() or user_id is null)
  );

-- Explicitly deny update and delete on audit trail
drop policy if exists "audit_immutable_no_update" on audit_trail_immutable;
create policy "audit_immutable_no_update" on audit_trail_immutable for update 
  using (false);

drop policy if exists "audit_immutable_no_delete" on audit_trail_immutable;
create policy "audit_immutable_no_delete" on audit_trail_immutable for delete 
  using (false);
