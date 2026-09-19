-- pgTAP security contract for E2B C.1.7.
-- Run with `supabase db test` against a migrated local database.
-- This file intentionally contains no Nigerian regulatory criteria.

begin;
select plan(13);

select has_table('public', 'pv_e2b_regulatory_assessments', 'assessment table exists');
select has_column('public', 'pv_e2b_regulatory_assessments', 'assessment_version', 'version linkage exists');
select has_column('public', 'pv_e2b_regulatory_assessments', 'supersedes_id', 'historical linkage exists');
select has_function('public', 'finalize_e2b_c17_assessment', ARRAY['text', 'text', 'text'], 'trusted finalization RPC exists');
select has_function('public', 'save_e2b_c17_recommendation', ARRAY['text', 'text', 'text', 'jsonb', 'text'], 'trusted recommendation RPC exists');
select has_policy('public', 'pv_e2b_regulatory_assessments', 'org_isolation_select', 'organization read isolation exists');

select results_eq(
  $$select has_table_privilege('authenticated', 'public.pv_e2b_regulatory_assessments', 'INSERT')$$,
  $$values (false)$$,
  'authenticated clients cannot insert assessment rows directly'
);
select results_eq(
  $$select has_table_privilege('authenticated', 'public.pv_e2b_regulatory_assessments', 'UPDATE')$$,
  $$values (false)$$,
  'authenticated clients cannot update assessment rows directly'
);
select results_eq(
  $$select has_table_privilege('authenticated', 'public.pv_e2b_regulatory_assessments', 'DELETE')$$,
  $$values (false)$$,
  'authenticated clients cannot delete assessment rows directly'
);
select results_eq(
  $$select has_function_privilege('authenticated', 'public.finalize_e2b_c17_assessment(text,text,text)', 'EXECUTE')$$,
  $$values (true)$$,
  'authenticated clients can only use the trusted finalization operation'
);

select has_function('public', 'finalize_e2b_c17_assessments_bulk', ARRAY['text[]', 'text', 'text'], 'bulk finalization RPC exists');
select results_eq(
  $$select has_function_privilege('authenticated', 'public.finalize_e2b_c17_assessments_bulk(text[],text,text)', 'EXECUTE')$$,
  $$values (true)$$,
  'authenticated clients can use the trusted bulk finalization operation'
);
select results_eq(
  $$select has_function_privilege('anon', 'public.finalize_e2b_c17_assessments_bulk(text[],text,text)', 'EXECUTE')$$,
  $$values (false)$$,
  'anonymous clients cannot finalize in bulk'
);

select * from finish();
rollback;