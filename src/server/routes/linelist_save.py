"""Server-validated saves of line-list cell changes.

Every save that changes a cell (Fix, Undo, Re-apply) goes through here:
the stored job is read for the caller's organisation only, the version the
browser read must still be current, every changed cell must be verified by
server/linelist/save_guard.py, and the write is one update conditional on
that version — all of it or nothing. Reasons returned name a row and a
column, never a value.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..dependencies import AuthenticatedUser, require_permission
from ..linelist.save_guard import validate_cell_save

logger = logging.getLogger(__name__)
router = APIRouter()


class SaveCellsRequest(BaseModel):
    job: dict
    expected_version: Optional[int] = None


class SaveCellsResponse(BaseModel):
    version: int


def _rest() -> tuple[str, dict]:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise HTTPException(status_code=503, detail="Saving is unavailable: the server is not configured.")
    return f"{url}/rest/v1/pv_linelist_jobs", {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


async def _load(job_id: str, org: str) -> Optional[dict]:
    url, headers = _rest()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=headers, params={"id": f"eq.{job_id}", "organization_id": f"eq.{org}", "select": "data"})
    r.raise_for_status()
    rows = r.json()
    return rows[0]["data"] if rows else None


async def _write(job_id: str, org: str, expected: Optional[int], data: dict) -> int:
    url, headers = _rest()
    params = {"id": f"eq.{job_id}", "organization_id": f"eq.{org}", "select": "id"}
    if expected is None:
        params["data->version"] = "is.null"
    else:
        params["data->>version"] = f"eq.{expected}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.patch(url, headers={**headers, "Prefer": "return=representation"}, params=params, json={"data": data})
    if r.status_code >= 400:
        # e.g. the identifier trigger (check_violation)
        logger.warning("Line-list cell save refused by the database: HTTP %s", r.status_code)
        raise HTTPException(status_code=422, detail={"message": "The database refused this change.", "problems": []})
    return len(r.json())


@router.post("/jobs/{job_id}/save-cells", response_model=SaveCellsResponse)
async def save_cells(
    job_id: str,
    request: SaveCellsRequest,
    user: AuthenticatedUser = Depends(require_permission("linelist.process")),
):
    if not user.organization_id:
        raise HTTPException(status_code=403, detail="No organisation.")
    current = await _load(job_id, user.organization_id)
    if current is None:
        # Not found, or another organisation's — indistinguishable on purpose.
        raise HTTPException(status_code=404, detail="Line list not found.")
    if current.get("version") != request.expected_version:
        raise HTTPException(status_code=409, detail="This line list was changed elsewhere. Nothing was saved — reload and repeat your change.")
    proposed = dict(request.job)
    if proposed.get("id") not in (None, job_id):
        raise HTTPException(status_code=422, detail={"message": "The line list does not match.", "problems": []})
    problems = validate_cell_save(current, proposed)
    if problems:
        raise HTTPException(status_code=422, detail={"message": "Nothing was saved: some changes could not be verified on the server.", "problems": problems[:50]})
    next_version = (request.expected_version or 0) + 1
    written = await _write(job_id, user.organization_id, request.expected_version, {**proposed, "id": job_id, "version": next_version})
    if written == 0:
        raise HTTPException(status_code=409, detail="This line list was changed elsewhere. Nothing was saved — reload and repeat your change.")
    return SaveCellsResponse(version=next_version)
