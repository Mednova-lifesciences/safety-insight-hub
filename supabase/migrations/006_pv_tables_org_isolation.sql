-- Close a critical multi-tenancy gap: the pv_* demo-workspace tables were
-- created (20260819002606_...) with `USING (true)` RLS policies granted to
-- both `anon` and `authenticated`, and no organization_id column at all.
-- That means the public anon key (shipped in the frontend bundle) could
-- read/write every organization's cases, audit trail, coding, follow-ups,
-- notifications, intake conversations, line-list jobs, PSUR data and
-- signals, without even being logged in.
--
-- This migration adds organization_id to every pv_* table, backfills it
-- from the existing (single-tenant, so far) data, and replaces the open
-- policies with real per-organization isolation enforced via auth.uid().
--
-- Deploy order: the frontend must already be attaching a real Supabase Auth
-- session (see src/lib/auth.tsx `syncSupabaseSession`) before this runs,
-- otherwise authenticated requests will also fail auth.uid() checks.

-- Helper: resolve the caller's organization without re-triggering RLS on
-- profiles (SECURITY DEFINER bypasses RLS; search_path is pinned for safety).
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

grant execute on function public.current_org_id() to anon, authenticated;

-- 1) Add organization_id columns -------------------------------------------------
alter table public.pv_cases add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_follow_ups add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_notifications add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_audit_events add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_intake_conversations add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_seriousness add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_coding_suggestions add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_coding_history add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_linelist_jobs add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_linelist_issues add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_psur_documents add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_psur_findings add column if not exists organization_id uuid references public.organizations(id);
alter table public.pv_signals add column if not exists organization_id uuid references public.organizations(id);

-- 2) Backfill existing rows -------------------------------------------------
-- Child tables inherit organization_id from their parent row.
update public.pv_follow_ups f set organization_id = c.organization_id
  from public.pv_cases c where f.case_id = c.id and f.organization_id is null;
update public.pv_seriousness s set organization_id = c.organization_id
  from public.pv_cases c where s.case_id = c.id and s.organization_id is null;
update public.pv_coding_suggestions cs set organization_id = c.organization_id
  from public.pv_cases c where cs.case_id = c.id and cs.organization_id is null;
update public.pv_coding_history ch set organization_id = c.organization_id
  from public.pv_cases c where ch.case_id = c.id and ch.organization_id is null;
update public.pv_linelist_issues li set organization_id = j.organization_id
  from public.pv_linelist_jobs j where li.job_id = j.id and li.organization_id is null;
update public.pv_psur_findings pf set organization_id = d.organization_id
  from public.pv_psur_documents d where pf.document_id = d.id and pf.organization_id is null;

-- Root tables (and any rows the joins above could not resolve, e.g.
-- orphaned children) fall back to the sole existing organization. This
-- repo has never had more than one tenant in practice; if that changes,
-- reassign the affected rows manually before rerunning.
do $$
declare
  sole_org uuid;
  org_count int;
begin
  select count(*) into org_count from public.organizations;
  if org_count = 1 then
    select id into sole_org from public.organizations limit 1;
    update public.pv_cases set organization_id = sole_org where organization_id is null;
    update public.pv_follow_ups set organization_id = sole_org where organization_id is null;
    update public.pv_notifications set organization_id = sole_org where organization_id is null;
    update public.pv_audit_events set organization_id = sole_org where organization_id is null;
    update public.pv_intake_conversations set organization_id = sole_org where organization_id is null;
    update public.pv_seriousness set organization_id = sole_org where organization_id is null;
    update public.pv_coding_suggestions set organization_id = sole_org where organization_id is null;
    update public.pv_coding_history set organization_id = sole_org where organization_id is null;
    update public.pv_linelist_jobs set organization_id = sole_org where organization_id is null;
    update public.pv_linelist_issues set organization_id = sole_org where organization_id is null;
    update public.pv_psur_documents set organization_id = sole_org where organization_id is null;
    update public.pv_psur_findings set organization_id = sole_org where organization_id is null;
    update public.pv_signals set organization_id = sole_org where organization_id is null;
  end if;
end $$;

-- 3) Enforce NOT NULL now that every existing row has a value --------------
alter table public.pv_cases alter column organization_id set not null;
alter table public.pv_follow_ups alter column organization_id set not null;
alter table public.pv_notifications alter column organization_id set not null;
alter table public.pv_audit_events alter column organization_id set not null;
alter table public.pv_intake_conversations alter column organization_id set not null;
alter table public.pv_seriousness alter column organization_id set not null;
alter table public.pv_coding_suggestions alter column organization_id set not null;
alter table public.pv_coding_history alter column organization_id set not null;
alter table public.pv_linelist_jobs alter column organization_id set not null;
alter table public.pv_linelist_issues alter column organization_id set not null;
alter table public.pv_psur_documents alter column organization_id set not null;
alter table public.pv_psur_findings alter column organization_id set not null;
alter table public.pv_signals alter column organization_id set not null;

create index if not exists idx_pv_cases_org on public.pv_cases(organization_id);
create index if not exists idx_pv_follow_ups_org on public.pv_follow_ups(organization_id);
create index if not exists idx_pv_notifications_org on public.pv_notifications(organization_id);
create index if not exists idx_pv_audit_events_org on public.pv_audit_events(organization_id);
create index if not exists idx_pv_intake_conversations_org on public.pv_intake_conversations(organization_id);
create index if not exists idx_pv_seriousness_org on public.pv_seriousness(organization_id);
create index if not exists idx_pv_coding_suggestions_org on public.pv_coding_suggestions(organization_id);
create index if not exists idx_pv_coding_history_org on public.pv_coding_history(organization_id);
create index if not exists idx_pv_linelist_jobs_org on public.pv_linelist_jobs(organization_id);
create index if not exists idx_pv_linelist_issues_org on public.pv_linelist_issues(organization_id);
create index if not exists idx_pv_psur_documents_org on public.pv_psur_documents(organization_id);
create index if not exists idx_pv_psur_findings_org on public.pv_psur_findings(organization_id);
create index if not exists idx_pv_signals_org on public.pv_signals(organization_id);

-- 4) Auto-fill organization_id on insert so clients cannot spoof it --------
create or replace function public.set_pv_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is null then
    new.organization_id := public.current_org_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_org_id on public.pv_cases;
create trigger trg_set_org_id before insert on public.pv_cases
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_follow_ups;
create trigger trg_set_org_id before insert on public.pv_follow_ups
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_notifications;
create trigger trg_set_org_id before insert on public.pv_notifications
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_audit_events;
create trigger trg_set_org_id before insert on public.pv_audit_events
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_intake_conversations;
create trigger trg_set_org_id before insert on public.pv_intake_conversations
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_seriousness;
create trigger trg_set_org_id before insert on public.pv_seriousness
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_coding_suggestions;
create trigger trg_set_org_id before insert on public.pv_coding_suggestions
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_coding_history;
create trigger trg_set_org_id before insert on public.pv_coding_history
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_linelist_jobs;
create trigger trg_set_org_id before insert on public.pv_linelist_jobs
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_linelist_issues;
create trigger trg_set_org_id before insert on public.pv_linelist_issues
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_psur_documents;
create trigger trg_set_org_id before insert on public.pv_psur_documents
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_psur_findings;
create trigger trg_set_org_id before insert on public.pv_psur_findings
  for each row execute function public.set_pv_organization_id();
drop trigger if exists trg_set_org_id on public.pv_signals;
create trigger trg_set_org_id before insert on public.pv_signals
  for each row execute function public.set_pv_organization_id();

-- 5) Replace the open "demo workspace access" policies with org isolation --
do $$
declare
  t text;
begin
  foreach t in array array[
    'pv_cases','pv_follow_ups','pv_notifications','pv_audit_events',
    'pv_intake_conversations','pv_seriousness','pv_coding_suggestions',
    'pv_coding_history','pv_linelist_jobs','pv_linelist_issues',
    'pv_psur_documents','pv_psur_findings','pv_signals'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'demo workspace access', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id = public.current_org_id())',
      'org_isolation_select', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (organization_id = public.current_org_id())',
      'org_isolation_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (organization_id = public.current_org_id()) with check (organization_id = public.current_org_id())',
      'org_isolation_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (organization_id = public.current_org_id())',
      'org_isolation_delete', t
    );
    -- Anonymous, unauthenticated access is no longer permitted on operational data.
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
