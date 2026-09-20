-- The C.1.7 expedited-reporting rule, kept as versioned data an assessor
-- can change, and the recommendation it produces.
--
-- Until now the rule was provisional and every case was NEEDS_REVIEW. The
-- rule now recommends YES or NO; a qualified assessor still finalizes each
-- case, and a recommendation can never finalize itself. E2B only — no PSUR
-- objects change.

create table if not exists public.pv_e2b_c17_rules (
  id text primary key,
  organization_id uuid not null references public.organizations(id),
  version text not null,
  name text not null,
  jurisdiction text not null,
  rule jsonb not null,
  status text not null check (status in ('ACTIVE', 'SUPERSEDED')),
  supersedes_id text references public.pv_e2b_c17_rules(id),
  changed_by text not null,
  changed_by_role text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pv_e2b_c17_rules_org
  on public.pv_e2b_c17_rules(organization_id, created_at desc);
-- One active rule per organization, whatever order changes arrive in.
create unique index if not exists idx_pv_e2b_c17_rules_one_active
  on public.pv_e2b_c17_rules(organization_id) where status = 'ACTIVE';

drop trigger if exists trg_set_org_id on public.pv_e2b_c17_rules;
create trigger trg_set_org_id before insert on public.pv_e2b_c17_rules
  for each row execute function public.set_pv_organization_id();

alter table public.pv_e2b_c17_rules enable row level security;

-- Everyone in the organization may read the rule their cases are judged by;
-- only the trusted function writes it.
create policy "org_isolation_select" on public.pv_e2b_c17_rules
  for select to authenticated using (organization_id = public.current_org_id());
revoke all on public.pv_e2b_c17_rules from anon;
revoke insert, update, delete, truncate on public.pv_e2b_c17_rules from anon, authenticated;

/** Saves a new version of the rule and makes it the active one. Only the
 *  qualified assessor roles may call it (e2b_c17_assert_actor), and the
 *  previous version is kept, superseded, never overwritten. */
create or replace function public.save_e2b_c17_rule(
  p_rule jsonb, p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  actor record;
  previous_id text;
  new_id text := 'c17-rule-' || gen_random_uuid()::text;
  now_value timestamptz := now();
begin
  select * into actor from public.e2b_c17_assert_actor();
  if nullif(p_rule->>'version', '') is null or nullif(p_rule->>'name', '') is null then
    raise exception 'The rule needs a name and a version';
  end if;
  if jsonb_typeof(p_rule->'criteria') <> 'object' then
    raise exception 'The rule needs its criteria';
  end if;

  select id into previous_id from public.pv_e2b_c17_rules
    where organization_id = actor.organization_id and status = 'ACTIVE' for update;
  update public.pv_e2b_c17_rules set status = 'SUPERSEDED'
    where id = previous_id;

  insert into public.pv_e2b_c17_rules(
    id, organization_id, version, name, jurisdiction, rule, status,
    supersedes_id, changed_by, changed_by_role, note, created_at
  ) values (
    new_id, actor.organization_id, p_rule->>'version', p_rule->>'name',
    coalesce(p_rule->>'jurisdiction', ''), p_rule, 'ACTIVE',
    previous_id, coalesce(nullif(actor.full_name, ''), actor.user_id::text), actor.role,
    nullif(trim(coalesce(p_note, '')), ''), now_value
  );

  insert into public.pv_audit_events(id, organization_id, occurred_at, data)
  values (gen_random_uuid()::text, actor.organization_id, now_value, jsonb_build_object(
    'userId', actor.user_id, 'organizationId', actor.organization_id, 'role', actor.role,
    'action', 'E2B_C17_RULE_CHANGED', 'entity', 'E2bC17Rule', 'entityId', new_id,
    'previousValue', previous_id, 'newValue', p_rule->>'name' || ' v' || (p_rule->>'version'),
    'reason', nullif(trim(coalesce(p_note, '')), '')));

  return jsonb_build_object(
    'id', new_id, 'status', 'ACTIVE', 'rule', p_rule,
    'changedBy', coalesce(nullif(actor.full_name, ''), actor.user_id::text),
    'changedByRole', actor.role, 'createdAt', now_value, 'supersedesId', previous_id);
end;
$$;

revoke all on function public.save_e2b_c17_rule(jsonb, text) from public, anon;
grant execute on function public.save_e2b_c17_rule(jsonb, text) to authenticated;

-- A recommendation may now be YES or NO, not only NEEDS_REVIEW. What may
-- NOT change is who decides: status stays NEEDS_REVIEW until a qualified
-- assessor finalizes it, and finalization fields still cannot be saved
-- with a recommendation.
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
  if nullif(p_assessment->'rule'->>'ruleId', '') is null
     or nullif(p_assessment->'rule'->>'version', '') is null
     or coalesce(p_assessment->'rule'->>'status', '') = 'RETIRED' then
    raise exception 'Invalid C.1.7 rule metadata';
  end if;
  if p_assessment->>'status' is distinct from 'NEEDS_REVIEW' then raise exception 'A recommendation is never a decision'; end if;
  if p_assessment->>'recommendation' not in ('YES', 'NO', 'NEEDS_REVIEW') then raise exception 'Invalid C.1.7 recommendation'; end if;
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
    'entityId', p_assessment_id, 'recommendation', result->>'recommendation',
    'ruleId', result->'rule'->>'ruleId', 'ruleVersion', result->'rule'->>'version'));
  return result;
end;
$$;

-- Finalization: a case carrying a YES/NO recommendation is now eligible,
-- and a decision that differs from the recommendation is recorded as an
-- override, as before.
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
  if row_data->>'status' is distinct from 'NEEDS_REVIEW' then raise exception 'Assessment is not eligible for finalization'; end if;
  if row_data->>'recommendation' not in ('YES', 'NO', 'NEEDS_REVIEW') then raise exception 'Assessment is not eligible for finalization'; end if;
  if nullif(row_data->'rule'->>'ruleId', '') is null or nullif(row_data->'rule'->>'version', '') is null then raise exception 'Invalid C.1.7 rule metadata'; end if;
  if jsonb_typeof(row_data->'sourceSnapshot'->'snapshot') is distinct from 'object' or nullif(row_data->'sourceSnapshot'->>'caseHash', '') is null then raise exception 'Assessment source snapshot is incomplete'; end if;
  next_data := row_data || jsonb_build_object(
    'status', 'FINALIZED', 'finalDecision', p_decision, 'rationale', trim(p_rationale),
    'reviewerId', actor.user_id, 'reviewerName', nullif(actor.full_name, ''),
    'reviewedAt', now_value, 'updatedAt', now_value);
  if row_data->>'recommendation' is not null and row_data->>'recommendation' <> p_decision then next_data := next_data || jsonb_build_object('overrideReason', trim(p_rationale)); end if;
  update public.pv_e2b_regulatory_assessments set data = next_data, updated_at = now_value where id = p_assessment_id;
  insert into public.pv_audit_events(id, organization_id, occurred_at, data)
  values (gen_random_uuid()::text, actor.organization_id, now_value, jsonb_build_object(
    'userId', actor.user_id, 'organizationId', actor.organization_id, 'role', actor.role,
    'action', 'E2B_ASSESSMENT_FINALIZED', 'entity', 'E2bRegulatoryAssessment', 'entityId', p_assessment_id,
    'recommendation', row_data->>'recommendation', 'newDecision', p_decision,
    'ruleId', row_data->'rule'->>'ruleId', 'ruleVersion', row_data->'rule'->>'version', 'reason', trim(p_rationale)));
  return next_data;
end;
$$;

/** Finalizes several cases, each with the decision the rule recommended
 *  for it. One action by a qualified assessor, still one audited decision
 *  per case. A case the rule could not decide is refused — those need a
 *  person's own YES or NO. */
create or replace function public.finalize_e2b_c17_as_recommended(
  p_assessment_ids text[], p_rationale text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  assessment_id text;
  recommendation text;
  results jsonb := '[]'::jsonb;
begin
  if p_assessment_ids is null or cardinality(p_assessment_ids) = 0 then
    raise exception 'At least one assessment is required';
  end if;
  foreach assessment_id in array p_assessment_ids loop
    select data->>'recommendation' into recommendation
      from public.pv_e2b_regulatory_assessments where id = assessment_id;
    if recommendation not in ('YES', 'NO') then
      raise exception 'The rule did not decide every case; those need your own decision';
    end if;
    results := results || jsonb_build_array(
      public.finalize_e2b_c17_assessment(assessment_id, recommendation, p_rationale)
    );
  end loop;
  return results;
end;
$$;

revoke all on function public.finalize_e2b_c17_as_recommended(text[],text) from public, anon;
grant execute on function public.finalize_e2b_c17_as_recommended(text[],text) to authenticated;
revoke all on function public.finalize_e2b_c17_assessment(text,text,text) from public, anon;
grant execute on function public.finalize_e2b_c17_assessment(text,text,text) to authenticated;
revoke all on function public.save_e2b_c17_recommendation(text,text,text,jsonb,text) from public, anon;
grant execute on function public.save_e2b_c17_recommendation(text,text,text,jsonb,text) to authenticated;
