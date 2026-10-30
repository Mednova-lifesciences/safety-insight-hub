-- Writes a PSUR's V4 pre-fill and nothing else, in one statement.
--
-- The pre-fill is an AI reading that runs whenever a report is opened and
-- can take a minute or more. It used to be saved by writing the whole
-- document back, so a reading that finished after someone else had saved
-- (seen on production: a peer reviewer's countersignature, 0.6 s before
-- the evaluator's page saved its pre-fill) put the older copy back and
-- erased their change. Setting only data.v4Prefill leaves every other
-- part of the document as it is in the database at that moment.
--
-- A failed reading never replaces a good earlier one (the same rule the
-- app applied before): the update is skipped and null is returned, as it
-- is when the document is not found or belongs to another organization.
--
-- SECURITY INVOKER: the caller's own row-level security (org_isolation_
-- update) decides which documents it can reach.
--
-- Rollback: supabase/rollbacks/20261030120000_psur_set_v4_prefill.rollback.sql

create or replace function public.psur_set_v4_prefill(
  p_document_id text,
  p_prefill jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_data jsonb;
begin
  update public.pv_psur_documents d
     set data = jsonb_set(d.data, '{v4Prefill}', p_prefill, true)
   where d.id = p_document_id
     and not (
       nullif(p_prefill ->> 'error', '') is not null
       and jsonb_typeof(d.data -> 'v4Prefill') = 'object'
       and nullif(d.data -> 'v4Prefill' ->> 'error', '') is null
     )
  returning d.data into v_data;
  return v_data;
end;
$$;

revoke all on function public.psur_set_v4_prefill(text, jsonb) from public, anon;
grant execute on function public.psur_set_v4_prefill(text, jsonb) to authenticated;
