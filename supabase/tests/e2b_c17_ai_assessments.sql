-- Database contract for AI evidence. AI rows cannot mutate regulatory rows.
begin;
select plan(5);
select has_table('public', 'pv_e2b_c17_ai_assessments', 'AI assessment history exists');
select has_function('public', 'save_e2b_c17_ai_assessment', ARRAY['text','text','text','text','text','text','text','text','text','text','text','text','jsonb'], 'AI persistence RPC exists');
select results_eq($$select has_table_privilege('authenticated', 'public.pv_e2b_c17_ai_assessments', 'INSERT')$$, $$values (false)$$, 'clients cannot insert AI rows directly');
select results_eq($$select has_table_privilege('authenticated', 'public.pv_e2b_c17_ai_assessments', 'UPDATE')$$, $$values (false)$$, 'clients cannot update AI rows directly');
select results_eq($$select has_table_privilege('authenticated', 'public.pv_e2b_c17_ai_assessments', 'DELETE')$$, $$values (false)$$, 'clients cannot delete AI rows directly');
select * from finish();
rollback;