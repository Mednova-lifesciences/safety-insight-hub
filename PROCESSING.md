# Processing — Line-list, E2B(R3) and PSUR/PBRER, explained

This covers the three screens grouped under **Processing** in the app's sidebar
(`/line-list`, `/e2b`, `/psur`): what each term means in pharmacovigilance (PV),
why it exists, and exactly how this app handles it — including what's real
and what's a clearly-labelled demo stand-in for something we haven't licensed
or built yet.

The short version: a pharma company running drug safety operations has to
turn raw adverse-event data into two kinds of regulated output — individual
case reports (ICSRs) sent to regulators continuously, and periodic summary
reports sent on a schedule. Line-list processing and E2B(R3) preparation are
about the first. PSUR/PBRER review is about the second.

---

## 1. Line-list processing (`/line-list`)

### What a "line-list" is

A line-list is just a spreadsheet — one row per adverse event case, one
column per data field (patient ID, product, reaction, onset date,
seriousness, outcome, etc.). It's the format safety data most commonly
arrives in when it comes in bulk: a CRO hands over a study's safety data, a
partner company sends their local cases, a call-center export dumps a
month of reports. It is almost never clean. Columns are named differently
between sources, required fields are blank, dates are in three different
formats in the same file, and reaction terms are spelled however the person
who typed them felt like at the time.

Before any of those cases can become real ICSRs, the file has to be
checked, and every problem in it has to be visible — not silently guessed
at or dropped.

### The pipeline

The page shows eight stages: **Upload → Inspect columns → Map columns →
Normalise → Validate → Review issues → Generate E2B(R3) → Download XML.**
That's the intended full pipeline for a line-list job. Today the app
actually wires up and uses four of those stages end to end — **Upload**,
**Validate**, **Review issues**, and handing off to **Generate E2B(R3)** —
because those are the ones a reviewer actually needs to act on. Column
inspection/mapping and normalisation exist as API functions
(`linelist.inspect`, `linelist.map`, `linelist.normalize` in
`src/services/api/linelist.ts`) but nothing in the UI calls them yet.

**Upload** — pick a CSV/XLSX file. The app counts the rows and creates a
job record with stage `UPLOADED`. Nothing is parsed or validated yet.

**Validate** — re-runs validation for a job. Every row-level problem is
returned as an *issue*: which row, which column, `ERROR` or `WARNING`, a
code, a human-readable message, and the offending value. The job's valid /
invalid / warning counts update from that, and the stage moves to
`VALIDATED`.

**Review issues** — the full issue list for the selected job, so nothing
is hidden. A row with a missing reaction term, for example, shows up as an
`ERROR` on that exact row with the code `MISSING_REACTION` — not a vague
"3 problems found."

From here, a validated job is either clean (0 invalid cases) — ready to
move into E2B(R3) preparation — or it still has errors that need fixing at
the source before it can be exported.

### How the app actually stores this

Each line-list job and its issues are just rows in Supabase
(`pv_linelist_jobs`, `pv_linelist_issues`) written directly from the
browser once you're signed in — there's no separate backend processing
service in production right now. Every stage transition (upload, validate)
also writes an audit event, so `/audit` shows exactly who uploaded what and
when it was validated.

---

## 2. E2B(R3) preparation (`/e2b`)

### What E2B(R3) actually is

**E2B(R3)** is not our term — it's the international regulatory standard
(from ICH, the International Council for Harmonisation) for the XML
message format an Individual Case Safety Report has to be in before it can
be electronically submitted to a regulator: FDA's FAERS, EMA's
EudraVigilance, and equivalents elsewhere all expect ICSRs in this exact
structured format, not a PDF and not a spreadsheet. "R3" is just the
standard's third release, the one in current use. Producing a
schema-correct E2B(R3) file is table-stakes for any company doing
electronic safety reporting — it's the format the entire global
pharmacovigilance reporting system runs on.

### What this screen does

It takes a line-list job that's already been validated with **zero invalid
cases** and turns it into an E2B(R3)-shaped XML file. A job with any
invalid cases is visibly blocked — the **Generate E2B(R3)** button is
disabled and the screen says exactly why ("N invalid case(s) must be
resolved in line-list processing first"), rather than letting you export
something broken.

### The important honesty check: this is preparation, not transmission

The banner on the page says it outright: *"This product prepares and
generates E2B(R3) output. It does not transmit reports to any regulatory
authority. Submission requires a separately validated gateway
integration."* That's a real, intentional line, not a hedge:

- **Actually sending** a file to FDA/EMA requires a validated gateway
  connection (AS2, ESTRI/WebTrader, or a regulator-specific portal) with
  its own certification process — that's a whole separate integration this
  product does not attempt.
- **Coding** the reaction and drug terms to the licensed MedDRA/WHODrug
  dictionaries is a prerequisite for a submission-ready file, and this
  environment only has a small labelled demo dictionary (see the coding
  workspace inside any case) — not the real licensed one.

So what's generated here is a **structurally accurate E2B(R3) preparation
draft**: it has the right message header format, the right envelope shape,
and it's built from real, validated line-list data — but the file itself
carries a `DEMO/SANDBOX OUTPUT` comment at the top saying exactly that,
because it should never be mistaken for a submission-ready regulatory file.
Generating it also stamps the job `E2B_GENERATED` and writes an audit
event; **Download XML** then saves that exact file to your machine.

---

## 3. PSUR / PBRER review (`/psur`)

### What a PSUR/PBRER is

A **PSUR** (Periodic Safety Update Report) or **PBRER** (Periodic
Benefit-Risk Evaluation Report — the newer, ICH E2C(R2)-aligned name for
essentially the same document) is the other half of the regulatory
reporting obligation: instead of one report per case, it's a single
document a company has to submit on a schedule (often every 6 months to a
few years, depending on the product) summarising *everything* known about
a product's safety over that period — cumulative case counts, new signals,
label changes, and an overall benefit-risk conclusion. It's a long,
structured document (the one in this demo's second example is 42 pages)
with a set of sections regulators expect to find, in a specific shape.

### What this screen does

Upload a PDF, and the app checks it for the kinds of problems a reviewer
would otherwise have to hunt for by reading the whole thing: sections that
seem to be missing, numbers that don't reconcile between reporting
periods, and a reminder to cross-check the benefit-risk conclusion against
whatever's showing up in Signal review. Every finding is explicitly tagged
**"AI-generated review assistance"** in the interface, and nothing counts
as a real outcome until a human clicks **Accept finding** or **Dismiss** on
it — that decision, not the finding itself, is what gets treated as the
review result and written to the audit trail.

### How it's actually generated right now

There's no licensed document-intelligence service wired in yet, so this
doesn't do real PDF content extraction. What it does instead: it checks
the document's own declared metadata (filename, page count, reporting
period) against a fixed checklist of standard PSUR/PBRER sections (worldwide
marketing authorisation status, actions taken for safety reasons, summary
of safety concerns, signal and risk evaluation, benefit-risk analysis) and
raises findings deterministically from that — the same document always
produces the same findings. It's a placeholder for the real thing, built
so the *workflow* (upload → findings → human accept/dismiss → audit) is
completely real and exercised end to end, while being explicit that the
findings themselves aren't reading the actual document content yet.

---

## The thread connecting all three

Every one of these screens follows the same shape, deliberately:

1. **Something messy or unstructured comes in** — a spreadsheet, a PDF, a
   line-list.
2. **The system does the mechanical checking** — validation rules, section
   checklists, dictionary matching — and shows every result, not a
   summary.
3. **A human makes the call** — accept, reject, resolve, dismiss — and
   that decision is what actually changes the record.
4. **It's written down.** Every one of those actions — upload, validate,
   generate, accept, dismiss — writes an entry to `/audit`, attributed to
   the person who did it, with a timestamp and (where relevant) a reason.

That's the actual point of the "AI assists, rules validate, humans decide,
everything is auditable" line on the sign-in page — it's not a slogan, it's
what these three screens are built to enforce.
