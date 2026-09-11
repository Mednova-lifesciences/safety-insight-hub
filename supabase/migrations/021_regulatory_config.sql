-- Persistent, org-scoped NAFDAC E2B(R3) regulatory configuration.
--
-- Replaces the function-parameter-only UNCONFIRMED_DEFAULT_CONFIG the E2B
-- pipeline used until now with real, admin-configured, audited,
-- org-isolated settings: sender/receiver transmission identifiers, the
-- C.1.3 report type, the E.i.7 outcome codelist, and an open-ended
-- reporter-qualification (C.2.r.4) designation -> code mapping table.
-- Follows the exact pv_intake_settings pattern (018_whatsapp_intake.sql):
-- one row per org, set_pv_organization_id trigger, org_isolation_* RLS
-- policies, no anon access.

create table if not exists public.pv_regulatory_config (
  organization_id uuid primary key references public.organizations(id),
  environment text not null default 'uat' check (environment in ('uat', 'production')),
  sender_organization text,
  sender_identifier text,
  sender_type text,
  sender_person_responsible text,
  receiver_organization text,
  receiver_identifier text,
  -- report_type stores the raw C.1.3 value ("1".."4") only once an admin
  -- has explicitly confirmed it through the settings UI — never populated
  -- with the E2B engine's internal "4" placeholder by default.
  -- report_type_confirmed is a SEPARATE, explicit flag (not merely
  -- "report_type is not null") so this stored value can never be
  -- accidentally treated as confirmed by its mere presence — the exact
  -- bug class this whole feature exists to close off (see
  -- src/services/e2b-r3/transmission-config.ts's reportTypeConfirmed).
  report_type text check (report_type in ('1', '2', '3', '4')),
  report_type_confirmed boolean not null default false,
  case_id_prefix text,
  -- E.i.7 outcome codelist: canonical ReactionOutcome -> NAFDAC/Appendix
  -- I(F)-confirmed numeric code. Keys are only ever the six fixed
  -- ReactionOutcome values (RECOVERED, RECOVERING, NOT_RECOVERED,
  -- RECOVERED_WITH_SEQUELAE, FATAL, UNKNOWN); a missing key means that
  -- outcome's code is not yet confirmed — never defaulted to the
  -- developer spec's placeholder 1-6 numbering.
  outcome_codes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_set_org_id on public.pv_regulatory_config;
create trigger trg_set_org_id before insert on public.pv_regulatory_config
  for each row execute function public.set_pv_organization_id();

alter table public.pv_regulatory_config enable row level security;

create policy "org_isolation_select" on public.pv_regulatory_config
  for select to authenticated using (organization_id = public.current_org_id());
create policy "org_isolation_insert" on public.pv_regulatory_config
  for insert to authenticated with check (organization_id = public.current_org_id());
create policy "org_isolation_update" on public.pv_regulatory_config
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
create policy "org_isolation_delete" on public.pv_regulatory_config
  for delete to authenticated using (organization_id = public.current_org_id());

revoke all on public.pv_regulatory_config from anon;

-- Reporter-qualification designation -> E2B Appendix I(F) qualification
-- code mappings. Open-ended per org (any free-text designation a source
-- line-list uses — CHEW, CHO, Nurse, Midwife, Doctor, HMIS, OIC, DENTAL,
-- ... — never hardcoded to any one source's vocabulary). A row can exist
-- with qualification_code = null: this represents a designation the
-- E2B(R3) preflight has ENCOUNTERED in real case data but no admin has
-- mapped yet — distinct from a designation nobody has ever seen, which
-- never gets a row at all. See src/services/api/regulatory-config.ts's
-- discoverReporterDesignations.
create table if not exists public.pv_reporter_qualification_mappings (
  id text primary key,
  organization_id uuid not null references public.organizations(id),
  designation text not null,
  designation_key text not null,
  qualification_code text check (qualification_code in ('1', '2', '3', '4', '5')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, designation_key)
);

create index if not exists idx_pv_reporter_qual_org
  on public.pv_reporter_qualification_mappings(organization_id);

drop trigger if exists trg_set_org_id on public.pv_reporter_qualification_mappings;
create trigger trg_set_org_id before insert on public.pv_reporter_qualification_mappings
  for each row execute function public.set_pv_organization_id();

alter table public.pv_reporter_qualification_mappings enable row level security;

create policy "org_isolation_select" on public.pv_reporter_qualification_mappings
  for select to authenticated using (organization_id = public.current_org_id());
create policy "org_isolation_insert" on public.pv_reporter_qualification_mappings
  for insert to authenticated with check (organization_id = public.current_org_id());
create policy "org_isolation_update" on public.pv_reporter_qualification_mappings
  for update to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());
create policy "org_isolation_delete" on public.pv_reporter_qualification_mappings
  for delete to authenticated using (organization_id = public.current_org_id());

revoke all on public.pv_reporter_qualification_mappings from anon;
