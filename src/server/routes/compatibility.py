"""Protected compatibility endpoints for frontend modules not yet persisted server-side."""

from fastapi import APIRouter, Depends

from ..dependencies import AuthenticatedUser, require_permission

router = APIRouter()


@router.get("/linelist/jobs")
async def list_linelist_jobs(
    user: AuthenticatedUser = Depends(require_permission("case.view")),
):
    return []


@router.get("/intake/conversations")
async def list_intake_conversations(
    user: AuthenticatedUser = Depends(require_permission("intake.manage")),
):
    return []


@router.get("/psur/documents")
async def list_psur_documents(
    user: AuthenticatedUser = Depends(require_permission("psur.review")),
):
    return []


@router.get("/notifications")
async def list_notifications(
    user: AuthenticatedUser = Depends(require_permission("case.view")),
):
    return []
