"""Protected compatibility endpoints for frontend modules not yet persisted server-side."""

from fastapi import APIRouter, Depends, HTTPException, status

from ..dependencies import AuthenticatedUser, require_permission
from ..db import get_supabase_client

router = APIRouter()


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
