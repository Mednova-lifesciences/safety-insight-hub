-- Record who finalized a C.1.7 decision by name, not only by user id, so the
-- E2B page and audit readers can see it. E2B only; no PSUR objects change.

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
    'reviewerId', actor.user_id, 'reviewerName', nullif(actor.full_name, ''),
    'reviewedAt', now_value, 'updatedAt', now_value);
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

revoke all on function public.finalize_e2b_c17_assessment(text,text,text) from public, anon;
grant execute on function public.finalize_e2b_c17_assessment(text,text,text) to authenticated;

-- Decisions made before this recorded only the reviewer's id.
update public.pv_e2b_regulatory_assessments a
set data = a.data || jsonb_build_object('reviewerName', p.full_name)
from public.profiles p
where a.data ? 'reviewerId'
  and not a.data ? 'reviewerName'
  and p.id::text = a.data->>'reviewerId'
  and nullif(p.full_name, '') is not null;
