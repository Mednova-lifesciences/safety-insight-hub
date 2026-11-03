-- Rollback of 20261103220000_pv_branches_and_registrations.sql. Deploy the
-- app version without the branch and registration registers first. Cases
-- keep their branch name, so report counts by branch still work from cases;
-- the audit trail keeps the record of every register change.
drop table if exists public.pv_registrations;
drop table if exists public.pv_branches;
