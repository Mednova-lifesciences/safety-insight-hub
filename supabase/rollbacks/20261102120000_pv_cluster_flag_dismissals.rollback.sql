-- Rollback of 20261102120000_pv_cluster_flag_dismissals.sql. Deploy the app
-- version without flag dismissals first. Dropping the table brings every
-- dismissed flag back; the audit trail keeps the record of each dismissal.
drop table if exists public.pv_cluster_flag_dismissals;
