-- The coding workspace's "search dictionary" box previously queried
-- pv_coding_suggestions (per-case suggestion instances, always empty until
-- a suggestion exists) as if it were a MedDRA/WHODrug term dictionary. That
-- table was never a dictionary and nothing ever populated it, so search and
-- the coding-candidate list were always empty — this is the "dictionary
-- shows no data" bug.
--
-- This adds a real term-dictionary table. Dictionaries are shared reference
-- vocabulary, not tenant data, so it is read-only reference data (no
-- organization_id, no client writes) rather than another pv_* workspace
-- table. Every row is explicitly labelled as demo/sample data — this is
-- NOT a licensed MedDRA or WHODrug dataset and must never be presented as
-- one; see dictionary_version below.

create table if not exists public.pv_dictionary_terms (
  id text primary key,
  dictionary text not null check (dictionary in ('MedDRA', 'WHODrug')),
  dictionary_version text not null,
  kind text not null check (kind in ('DRUG', 'REACTION')),
  term text not null,
  code text not null,
  synonyms text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_pv_dictionary_terms_kind on public.pv_dictionary_terms(kind);
create index if not exists idx_pv_dictionary_terms_term on public.pv_dictionary_terms using gin (to_tsvector('english', term));

alter table public.pv_dictionary_terms enable row level security;

drop policy if exists "dictionary_read" on public.pv_dictionary_terms;
create policy "dictionary_read" on public.pv_dictionary_terms
  for select to authenticated using (true);

grant select on public.pv_dictionary_terms to authenticated;
revoke all on public.pv_dictionary_terms from anon;

-- Sample terms only, for demonstrating the coding workflow end to end.
-- dictionary_version is prefixed DEMO- so the UI (which renders
-- "{dictionary} {code} · {dictionaryVersion}") always shows this is not an
-- authoritative regulatory dictionary.
insert into public.pv_dictionary_terms (id, dictionary, dictionary_version, kind, term, code, synonyms) values
  ('meddra-demo-0001', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Rash', '10037844', array['skin rash','rash generalised','cutaneous eruption']),
  ('meddra-demo-0002', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Nausea', '10028813', array['feeling sick','queasy']),
  ('meddra-demo-0003', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Headache', '10019211', array['head pain','cephalalgia']),
  ('meddra-demo-0004', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Anaphylactic reaction', '10002198', array['anaphylaxis','anaphylactic shock']),
  ('meddra-demo-0005', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Pyrexia', '10037660', array['fever','elevated temperature']),
  ('meddra-demo-0006', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Dizziness', '10013573', array['lightheadedness','vertigo']),
  ('meddra-demo-0007', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Diarrhoea', '10012735', array['diarrhea','loose stools']),
  ('meddra-demo-0008', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Vomiting', '10047700', array['emesis','throwing up']),
  ('meddra-demo-0009', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Angioedema', '10002424', array['swelling of face','facial oedema']),
  ('meddra-demo-0010', 'MedDRA', 'DEMO-MedDRA-sample-27.0', 'REACTION', 'Hepatic failure', '10019663', array['liver failure']),
  ('whodrug-demo-0001', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Paracetamol', 'WD-00019101', array['acetaminophen','panadol','tylenol']),
  ('whodrug-demo-0002', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Amoxicillin', 'WD-00000601', array['amoxil']),
  ('whodrug-demo-0003', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Ibuprofen', 'WD-00040101', array['advil','nurofen']),
  ('whodrug-demo-0004', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Metformin', 'WD-00082201', array['glucophage']),
  ('whodrug-demo-0005', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Amlodipine', 'WD-00071301', array['norvasc']),
  ('whodrug-demo-0006', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Omeprazole', 'WD-00090501', array['losec','prilosec']),
  ('whodrug-demo-0007', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Ciprofloxacin', 'WD-00010801', array['cipro']),
  ('whodrug-demo-0008', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Atorvastatin', 'WD-00088801', array['lipitor']),
  ('whodrug-demo-0009', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Sertraline', 'WD-00095501', array['zoloft']),
  ('whodrug-demo-0010', 'WHODrug', 'DEMO-WHODrug-sample-2025Q3', 'DRUG', 'Insulin glargine', 'WD-00082901', array['lantus'])
on conflict (id) do nothing;
