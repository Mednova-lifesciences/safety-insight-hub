# Public Adverse Event Intake Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a patient or clinician submit an adverse event report at a public, unauthenticated `/report` page, landing it in the same intake-review-and-convert pipeline SafetyCore staff already use for WhatsApp conversations.

**Architecture:** A new unauthenticated FastAPI endpoint (`POST /api/public/intake`) writes a `pv_intake_conversations` row tagged `channel: "WEB_FORM"`, using the existing service-role Supabase client. No new database table, no new review UI, no change to the existing `/convert` endpoint — the row is shaped so the existing `/intake` inbox and `/intake/conversations/{id}/convert` pipeline pick it up unmodified. A new public route (`src/routes/report.tsx`, outside the authenticated `_app` layout) hosts the form.

**Tech Stack:** FastAPI (Python) backend, TanStack Start / React (TypeScript) frontend, Supabase (Postgres via REST), pytest (new — first backend test suite in this repo) + FastAPI `TestClient`, vitest (existing frontend test runner).

**Spec:** `docs/superpowers/specs/2026-08-25-public-ae-intake-portal-design.md`

## Global Constraints

- New endpoint is `POST /api/public/intake` and MUST NOT have any auth dependency (`Depends(get_current_user)` etc.) — it is the only unauthenticated write endpoint in the backend, by design.
- New public route is `/report`, defined outside `src/routes/_app/` so it is not subject to the `useAuth` gate in `src/routes/_app.tsx`.
- New conversations use `channel: "WEB_FORM"`. `pv_intake_conversations.criteria` keys are exactly `reporter`, `patient`, `product`, `event` (existing contract).
- The existing `/convert` endpoint (`src/server/routes/compatibility.py`) reads `extracted` entries by exact `field` string: `"Patient"`, `"Suspect product"`, `"Adverse event"`. New rows MUST use these exact strings or a converted case will show "Unknown"/"Unspecified" values.
- Org scoping is single-tenant for this feature: a server-only env var `PUBLIC_INTAKE_ORG_ID` (never sent to the client). No per-org routing.
- No CAPTCHA, no new rate-limiting dependency (no `slowapi` etc.) — a simple in-memory per-IP sliding window is sufficient at current scale, per spec.
- Pydantic request field names are camelCase, matching every other body/schema in `src/server/` (e.g. `weightKg`, `consentToContact`, `onsetDate` in `src/server/routes/cases.py`) and the frontend's `src/types/pv.ts` — not Python-idiomatic snake_case.

## Known limitation (documented, not fixed here)

`convert_intake_conversation` in `src/server/routes/compatibility.py` hardcodes the resulting case's `"source": "WHATSAPP"` regardless of the originating conversation's `channel`. The spec's non-goals explicitly exclude changing `/convert`'s behavior, so a case converted from a `WEB_FORM` conversation will still show `source: "WHATSAPP"`. This is a pre-existing endpoint limitation, not something this plan introduces — flag it to the user as a fast-follow if it matters for reporting/filtering.

---

### Task 1: Backend — public intake endpoint

**Files:**
- Create: `src/server/routes/public_intake.py`
- Modify: `src/server/main.py` (mount the new router)
- Modify: `.env.example` (document `PUBLIC_INTAKE_ORG_ID`)
- Modify: `requirements.txt` (add `pytest`)
- Test: `tests/server/test_public_intake.py`

**Interfaces:**
- Consumes: `get_supabase_client()` from `src/server/db.py` — `async def query(table: str, method: str = "GET", filters: Optional[dict] = None, data: Optional[dict] = None, select: Optional[str] = None) -> list`.
- Produces: `router` (FastAPI `APIRouter`), mounted at `/api/public` so the live path is `POST /api/public/intake`. Also exposes `RATE_LIMIT_MAX_REQUESTS: int` and `_rate_limit_store: dict[str, list[float]]` for tests to reset/inspect.

- [ ] **Step 1: Add pytest to `requirements.txt`**

Open `requirements.txt` and add, near the other dev/runtime deps:

```
pytest>=8.0
```

- [ ] **Step 2: Install it**

Run: `pip install pytest`

- [ ] **Step 3: Write the failing tests**

Create `tests/server/test_public_intake.py`:

```python
"""Tests for the public, unauthenticated adverse-event intake endpoint.

Uses an isolated FastAPI app that only mounts this one router, and a
fake Supabase client, so these tests never touch a real database and
don't require the full app's env vars (SUPABASE_URL etc.) to import.
"""

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("PUBLIC_INTAKE_ORG_ID", "test-org-123")

from src.server.routes import public_intake  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limit_store():
    public_intake._rate_limit_store.clear()
    yield
    public_intake._rate_limit_store.clear()


@pytest.fixture
def recorded_inserts(monkeypatch):
    inserts = []

    class FakeSupabaseClient:
        async def query(self, table, method="GET", filters=None, data=None, select=None):
            if method == "POST":
                inserts.append((table, data))
            return [data] if data else []

    monkeypatch.setattr(public_intake, "get_supabase_client", lambda: FakeSupabaseClient())
    return inserts


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(public_intake.router, prefix="/api/public")
    return TestClient(app)


VALID_PAYLOAD = {
    "reporterName": "Jane Doe",
    "reporterContact": "jane@example.com",
    "relationshipToPatient": "Self",
    "consent": True,
    "patientAge": "34",
    "patientSex": "FEMALE",
    "patientWeightKg": "61",
    "suspectProduct": "Amoxicillin",
    "reactionDescription": "Facial swelling and difficulty breathing",
    "onsetDate": "2026-08-20",
    "website": "",
}


def test_valid_submission_writes_a_conversation_row(client, recorded_inserts):
    response = client.post("/api/public/intake", json=VALID_PAYLOAD)

    assert response.status_code == 201
    assert response.json() == {"status": "received"}
    assert len(recorded_inserts) == 1
    table, row = recorded_inserts[0]
    assert table == "pv_intake_conversations"
    assert row["organization_id"] == "test-org-123"
    assert row["data"]["channel"] == "WEB_FORM"
    assert row["data"]["consent"] == "GRANTED"
    assert row["data"]["criteria"] == {
        "reporter": True,
        "patient": True,
        "product": True,
        "event": True,
    }
    extracted = {e["field"]: e["value"] for e in row["data"]["extracted"]}
    assert extracted["Suspect product"] == "Amoxicillin"
    assert extracted["Adverse event"] == "Facial swelling and difficulty breathing"


def test_honeypot_filled_drops_submission_silently(client, recorded_inserts):
    payload = {**VALID_PAYLOAD, "website": "http://spam.example"}

    response = client.post("/api/public/intake", json=payload)

    assert response.status_code == 201
    assert response.json() == {"status": "received"}
    assert recorded_inserts == []


def test_missing_required_field_is_rejected(client, recorded_inserts):
    payload = {**VALID_PAYLOAD}
    del payload["reactionDescription"]

    response = client.post("/api/public/intake", json=payload)

    assert response.status_code == 422
    assert recorded_inserts == []


def test_declined_consent_is_still_recorded(client, recorded_inserts):
    payload = {**VALID_PAYLOAD, "consent": False}

    response = client.post("/api/public/intake", json=payload)

    assert response.status_code == 201
    assert recorded_inserts[0][1]["data"]["consent"] == "DECLINED"


def test_rate_limit_blocks_after_max_requests(client, recorded_inserts):
    for _ in range(public_intake.RATE_LIMIT_MAX_REQUESTS):
        response = client.post("/api/public/intake", json=VALID_PAYLOAD)
        assert response.status_code == 201

    response = client.post("/api/public/intake", json=VALID_PAYLOAD)

    assert response.status_code == 429
    assert len(recorded_inserts) == public_intake.RATE_LIMIT_MAX_REQUESTS


def test_unconfigured_org_id_returns_503(client, recorded_inserts, monkeypatch):
    monkeypatch.delenv("PUBLIC_INTAKE_ORG_ID", raising=False)

    response = client.post("/api/public/intake", json=VALID_PAYLOAD)

    assert response.status_code == 503
    assert recorded_inserts == []
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `python -m pytest tests/server/test_public_intake.py -v`
Expected: FAIL/ERROR — `ModuleNotFoundError: No module named 'src.server.routes.public_intake'` (the module doesn't exist yet).

- [ ] **Step 5: Write the implementation**

Create `src/server/routes/public_intake.py`:

```python
"""Public, unauthenticated adverse-event intake endpoint.

This is the only endpoint in the backend with no auth dependency, by
design — see
docs/superpowers/specs/2026-08-25-public-ae-intake-portal-design.md.
Kept in its own file (not compatibility.py) so the "no auth required"
surface area stays a single file to audit.
"""

import os
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from ..db import get_supabase_client

router = APIRouter()

RATE_LIMIT_MAX_REQUESTS = 5
RATE_LIMIT_WINDOW_SECONDS = 3600
_rate_limit_store: dict[str, list[float]] = defaultdict(list)


def _is_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    window_start = now - RATE_LIMIT_WINDOW_SECONDS
    timestamps = [t for t in _rate_limit_store[ip] if t > window_start]
    timestamps.append(now)
    _rate_limit_store[ip] = timestamps
    return len(timestamps) > RATE_LIMIT_MAX_REQUESTS


class PublicIntakeSubmission(BaseModel):
    reporterName: str = Field(min_length=1, max_length=200)
    reporterContact: str = Field(min_length=1, max_length=200)
    relationshipToPatient: str = Field(min_length=1, max_length=200)
    consent: bool
    patientAge: Optional[str] = Field(default=None, max_length=20)
    patientSex: Optional[str] = Field(default=None, max_length=20)
    patientWeightKg: Optional[str] = Field(default=None, max_length=20)
    suspectProduct: str = Field(min_length=1, max_length=500)
    reactionDescription: str = Field(min_length=1, max_length=4000)
    onsetDate: Optional[str] = Field(default=None, max_length=20)
    # Honeypot: real users never see or fill this field. Any non-empty
    # value means the submission is automated — accept silently, write
    # nothing, so bots can't tell they were filtered.
    website: str = Field(default="")


def _build_conversation_data(submission: PublicIntakeSubmission) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    message_body = (
        f"Reporter: {submission.reporterName} ({submission.relationshipToPatient}). "
        f"Patient: age {submission.patientAge or 'not stated'}, "
        f"sex {submission.patientSex or 'not stated'}. "
        f"Suspect product: {submission.suspectProduct}. "
        f"Reaction: {submission.reactionDescription}"
        + (f" Onset: {submission.onsetDate}." if submission.onsetDate else "")
    )
    criteria = {
        "reporter": bool(submission.reporterName and submission.reporterContact),
        "patient": bool(submission.patientAge or submission.patientSex),
        "product": bool(submission.suspectProduct),
        "event": bool(submission.reactionDescription),
    }
    missing = []
    if not criteria["reporter"]:
        missing.append("Reporter information")
    if not criteria["patient"]:
        missing.append("Patient information")
    if not criteria["product"]:
        missing.append("Product information")
    if not criteria["event"]:
        missing.append("Adverse event description")

    return {
        "id": f"web-{uuid.uuid4().hex[:10]}",
        "channel": "WEB_FORM",
        "reporterName": submission.reporterName,
        "reporterNumberMasked": submission.reporterContact,
        "lastMessage": message_body,
        "lastMessageAt": now,
        "consent": "GRANTED" if submission.consent else "DECLINED",
        "criteria": criteria,
        "status": "NEW",
        "messages": [
            {"id": "m1", "direction": "INBOUND", "at": now, "body": message_body}
        ],
        "extracted": [
            {"field": "Reporter", "value": submission.reporterName},
            {
                "field": "Patient",
                "value": f"{submission.patientAge or '?'} / {submission.patientSex or '?'}",
            },
            {"field": "Suspect product", "value": submission.suspectProduct},
            {"field": "Adverse event", "value": submission.reactionDescription},
        ],
        "missing": missing,
    }


@router.post("/intake", status_code=status.HTTP_201_CREATED)
async def submit_public_intake(submission: PublicIntakeSubmission, request: Request):
    org_id = os.getenv("PUBLIC_INTAKE_ORG_ID", "").strip()
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Public intake is not configured",
        )

    client_ip = request.client.host if request.client else "unknown"
    if _is_rate_limited(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many submissions. Please try again later.",
        )

    if submission.website.strip():
        return {"status": "received"}

    data = _build_conversation_data(submission)
    now = datetime.now(timezone.utc).isoformat()
    await get_supabase_client().query(
        "pv_intake_conversations",
        method="POST",
        data={
            "id": data["id"],
            "organization_id": org_id,
            "data": data,
            "created_at": now,
            "updated_at": now,
        },
    )
    return {"status": "received"}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/server/test_public_intake.py -v`
Expected: PASS (6 passed).

- [ ] **Step 7: Mount the router**

In `src/server/main.py`, add `public_intake` to the routes import:

```python
from .routes import auth, cases, seriousness, coding, audit, signals, followups, compatibility, public_intake
```

Immediately after the `compatibility.router` include line, add:

```python
app.include_router(public_intake.router, prefix="/api/public", tags=["public-intake"])
```

- [ ] **Step 8: Document the new env var**

In `.env.example`, add:

```
# Server-side only — never exposed to the browser. Organization the
# public adverse-event intake form (/report) writes new conversations
# into. Leave unset to disable the endpoint (it returns 503).
PUBLIC_INTAKE_ORG_ID=
```

- [ ] **Step 9: Verify the whole server still imports**

Run: `python -c "import sys; sys.path.insert(0, '.'); from src.server import main"` from the repo root, with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set in the environment (or in `.env` if `main.py` loads it — check for `load_dotenv()`; if absent, export them inline for this check only, e.g. `SUPABASE_URL=x SUPABASE_SERVICE_ROLE_KEY=y python -c "..."`).
Expected: no import error (confirms `public_intake` wired in cleanly).

- [ ] **Step 10: Commit**

```bash
git add requirements.txt src/server/routes/public_intake.py src/server/main.py .env.example tests/server/test_public_intake.py
git commit -m "feat: add public unauthenticated adverse-event intake endpoint"
```

---

### Task 2: Frontend — widen the intake channel type and show it in the UI

**Files:**
- Modify: `src/types/pv.ts:256`
- Modify: `src/routes/_app/intake.index.tsx`
- Modify: `src/routes/_app/intake.$conversationId.tsx:48`

**Interfaces:**
- Consumes: nothing new.
- Produces: `IntakeConversation["channel"]` now includes `"WEB_FORM"`, which Task 5's submission flow and any future channel-aware code can rely on.

- [ ] **Step 1: Widen the type**

In `src/types/pv.ts`, change line 256:

```ts
  channel: "WHATSAPP";
```

to:

```ts
  channel: "WHATSAPP" | "WEB_FORM";
```

- [ ] **Step 2: Verify the type change compiles**

Run: `npx tsc --noEmit`
Expected: no new errors (this is a widening change, so nothing that already matches `"WHATSAPP"` breaks).

- [ ] **Step 3: Show the channel in the intake inbox list**

In `src/routes/_app/intake.index.tsx`, change the icon import on line 2:

```ts
import { MessageSquare } from "lucide-react";
```

to:

```ts
import { Globe, MessageSquare } from "lucide-react";
```

Then replace the icon at line 73:

```tsx
                          <MessageSquare className="mt-0.5 size-4 text-muted-foreground" />
```

with:

```tsx
                          {c.channel === "WEB_FORM" ? (
                            <Globe className="mt-0.5 size-4 text-muted-foreground" />
                          ) : (
                            <MessageSquare className="mt-0.5 size-4 text-muted-foreground" />
                          )}
```

Then, in the same row, right after the `reporterNumberMasked` span (line 77), add a channel badge:

```tsx
                              <span className="mono-num text-xs text-muted-foreground">{c.reporterNumberMasked}</span>
                              <StatusPill tone="neutral">
                                {c.channel === "WEB_FORM" ? "Web form" : "WhatsApp"}
                              </StatusPill>
```

- [ ] **Step 4: Show the channel in the conversation detail header**

In `src/routes/_app/intake.$conversationId.tsx`, replace line 48:

```tsx
              description={`WhatsApp intake · ${c.reporterNumberMasked}`}
```

with:

```tsx
              description={
                c.channel === "WEB_FORM"
                  ? `Public web form submission · ${c.reporterNumberMasked}`
                  : `WhatsApp intake · ${c.reporterNumberMasked}`
              }
```

- [ ] **Step 5: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/pv.ts src/routes/_app/intake.index.tsx src/routes/_app/intake.\$conversationId.tsx
git commit -m "feat: recognize WEB_FORM as an intake channel in the review UI"
```

---

### Task 3: Frontend — public intake form validation/payload module

**Files:**
- Create: `src/services/public-intake.ts`
- Test: `src/services/public-intake.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `interface PublicIntakeFormState` — the field set the `/report` page's form state uses.
  - `const EMPTY_PUBLIC_INTAKE_FORM: PublicIntakeFormState`
  - `function validatePublicIntakeForm(state: PublicIntakeFormState): string[]` — empty array means valid.
  - `function buildPublicIntakePayload(state: PublicIntakeFormState): Record<string, unknown>` — shape matches the backend's `PublicIntakeSubmission` field names exactly (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `src/services/public-intake.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  EMPTY_PUBLIC_INTAKE_FORM,
  buildPublicIntakePayload,
  validatePublicIntakeForm,
  type PublicIntakeFormState,
} from "./public-intake";

function validState(overrides: Partial<PublicIntakeFormState> = {}): PublicIntakeFormState {
  return {
    ...EMPTY_PUBLIC_INTAKE_FORM,
    reporterName: "Jane Doe",
    reporterContact: "jane@example.com",
    relationshipToPatient: "Self",
    consent: true,
    suspectProduct: "Amoxicillin",
    reactionDescription: "Facial swelling and difficulty breathing",
    ...overrides,
  };
}

describe("validatePublicIntakeForm", () => {
  it("returns no errors for a fully filled valid form", () => {
    expect(validatePublicIntakeForm(validState())).toEqual([]);
  });

  it("requires reporter name, contact, relationship, product and reaction", () => {
    const errors = validatePublicIntakeForm(EMPTY_PUBLIC_INTAKE_FORM);
    expect(errors).toContain("Your name is required.");
    expect(errors).toContain("A contact email or phone number is required.");
    expect(errors).toContain("Please state your relationship to the patient.");
    expect(errors).toContain("The suspect medicine name is required.");
    expect(errors).toContain("Please describe what happened.");
  });

  it("does not require optional patient fields", () => {
    const errors = validatePublicIntakeForm(
      validState({ patientAge: "", patientSex: "", patientWeightKg: "", onsetDate: "" }),
    );
    expect(errors).toEqual([]);
  });
});

describe("buildPublicIntakePayload", () => {
  it("trims text fields and nulls out empty optional fields", () => {
    const payload = buildPublicIntakePayload(
      validState({ patientAge: "  34  ", patientSex: "", patientWeightKg: "", onsetDate: "" }),
    );
    expect(payload).toEqual({
      reporterName: "Jane Doe",
      reporterContact: "jane@example.com",
      relationshipToPatient: "Self",
      consent: true,
      patientAge: "34",
      patientSex: null,
      patientWeightKg: null,
      suspectProduct: "Amoxicillin",
      reactionDescription: "Facial swelling and difficulty breathing",
      onsetDate: null,
      website: "",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/public-intake.test.ts`
Expected: FAIL — `Cannot find module './public-intake'`.

- [ ] **Step 3: Write the implementation**

Create `src/services/public-intake.ts`:

```ts
export interface PublicIntakeFormState {
  reporterName: string;
  reporterContact: string;
  relationshipToPatient: string;
  consent: boolean;
  patientAge: string;
  patientSex: string;
  patientWeightKg: string;
  suspectProduct: string;
  reactionDescription: string;
  onsetDate: string;
  /** Honeypot — must stay empty for real submissions. */
  website: string;
}

export const EMPTY_PUBLIC_INTAKE_FORM: PublicIntakeFormState = {
  reporterName: "",
  reporterContact: "",
  relationshipToPatient: "",
  consent: false,
  patientAge: "",
  patientSex: "",
  patientWeightKg: "",
  suspectProduct: "",
  reactionDescription: "",
  onsetDate: "",
  website: "",
};

export function validatePublicIntakeForm(state: PublicIntakeFormState): string[] {
  const errors: string[] = [];
  if (!state.reporterName.trim()) errors.push("Your name is required.");
  if (!state.reporterContact.trim()) errors.push("A contact email or phone number is required.");
  if (!state.relationshipToPatient.trim())
    errors.push("Please state your relationship to the patient.");
  if (!state.suspectProduct.trim()) errors.push("The suspect medicine name is required.");
  if (!state.reactionDescription.trim()) errors.push("Please describe what happened.");
  return errors;
}

export function buildPublicIntakePayload(state: PublicIntakeFormState): Record<string, unknown> {
  return {
    reporterName: state.reporterName.trim(),
    reporterContact: state.reporterContact.trim(),
    relationshipToPatient: state.relationshipToPatient.trim(),
    consent: state.consent,
    patientAge: state.patientAge.trim() || null,
    patientSex: state.patientSex.trim() || null,
    patientWeightKg: state.patientWeightKg.trim() || null,
    suspectProduct: state.suspectProduct.trim(),
    reactionDescription: state.reactionDescription.trim(),
    onsetDate: state.onsetDate.trim() || null,
    website: state.website,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/public-intake.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/public-intake.ts src/services/public-intake.test.ts
git commit -m "feat: add validation/payload helpers for the public intake form"
```

---

### Task 4: Frontend — the `/report` public page

**Files:**
- Create: `src/routes/report.tsx`

**Interfaces:**
- Consumes:
  - `apiRequest` from `src/services/api/client.ts` — `apiRequest<T>(endpoint: string, opts?: { method?, body?, ... }): Promise<T>`. No auth token is attached when there is no Supabase session (confirmed in `src/services/api/client.ts:116-125`), so this is safe to call unauthenticated.
  - `EMPTY_PUBLIC_INTAKE_FORM`, `validatePublicIntakeForm`, `buildPublicIntakePayload`, `type PublicIntakeFormState` from `src/services/public-intake.ts` (Task 3).
  - `Button`, `Input`, `Label`, `Textarea`, `Checkbox`, `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem` from `src/components/ui/*`.
- Produces: the `/report` route, reachable with no authentication.

- [ ] **Step 1: Create the route file**

Create `src/routes/report.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { apiRequest, ApiError, ApiNotConfiguredError } from "@/services/api/client";
import {
  EMPTY_PUBLIC_INTAKE_FORM,
  buildPublicIntakePayload,
  validatePublicIntakeForm,
  type PublicIntakeFormState,
} from "@/services/public-intake";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/report")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Report a side effect — MedNova" },
      {
        name: "description",
        content: "Report a suspected adverse drug reaction to MedNova Lifesciences.",
      },
    ],
  }),
  component: PublicIntakeForm,
});

function PublicIntakeForm() {
  const [form, setForm] = useState<PublicIntakeFormState>(EMPTY_PUBLIC_INTAKE_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const set = <K extends keyof PublicIntakeFormState>(key: K, value: PublicIntakeFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  if (submitted) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <ShieldCheck className="size-10 text-primary" />
        <h1 className="text-xl font-semibold">Thank you — your report has been received.</h1>
        <p className="text-sm text-muted-foreground">
          A pharmacovigilance reviewer will assess it. If you provided contact details and
          consented to follow-up, we may reach out for more information.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <h1 className="text-xl font-semibold">Report a suspected side effect</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Use this form to tell us about a suspected adverse reaction to a medicine. No account or
        login is required.
      </p>

      <form
        className="mt-6 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const validationErrors = validatePublicIntakeForm(form);
          setErrors(validationErrors);
          setSubmitError(null);
          if (validationErrors.length > 0) return;

          setSubmitting(true);
          try {
            await apiRequest("/api/public/intake", {
              method: "POST",
              body: buildPublicIntakePayload(form),
            });
            setSubmitted(true);
          } catch (err) {
            if (err instanceof ApiNotConfiguredError) {
              setSubmitError("This form isn't connected yet. Please contact MedNova directly.");
            } else if (err instanceof ApiError && err.status === 429) {
              setSubmitError("Too many submissions from this location. Please try again later.");
            } else {
              setSubmitError("Something went wrong sending your report. Please try again.");
            }
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {/* Honeypot — visually hidden, real users never fill this in. */}
        <div className="absolute -left-[9999px]" aria-hidden="true">
          <label htmlFor="website">Leave this field empty</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => set("website", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reporterName">Your name</Label>
          <Input
            id="reporterName"
            required
            value={form.reporterName}
            onChange={(e) => set("reporterName", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reporterContact">Your email or phone number</Label>
          <Input
            id="reporterContact"
            required
            value={form.reporterContact}
            onChange={(e) => set("reporterContact", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="relationshipToPatient">Your relationship to the patient</Label>
          <Input
            id="relationshipToPatient"
            required
            placeholder="e.g. Self, Parent, Nurse, Doctor"
            value={form.relationshipToPatient}
            onChange={(e) => set("relationshipToPatient", e.target.value)}
          />
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="consent"
            checked={form.consent}
            onCheckedChange={(checked) => set("consent", checked === true)}
          />
          <Label htmlFor="consent" className="font-normal">
            I consent to being contacted for follow-up about this report.
          </Label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="patientAge">Patient age (optional)</Label>
            <Input
              id="patientAge"
              value={form.patientAge}
              onChange={(e) => set("patientAge", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="patientSex">Patient sex (optional)</Label>
            <Select value={form.patientSex} onValueChange={(v) => set("patientSex", v)}>
              <SelectTrigger id="patientSex">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FEMALE">Female</SelectItem>
                <SelectItem value="MALE">Male</SelectItem>
                <SelectItem value="UNKNOWN">Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="patientWeightKg">Patient weight in kg (optional)</Label>
          <Input
            id="patientWeightKg"
            value={form.patientWeightKg}
            onChange={(e) => set("patientWeightKg", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="suspectProduct">Medicine you suspect caused the reaction</Label>
          <Input
            id="suspectProduct"
            required
            value={form.suspectProduct}
            onChange={(e) => set("suspectProduct", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reactionDescription">What happened?</Label>
          <Textarea
            id="reactionDescription"
            required
            rows={5}
            value={form.reactionDescription}
            onChange={(e) => set("reactionDescription", e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="onsetDate">When did it start? (optional)</Label>
          <Input
            id="onsetDate"
            type="date"
            value={form.onsetDate}
            onChange={(e) => set("onsetDate", e.target.value)}
          />
        </div>

        {errors.length > 0 && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <ul className="list-disc pl-4">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {submitError && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {submitError}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Sending…" : "Submit report"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors. If `ApiError`/`ApiNotConfiguredError` aren't exported from `src/services/api/client.ts`, confirm their exact export names there first (they are exported as classes per `src/services/api/client.ts:68-91`) and fix the import if names differ.

- [ ] **Step 3: Manual verification against the real backend**

1. Ensure `.env` has `VITE_PV_API_BASE_URL` pointing at a locally running backend, and the backend's environment has `PUBLIC_INTAKE_ORG_ID` set to a real organization id from your Supabase `organizations` table.
2. Run the backend: `python -m uvicorn src.server.main:app --reload --port 8000` (or however this repo normally starts it — check `README.md`/existing scripts if this doesn't match).
3. Run the frontend: `npm run dev`.
4. In a private/incognito browser window (to confirm no auth session is required), navigate to `/report`, fill in the form, and submit.
5. Confirm the success screen appears.
6. Sign in to the app as a Field Associate or PV Coordinator, open `/intake`, and confirm the new conversation appears tagged "Web form" with the correct reporter/product/reaction details.
7. Open the conversation, confirm "Minimum ICSR information available" shows if all fields were filled, then click convert-to-case (via the existing UI action) and confirm the resulting case's product and reaction match what was submitted.
8. Submit the form again with the same field values but leave "What happened?" empty — confirm client-side validation blocks submission without a network call.

- [ ] **Step 4: Commit**

```bash
git add src/routes/report.tsx
git commit -m "feat: add public /report adverse-event intake page"
```
