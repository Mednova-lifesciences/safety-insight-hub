"""
AI-powered PSUR/PBRER review and fix.

PDF review happens inline with upload (see /review-pdf), because the raw
file only ever exists in the browser's memory for the duration of the
upload request — this app has no document storage, so there is no later
point at which the original bytes could be re-fetched for a lazy review.
Sending the file once, at upload time, also naturally satisfies "don't
send the same document to the model multiple times."

Spreadsheet-sourced PSUR review (see /review-spreadsheet) uses the rows
already parsed and persisted client-side, so it can run lazily like the
rest of the review workflow.
"""
from __future__ import annotations

import io
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel

from ..ai.client import AiNotConfiguredError, AiRequestError, is_ai_configured, structured_completion
from ..ai.prompts import (
    PROMPT_VERSION,
    PSUR_FULL_FIX_PROMPT,
    PSUR_REVIEW_PDF_PROMPT,
    PSUR_REVIEW_SPREADSHEET_PROMPT,
)
from ..ai.schemas import AiPsurFix, AiPsurReview
from ..dependencies import AuthenticatedUser, require_permission

logger = logging.getLogger(__name__)
router = APIRouter()

# Keeps a single review call's token footprint bounded regardless of
# document length, per-page markers are kept so findings can still cite
# an approximate location even though the document is truncated.
MAX_PDF_CHARS = 60_000
MAX_SPREADSHEET_ROWS_PER_CALL = 300


def _extract_pdf_text(raw: bytes) -> tuple[str, int]:
    import pdfplumber

    parts: list[str] = []
    char_budget = MAX_PDF_CHARS
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        total_pages = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            if char_budget <= 0:
                break
            page_text = (page.extract_text() or "").strip()
            if not page_text:
                continue
            chunk = f"\n\n--- page {i + 1} ---\n{page_text[:char_budget]}"
            parts.append(chunk)
            char_budget -= len(chunk)
    return "".join(parts), total_pages


class PsurFindingOut(BaseModel):
    category: str
    severity: str
    section: str
    description: str
    evidence: str


class ReviewResponse(BaseModel):
    findings: list[PsurFindingOut]
    ai_used: bool
    prompt_version: str
    pages_extracted: Optional[int] = None
    truncated: bool = False
    model: Optional[str] = None
    error: Optional[str] = None


@router.get("/status")
async def ai_status():
    return {"configured": is_ai_configured()}


@router.post("/review-pdf", response_model=ReviewResponse)
async def review_pdf(
    file: UploadFile = File(...),
    product: str = Form(""),
    reportingPeriod: str = Form(""),
    user: AuthenticatedUser = Depends(require_permission("psur.review")),
):
    raw = await file.read()
    try:
        text, total_pages = _extract_pdf_text(raw)
    except Exception as exc:
        logger.error("PDF text extraction failed for %s: %s", file.filename, exc)
        return ReviewResponse(
            findings=[], ai_used=False, prompt_version=PROMPT_VERSION, error="Could not extract text from this PDF."
        )

    if not text.strip():
        return ReviewResponse(
            findings=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            pages_extracted=total_pages,
            error="No extractable text found in this PDF (it may be a scanned image without a text layer).",
        )

    truncated = len(text) >= MAX_PDF_CHARS

    try:
        payload = {
            "filename": file.filename,
            "declaredProduct": product or None,
            "declaredReportingPeriod": reportingPeriod or None,
            "totalPages": total_pages,
            "truncated": truncated,
            "extractedText": text,
        }
        completion = await structured_completion(
            system_prompt=PSUR_REVIEW_PDF_PROMPT,
            user_content=json.dumps(payload),
            max_output_tokens=3000,
        )
        parsed = AiPsurReview.model_validate(completion.data)
        return ReviewResponse(
            findings=[PsurFindingOut(**f.model_dump()) for f in parsed.findings],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            pages_extracted=total_pages,
            truncated=truncated,
            model=completion.model,
        )
    except AiNotConfiguredError as exc:
        logger.info("PSUR PDF AI review skipped: %s", exc)
        return ReviewResponse(
            findings=[], ai_used=False, prompt_version=PROMPT_VERSION, pages_extracted=total_pages, error=str(exc)
        )
    except AiRequestError as exc:
        logger.error("PSUR PDF AI review failed: %s", exc)
        return ReviewResponse(
            findings=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            pages_extracted=total_pages,
            error="AI review unavailable.",
        )
    except Exception as exc:
        logger.error("PSUR PDF AI review returned unusable output: %s", exc)
        return ReviewResponse(
            findings=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            pages_extracted=total_pages,
            error="AI review returned an unusable response.",
        )


class ReviewSpreadsheetRequest(BaseModel):
    filename: str
    columns: list[str]
    rows: list[dict]
    product: str
    reportingPeriod: str
    stats: dict


@router.post("/review-spreadsheet", response_model=ReviewResponse)
async def review_spreadsheet(
    request: ReviewSpreadsheetRequest,
    user: AuthenticatedUser = Depends(require_permission("psur.review")),
):
    try:
        payload = {
            "filename": request.filename,
            "columns": request.columns,
            "rows": request.rows[:MAX_SPREADSHEET_ROWS_PER_CALL],
            "product": request.product,
            "reportingPeriod": request.reportingPeriod,
            "stats": request.stats,
        }
        completion = await structured_completion(
            system_prompt=PSUR_REVIEW_SPREADSHEET_PROMPT,
            user_content=json.dumps(payload),
        )
        parsed = AiPsurReview.model_validate(completion.data)
        return ReviewResponse(
            findings=[PsurFindingOut(**f.model_dump()) for f in parsed.findings],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            model=completion.model,
        )
    except AiNotConfiguredError as exc:
        logger.info("PSUR spreadsheet AI review skipped: %s", exc)
        return ReviewResponse(findings=[], ai_used=False, prompt_version=PROMPT_VERSION, error=str(exc))
    except AiRequestError as exc:
        logger.error("PSUR spreadsheet AI review failed: %s", exc)
        return ReviewResponse(findings=[], ai_used=False, prompt_version=PROMPT_VERSION, error="AI review unavailable.")
    except Exception as exc:
        logger.error("PSUR spreadsheet AI review returned unusable output: %s", exc)
        return ReviewResponse(
            findings=[], ai_used=False, prompt_version=PROMPT_VERSION, error="AI review returned an unusable response."
        )


class AcceptedFindingIn(BaseModel):
    id: str
    category: str
    section: str
    description: str
    evidence: str


class FixRequest(BaseModel):
    filename: str
    sourceType: str
    acceptedFindings: list[AcceptedFindingIn]
    columns: Optional[list[str]] = None
    rows: Optional[list[dict]] = None


class ResolutionOut(BaseModel):
    finding_id: str
    resolution_text: str
    row: Optional[int] = None
    column: Optional[str] = None
    new_value: Optional[str] = None


class UnresolvedOut(BaseModel):
    finding_id: str
    reason: str


class FixResponse(BaseModel):
    resolutions: list[ResolutionOut]
    unresolved: list[UnresolvedOut]
    ai_used: bool
    prompt_version: str
    error: Optional[str] = None


@router.post("/fix", response_model=FixResponse)
async def fix_psur(
    request: FixRequest,
    user: AuthenticatedUser = Depends(require_permission("psur.review")),
):
    if not request.acceptedFindings:
        return FixResponse(resolutions=[], unresolved=[], ai_used=False, prompt_version=PROMPT_VERSION)

    try:
        payload = {
            "filename": request.filename,
            "sourceType": request.sourceType,
            "acceptedFindings": [f.model_dump() for f in request.acceptedFindings],
            "columns": request.columns,
            "rows": (request.rows or [])[:MAX_SPREADSHEET_ROWS_PER_CALL],
        }
        completion = await structured_completion(
            system_prompt=PSUR_FULL_FIX_PROMPT,
            user_content=json.dumps(payload),
        )
        parsed = AiPsurFix.model_validate(completion.data)
        return FixResponse(
            resolutions=[ResolutionOut(**r.model_dump()) for r in parsed.resolutions],
            unresolved=[UnresolvedOut(**u.model_dump()) for u in parsed.unresolved],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
        )
    except AiNotConfiguredError as exc:
        logger.info("PSUR AI fix skipped: %s", exc)
        return FixResponse(resolutions=[], unresolved=[], ai_used=False, prompt_version=PROMPT_VERSION, error=str(exc))
    except AiRequestError as exc:
        logger.error("PSUR AI fix failed: %s", exc)
        return FixResponse(
            resolutions=[], unresolved=[], ai_used=False, prompt_version=PROMPT_VERSION, error="AI fix unavailable."
        )
    except Exception as exc:
        logger.error("PSUR AI fix returned unusable output: %s", exc)
        return FixResponse(
            resolutions=[],
            unresolved=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI fix returned an unusable response.",
        )
