"""
AI-powered line-list analysis and fix.

OpenAI is the primary issue-detection and fix engine here; the deterministic
rule-based checks in src/services/api/linelist.ts run unconditionally
alongside it and are what the app falls back to if these endpoints are
unavailable, time out, or the frontend can't reach them at all (e.g.
OPENAI_API_KEY not configured server-side — see /status).
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..ai.client import AiNotConfiguredError, AiRequestError, VALIDATION_MODEL, is_ai_configured, structured_completion
from ..ai.prompts import (
    LINELIST_ADVERSARIAL_REVIEW_PROMPT,
    LINELIST_ANALYSIS_PROMPT,
    LINELIST_FIX_PROMPT,
    PROMPT_VERSION,
)
from ..ai.schemas import AiLineListAdversarialReview, AiLineListAnalysis, AiLineListFix
from ..dependencies import AuthenticatedUser, require_permission

logger = logging.getLogger(__name__)
router = APIRouter()

# Keeps a single OpenAI call's token footprint bounded regardless of file
# size — larger files are analysed in multiple calls, each still cheap,
# rather than one call scaling unboundedly with row count.
MAX_ROWS_PER_ANALYSIS_CALL = 200

# Pass 2 (adversarial review) gets every row a Pass-1 finding references,
# plus a small evenly-spaced sample of the rest for baseline context — not
# the whole file again, since it's re-examining Pass 1's findings, not
# redoing Pass 1's scan from scratch.
MAX_ADVERSARIAL_SAMPLE_ROWS = 20


class RowIn(BaseModel):
    model_config = {"extra": "allow"}


class AnalyzeRequest(BaseModel):
    headers: list[str]
    mapping: dict[str, str]
    rows: list[dict]


class IssueOut(BaseModel):
    row: int
    column: str
    severity: str
    confidence: str = "HIGH"
    code: str
    message: str
    value: Optional[str] = None
    fixable: bool = False
    source: str = "ai"


class AnalyzeResponse(BaseModel):
    findings: list[IssueOut]
    ai_used: bool
    prompt_version: str
    model: Optional[str] = None
    error: Optional[str] = None


@router.get("/status")
async def ai_status():
    """Lets the frontend check availability once instead of guessing from
    a failed call, so it can show an accurate "AI unavailable" state."""
    return {"configured": is_ai_configured()}


async def _adversarial_review(
    *,
    headers: list[str],
    mapping: dict[str, str],
    rows: list[dict],
    findings: list[IssueOut],
) -> list[IssueOut]:
    """Pass 2: an independent re-examination of Pass 1's own findings,
    looking for false positives, miscalibrated severity/confidence, and
    clear-cut misses — before anything reaches a human reviewer.

    Best-effort only: any failure here (AI not configured, request error,
    unparseable output) falls back silently to Pass 1's findings, since
    Pass 1 already produced a usable result on its own.
    """
    if not findings:
        return findings

    rows_by_number = {i + 1: row for i, row in enumerate(rows)}
    referenced = sorted({f.row for f in findings if f.row in rows_by_number})

    sample: list[int] = []
    if len(rows) > 0:
        step = max(1, len(rows) // MAX_ADVERSARIAL_SAMPLE_ROWS)
        sample = [r for r in range(1, len(rows) + 1, step)][:MAX_ADVERSARIAL_SAMPLE_ROWS]

    row_numbers = sorted(set(referenced) | set(sample))
    rows_payload = [{"row": r, **rows_by_number[r]} for r in row_numbers if r in rows_by_number]

    try:
        payload = {
            "columns": headers,
            "mapping": mapping,
            "rows": rows_payload,
            "findings": [f.model_dump(exclude={"source"}) for f in findings],
        }
        completion = await structured_completion(
            system_prompt=LINELIST_ADVERSARIAL_REVIEW_PROMPT,
            user_content=json.dumps(payload),
            model=VALIDATION_MODEL,
        )
        parsed = AiLineListAdversarialReview.model_validate(completion.data)
        return [
            IssueOut(
                row=f.row,
                column=f.column,
                severity=f.severity,
                confidence=f.confidence,
                code=f.code,
                message=f.message,
                value=f.value,
                fixable=f.fixable,
                source="ai",
            )
            for f in parsed.findings
        ]
    except Exception as exc:  # AiNotConfiguredError, AiRequestError, or bad output
        logger.warning("Line-list adversarial review (pass 2) skipped, using pass 1 findings: %s", exc)
        return findings


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_linelist(
    request: AnalyzeRequest,
    user: AuthenticatedUser = Depends(require_permission("linelist.process")),
):
    if not request.rows:
        return AnalyzeResponse(findings=[], ai_used=False, prompt_version=PROMPT_VERSION)

    all_findings: list[IssueOut] = []
    model_used: Optional[str] = None
    try:
        for offset in range(0, len(request.rows), MAX_ROWS_PER_ANALYSIS_CALL):
            chunk = request.rows[offset : offset + MAX_ROWS_PER_ANALYSIS_CALL]
            payload = {
                "columns": request.headers,
                "mapping": request.mapping,
                "rows": [{"row": offset + i + 1, **row} for i, row in enumerate(chunk)],
            }
            completion = await structured_completion(
                system_prompt=LINELIST_ANALYSIS_PROMPT,
                user_content=json.dumps(payload),
            )
            model_used = completion.model
            parsed = AiLineListAnalysis.model_validate(completion.data)
            all_findings.extend(
                IssueOut(
                    row=f.row,
                    column=f.column,
                    severity=f.severity,
                    confidence=f.confidence,
                    code=f.code,
                    message=f.message,
                    value=f.value,
                    fixable=f.fixable,
                    source="ai",
                )
                for f in parsed.findings
            )

        all_findings = await _adversarial_review(
            headers=request.headers,
            mapping=request.mapping,
            rows=request.rows,
            findings=all_findings,
        )

        return AnalyzeResponse(
            findings=all_findings, ai_used=True, prompt_version=PROMPT_VERSION, model=model_used
        )
    except AiNotConfiguredError as exc:
        logger.info("Line-list AI analysis skipped: %s", exc)
        return AnalyzeResponse(findings=[], ai_used=False, prompt_version=PROMPT_VERSION, error=str(exc))
    except AiRequestError as exc:
        logger.error("Line-list AI analysis failed: %s", exc)
        return AnalyzeResponse(
            findings=[], ai_used=False, prompt_version=PROMPT_VERSION, error="AI analysis unavailable; showing rule-based findings only."
        )
    except Exception as exc:  # malformed/unvalidatable model output, etc.
        logger.error("Line-list AI analysis returned unusable output: %s", exc)
        return AnalyzeResponse(
            findings=[], ai_used=False, prompt_version=PROMPT_VERSION, error="AI analysis returned an unusable response; showing rule-based findings only."
        )


class FixRequest(BaseModel):
    headers: list[str]
    mapping: dict[str, str]
    rows: list[dict]
    issues: list[dict]


class CorrectionOut(BaseModel):
    row: int
    column: str
    new_value: str
    reason: str


class UnresolvedOut(BaseModel):
    row: int
    column: str
    reason: str


class FixResponse(BaseModel):
    corrections: list[CorrectionOut]
    unresolved: list[UnresolvedOut]
    ai_used: bool
    prompt_version: str
    error: Optional[str] = None


@router.post("/fix", response_model=FixResponse)
async def fix_linelist(
    request: FixRequest,
    user: AuthenticatedUser = Depends(require_permission("linelist.process")),
):
    fixable_issues = [i for i in request.issues if i.get("fixable")]
    if not fixable_issues:
        return FixResponse(corrections=[], unresolved=[], ai_used=False, prompt_version=PROMPT_VERSION)

    # Only the rows that actually have an issue are sent — not the whole
    # file — since that's all the model needs to propose corrections.
    affected_rows = sorted({i["row"] for i in fixable_issues if isinstance(i.get("row"), int)})
    rows_by_number = {i + 1: row for i, row in enumerate(request.rows)}
    rows_payload = [{"row": r, **rows_by_number[r]} for r in affected_rows if r in rows_by_number]

    try:
        payload = {
            "columns": request.headers,
            "mapping": request.mapping,
            "rows": rows_payload,
            "issues": fixable_issues,
        }
        completion = await structured_completion(
            system_prompt=LINELIST_FIX_PROMPT,
            user_content=json.dumps(payload),
        )
        parsed = AiLineListFix.model_validate(completion.data)
        return FixResponse(
            corrections=[CorrectionOut(**c.model_dump()) for c in parsed.corrections],
            unresolved=[UnresolvedOut(**u.model_dump()) for u in parsed.unresolved],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
        )
    except AiNotConfiguredError as exc:
        logger.info("Line-list AI fix skipped: %s", exc)
        return FixResponse(corrections=[], unresolved=[], ai_used=False, prompt_version=PROMPT_VERSION, error=str(exc))
    except AiRequestError as exc:
        logger.error("Line-list AI fix failed: %s", exc)
        return FixResponse(
            corrections=[], unresolved=[], ai_used=False, prompt_version=PROMPT_VERSION, error="AI fix unavailable. No changes were made."
        )
    except Exception as exc:
        logger.error("Line-list AI fix returned unusable output: %s", exc)
        return FixResponse(
            corrections=[], unresolved=[], ai_used=False, prompt_version=PROMPT_VERSION, error="AI fix returned an unusable response. No changes were made."
        )
