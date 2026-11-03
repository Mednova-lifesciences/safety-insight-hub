-- Rollback of 20261103233000_pv_psur_drafts.sql. Deploy the app version
-- without PSUR drafting first. Dropping the table removes every saved draft;
-- export any draft that is still needed before running this.
drop table if exists public.pv_psur_drafts;
