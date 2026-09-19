-- E2B C.1.7 trust boundary only. No PSUR objects are changed.

alter table public.pv_e2b_regulatory_assessments
  add column if not exists assessment_version integer not null default 1,
  add column if not exists supersedes_id text references public.pv_e2b_regulatory_assessments(id);

drop policy if exists "org_isolation_insert" on public.pv_e2b_regulatory_assessments;
drop policy if exists "org_isolation_update" on public.pv_e2b_regulatory_assessments;
drop policy if exists "org_isolation_delete" on public.pv_e2b_regulatory_assessments;
revoke insert, update, delete, truncate on public.pv_e2b_regulatory_assessments from anon, authenticated;

create or replace function public.e2b_c17_assert_actor()
returns table (user_id uuid, organization_id uuid, role text, full_name text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return query
    select p.id, p.organization_id, upper(p.role), coalesce(p.full_name, '')
    from public.profiles p
    where p.id = auth.uid()
      and upper(p.role) in ('REVIEW_OFFICER', 'EVALUATOR', 'PEER_REVIEWER');
  if not found then raise exception 'C.1.7 finalization role is not authorized'; end if;
end;
$$;

create or replace function public.save_e2b_c17_recommendation(
  p_assessment_id text,
  p_job_id text,
  p_case_id text,
  p_assessment jsonb,
  p_supersedes_id text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  actor_org uuid;
  actor_role text;
  existing jsonb;
  existing_job_id text;
  existing_case_id text;
  result jsonb := p_assessment || jsonb_build_object(
    'id', p_assessment_id,
    'organizationId', public.current_org_id(),
    'assessmentVersion', coalesce((p_assessment->>'assessmentVersion')::integer, 1),
    'updatedAt', now()
  );
begin
  if auth.uid() is null or public.current_org_id() is null then raise exception 'Authentication required'; end if;
  actor_org := public.current_org_id();
  select upper(role) into actor_role from public.profiles where id = auth.uid();
  -- Rule-agnostic: any versioned, non-retired rule is accepted so new rule
  -- versions or jurisdictions never need a schema change.
  if nullif(p_assessment->'rule'->>'ruleId', '') is null
     or nullif(p_assessment->'rule'->>'version', '') is null
     or coalesce(p_assessment->'rule'->>'status', '') = 'RETIRED' then
    raise exception 'Invalid C.1.7 rule metadata';
  end if;
  if p_assessment->>'status' is distinct from 'NEEDS_REVIEW' or p_assessment->>'recommendation' is distinct from 'NEEDS_REVIEW' then raise exception 'Only provisional recommendations may be saved'; end if;
  if p_assessment ?| array['finalDecision','reviewerId','reviewedAt'] then raise exception 'Recommendations cannot contain finalization fields'; end if;
  if p_assessment->'sourceSnapshot'->>'caseId' is distinct from p_case_id
     or jsonb_typeof(p_assessment->'sourceSnapshot'->'snapshot') is distinct from 'object'
     or nullif(p_assessment->'sourceSnapshot'->>'caseHash', '') is null then
    raise exception 'Recommendation source snapshot is incomplete';
  end if;
  select data, job_id, case_id into existing, existing_job_id, existing_case_id
    from public.pv_e2b_regulatory_assessments
    where id = p_assessment_id and organization_id = actor_org
    for update;
  if existing is not null and (existing->>'status' = 'FINALIZED' or existing ? 'finalDecision') then raise exception 'Finalized assessment is immutable'; end if;
  if existing is not null and (existing_job_id <> p_job_id or existing_case_id <> p_case_id) then raise exception 'Assessment identity cannot be changed'; end if;
  if existing is null then
    insert into public.pv_e2b_regulatory_assessments(id, organization_id, job_id, case_id, assessment_type, data, assessment_version, supersedes_id)
    values (p_assessment_id, actor_org, p_job_id, p_case_id, 'C1.7_EXPEDITED_REPORTING', result, (result->>'assessmentVersion')::integer, p_supersedes_id);
  else
    update public.pv_e2b_regulatory_assessments set data = result, updated_at = now() where id = p_assessment_id;
  end if;
  insert into public.pv_audit_events(id, organization_id, occurred_at, data)
  values (gen_random_uuid()::text, actor_org, now(), jsonb_build_object(
    'userId', auth.uid(), 'organizationId', actor_org, 'role', actor_role,
    'action', 'E2B_ASSESSMENT_RECOMMENDED', 'entity', 'E2bRegulatoryAssessment',
    'entityId', p_assessment_id, 'ruleId', result->'rule'->>'ruleId', 'ruleVersion', result->'rule'->>'version'));
  return result;
end;
$$;

create or replace function public.finalize_e2b_c17_assessment(
  p_assessment_id text, p_decision text, p_rationale text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  actor record;
  row_data jsonb;
  row_org uuid;
  next_data jsonb;
  now_value timestamptz := now();
begin
  select * into actor from public.e2b_c17_assert_actor();
  if p_decision is null or p_decision not in ('YES', 'NO') or nullif(trim(p_rationale), '') is null then raise exception 'Valid decision and rationale are required'; end if;
  select organization_id, data into row_org, row_data from public.pv_e2b_regulatory_assessments where id = p_assessment_id for update;
  if row_data is null then raise exception 'Assessment not found'; end if;
  if row_org <> actor.organization_id then raise exception 'Assessment belongs to another organization'; end if;
  if row_data->>'status' = 'FINALIZED' or row_data ? 'finalDecision' then raise exception 'Finalized assessment is immutable'; end if;
  if row_data->>'status' is distinct from 'NEEDS_REVIEW' or row_data->>'recommendation' is distinct from 'NEEDS_REVIEW' then raise exception 'Assessment is not eligible for finalization'; end if;
  if nullif(row_data->'rule'->>'ruleId', '') is null or nullif(row_data->'rule'->>'version', '') is null then raise exception 'Invalid C.1.7 rule metadata'; end if;
  if jsonb_typeof(row_data->'sourceSnapshot'->'snapshot') is distinct from 'object' or nullif(row_data->'sourceSnapshot'->>'caseHash', '') is null then raise exception 'Assessment source snapshot is incomplete'; end if;
  next_data := row_data || jsonb_build_object(
    'status', 'FINALIZED', 'finalDecision', p_decision, 'rationale', trim(p_rationale),
    'reviewerId', actor.user_id, 'reviewedAt', now_value, 'updatedAt', now_value);
  if row_data->>'recommendation' is not null and row_data->>'recommendation' <> p_decision then next_data := next_data || jsonb_build_object('overrideReason', trim(p_rationale)); end if;
  update public.pv_e2b_regulatory_assessments set data = next_data, updated_at = now_value where id = p_assessment_id;
  insert into public.pv_audit_events(id, organization_id, occurred_at, data)
  values (gen_random_uuid()::text, actor.organization_id, now_value, jsonb_build_object(
    'userId', actor.user_id, 'organizationId', actor.organization_id, 'role', actor.role,
    'action', 'E2B_ASSESSMENT_FINALIZED', 'entity', 'E2bRegulatoryAssessment', 'entityId', p_assessment_id,
    'previousDecision', row_data->'finalDecision', 'newDecision', p_decision,
    'ruleId', row_data->'rule'->>'ruleId', 'ruleVersion', row_data->'rule'->>'version', 'reason', trim(p_rationale)));
  return next_data;
end;
$$;

revoke all on function public.e2b_c17_assert_actor() from public, anon, authenticated;
revoke all on function public.save_e2b_c17_recommendation(text,text,text,jsonb,text) from public, anon;
revoke all on function public.finalize_e2b_c17_assessment(text,text,text) from public, anon;
grant execute on function public.save_e2b_c17_recommendation(text,text,text,jsonb,text) to authenticated;
grant execute on function public.finalize_e2b_c17_assessment(text,text,text) to authenticated;