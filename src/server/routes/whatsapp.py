"""
WhatsApp (Termii) ICSR intake.

Two very different trust levels live in this one file:
- POST /webhook has NO auth dependency at all — Termii calls it directly,
  verified only by a shared secret (see termii_client.webhook_secret_configured).
  Every DB write here goes through the service-role client (get_supabase_client()),
  bypassing RLS entirely, the same way auth.py already does for organizations/profiles.
- Everything else requires a real signed-in session via require_permission,
  exactly like every other authenticated route in this app.

Nothing here creates a case. A WhatsApp conversation only ever produces a
pv_intake_conversations row a human reviews; converting it into a real
ICSR is a frontend action (src/services/api/whatsapp.ts convertToCase)
that reuses cases.ts's existing buildCaseDetail()/create(), exactly like
the manual intake form does.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from ..ai.client import AiNotConfiguredError, AiRequestError, structured_completion
from ..ai.prompts import build_whatsapp_intake_prompt
from ..ai.schemas import AiWhatsAppTurnResult
from ..db import get_supabase_client
from ..dependencies import AuthenticatedUser, require_permission
from ..whatsapp.termii_client import (
    TermiiNotConfiguredError,
    TermiiRequestError,
    send_whatsapp_message,
    webhook_secret_configured,
)
import os

logger = logging.getLogger(__name__)
router = APIRouter()

GREETING_TEMPLATE = (
    "Hi, we are {org_name}. Would you like to report an adverse reaction to one of our drugs?"
)


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4()}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_conversation_data(phone: str, auto_respond: bool, required_questions: list[dict]) -> dict:
    return {
        "phoneNumber": phone,
        "status": "OPEN",
        "autoRespond": auto_respond,
        "reporter": {},
        "patient": {},
        "suspectProducts": [],
        "reactions": [],
        "narrative": "",
        "dynamicFields": [],
        "wantsAnotherProduct": None,
        "requiredQuestionsStatus": [
            {"questionId": q["id"], "answered": False, "answerSummary": None} for q in required_questions
        ],
        "lastMessageAt": _now_iso(),
    }


async def _get_intake_settings(db, organization_id: str) -> Optional[dict]:
    rows = await db.query("pv_intake_settings", filters={"organization_id": organization_id})
    return rows[0] if rows else None


async def _get_org_name(db, organization_id: str) -> str:
    rows = await db.query("organizations", filters={"id": organization_id}, select="name")
    return rows[0]["name"] if rows else "our organisation"


async def _get_drug_names(db, organization_id: str) -> list[str]:
    rows = await db.query("pv_products", filters={"organization_id": organization_id})
    names = []
    for r in rows:
        data = r.get("data") or {}
        if data.get("name"):
            names.append(data["name"])
    return names


async def _insert_message(
    db, conversation_id: str, organization_id: str, direction: str, sender: str, body: str,
    staff_user_id: Optional[str] = None, termii_message_id: Optional[str] = None,
) -> dict:
    row = {
        "id": _new_id("msg"),
        "conversation_id": conversation_id,
        "organization_id": organization_id,
        "direction": direction,
        "sender": sender,
        "body": body,
        "staff_user_id": staff_user_id,
        "termii_message_id": termii_message_id,
    }
    created = await db.query("pv_intake_messages", method="POST", data=row)
    return created[0] if created else row


async def _notify_staff_ready(db, organization_id: str, org_name: str, conversation_id: str) -> None:
    notification_id = _new_id("nt")
    await db.query(
        "pv_notifications",
        method="POST",
        data={
            "id": notification_id,
            "organization_id": organization_id,
            "data": {
                "id": notification_id,
                "type": "CASE_ASSIGNED",
                "title": "WhatsApp report ready for review",
                "body": f"A WhatsApp conversation with {org_name} is ready — review and create the ICSR.",
                "at": _now_iso(),
                "read": False,
                "link": f"/whatsapp-intake?conversation={conversation_id}",
            },
        },
    )
    staff = await db.query(
        "profiles",
        filters={"organization_id": organization_id, "role": ["PV_MANAGER", "PV_COORDINATOR", "ADMIN"]},
    )
    from_number = None
    settings_row = await _get_intake_settings(db, organization_id)
    if settings_row:
        from_number = settings_row.get("whatsapp_number")
    if not from_number:
        return
    for member in staff:
        phone = member.get("phone")
        if not phone:
            continue
        try:
            await send_whatsapp_message(
                to=phone,
                from_number=from_number,
                text=f"{org_name} PV Assist: a new WhatsApp adverse-event report is ready for your review.",
            )
        except (TermiiNotConfiguredError, TermiiRequestError) as exc:
            logger.info("Staff notification text not sent to %s: %s", phone, exc)


async def _run_ai_turn(
    db, organization_id: str, org_name: str, conversation: dict, messages: list[dict]
) -> AiWhatsAppTurnResult:
    settings_row = await _get_intake_settings(db, organization_id)
    required_questions = (settings_row or {}).get("required_questions") or []
    drug_names = await _get_drug_names(db, organization_id)

    transcript = [
        {"from": m["sender"], "text": m["body"]} for m in messages if m["direction"] != "SYSTEM"
    ]
    user_content = json.dumps(
        {
            "transcript": transcript,
            "currentState": conversation["data"],
            "requiredQuestions": required_questions,
        }
    )
    completion = await structured_completion(
        system_prompt=build_whatsapp_intake_prompt(org_name, drug_names, [q["text"] for q in required_questions]),
        user_content=user_content,
    )
    return AiWhatsAppTurnResult.model_validate(completion.data)


@router.post("/webhook")
async def receive_whatsapp_webhook(request: Request, secret: str = Query(default="")):
    # Fails closed, always — an unauthenticated public endpoint that
    # triggers OpenAI calls and writes conversations/notifications must
    # never have a "warn and proceed anyway" fallback for the
    # not-yet-configured state. Set TERMII_WEBHOOK_SECRET on this server
    # and register the same value as `?secret=` on the webhook URL you
    # give Termii — do this before Termii can deliver anything for real.
    expected = os.getenv("TERMII_WEBHOOK_SECRET", "").strip()
    if not webhook_secret_configured() or secret != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing webhook secret")

    payload = await request.json()
    sender = str(payload.get("sender", "")).strip()
    receiver = str(payload.get("receiver", "")).strip()
    message = str(payload.get("message", "")).strip()
    termii_message_id = payload.get("message_id")

    if not sender or not receiver or not message:
        # Ack anyway — never make Termii retry a payload shape we can't use.
        logger.warning("Webhook payload missing sender/receiver/message: %s", payload)
        return {"status": "ignored"}

    db = get_supabase_client()
    settings_rows = await db.query("pv_intake_settings", filters={"whatsapp_number": receiver})
    if not settings_rows:
        logger.info("No organization registered for WhatsApp number %s", receiver)
        return {"status": "ignored"}
    settings_row = settings_rows[0]
    organization_id = settings_row["organization_id"]
    org_name = await _get_org_name(db, organization_id)

    all_conversations = await db.query("pv_intake_conversations", filters={"organization_id": organization_id})
    open_conversation = next(
        (
            c for c in all_conversations
            if c["data"].get("phoneNumber") == sender
            and c["data"].get("status") in ("OPEN", "READY_FOR_REVIEW")
        ),
        None,
    )

    is_new = open_conversation is None
    if is_new:
        required_questions = settings_row.get("required_questions") or []
        conversation_id = _new_id("conv")
        conversation_data = _empty_conversation_data(sender, settings_row.get("auto_respond_default", True), required_questions)
        created = await db.query(
            "pv_intake_conversations",
            method="POST",
            data={"id": conversation_id, "organization_id": organization_id, "data": conversation_data},
        )
        conversation = created[0]
    else:
        conversation = open_conversation
        conversation_id = conversation["id"]

    await _insert_message(
        db, conversation_id, organization_id, "INBOUND", "REPORTER", message, termii_message_id=termii_message_id,
    )

    if is_new:
        greeting = GREETING_TEMPLATE.format(org_name=org_name)
        await _insert_message(db, conversation_id, organization_id, "OUTBOUND", "SYSTEM", greeting)
        try:
            await send_whatsapp_message(to=sender, from_number=receiver, text=greeting)
        except (TermiiNotConfiguredError, TermiiRequestError) as exc:
            logger.info("Greeting not sent to %s: %s", sender, exc)
        return {"status": "greeted"}

    if conversation["data"].get("status") == "READY_FOR_REVIEW" or not conversation["data"].get("autoRespond", True):
        # Awaiting human review, or staff has taken over — record only.
        return {"status": "recorded"}

    messages = await db.query("pv_intake_messages", filters={"conversation_id": conversation_id})
    messages.sort(key=lambda m: m.get("created_at", ""))

    try:
        result = await _run_ai_turn(db, organization_id, org_name, conversation, messages)
    except AiNotConfiguredError as exc:
        logger.info("WhatsApp AI turn skipped: %s", exc)
        return {"status": "ai_not_configured"}
    except AiRequestError as exc:
        logger.error("WhatsApp AI turn failed: %s", exc)
        return {"status": "ai_error"}
    except Exception as exc:
        logger.error("WhatsApp AI turn returned unusable output: %s", exc)
        return {"status": "ai_error"}

    next_data = dict(conversation["data"])
    next_data.update(
        {
            "status": "READY_FOR_REVIEW" if result.isComplete else "OPEN",
            "wantsAnotherProduct": result.wantsAnotherProduct,
            "narrative": result.narrative or next_data.get("narrative", ""),
            "suspectProducts": [p.model_dump() for p in result.suspectProducts] or next_data.get("suspectProducts", []),
            "reactions": [r.model_dump() for r in result.reactions] or next_data.get("reactions", []),
            "dynamicFields": [d.model_dump() for d in result.dynamicFields],
            "requiredQuestionsStatus": [q.model_dump() for q in result.requiredQuestionsStatus] or next_data.get("requiredQuestionsStatus", []),
            "lastMessageAt": _now_iso(),
        }
    )
    next_data["reporter"] = {
        **next_data.get("reporter", {}),
        **{
            k: v for k, v in {
                "name": result.reporterName,
                "qualification": result.reporterQualification,
                "contact": result.reporterContact,
            }.items() if v is not None
        },
    }
    next_data["patient"] = {
        **next_data.get("patient", {}),
        **{
            k: v for k, v in {
                "identifier": result.patientIdentifier,
                "age": result.patientAge,
                "sex": result.patientSex,
            }.items() if v is not None
        },
    }
    await db.query(
        "pv_intake_conversations",
        method="PATCH",
        filters={"id": conversation_id},
        data={"data": next_data, "updated_at": _now_iso()},
    )

    await _insert_message(db, conversation_id, organization_id, "OUTBOUND", "AI", result.reply)
    try:
        await send_whatsapp_message(to=sender, from_number=receiver, text=result.reply)
    except (TermiiNotConfiguredError, TermiiRequestError) as exc:
        logger.info("AI reply not sent to %s: %s", sender, exc)

    if result.isComplete:
        await _notify_staff_ready(db, organization_id, org_name, conversation_id)

    return {"status": "processed", "isComplete": result.isComplete}


class SendReplyRequest(BaseModel):
    conversationId: str
    message: str


@router.post("/send")
async def send_staff_reply(
    request: SendReplyRequest,
    user: AuthenticatedUser = Depends(require_permission("intake.manage")),
):
    db = get_supabase_client()
    conversations = await db.query(
        "pv_intake_conversations",
        filters={"id": request.conversationId, "organization_id": user.organization_id},
    )
    if not conversations:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    conversation = conversations[0]
    phone = conversation["data"].get("phoneNumber")
    if not phone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Conversation has no phone number on file")

    settings_row = await _get_intake_settings(db, user.organization_id)
    from_number = (settings_row or {}).get("whatsapp_number")
    if not from_number:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No WhatsApp number configured for this organization")

    try:
        result = await send_whatsapp_message(to=phone, from_number=from_number, text=request.message)
    except TermiiNotConfiguredError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except TermiiRequestError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))

    return {"termiiMessageId": result.message_id}
