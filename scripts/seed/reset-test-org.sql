-- Clears the line lists, issues and PSURs of the SYNTHETIC test organisation
-- ONLY ("MedNova TEST A (synthetic data only)", slug mednova-test-a), so an
-- end-to-end run or the demo starts from the seed files. Configuration
-- (test-org-config.sql) and the audit trail are kept.
--
-- Guarded twice: by slug, and by the organisation name saying it is
-- synthetic. It cannot touch any other organisation's rows.

do $$
declare org uuid;
begin
  select id into org from public.organizations
  where slug = 'mednova-test-a' and name ilike '%synthetic data only%';
  if org is null then
    raise exception 'Test organisation not found — nothing deleted.';
  end if;

  delete from public.pv_linelist_issues where organization_id = org;
  delete from public.pv_linelist_jobs where organization_id = org;
  delete from public.pv_psur_findings where organization_id = org;
  delete from public.pv_psur_documents where organization_id = org;
  delete from public.pv_e2b_c17_ai_assessments where organization_id = org;
  delete from public.pv_e2b_regulatory_assessments where organization_id = org;
  delete from public.pv_signals where organization_id = org and data->>'source' = 'LINE_LIST';
  delete from public.pv_pms_referrals where organization_id = org;
  -- The coded demo files' term and designation choices (only theirs).
  delete from public.pv_term_mappings
  where organization_id = org and first_seen_file like 'DEMO-ondo-aefi%';
  delete from public.pv_reporter_qualification_mappings
  where organization_id = org
    and designation in ('Nursing Sister', 'RN/RM', 'SMO', 'Pharm. Tech', 'Mother of child', 'DSNO', 'LIO');
end $$;
