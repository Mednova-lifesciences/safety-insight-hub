-- Generic AI-assisted E2B C.1.7 assessment history only.
-- This table never stores or writes the human regulatory final decision.

create table if not exists public.pv_e2b_c17_ai_assessments (
  id text primary key,
  organization_id uuid not null references public.organizations(id),
  assessment_id text references public.pv_e2b_regulatory_assessments(id),
  case_id text not null,
  input_snapshot_hash text not null,
  input_version text not null,
  rule_id text not null,
  rule_version text not null,
  provider text not null,
  model text,
  model_version text,
  prompt_version text not null,
  status text not null check (status in ('COMPLETED', 'INVALID_OUTPUT', 'UNAVAILABLE', 'STALE')),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_e2b_c17_ai_case
  on public.pv_e2b_c17_ai_assessments(organization_id, case_id, created_at);

alter table public.pv_e2b_c17_ai_assessments enable row level security;
create policy "org_isolation_select" on public.pv_e2b_c17_ai_assessments
  for select to authenticated using (organization_id = public.current_org_id());
revoke insert, update, delete, truncate on public.pv_e2b_c17_ai_assessments from anon, authenticated;

create or replace function public.save_e2b_c17_ai_assessment(
  p_ai_assessment_id text,
  p_regulatory_assessment_id text,
  p_case_id text,
  p_input_snapshot_hash text,
  p_input_version text,
  p_rule_id text,
  p_rule_version text,
  p_provider text,
  p_model text,
  p_model_version text,
  p_prompt_version text,
  p_status text,
  p_data jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
 declare
  actor_org uuid;
  result jsonb;
 begin
  if auth.uid() is null or public.current_org_id() is null then
    raise exception 'Authentication required';
  end if;
  if p_rule_id is null or p_rule_version is null or p_input_snapshot_hash is null then
    raise exception 'AI assessment provenance is required';
  end if;
  if p_status not in ('COMPLETED', 'INVALID_OUTPUT', 'UNAVAILABLE', 'STALE') then
    raise exception 'Invalid AI assessment status';
  end if;
  if p_data ?| array['finalDecision', 'fulfilsExpeditedCriteria', 'exportAuthorized', 'overrideReason', 'humanDecision'] then
    raise exception 'AI assessment cannot contain regulatory decision or authorization fields';
  end if;
  if p_data->>'caseId' is distinct from p_case_id
     or p_data->>'inputSnapshotHash' is distinct from p_input_snapshot_hash
     or p_data->>'ruleId' is distinct from p_rule_id
     or p_data->>'ruleVersion' is distinct from p_rule_version
     or p_data->>'provider' is distinct from p_provider then
    raise exception 'AI assessment provenance does not match trusted parameters';
  end if;
  actor_org := public.current_org_id();
  if p_regulatory_assessment_id is not null and not exists (
    select 1 from public.pv_e2b_regulatory_assessments
    where id = p_regulatory_assessment_id and organization_id = actor_org
  ) then
    raise exception 'Linked regulatory assessment not found in this organization';
  end if;
  result := p_data || jsonb_build_object(
    'id', p_ai_assessment_id,
    'caseId', p_case_id,
    'inputSnapshotHash', p_input_snapshot_hash,
    'inputVersion', p_input_version,
    'ruleId', p_rule_id,
    'ruleVersion', p_rule_version,
    'provider', p_provider,
    'status', p_status,
    'createdAt', now()
  );
  insert into public.pv_e2b_c17_ai_assessments(
    id, organization_id, assessment_id, case_id, input_snapshot_hash,
    input_version, rule_id, rule_version, provider, model, model_version,
    prompt_version, status, data
  ) values (
    p_ai_assessment_id, actor_org, p_regulatory_assessment_id, p_case_id, p_input_snapshot_hash,
    p_input_version, p_rule_id, p_rule_version, p_provider, p_model, p_model_version,
    p_prompt_version, p_status, result
  );
  insert into public.pv_audit_events(id, organization_id, occurred_at, data)
  values (gen_random_uuid()::text, actor_org, now(), jsonb_build_object(
    'userId', auth.uid(), 'organizationId', actor_org,
    'action', 'E2B_C17_AI_ASSESSMENT_RECORDED',
    'entity', 'E2bC17AiAssessment', 'entityId', p_ai_assessment_id,
    'caseId', p_case_id, 'ruleId', p_rule_id, 'ruleVersion', p_rule_version,
    'provider', p_provider, 'model', p_model, 'promptVersion', p_prompt_version));
  return result;
 end;
$$;

revoke all on function public.save_e2b_c17_ai_assessment(text,text,text,text,text,text,text,text,text,text,text,text,jsonb) from public, anon;
grant execute on function public.save_e2b_c17_ai_assessment(text,text,text,text,text,text,text,text,text,text,text,text,jsonb) to authenticated;
