-- Defense in depth: RLS already fully blocks anon on both tables (no
-- anon-scoped policy exists on either in 018_whatsapp_intake.sql), but
-- this project's default privileges grant anon full table access on
-- every new table regardless of RLS (the same surprise found earlier
-- with function EXECUTE grants in
-- 016_fix_rpc_anon_revoke_target.sql) — revoking explicitly rather than
-- relying on RLS alone for tables an anonymous webhook payload should
-- never be able to touch even indirectly.
revoke all on public.pv_intake_settings from anon;
revoke all on public.pv_intake_messages from anon;
