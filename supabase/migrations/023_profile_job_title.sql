-- Let people maintain their own profile details.
--
-- Until now a profile carried a name, an email and (since 018) a phone
-- number, and only the name was editable in the UI. Assessors sign their
-- names to regulatory records, so keeping their own details current is
-- their business rather than an administrator's.
--
-- `job_title` is the one genuinely missing field: the NAFDAC sign-off block
-- identifies a person by their post as well as their name, and there was
-- nowhere to record it.

alter table public.profiles add column if not exists job_title text;

comment on column public.profiles.job_title is
  'Free-text post held by this person, e.g. "Senior Regulatory Officer". '
  'Shown alongside their name on assessment sign-offs.';

-- No RLS change is needed. profiles_own_update (migration 001) already
-- lets a person update their own row, and
-- trg_protect_profile_privileged_columns (migration 014) already blocks the
-- only two columns that must never be self-served — role and
-- organization_id. A new ordinary column is covered by both without
-- further work.
--
-- Email is deliberately NOT handled here. It is a sign-in credential, so it
-- changes through Supabase Auth (which mails a confirmation link), and the
-- profile row is only updated once that address actually works — see
-- updateProfile in src/lib/auth.tsx.
