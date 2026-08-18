# Safety Insight Hub

I am building a pharmacovigilance application called MedNova PV Assist.

IMPORTANT:

This is a separate product. Do NOT reference, reuse, or mention SafetyCore or any previous SafetyCore project.

I have an existing Python backend/processing project that already contains the core pharmacovigilance engines. I want you to build the COMPLETE WEB APPLICATION FRONTEND around those existing Python capabilities.

Do NOT replace the Python processing logic with fake frontend logic.

Do NOT create fake AI responses.

Do NOT hardcode results just to make the UI appear functional.

The frontend should be designed so that I can later clone the Lovable project locally and connect it to a FastAPI layer that exposes the existing Python modules.

==================================================

1. PRODUCT

==================================================

Product name:

MedNova PV Assist

Purpose:

A human-in-the-loop pharmacovigilance operations platform that assists safety teams with:

1. ICSR seriousness triage

2. MedDRA / WHODrug coding assistance

3. Messy line-list cleaning and E2B(R3) XML preparation

4. PSUR/PBRER review assistance

The system is NOT intended to silently make regulatory decisions.

The fundamental product principle is:

AI assists.

Rules validate.

Humans decide.

Every important action is auditable.

Nothing should silently modify an official safety record.

==================================================

2. EXISTING PYTHON BACKEND

==================================================

The existing Python project contains these major modules:

pv_assist/

    audit.py

    llm.py

    seriousness/

    coding/

    linelist/

    psur/

There is also sample data and an examples/run_all.py script demonstrating the workflows.

The frontend must be designed as a client of these existing capabilities.

Do NOT duplicate these algorithms in TypeScript.

Instead create clean API/service boundaries so the Python implementation can later be exposed through FastAPI.

==================================================

3. RECOMMENDED ARCHITECTURE

==================================================

Frontend:

React

TypeScript

Tailwind CSS

shadcn/ui

Backend integration:

FastAPI API layer around the existing Python modules.

The frontend should communicate with the backend through service functions such as:

/api/cases

/api/seriousness/analyze

/api/coding/suggest

/api/linelist/upload

/api/linelist/validate

/api/e2b/generate

/api/psur/upload

/api/psur/review

/api/audit

These endpoints are interface contracts for now.

Do not fake successful backend calls.

If an endpoint is not connected yet, show a clear loading/empty/unavailable state rather than inventing data.

==================================================

4. DESIGN DIRECTION

==================================================

This is a professional pharmacovigilance application.

Design it like enterprise regulatory/safety software.

References:

- Linear

- Stripe

- Vercel

- modern enterprise healthcare software

- professional pharmacovigilance systems

Avoid:

- flashy AI aesthetics

- excessive gradients

- childish dashboards

- unnecessary animations

- excessive cards

- fake "AI magic" language

The interface should feel:

clinical

professional

controlled

auditable

trustworthy

efficient

modern

Use strong typography, restrained color, clear status indicators and dense but readable information layouts.

==================================================

5. AUTHENTICATION

==================================================

Create role-based authentication architecture.

Roles:

PV FIELD ASSOCIATE

PV COORDINATOR

PV MANAGER

The UI must dynamically change based on role.

Do not simply create three cosmetic buttons.

Create a proper auth/session abstraction:

useAuth()

useCurrentUser()

useRole()

Navigation and permissions must be role-aware.

==================================================

6. FIELD ASSOCIATE WORKSPACE

==================================================

Create the Field Associate workspace.

Primary purpose:

Capture and prepare incoming safety information.

Navigation should include:

Dashboard

New ICSR

My Cases

Case Detail

WhatsApp Intake

Follow-ups

Notifications

Audit / Activity

Field Associate dashboard should show:

- assigned cases

- cases requiring attention

- new intake

- follow-ups

- serious cases requiring attention

- overdue tasks

- recent activity

==================================================

7. NEW ICSR

==================================================

Create a professional ICSR intake form.

Explain the workflow visually.

The form should capture the minimum information required to establish a valid Individual Case Safety Report.

Include:

Reporter information

Patient information

Suspect product

Adverse event/reaction

Narrative

Seriousness

Dates

Outcome

Additional information

The UI should clearly distinguish:

Required

Optional

Needs review

Suggested

Validated

After submission:

New ICSR

→ Validation

→ Triage

→ Coding

→ Review

→ QC

→ Regulatory readiness

The frontend must preserve the case ID and workflow state.

==================================================

8. CASE WORKBENCH

==================================================

Create a case list with:

Case ID

Patient

Product

Reaction

Seriousness

Outcome

Status

Assigned user

Received date

Due date

Priority

Include:

Search

Filters

Status filters

Seriousness filters

Date filters

Assignment filters

Clicking a case opens the case detail workspace.

==================================================

9. CASE DETAIL

==================================================

Create a full professional safety-case workspace.

Sections:

Case header

Patient

Reporter

Product

Reaction/event

Narrative

Seriousness

Coding

Outcome

Follow-up

Workflow status

Audit trail

Show a workflow progress indicator:

INTAKE

→ TRIAGE

→ CODING

→ REVIEW

→ QC

→ REGULATORY READY

→ CLOSED

Each step should clearly show:

completed

current

blocked

requires action

==================================================

10. SERIOUSNESS ASSIST

==================================================

Create a dedicated seriousness review component.

The existing Python engine analyses whether the narrative indicates seriousness.

The UI must show:

Reported seriousness

Narrative assessment

Potential mismatch

Evidence

ICH seriousness criterion

Example:

Reported:

Non-serious

Narrative:

"Patient was admitted to hospital for observation."

Result:

Potential seriousness mismatch

Reason:

Narrative contains evidence consistent with hospitalization.

Buttons:

Review

Accept reported classification

Mark as serious

Request more information

IMPORTANT:

Never automatically change the official case value.

This is an assistive flag requiring human review.

==================================================

11. CODING ASSIST

==================================================

Create a coding workspace.

Sections:

Drug/Product coding

Reaction coding

For each suggestion show:

Term

Code

Dictionary

Dictionary version

Match type

Confidence

Evidence

Possible actions:

Accept

Reject

Choose another

Search dictionary

IMPORTANT:

The LLM must NEVER invent MedDRA or WHODrug codes.

The backend will provide candidates from the actual dictionary.

The frontend should make it clear that suggestions are recommendations requiring human confirmation.

Include coding history.

==================================================

12. WHATSAPP / INBOUND INTAKE

==================================================

Create an intake inbox architecture.

The screen should show:

Conversation list

Reporter

Last message

Potential case status

Missing information

Consent status

Minimum ICSR criteria

Conversation view:

Messages

Extracted information

Missing information

Case qualification

Convert to ICSR

Show four minimum criteria clearly:

Reporter

Patient

Suspect product

Adverse event

If all four are present:

"Minimum ICSR information available"

Allow:

Create ICSR

If information is missing:

Request information

==================================================

13. LINE-LIST PROCESSOR

==================================================

Create a dedicated workspace:

Line-list Processing

Flow:

Upload CSV/XLSX

↓

Inspect columns

↓

Map columns

↓

Normalize data

↓

Validation

↓

Review issues

↓

Generate E2B(R3)

↓

Download XML

Show validation errors clearly.

Examples:

Invalid date

Missing patient identifier

Unrecognized reaction

Invalid product

Column mismatch

Missing required value

Never hide validation problems.

==================================================

14. E2B(R3)

==================================================

Create an E2B preparation screen.

Show:

Case count

Valid cases

Invalid cases

Validation warnings

XML readiness

Then:

Generate E2B(R3)

The UI should clearly distinguish:

Prepared

Validated

Ready for export

Do NOT claim that the system transmitted a regulatory report unless a real gateway is connected.

This product currently prepares/generates E2B(R3)-shaped output; regulatory transmission must remain a separate integration.

==================================================

15. PSUR / PBRER REVIEW

==================================================

Create:

PSUR/PBRER Review

Flow:

Upload PDF

↓

Extract document

↓

Identify sections

↓

Check completeness

↓

Check consistency

↓

Review findings

↓

Human assessment

Show:

Document metadata

Reporting period

Detected sections

Missing sections

Consistency warnings

Numerical discrepancies

Signal-related findings

Benefit-risk areas requiring attention

Clearly label AI-generated/review-assistance content.

Never present the system as making the final regulatory assessment.

==================================================

16. MANAGER WORKSPACE

==================================================

Create a manager dashboard.

Show:

Total cases

Open cases

Serious cases

Overdue cases

Cases awaiting review

Coding backlog

Seriousness flags

Signals

PSUR/PBRER reviews

Recent audit activity

Include operational charts where useful.

Avoid meaningless charts.

The manager should be able to drill into:

Cases

Seriousness flags

Coding

Line-list jobs

Signals

Reports

Audit history

==================================================

17. SIGNAL / SAFETY REVIEW

==================================================

Create a signal workspace architecture.

Show:

Potential signals

Under review

Confirmed

Refuted

Historical

For each signal:

Signal reference

Product

Reaction

Detection method

Detection period

Case count

Statistical evidence

Supporting cases

Status

Reviewer

Rationale

Manager actions:

Start review

Confirm

Refute

Confirmation/refutation must require rationale.

After decision:

The item must leave the active review queue.

Confirmed signal:

→ appears in confirmed signals

→ rationale is displayed

→ supporting cases are accessible

→ review decision is recorded

Refuted signal:

→ disappears from pending queue

→ appears in historical/refuted records

→ rationale is preserved

==================================================

18. AUDIT TRAIL

==================================================

Every meaningful regulated action must have an audit event.

Create a reusable audit timeline component.

Show:

Timestamp

User

Role

Action

Entity

Previous value

New value

Reason/rationale

Examples:

Case created

Case edited

Seriousness reviewed

Coding accepted

Coding rejected

Follow-up requested

Signal confirmed

Signal refuted

E2B generated

PSUR reviewed

The frontend should make auditability visible.

==================================================

19. NOTIFICATIONS

==================================================

Create notification center.

Examples:

New case assigned

Seriousness mismatch

Follow-up due

Case overdue

Coding required

Manager review required

Signal requires review

PSUR review completed

Line-list validation failed

==================================================

20. SECURITY

==================================================

This application handles personal health information.

Do not expose sensitive information unnecessarily.

Use:

role-based access

secure API calls

no secrets in frontend

no API keys in client code

clear session handling

protected routes

appropriate error handling

Backend secrets must remain server-side.

==================================================

21. API ABSTRACTION

==================================================

Create a clean frontend API layer.

Example:

src/services/api/

    cases.ts

    seriousness.ts

    coding.ts

    linelist.ts

    e2b.ts

    psur.ts

    audit.ts

    signals.ts

Example:

seriousness.analyzeCase(caseId)

coding.getSuggestions(caseId)

linelist.upload(file)

linelist.validate(jobId)

e2b.generate(jobId)

psur.upload(file)

psur.review(documentId)

The actual FastAPI implementation will be connected after the frontend is cloned locally.

==================================================

22. IMPORTANT DEVELOPMENT RULES

==================================================

Do NOT create fake backend functionality.

Do NOT invent medical/regulatory codes.

Do NOT silently change safety data.

Do NOT claim regulatory transmission when there is no gateway.

Do NOT expose API keys.

Do NOT create fake "AI results" simply to make screens look functional.

Use realistic seeded demo data only where necessary for the UI.

Clearly separate:

REAL BACKEND RESULT

DEMO DATA

PENDING INTEGRATION

But do not put "DEMO" everywhere in the actual product interface unless it is necessary for safety/clarity.

==================================================

23. BUILD ORDER

==================================================

Build in this order:

PHASE 1

Authentication

Role system

App shell

Navigation

Dashboard

PHASE 2

ICSR intake

Case workbench

Case detail

Workflow state

PHASE 3

Seriousness review

Coding workspace

Audit trail

PHASE 4

WhatsApp intake

Follow-ups

Notifications

PHASE 5

Line-list processor

Validation

E2B preparation

PHASE 6

PSUR/PBRER review

PHASE 7

Signal workspace

Manager review

PHASE 8

Polish

Responsive design

Loading states

Empty states

Error states

Accessibility

Security hardening

==================================================

24. FINAL REQUIREMENT

==================================================

Before finishing, ensure the frontend has a clean architecture that can be cloned locally and connected to a Python FastAPI backend without rewriting the UI.

The final project should feel like a real enterprise pharmacovigilance platform, not a collection of disconnected screens.

Build the actual application experience now.

Do not spend time explaining what you are going to build.

Start implementing the frontend.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0b7e067a-270f-4e5e-9c3f-064ce773443b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
