CREATE TABLE public.pv_cases (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pv_follow_ups (
  id text PRIMARY KEY,
  case_id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pv_notifications (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pv_audit_events (
  id text PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL
);
CREATE TABLE public.pv_intake_conversations (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pv_seriousness (
  case_id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pv_coding_suggestions (
  id text PRIMARY KEY,
  case_id text NOT NULL,
  data jsonb NOT NULL
);
CREATE TABLE public.pv_coding_history (
  id text PRIMARY KEY,
  case_id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pv_linelist_jobs (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pv_linelist_issues (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  data jsonb NOT NULL
);
CREATE TABLE public.pv_psur_documents (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pv_psur_findings (
  id text PRIMARY KEY,
  document_id text NOT NULL,
  data jsonb NOT NULL
);
CREATE TABLE public.pv_signals (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pv_cases, public.pv_follow_ups, public.pv_notifications, public.pv_audit_events, public.pv_intake_conversations, public.pv_seriousness, public.pv_coding_suggestions, public.pv_coding_history, public.pv_linelist_jobs, public.pv_linelist_issues, public.pv_psur_documents, public.pv_psur_findings, public.pv_signals TO anon, authenticated;
GRANT ALL ON public.pv_cases, public.pv_follow_ups, public.pv_notifications, public.pv_audit_events, public.pv_intake_conversations, public.pv_seriousness, public.pv_coding_suggestions, public.pv_coding_history, public.pv_linelist_jobs, public.pv_linelist_issues, public.pv_psur_documents, public.pv_psur_findings, public.pv_signals TO service_role;

ALTER TABLE public.pv_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_intake_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_seriousness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_coding_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_coding_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_linelist_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_linelist_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_psur_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_psur_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pv_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demo workspace access" ON public.pv_cases FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_follow_ups FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_notifications FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_audit_events FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_intake_conversations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_seriousness FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_coding_suggestions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_coding_history FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_linelist_jobs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_linelist_issues FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_psur_documents FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_psur_findings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "demo workspace access" ON public.pv_signals FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);