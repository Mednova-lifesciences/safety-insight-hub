-- Fixes three issues in 012_org_codes_and_public_intake.sql, found by
-- automated security review immediately after that migration shipped:
--
-- 1. CRITICAL — credential exposure. `organizations` already carried a
--    pre-existing `org_public_read` policy (`using (true)`, no `to`
--    clause — applies to every role). Adding `invite_code` as a plain
--    column on that same table meant anyone, unauthenticated, could read
--    every organization's private invite code and join any company as a
--    PV_COORDINATOR. Column-level GRANTs (independent of row-level
--    security) now restrict anon/authenticated to exactly the columns
--    that were always meant to be public.
--
-- 2. CRITICAL — insufficient entropy. 012's backfill derived invite_code
--    from the organization's own name and id prefix — both effectively
--    public — making it guessable rather than a real secret. Every
--    existing organization gets a cryptographically random code here
--    (concatenated gen_random_uuid() output — no extension dependency).
--    The demo organization is deliberately kept on a fixed, well-known
--    code afterwards, same tier as its published demo password.
--
-- 3. HIGH — audit log integrity. Anon had INSERT on `pv_audit_events`
--    with a client-supplied `data` jsonb blob and no validation — any
--    caller could fabricate arbitrary audit history for any
--    organization, not just a record of their own case submission. The
--    anon grant is removed entirely; the audit row for a public
--    submission is now written server-side by a trigger on `pv_cases`,
--    with fixed, non-spoofable content.

update organizations
set invite_code = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

update organizations set invite_code = 'DEMO-0000' where slug = 'demo';

revoke select on public.organizations from anon, authenticated;
grant select (id, name, slug) on public.organizations to anon, authenticated;

drop policy if exists "public_field_associate_audit" on public.pv_audit_events;
revoke insert on public.pv_audit_events from anon;

create or replace function public.log_public_case_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    insert into public.pv_audit_events (id, occurred_at, organization_id, data)
    values (
      'ae-' || gen_random_uuid()::text,
      now(),
      new.organization_id,
      jsonb_build_object(
        'id', 'ae-' || gen_random_uuid()::text,
        'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'user', 'Field Associate',
        'role', 'FIELD_ASSOCIATE',
        'action', 'CASE_CREATED',
        'entity', 'Case',
        'entityId', new.id,
        'newValue', coalesce(new.data->>'product', 'Unspecified product')
          || ' / ' || coalesce(new.data->>'reaction', 'Unspecified reaction'),
        'reason', 'ICSR captured through the public field-associate link'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_public_case_audit on public.pv_cases;
create trigger trg_log_public_case_audit after insert on public.pv_cases
  for each row execute function public.log_public_case_audit();
