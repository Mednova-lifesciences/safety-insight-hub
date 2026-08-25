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
