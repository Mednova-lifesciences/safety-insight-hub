-- One-time configuration for the SYNTHETIC test organisation
-- "MedNova TEST A (synthetic data only)" — the decisions an administrator
-- makes once per organisation, so the demo line lists can reach E2B
-- export. No case data. Idempotent; run with the service role / SQL editor.
--
--   - regulatory config (sender / receiver, report type, outcome codes),
--     the same values the demo organisation uses;
--   - the active C.1.7 rule, copied from the demo organisation;
--   - reporter designations → ICH C.2.r.4 qualification
--     (1 Physician, 3 Other health professional).

with test_org as (select id from public.organizations where slug = 'mednova-test-a'),
demo_org as (select id from public.organizations where name = 'Safety Insight Hub Demo')
insert into public.pv_regulatory_config (
  organization_id, environment, sender_organization, sender_identifier, sender_type,
  sender_person_responsible, receiver_organization, receiver_identifier, report_type,
  report_type_confirmed, case_id_prefix, outcome_codes, updated_at
)
select (select id from test_org), 'uat', 'NAFDAC (TEST)', 'NAFDAC', c.sender_type,
  c.sender_person_responsible, c.receiver_organization, c.receiver_identifier, c.report_type,
  c.report_type_confirmed, 'TST', c.outcome_codes, now()
from public.pv_regulatory_config c
where c.organization_id = (select id from demo_org)
on conflict (organization_id) do update set
  sender_organization = excluded.sender_organization,
  sender_identifier = excluded.sender_identifier,
  receiver_organization = excluded.receiver_organization,
  receiver_identifier = excluded.receiver_identifier,
  report_type = excluded.report_type,
  report_type_confirmed = excluded.report_type_confirmed,
  outcome_codes = excluded.outcome_codes,
  updated_at = now();

insert into public.pv_e2b_c17_rules (
  id, organization_id, version, name, jurisdiction, rule, status, supersedes_id,
  changed_by, changed_by_role, note, created_at
)
select 'c17-rule-test-a-1', (select id from public.organizations where slug = 'mednova-test-a'),
  '1.0', r.name, r.jurisdiction, r.rule, 'ACTIVE', null,
  'TEST Review Officer', 'REVIEW_OFFICER', 'Seeded for the synthetic test organisation.', now()
from public.pv_e2b_c17_rules r
where r.organization_id = (select id from public.organizations where name = 'Safety Insight Hub Demo')
  and r.status = 'ACTIVE'
on conflict (id) do nothing;

insert into public.pv_reporter_qualification_mappings (
  id, organization_id, designation, designation_key, qualification_code, created_at, updated_at
)
select 'rq-test-a-' || lower(replace(d.key, ' ', '-')),
  (select id from public.organizations where slug = 'mednova-test-a'), d.label, d.key, d.code, now(), now()
from (values
  ('Nurse', 'NURSE', '3'),
  ('Medical Officer', 'MEDICAL OFFICER', '1'),
  ('Other health professional', 'OTHER HEALTH PROFESSIONAL', '3')
) as d(label, key, code)
on conflict (organization_id, designation_key) do update set
  qualification_code = excluded.qualification_code, updated_at = now();
