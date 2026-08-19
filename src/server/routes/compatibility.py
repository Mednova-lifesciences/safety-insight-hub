"""Protected compatibility endpoints for frontend modules not yet persisted server-side."""

from fastapi import APIRouter, Depends

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
