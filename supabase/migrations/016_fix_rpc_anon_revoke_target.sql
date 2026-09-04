-- 015 revoked EXECUTE from the `public` pseudo-role, which was a no-op:
-- this project's default privileges (ALTER DEFAULT PRIVILEGES ... GRANT
-- EXECUTE ON FUNCTIONS TO anon, authenticated) grant EXECUTE to the anon
-- and authenticated roles directly at function-creation time, not via
-- PUBLIC. Verified live via has_function_privilege('anon', ...) still
-- returning true after 015. Revoking from the actual grantee roles here.

revoke execute on function public.get_organization_invite_code() from anon;
revoke execute on function public.delete_my_organization() from anon;
revoke execute on function public.protect_profile_privileged_columns() from anon, authenticated;
revoke execute on function public.log_public_case_audit() from anon, authenticated;
