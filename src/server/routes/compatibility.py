"""Protected compatibility endpoints for frontend modules not yet persisted server-side."""

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..dependencies import AuthenticatedUser, require_permission
from ..db import get_supabase_client

router = APIRouter()


class RequestInformationBody(BaseModel):
    fields: List[str]
    message: str


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


async def _record_pv_audit_event(
    user: AuthenticatedUser,
    action: str,
    entity: str,
    entity_id: str,
    new_value: Optional[str] = None,
    previous_value: Optional[str] = None,
    reason: Optional[str] = None,
) -> None:
    """Write to pv_audit_events — the table the dashboard and audit trail
    actually read from (the FastAPI `audit_events` table is unused by the
    live app and would make these events invisible in the UI)."""
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "id": _new_id("ae"),
        "timestamp": now,
        "user": user.email,
        "role": user.role,
        "action": action,
        "entity": entity,
        "entityId": entity_id,
        "previousValue": previous_value,
        "newValue": new_value,
        "reason": reason,
    }
    await get_supabase_client().query(
        "pv_audit_events",
        method="POST",
        data={"id": row["id"], "occurred_at": now, "organization_id": user.organization_id, "data": row},
    )


async def _push_pv_notification(user: AuthenticatedUser, type_: str, title: str, body: str, link: Optional[str] = None) -> None:
    row = {
        "id": _new_id("nt"),
        "type": type_,
        "title": title,
        "body": body,
        "at": datetime.now(timezone.utc).isoformat(),
        "read": False,
    }
    if link:
        row["link"] = link
    await get_supabase_client().query(
        "pv_notifications",
        method="POST",
        data={"id": row["id"], "organization_id": user.organization_id, "data": row},
    )


@router.get("/linelist/jobs")
async def list_linelist_jobs(
    user: AuthenticatedUser = Depends(require_permission("case.view")),
):
    return await _list_data_table("pv_linelist_jobs")


@router.get("/intake/conversations")
async def list_intake_conversations(
    user: AuthenticatedUser = Depends(require_permission("intake.manage")),
):
    return await _list_data_table("pv_intake_conversations")


@router.get("/intake/conversations/{conversation_id}")
async def get_intake_conversation(
    conversation_id: str,
    user: AuthenticatedUser = Depends(require_permission("intake.manage")),
):
    rows = await get_supabase_client().query(
        "pv_intake_conversations",
        filters={"id": conversation_id},
        select="data",
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    data = rows[0].get("data", {})
    
    # Ensure detail fields exist with sensible defaults
    if "messages" not in data:
        data["messages"] = [
            {
                "id": "m1",
                "direction": "INBOUND",
                "at": data.get("lastMessageAt", ""),
                "body": data.get("lastMessage", "")
            }
        ]
    if "extracted" not in data:
        data["extracted"] = []
    if "missing" not in data:
        # Determine missing fields based on criteria
        missing = []
        if not data.get("criteria", {}).get("reporter"):
            missing.append("Reporter information")
        if not data.get("criteria", {}).get("patient"):
            missing.append("Patient information")
        if not data.get("criteria", {}).get("product"):
            missing.append("Product information")
        if not data.get("criteria", {}).get("event"):
            missing.append("Adverse event description")
        data["missing"] = missing
    
    return data


async def _get_conversation_row(conversation_id: str) -> dict:
    rows = await get_supabase_client().query(
        "pv_intake_conversations",
        filters={"id": conversation_id},
        select="*",
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return rows[0]


@router.post("/intake/conversations/{conversation_id}/request-information")
async def request_intake_information(
    conversation_id: str,
    body: RequestInformationBody,
    user: AuthenticatedUser = Depends(require_permission("intake.manage")),
):
    row = await _get_conversation_row(conversation_id)
    data = row.get("data", {})
    now = datetime.now(timezone.utc).isoformat()

    messages = data.get("messages") or []
    messages.append(
        {
            "id": f"m{len(messages) + 1}",
            "direction": "OUTBOUND",
            "at": now,
            "body": body.message,
        }
    )
    data["messages"] = messages
    data["lastMessage"] = body.message
    data["lastMessageAt"] = now
    if data.get("status") == "NEW":
        data["status"] = "IN_REVIEW"

    await get_supabase_client().query(
        "pv_intake_conversations",
        method="PATCH",
        filters={"id": conversation_id},
        data={"data": data, "updated_at": now},
    )
    await _record_pv_audit_event(
        user,
        "INTAKE_INFORMATION_REQUESTED",
        "IntakeConversation",
        conversation_id,
        new_value=f"Requested: {', '.join(body.fields)}" if body.fields else body.message,
    )
    return data


@router.post("/intake/conversations/{conversation_id}/convert")
async def convert_intake_conversation(
    conversation_id: str,
    user: AuthenticatedUser = Depends(require_permission("intake.manage")),
):
    row = await _get_conversation_row(conversation_id)
    data = row.get("data", {})

    if data.get("linkedCaseId"):
        return {"caseId": data["linkedCaseId"]}

    criteria = data.get("criteria", {})
    if not all(criteria.get(k) for k in ("reporter", "patient", "product", "event")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Minimum ICSR criteria are not complete for this conversation",
        )

    db = get_supabase_client()
    existing = await db.query("pv_cases", select="id")
    case_id = f"MN-{datetime.now(timezone.utc).year}-{900000 + len(existing) + 1}"

    extracted = {e.get("field"): e.get("value") for e in data.get("extracted", []) if e.get("field")}
    now_date = datetime.now(timezone.utc).date().isoformat()
    case_detail = {
        "id": case_id,
        "patientIdentifier": extracted.get("Patient") or "Unknown",
        "product": extracted.get("Suspect product") or "Unspecified product",
        "reaction": extracted.get("Adverse event") or "Unspecified reaction",
        "seriousness": "UNASSESSED",
        "outcome": "UNKNOWN",
        "workflowStep": "INTAKE",
        "assignedTo": user.email,
        "receivedDate": now_date,
        "dueDate": now_date,
        "priority": "MEDIUM",
        "flags": [],
        "source": "WHATSAPP",
        "reporter": {
            "name": data.get("reporterName") or "Unknown reporter",
            "qualification": "Not stated",
            "country": "Not stated",
            "contact": data.get("reporterNumberMasked"),
            "consentToContact": data.get("consent") == "GRANTED",
        },
        "patient": {
            "identifier": extracted.get("Patient") or "Unknown",
            "age": None,
            "sex": "UNKNOWN",
            "weightKg": None,
            "medicalHistory": None,
        },
        "suspectProducts": [
            {"reportedName": extracted.get("Suspect product") or "Unspecified product"}
        ],
        "reactions": [
            {"reportedTerm": extracted.get("Adverse event") or "Unspecified reaction", "outcome": "UNKNOWN"}
        ],
        "narrative": data.get("lastMessage") or "",
        "reportedSeriousnessCriteria": [],
        "followUpRequests": [],
        "workflowState": {
            "INTAKE": "CURRENT",
            "TRIAGE": "PENDING",
            "CODING": "PENDING",
            "REVIEW": "PENDING",
            "QC": "PENDING",
            "REGULATORY_READY": "PENDING",
            "CLOSED": "PENDING",
        },
    }

    await db.query("pv_cases", method="POST", data={"id": case_id, "organization_id": user.organization_id, "data": case_detail})

    data["status"] = "CONVERTED"
    data["linkedCaseId"] = case_id
    await db.query(
        "pv_intake_conversations",
        method="PATCH",
        filters={"id": conversation_id},
        data={"data": data, "updated_at": datetime.now(timezone.utc).isoformat()},
    )
    await _record_pv_audit_event(
        user,
        "CASE_CREATED",
        "Case",
        case_id,
        new_value=f"{case_detail['product']} / {case_detail['reaction']}",
        reason=f"Converted from intake conversation {conversation_id}",
    )
    await _push_pv_notification(
        user,
        "CASE_ASSIGNED",
        f"Case {case_id} created",
        f"{case_detail['product']} — {case_detail['reaction']}. Converted from an intake conversation.",
        link=f"/cases/{case_id}",
    )
    return {"caseId": case_id}


@router.get("/psur/documents")
async def list_psur_documents(
    user: AuthenticatedUser = Depends(require_permission("psur.review")),
):
    return await _list_data_table("pv_psur_documents")


@router.get("/notifications")
async def list_notifications(
    user: AuthenticatedUser = Depends(require_permission("case.view")),
):
    return await _list_data_table("pv_notifications")


async def _list_data_table(table: str) -> list:
    rows = await get_supabase_client().query(table, select="data")
    return [row.get("data") for row in rows if row.get("data") is not None]
