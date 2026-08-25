# Public Adverse Event Intake Portal — Design

## Context

MedNova Lifesciences produced a technical hand-off blueprint
(`src/types/mednova-technical-handoff-blueprint.docx`) describing five
digital assets to integrate with SafetyCore, plus four GxP compliance
requirements. This spec covers one of those four requirements (3.4 in
the blueprint): a lightweight, public, unauthenticated web portal so
patients or clinicians can submit an adverse event report directly,
without needing a SafetyCore login.

The other four items from the blueprint (readiness-assessment lead
capture, literature screener pipeline, PV Academy/LMS, dual-signature
finalization, investor deck) are out of scope for this spec — each is
an independent sub-project to be brainstormed and spec'd separately.

### What already exists

SafetyCore already has an internal, authenticated intake pipeline:

- `pv_intake_conversations` table (JSON `data` blob per conversation),
  currently only populated by a `WHATSAPP` channel.
- `/intake` and `/intake/$conversationId` routes (under the
  authenticated `_app` layout) let Field Associates / PV Coordinators
  review conversations, see ICSR-criteria completeness
  (reporter/patient/product/event), request more information, and
  convert a conversation into a case via
  `POST /api/intake/conversations/{id}/convert`
  (`src/server/routes/compatibility.py`).
- All privileged writes go through the FastAPI backend
  (`src/server/`) using a service-role Supabase client — the frontend
  never talks to Supabase directly for these tables.

The gap is purely the public-facing entry point: nothing today lets a
patient or clinician create an intake conversation without logging in.

## Goals

- A public, unauthenticated form at `/report` for submitting an
  adverse event.
- Submissions land in the same review/promote pipeline staff already
  use — no parallel review UI, no parallel "convert to case" code
  path.
- Reasonable abuse resistance for an endpoint that, by definition,
  accepts writes from anyone on the internet.

## Non-goals

- MedDRA/WHO Drug dictionary autocomplete on the public form (that's
  an internal coding step staff already perform later in the
  pipeline).
- Multi-organization / per-tenant public portals. This ships scoped to
  a single organization (MedNova's), via a server-side env var.
- CAPTCHA integration (kept dependency-free for now; flagged as a
  fast-follow if spam becomes a real problem).
- Any change to the existing WhatsApp intake flow or the `/convert`
  endpoint's behavior.

## Architecture

```
Public visitor (no auth)
        |
        v
  /report  (new route, outside the authenticated _app layout)
        |  POST
        v
  POST /api/public/intake   (new FastAPI router, no auth dependency)
        |  writes via existing service-role Supabase client
        v
  pv_intake_conversations   (channel = "WEB_FORM", status = "NEW",
                              organization_id = PUBLIC_INTAKE_ORG_ID)
        |
        v
  /intake inbox  ---review, request info---  /convert  --->  pv_cases
  (existing, authenticated, unmodified)
```

The public endpoint is additive: it produces a row shaped exactly like
a WhatsApp-sourced conversation, so every downstream screen and
permission check (`intake.manage`) keeps working without modification.

## Components

1. **`src/routes/report.tsx`** (new) — public form page, rendered
   outside `_app/` so it is not subject to the `useAuth` gate in
   `src/routes/_app.tsx`. Plain page chrome, no dashboard nav.

2. **`src/server/routes/public_intake.py`** (new router) — a single
   `POST /` handler, mounted in `main.py` as:
   ```python
   app.include_router(public_intake.router, prefix="/api/public", tags=["public-intake"])
   ```
   Deliberately has **no** `Depends(get_current_user)`. This is the
   only unauthenticated write endpoint in the backend, so it gets its
   own file rather than living in `compatibility.py`, to keep the
   "no auth required" surface area easy to audit.

3. **`src/types/pv.ts`** — widen
   `IntakeConversation["channel"]` from the literal `"WHATSAPP"` to
   `"WHATSAPP" | "WEB_FORM"`.

4. **Source badge** — wherever `SourceTag`/channel is rendered in the
   intake inbox and conversation-detail views, add the `WEB_FORM` case
   so staff can see at a glance which conversations came from the
   public portal vs. WhatsApp.

No new database table or migration is required for the core flow —
the existing `pv_intake_conversations` JSON `data` column already
holds everything the form collects (reporter, patient, criteria,
messages, consent, status).

## Data flow / form fields

The form collects structured fields that map onto the existing
`criteria` model (`reporter`, `patient`, `product`, `event`) so the
inbox's completeness indicator ("Minimum ICSR information available")
works unchanged for web-sourced conversations:

- **Reporter**: name, contact (email or phone), relationship to
  patient, explicit consent-to-contact checkbox — stored as
  `consent: "GRANTED" | "DECLINED"`, never defaulted or inferred.
- **Patient**: age, sex, weight (optional).
- **Product**: suspect medicine name(s), free text.
- **Event**: what happened (free text), onset date.

On submit, the backend synthesizes a single inbound `IntakeMessage`
from the structured answers (concatenated into readable prose) so the
conversation renders naturally in the existing detail view alongside
real WhatsApp threads, and computes `criteria`/`missing` the same way
the WhatsApp path does.

## Security & abuse handling

This endpoint is the first place in the app that accepts a write from
an unauthenticated caller, so it needs protections the rest of the
backend doesn't:

- **Honeypot field**: a hidden input real users never see or fill;
  any submission with it populated is silently accepted (200 response)
  but dropped without writing a row, so bots can't tell they were
  filtered.
- **Per-IP rate limiting**: a simple in-memory sliding-window limiter
  (e.g. N submissions per IP per hour) on the endpoint. No new
  dependency (`slowapi` etc.) needed at current scale.
- **Server-side validation only**: required fields and plausible
  value ranges (e.g. age, dates) are checked server-side; the endpoint
  never trusts client-side validation alone.
- **No information leakage**: validation/rate-limit failures return a
  generic error — the endpoint never reveals whether an organization
  ID exists or exposes internal identifiers.
- **`PUBLIC_INTAKE_ORG_ID`** is a server-only env var; it is never
  sent to or read from the client.

## Testing

- Backend unit tests for `POST /api/public/intake`: happy path,
  honeypot-triggered silent drop, rate-limit rejection, missing
  required field rejection.
- Manual end-to-end pass: submit the public form → confirm the
  conversation appears in `/intake` tagged `WEB_FORM` → convert it →
  confirm the resulting case looks correct.

## Open questions for implementation time

None outstanding — this design was reviewed and approved in chat
before writing this spec.
