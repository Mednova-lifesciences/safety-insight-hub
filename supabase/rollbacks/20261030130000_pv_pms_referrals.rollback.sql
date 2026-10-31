-- Rollback of 20261030130000_pv_pms_referrals.sql. Deploy the app version
-- without post-market surveillance referrals first. Dropping the table
-- deletes every referral record: export them before running this.
drop table if exists public.pv_pms_referrals;
