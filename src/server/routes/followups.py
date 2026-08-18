"""Protected reporter follow-up request routes."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..db import get_supabase_client
from ..dependencies import AuthenticatedUser, require_permission

router = APIRouter()


class FollowUpCreateRequest(BaseModel):
    requestedInformation: str
    channel: str = "EMAIL"


def _format_follow_up(item: dict) -> dict:
    requester = item.get("profiles") or {}
    if isinstance(requester, list):
        requester = requester[0] if requester else {}
    return {
        "id": item.get("id"),
        "caseId": item.get("case_id"),
        "requestedInformation": item.get("requested_information"),
        "channel": item.get("channel"),
        "requestedBy": requester.get("full_name") or requester.get("email") or item.get("requested_by"),
        "requestedAt": item.get("requested_at"),
        "dueAt": item.get("due_at"),
        "status": item.get("status"),
    }


@router.get("")
async def list_follow_ups(
    case_id: Optional[str] = None,
    user: AuthenticatedUser = Depends(require_permission("follow_up.view")),
):
    filters = {"organization_id": user.organization_id}
    if case_id:
        filters["case_id"] = case_id
    items = await get_supabase_client().query(
        "follow_ups",
        filters=filters,
        select="*, profiles(full_name,email)",
    )
    return [_format_follow_up(item) for item in items]


@router.post("/{case_id}")
async def create_follow_up(
    case_id: str,
    request: FollowUpCreateRequest,
    user: AuthenticatedUser = Depends(require_permission("follow_up.create")),
):
    if request.channel not in {"EMAIL", "PHONE", "WHATSAPP", "PORTAL"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported follow-up channel")

    db = get_supabase_client()
    case = await db.get_case(case_id, user.organization_id)
    if not case:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")

    now = datetime.now(timezone.utc)
    item = await db.query(
        "follow_ups",
        method="POST",
        data={
            "organization_id": user.organization_id,
            "case_id": case_id,
            "requested_information": request.requestedInformation,
            "channel": request.channel,
            "requested_by": user.user_id,
            "requested_at": now.isoformat(),
            "due_at": (now + timedelta(days=7)).isoformat(),
            "status": "OPEN",
        },
        select="*, profiles(full_name,email)",
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Follow-up was not created")
    return _format_follow_up(item[0])
