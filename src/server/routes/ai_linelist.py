"""
AI-powered line-list analysis and fix.

OpenAI is the primary issue-detection and fix engine here; the deterministic
rule-based checks in src/services/api/linelist.ts run unconditionally
alongside it and are what the app falls back to if these endpoints are
unavailable, time out, or the frontend can't reach them at all (e.g.
OPENAI_API_KEY not configured server-side — see /status).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..ai.client import AiNotConfiguredError, AiRequestError, VALIDATION_MODEL, is_ai_configured, structured_completion
from ..ai.prompts import (
    LINELIST_ADVERSARIAL_REVIEW_PROMPT,
    LINELIST_ANALYSIS_PROMPT,
    LINELIST_COLUMN_MAPPING_PROMPT,
    LINELIST_FIX_PROMPT,
    LINELIST_OUTCOME_VOCABULARY_PROMPT,
    PROMPT_VERSION,
)
from ..ai.schemas import (
    AiColumnMapping,
    AiOutcomeVocabulary,
    AiLineListAdversarialReview,
    AiLineListAnalysis,
    AiLineListFix,
)
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

# structured_completion()'s 4000-token default was sized for the original,
# smaller per-finding shape — each finding now also carries issueType and
# affectedFields, and a 200-row chunk on a genuinely issue-heavy file (the
# real Ondo AEFI workbook has 500+ rule findings alone) can produce enough
# findings that the response gets truncated mid-JSON against the old
# default, which fails as a terminal (non-retried) JSON-decode error, not
# a transient one — that's a real, reproduced-live regression this fixes.
#
# Reproduced live again at 8000: the configured model (a reasoning-tier
# model — see client.py's temperature/max_completion_tokens handling)
# spends part of this budget on its own hidden reasoning tokens before
# writing the visible JSON answer, so on a genuinely large/issue-heavy
# chunk 8000 wasn't enough headroom for *both* reasoning and the answer —
# finish_reason came back "length" with an empty visible response on all
# 3 retry attempts (a systematic shortfall for that request, not a fluke
# worth just retrying past). Raised with real margin for both.
MAX_ANALYSIS_OUTPUT_TOKENS = 20000

# /fix's response shape (row/column/new_value/reason per issue) is smaller
# per-item than an analysis finding, but a genuinely issue-heavy file can
# still send hundreds of fixable issues in one call — the same reasoning-
# budget risk as MAX_ANALYSIS_OUTPUT_TOKENS applies, so this gets its own
# explicit, larger-than-the-4000-token-default budget rather than relying
# on structured_completion()'s default sized for smaller requests.
MAX_FIX_OUTPUT_TOKENS = 12000


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
    issueType: Optional[str] = None
    affectedFields: list[str] = []


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
            max_output_tokens=MAX_ANALYSIS_OUTPUT_TOKENS,
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
                issueType=f.issueType,
                affectedFields=f.affectedFields,
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

    model_used: Optional[str] = None
    try:
        # Each row-chunk is an independent OpenAI call, so they're fired
        # concurrently rather than awaited one at a time — for a file with
        # more than MAX_ROWS_PER_ANALYSIS_CALL rows (the real Ondo AEFI
        # workbook needs 2), sequential awaiting means the platform-level
        # HTTP timeout between browser and backend has to survive the SUM
        # of every chunk's (possibly retried, reasoning-model-slow) call —
        # reproduced live as a client-side "Failed to fetch" after the
        # backend had, in fact, finished successfully ~2.5 minutes later.
        # Concurrent calls bound total wall-clock to the slowest chunk.
        async def analyze_chunk(offset: int) -> tuple[Optional[str], list[IssueOut]]:
            chunk = request.rows[offset : offset + MAX_ROWS_PER_ANALYSIS_CALL]
            payload = {
                "columns": request.headers,
                "mapping": request.mapping,
                "rows": [{"row": offset + i + 1, **row} for i, row in enumerate(chunk)],
            }
            try:
                completion = await structured_completion(
                    system_prompt=LINELIST_ANALYSIS_PROMPT,
                    user_content=json.dumps(payload),
                    model=VALIDATION_MODEL,
                    max_output_tokens=MAX_ANALYSIS_OUTPUT_TOKENS,
                )
                parsed = AiLineListAnalysis.model_validate(completion.data)
                return completion.model, [
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
                        issueType=f.issueType,
                        affectedFields=f.affectedFields,
                    )
                    for f in parsed.findings
                ]
            except AiNotConfiguredError:
                # Every chunk would fail identically — let this propagate to
                # the outer handler's dedicated "not configured" response
                # instead of being reported as a generic per-chunk failure.
                raise
            except Exception as exc:
                # A single chunk (e.g. one that hit OpenAI's timeout on
                # every retry) used to fail the *entire* file's AI review via
                # asyncio.gather's fail-fast behaviour — other chunks that
                # had already succeeded got silently discarded, so the same
                # file could show a full AI+rule finding set on one run and
                # rule-only findings on the next, with nothing wrong with
                # the file itself. Now only this chunk's rows fall back to
                # rule-based findings; chunks that succeeded are kept.
                logger.warning(
                    "Line-list AI analysis chunk (rows %s-%s) failed, those rows get rule-based findings only: %s",
                    offset + 1, offset + len(chunk), exc,
                )
                return None, []

        chunk_offsets = list(range(0, len(request.rows), MAX_ROWS_PER_ANALYSIS_CALL))
        chunk_results = await asyncio.gather(*(analyze_chunk(offset) for offset in chunk_offsets))
        all_findings: list[IssueOut] = []
        any_chunk_succeeded = False
        for model, findings in chunk_results:
            if model is not None:
                any_chunk_succeeded = True
                model_used = model
            all_findings.extend(findings)

        if not any_chunk_succeeded:
            return AnalyzeResponse(
                findings=[], ai_used=False, prompt_version=PROMPT_VERSION,
                error="AI analysis unavailable; showing rule-based findings only.",
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


# Header reading needs a handful of example values per column, not the
# file. Ten rows is enough to tell "Fever" from "19" and a date from a
# duration, and keeps this call cheap enough to sit in the upload path.
MAX_MAPPING_SAMPLE_ROWS = 10


class MapColumnsRequest(BaseModel):
    headers: list[str]
    rows: list[dict]


class ColumnMappingProposalOut(BaseModel):
    column: str
    field: Optional[str] = None
    confidence: float = 0.0
    reason: str = ""


class MapColumnsResponse(BaseModel):
    proposals: list[ColumnMappingProposalOut]
    ai_used: bool
    prompt_version: str
    model: Optional[str] = None
    error: Optional[str] = None


@router.post("/map-columns", response_model=MapColumnsResponse)
async def map_columns(
    request: MapColumnsRequest,
    user: AuthenticatedUser = Depends(require_permission("linelist.process")),
):
    """Proposes a column -> canonical field mapping by reading the headers
    and a sample of values.

    The deterministic keyword matcher in linelist.ts runs first and remains
    the fallback: this endpoint returning ai_used=False (not configured,
    timed out, malformed response) must never be an error the user sees,
    only a mapping that stays as the keyword matcher left it. That is why
    every failure below returns a 200 with an empty proposal list.
    """
    if not request.headers:
        return MapColumnsResponse(proposals=[], ai_used=False, prompt_version=PROMPT_VERSION)

    # Values only — the model is reading column SHAPE, and sending fewer
    # rows of real patient data than the analysis pass already sends is the
    # right default for a call that only needs examples.
    sample = request.rows[:MAX_MAPPING_SAMPLE_ROWS]
    payload = {
        "columns": request.headers,
        "sample_values": {
            header: [
                str(row.get(header))
                for row in sample
                if row.get(header) not in (None, "")
            ][:5]
            for header in request.headers
        },
    }

    try:
        completion = await structured_completion(
            system_prompt=LINELIST_COLUMN_MAPPING_PROMPT,
            user_content=json.dumps(payload),
            model=VALIDATION_MODEL,
        )
        parsed = AiColumnMapping.model_validate(completion.data)
        return MapColumnsResponse(
            proposals=[
                ColumnMappingProposalOut(
                    column=p.column,
                    field=p.field,
                    confidence=p.confidence,
                    reason=p.reason,
                )
                for p in parsed.proposals
            ],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            model=completion.model,
        )
    except AiNotConfiguredError:
        return MapColumnsResponse(
            proposals=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI is not configured; columns were matched by keyword only.",
        )
    except Exception as exc:
        logger.warning("AI column mapping failed, keeping keyword mapping: %s", exc)
        return MapColumnsResponse(
            proposals=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI column mapping was unavailable; columns were matched by keyword only.",
        )


# A file has a handful of distinct outcome words however many rows it
# has, so this is one small call per upload rather than one per row. The
# cap exists only to bound a pathological file whose outcome column is
# really free text.
MAX_OUTCOME_TERMS = 60


class MapOutcomesRequest(BaseModel):
    """`terms` are the DISTINCT outcome values the deterministic dictionary
    could not resolve — not one entry per row."""

    terms: list[str]


class OutcomeProposalOut(BaseModel):
    term: str
    outcome: Optional[str] = None
    confidence: float = 0.0
    reason: str = ""


class MapOutcomesResponse(BaseModel):
    proposals: list[OutcomeProposalOut]
    ai_used: bool
    prompt_version: str
    model: Optional[str] = None
    error: Optional[str] = None


@router.post("/map-outcomes", response_model=MapOutcomesResponse)
async def map_outcomes(
    request: MapOutcomesRequest,
    user: AuthenticatedUser = Depends(require_permission("linelist.process")),
):
    """Resolves a source's own outcome words to the ICH E2B(R3) E.i.7
    codelist.

    Like /map-columns, every failure answers 200 with ai_used=False: an
    unresolved outcome is the state the file was already in, and must never
    surface as an error that stops the job.
    """
    terms = [t for t in dict.fromkeys(request.terms) if t and t.strip()][:MAX_OUTCOME_TERMS]
    if not terms:
        return MapOutcomesResponse(proposals=[], ai_used=False, prompt_version=PROMPT_VERSION)

    try:
        completion = await structured_completion(
            system_prompt=LINELIST_OUTCOME_VOCABULARY_PROMPT,
            user_content=json.dumps({"terms": terms}),
            model=VALIDATION_MODEL,
        )
        parsed = AiOutcomeVocabulary.model_validate(completion.data)
        return MapOutcomesResponse(
            proposals=[
                OutcomeProposalOut(
                    term=p.term,
                    outcome=p.outcome,
                    confidence=p.confidence,
                    reason=p.reason,
                )
                for p in parsed.proposals
            ],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            model=completion.model,
        )
    except AiNotConfiguredError:
        return MapOutcomesResponse(
            proposals=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI is not configured; outcome values were left for human review.",
        )
    except Exception as exc:
        logger.warning("AI outcome resolution failed, leaving terms unresolved: %s", exc)
        return MapOutcomesResponse(
            proposals=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI outcome resolution was unavailable; values were left for human review.",
        )


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
            model=VALIDATION_MODEL,
            max_output_tokens=MAX_FIX_OUTPUT_TOKENS,
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
