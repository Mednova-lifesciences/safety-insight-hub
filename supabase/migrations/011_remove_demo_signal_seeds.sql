-- Migration 008 seeded three demo signals (sig-demo-0001/2/3) with fabricated
-- PRR/EBGM statistics and case counts, so the Signal review workspace had
-- something to show before real detection existed. Signal detection is now
-- a real computation (src/services/api/signals.ts: runDetection) that scans
-- pv_cases and writes genuinely-derived candidates, so these hand-authored
-- placeholders no longer belong in the table — leaving them in would mean a
-- fresh deployment still shows fake "demo detection" signals alongside real
-- ones. None of the three ever had a genuine human review recorded through
-- the app's own startReview/decide functions (their reviewer/rationale
-- fields were written directly by the seed migration, not through the
-- audited workflow), so removing them loses no real review history.
delete from public.pv_signals
where id in ('sig-demo-0001', 'sig-demo-0002', 'sig-demo-0003');
