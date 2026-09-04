-- Postgres grants EXECUTE on a new function to PUBLIC (which includes
-- `anon`) by default unless explicitly revoked — the security advisor
-- caught this on every function added in 013/014. Each one is safe by
-- construction (they key off auth.uid(), which is null for an anon
-- caller, so they return nothing / do nothing rather than leak or
-- delete), but a destructive, manager-gated RPC like
-- delete_my_organization() should never rely on internal logic alone
-- when an explicit grant boundary is just as easy. The two trigger
-- functions never need direct EXECUTE at all — triggers invoke them
-- internally regardless of grants — so PUBLIC execute on those is pure
-- unnecessary surface, not something intentionally offered.

revoke all on function public.get_organization_invite_code() from public;
grant execute on function public.get_organization_invite_code() to authenticated;

revoke all on function public.delete_my_organization() from public;
grant execute on function public.delete_my_organization() to authenticated;

revoke all on function public.protect_profile_privileged_columns() from public;
revoke all on function public.log_public_case_audit() from public;
