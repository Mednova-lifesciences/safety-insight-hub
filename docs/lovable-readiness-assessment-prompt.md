PRODUCT: MedNova PV Readiness Assessment

I am building a lead-generation tool for MedNova PV Assist, a pharmacovigilance
operations platform. This is a standalone public assessment form that lets
pharma/biotech/CRO safety teams self-score their current pharmacovigilance
maturity, plus an internal admin dashboard where our team reviews submissions.

Do NOT reference SafetyCore. This is a separate MedNova-branded tool.

==================================================
1. PUBLIC ASSESSMENT FORM
==================================================

Route: /assessment

A multi-step form (progress indicator at top: Step 1 of 5, etc.), not one
giant page. Autosave answers in local state as the user progresses so nothing
is lost if they go back a step.

STEP 1 — Contact & Organization
- Full name (required)
- Work email (required, validate email format)
- Phone number (required)
- Job title / role (required)
- Company / organization name (required)
- Company type (select: Pharma manufacturer, Biotech, CRO, Medical device,
  Distributor/importer, Other)
- Company size (select: 1–50, 51–200, 201–1000, 1000+)
- Country / region of operation (required)

STEP 2 — Case Volume & Intake
- Approximate number of adverse event reports handled per month
  (select: <10, 10–50, 51–200, 200+)
- How do reports currently reach you? (multi-select: Email, Phone/call center,
  WhatsApp/SMS, Paper/fax, Field reps, Website form, Don't currently have a
  formal channel)
- Do you currently use a case management or safety database system?
  (Yes – named system / Yes – spreadsheets / No formal system)

STEP 3 — Triage & Coding Maturity
- How is seriousness (per ICH criteria) currently determined? (select:
  Dedicated trained reviewer, General staff without formal training,
  No consistent process)
- How confident are you that reported seriousness always matches narrative
  evidence? (1–5 scale)
- How are adverse events and drugs coded today? (select: MedDRA/WHODrug with
  trained coder, Coded but inconsistently, Not coded / free text only)
- Average time from case receipt to full coding completion (select: <1 day,
  1–3 days, 4–7 days, >7 days, Unknown)

STEP 4 — Line-Listing, E2B & PSUR
- How do you currently prepare line-listings for regulatory submission?
  (select: Structured software export, Manual Excel cleanup, No standard
  process)
- Can you currently generate E2B(R3)-compliant XML in-house? (Yes / No /
  Outsourced)
- How are PSUR/PBRER documents reviewed today? (select: Dedicated review
  workflow, Manual review by 1–2 people, Outsourced entirely, No formal
  process)
- Have you had any findings/observations in an audit or inspection related to
  case processing timeliness, coding accuracy, or documentation completeness
  in the last 2 years? (Yes / No / Not sure)

STEP 5 — Priorities
- What is your single biggest pharmacovigilance pain point right now?
  (open text, required)
- Which areas are you most interested in improving? (multi-select: Case
  intake & triage, MedDRA/WHODrug coding, Line-list & E2B automation,
  PSUR/PBRER review, Audit trail & compliance, Signal detection)
- How soon are you looking to act on this? (select: Immediately, Within
  1 quarter, Within 6 months, Just researching)

Each step has Back/Continue buttons. Validate required fields before
allowing Continue. Final step submit button reads "Get My Readiness Score".

==================================================
2. SCORING
==================================================

On submit, compute a simple weighted readiness score (0–100) from Steps 2–4
answers (mature/automated answers score higher, manual/absent processes score
lower). Bucket into three tiers:
- 0–40: "Foundational" (high gap, high urgency)
- 41–70: "Developing" (moderate gaps)
- 71–100: "Advanced" (few gaps, still show findings)

Also compute a per-category flag (Intake, Triage, Coding, Line-list/E2B,
PSUR) so weak areas are visible individually, not just as one number.

==================================================
3. CONFIRMATION CARD
==================================================

After submission, replace the form with a confirmation card (not a redirect):
- Checkmark icon, "Assessment received"
- Their readiness tier and score, shown as a simple visual gauge/badge
- 1–2 sentence summary naming their weakest category
- "Our team will follow up with your personalized report shortly."
- No further action required from the user on this screen.

==================================================
4. DESIGN DIRECTION
==================================================

Blue and white color system. Clean, clinical, professional — same design
language as enterprise healthcare/regulatory software (Linear, Stripe,
Vercel references). Primary blue for actions/progress/accents, white/light
gray backgrounds, dark slate text. No gradients, no playful illustrations,
no "AI magic" styling. Generous whitespace, clear step progress indicator,
readable form density. Fully responsive (mobile-first — many respondents
will fill this on a phone).

==================================================
5. SUPABASE BACKEND
==================================================

Set up Supabase integration (I will add my project credentials to .env
myself later — scaffold the client and env var references now).

Table: assessment_submissions
- id (uuid, primary key, default gen_random_uuid())
- created_at (timestamptz, default now())
- full_name (text)
- email (text)
- phone (text)
- job_title (text)
- company_name (text)
- company_type (text)
- company_size (text)
- region (text)
- monthly_case_volume (text)
- intake_channels (text[])
- has_case_system (text)
- seriousness_process (text)
- seriousness_confidence (int)
- coding_process (text)
- coding_turnaround (text)
- linelist_process (text)
- e2b_capability (text)
- psur_process (text)
- audit_findings (text)
- biggest_pain_point (text)
- improvement_areas (text[])
- urgency (text)
- readiness_score (int)
- readiness_tier (text)
- category_flags (jsonb)
- email_notified (boolean, default false)

Enable Row Level Security. Public/anon role: INSERT only, no SELECT/UPDATE/
DELETE. Admin reads happen through an authenticated Supabase user (the admin
dashboard), or a service-role edge function — do not expose submission data
to the anon/public role under any policy.

==================================================
6. EMAIL NOTIFICATION (Resend)
==================================================

Use a Supabase Edge Function triggered on new row insert into
assessment_submissions (via a database webhook), which calls the Resend API.
I will add my Resend API key and sender domain to .env myself later —
reference it as an env var, don't hardcode it.

Email content:
- Subject: "New PV Readiness Assessment: {{full_name}} from {{company_name}}"
- Body: "{{full_name}} just filled out your PV Readiness Assessment form.
  Click below to view their results."
- Button/link: "View Submission" → links to the admin login page
  (/admin/login)
- Send to a single fixed recipient address, read from an env var
  (ADMIN_NOTIFICATION_EMAIL), not hardcoded in code.

After a successful send, set email_notified = true on that row so it's
never double-sent.

==================================================
7. ADMIN DASHBOARD — "Welcome MedNova"
==================================================

Route: /admin/login → /admin/dashboard

This is a single hardcoded admin account (not the multi-role auth system
from the main MedNova PV Assist product — this is a separate, simple tool).
Login credentials (email + password) should be read from env vars
(ADMIN_EMAIL, ADMIN_PASSWORD) — I will fill these in later. Do not hardcode
real credentials in source; use env var references with obvious placeholder
values in .env.example.

Login page: centered card, "Welcome MedNova" heading, email + password
fields, Sign In button, blue/white styling matching the assessment form.

Dashboard (/admin/dashboard):
- Header: "Welcome MedNova" + sign out button
- Summary row: total submissions, submissions this week, breakdown by
  readiness tier (Foundational/Developing/Advanced counts)
- Submissions table: Name, Company, Email, Phone, Score, Tier, Biggest Pain
  Point (truncated), Submitted date — sortable by date and score, filterable
  by tier and by improvement area
- Search by name/company/email
- Clicking a row opens a detail view/drawer showing every answer from all
  5 steps, the full score breakdown by category, and contact details with a
  "mailto:" and "tel:" quick-action link
- Empty state when there are no submissions yet (not fake seeded rows)

==================================================
8. ENV VARS (reference these, do not hardcode real values)
==================================================

VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   (edge function only, never client-side)
RESEND_API_KEY              (edge function only)
ADMIN_NOTIFICATION_EMAIL
ADMIN_EMAIL
ADMIN_PASSWORD

==================================================
9. RULES
==================================================

Do not fake submission data anywhere in the admin dashboard — empty states
must be honest empty states.
Do not expose the service role key or Resend key to the client bundle.
Do not skip Supabase RLS — anon role is insert-only on the submissions table.
Keep this visually and structurally separate from the main MedNova PV Assist
product; this is a standalone lead-capture tool that happens to share the
MedNova brand.

Build the actual working form, Supabase wiring, edge function, and admin
dashboard now — don't just describe it.
