-- Migration 002: Normalized Product and Reaction Model
-- This migration adds support for multi-product and multi-reaction cases
-- while maintaining backward compatibility with existing case records

-- Products table (normalized dictionary)
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  
  -- Product identification
  name text not null,
  active_ingredient text,
  strength text,
  dose_unit text,
  route text,
  
  -- Metadata
  source text, -- 'MANUAL', 'LINELIST', 'API'
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  unique(organization_id, name)
);

-- Reactions/Events table (normalized)
create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  
  -- Reaction identification
  reported_term text not null,
  
  -- Medical coding (when available)
  meddra_term text,
  meddra_llt text,
  meddra_pt text,
  meddra_soc text,
  meddra_version text,
  
  -- Temporal data
  onset_date date,
  outcome text check (outcome in ('RECOVERED', 'RECOVERING', 'NOT_RECOVERED', 'FATAL', 'UNKNOWN') or outcome is null),
  dechallenge text check (dechallenge in ('YES', 'NO', 'UNKNOWN') or dechallenge is null),
  rechallenge text check (rechallenge in ('YES', 'NO', 'UNKNOWN') or rechallenge is null),
  
  -- Seriousness classification
  is_serious boolean,
  seriousness_criteria text[], -- array of criteria that apply
  
  -- Metadata
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Case-Product relationship (normalized)
-- A case may involve multiple products (suspect, concomitant, interacting)
create table if not exists case_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  case_id uuid not null references cases on delete cascade,
  product_id uuid not null references products on delete restrict,
  
  -- Product role in this case
  role text not null check (role in ('SUSPECT', 'CONCOMITANT', 'INTERACTING')) default 'SUSPECT',
  
  -- Case-specific product details
  dose text,
  dose_unit text,
  route text,
  frequency text,
  therapy_start date,
  therapy_stop date,
  indication text,
  action_taken text check (action_taken in ('WITHDRAWN', 'DOSE_REDUCED', 'DOSE_INCREASED', 'UNCHANGED', 'UNKNOWN') or action_taken is null),
  
  -- Metadata
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  unique(case_id, product_id, role)
);

-- Case-Reaction relationship (normalized)
-- A case may involve multiple reactions/events
create table if not exists case_reactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  case_id uuid not null references cases on delete cascade,
  reaction_id uuid not null references reactions on delete restrict,
  
  -- Metadata
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  unique(case_id, reaction_id)
);

-- Create indexes
create index if not exists idx_products_org on products(organization_id);
create index if not exists idx_products_name on products(name);
create index if not exists idx_reactions_org on reactions(organization_id);
create index if not exists idx_reactions_reported_term on reactions(reported_term);
create index if not exists idx_case_products_case on case_products(case_id);
create index if not exists idx_case_products_product on case_products(product_id);
create index if not exists idx_case_products_role on case_products(role);
create index if not exists idx_case_reactions_case on case_reactions(case_id);
create index if not exists idx_case_reactions_reaction on case_reactions(reaction_id);

-- Enable RLS
alter table products enable row level security;
alter table reactions enable row level security;
alter table case_products enable row level security;
alter table case_reactions enable row level security;

-- RLS Policies: Products
drop policy if exists "products_own_org" on products;
create policy "products_own_org" on products for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "products_create" on products;
create policy "products_create" on products for insert 
  with check (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "products_update" on products;
create policy "products_update" on products for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

-- RLS Policies: Reactions
drop policy if exists "reactions_own_org" on reactions;
create policy "reactions_own_org" on reactions for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "reactions_create" on reactions;
create policy "reactions_create" on reactions for insert 
  with check (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "reactions_update" on reactions;
create policy "reactions_update" on reactions for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

-- RLS Policies: Case-Products
drop policy if exists "case_products_own_org" on case_products;
create policy "case_products_own_org" on case_products for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "case_products_create" on case_products;
create policy "case_products_create" on case_products for insert 
  with check (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "case_products_update" on case_products;
create policy "case_products_update" on case_products for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

-- RLS Policies: Case-Reactions
drop policy if exists "case_reactions_own_org" on case_reactions;
create policy "case_reactions_own_org" on case_reactions for select 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "case_reactions_create" on case_reactions;
create policy "case_reactions_create" on case_reactions for insert 
  with check (organization_id = (select organization_id from profiles where id = auth.uid()));

drop policy if exists "case_reactions_update" on case_reactions;
create policy "case_reactions_update" on case_reactions for update 
  using (organization_id = (select organization_id from profiles where id = auth.uid()));
