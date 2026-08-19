-- Migration 006 applied the same four (select/insert/update/delete) policies
-- to every pv_* table uniformly, including pv_audit_events. That's wrong for
-- an audit trail: src/services/api/audit.ts already documents "The audit
-- trail is append-only: rows are inserted, never updated," and nothing in
-- the app ever updates or deletes an audit row — but until this migration
-- RLS still let any authenticated member of an organization silently
-- rewrite or erase that organization's own audit history. Restrict
-- pv_audit_events to select + insert only.

drop policy if exists "org_isolation_update" on public.pv_audit_events;
drop policy if exists "org_isolation_delete" on public.pv_audit_events;
revoke update, delete on public.pv_audit_events from authenticated;
