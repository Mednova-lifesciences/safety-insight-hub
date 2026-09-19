-- Bulk C.1.7 finalization for E2B only. No PSUR objects are changed.
-- Delegates every row to finalize_e2b_c17_assessment so each case keeps the
-- same role check, immutability guard and per-case audit event. All-or-
-- nothing: if any case cannot be finalized, no case in the batch is.

create or replace function public.finalize_e2b_c17_assessments_bulk(
  p_assessment_ids text[], p_decision text, p_rationale text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  assessment_id text;
  results jsonb := '[]'::jsonb;
begin
  if p_assessment_ids is null or cardinality(p_assessment_ids) = 0 then
    raise exception 'At least one assessment is required';
  end if;
  if cardinality(p_assessment_ids) <> (select count(distinct x) from unnest(p_assessment_ids) as x) then
    raise exception 'Duplicate assessment ids are not allowed';
  end if;
  foreach assessment_id in array p_assessment_ids loop
    results := results || jsonb_build_array(
      public.finalize_e2b_c17_assessment(assessment_id, p_decision, p_rationale)
    );
  end loop;
  return results;
end;
$$;

revoke all on function public.finalize_e2b_c17_assessments_bulk(text[],text,text) from public, anon;
grant execute on function public.finalize_e2b_c17_assessments_bulk(text[],text,text) to authenticated;
