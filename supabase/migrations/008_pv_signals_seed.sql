-- pv_signals had zero rows, so the Signal review workspace was always
-- empty and there was nothing to exercise the DETECTED/review/confirm-
-- refute workflow with. Seeds a small set of demo signals (organization_id
-- is filled by the trg_set_org_id trigger from migration 006, resolving to
-- the sole existing organization since these inserts run under the
-- migration's own connection, not a user session — so it's set directly).
insert into public.pv_signals (id, organization_id, data)
select
  'sig-demo-0001',
  o.id,
  jsonb_build_object(
    'id', 'sig-demo-0001',
    'reference', 'SIG-2026-0001',
    'product', 'Paracetamol',
    'reaction', 'Rash',
    'detectionMethod', 'Disproportionality (PRR) — demo detection',
    'detectionPeriod', 'Q3 2026',
    'caseCount', 1,
    'statistic', jsonb_build_array(
      jsonb_build_object('name', 'PRR', 'value', '2.4', 'ci', '95% CI 1.1-3.9')
    ),
    'supportingCaseIds', jsonb_build_array('MN-2026-900001'),
    'status', 'POTENTIAL'
  )
from public.organizations o
order by o.created_at limit 1
on conflict (id) do nothing;

insert into public.pv_signals (id, organization_id, data)
select
  'sig-demo-0002',
  o.id,
  jsonb_build_object(
    'id', 'sig-demo-0002',
    'reference', 'SIG-2026-0002',
    'product', 'Ibuprofen',
    'reaction', 'Gastrointestinal haemorrhage',
    'detectionMethod', 'Disproportionality (EBGM) — demo detection',
    'detectionPeriod', 'Q2 2026',
    'caseCount', 3,
    'statistic', jsonb_build_array(
      jsonb_build_object('name', 'EB05', 'value', '1.9')
    ),
    'supportingCaseIds', jsonb_build_array(),
    'status', 'UNDER_REVIEW',
    'reviewer', 'PV Manager'
  )
from public.organizations o
order by o.created_at limit 1
on conflict (id) do nothing;

insert into public.pv_signals (id, organization_id, data)
select
  'sig-demo-0003',
  o.id,
  jsonb_build_object(
    'id', 'sig-demo-0003',
    'reference', 'SIG-2026-0003',
    'product', 'Amoxicillin',
    'reaction', 'Anaphylactic reaction',
    'detectionMethod', 'Disproportionality (PRR) — demo detection',
    'detectionPeriod', 'Q1 2026',
    'caseCount', 2,
    'statistic', jsonb_build_array(
      jsonb_build_object('name', 'PRR', 'value', '3.6', 'ci', '95% CI 2.0-5.8')
    ),
    'supportingCaseIds', jsonb_build_array(),
    'status', 'CONFIRMED',
    'reviewer', 'PV Manager',
    'rationale', 'Confirmed after literature review and case-by-case causality assessment; regulatory notification filed separately.',
    'decidedAt', '2026-06-01T00:00:00Z'
  )
from public.organizations o
order by o.created_at limit 1
on conflict (id) do nothing;
