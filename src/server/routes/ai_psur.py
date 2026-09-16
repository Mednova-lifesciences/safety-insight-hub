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
    PSUR_SCREENING_PDF_PROMPT,
)
from ..ai.schemas import AiPsurAdministrativeScreening, AiPsurFix, AiPsurReview
from ..dependencies import AuthenticatedUser, require_any_permission, require_permission

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


class PsurSuggestedSourceOut(BaseModel):
    type: str
    note: str


class PsurFindingOut(BaseModel):
    category: str
    severity: str
    section: str
    description: str
    evidence: str
    # Only present for MISSING_SECTION/SIGNAL/BENEFIT_RISK — see
    # PSUR_REVIEW_PDF_PROMPT/PSUR_REVIEW_SPREADSHEET_PROMPT for the fixed
    # category list and the "never a specific citation" constraint.
    suggested_source: Optional[PsurSuggestedSourceOut] = None
    # Which of the 14 NAFDAC V4 template sections this finding belongs to,
    # and (optionally) which of the 10 deficiency types it is — see
    # AiPsurFinding in schemas.py for the fixed lists both normalize to.
    v4_section: Optional[str] = None
    deficiency_type: Optional[str] = None


class PsurAdministrativeCheckOut(BaseModel):
    id: str
    label: str
    status: str
    comment: str


class PsurSectionCoverageOut(BaseModel):
    section: str
    status: str
    comment: str
    not_applicable_justification: Optional[str] = None


class PsurSpecialPopulationItemOut(BaseModel):
    area: str
    status: str
    comment: str
    not_applicable_justification: Optional[str] = None


class PsurScreeningOut(BaseModel):
    """Administrative Completeness Check — runs before scientific review,
    per the V4 template's own instruction. A recommendation for the
    assessor, never an automatic accept/reject."""

    administrative_checks: list[PsurAdministrativeCheckOut] = []
    section_coverage: list[PsurSectionCoverageOut] = []
    recommendation: str = "PROCEED_TO_SCIENTIFIC_REVIEW"


class PsurKeyBenefitOut(BaseModel):
    benefit: str
    evidence_source: str
    magnitude: str
    evidence_quality: str


class PsurKeyRiskOut(BaseModel):
    kind: str
    risk: str
    severity: str
    frequency: str
    frequency_data_source: str
    reversibility: str
    duration: str
    preventability_risk_management: str
    comment: str


class PsurMissingInformationItemOut(BaseModel):
    missing_information: str
    risk_minimisation_implication: str


class PsurIntegratedEffectsRowOut(BaseModel):
    dimension: str
    evidence_and_uncertainty: str
    reviewer_conclusion: str


class PsurPatientHcpPerspectiveOut(BaseModel):
    available: bool = False
    summary: str = ""


class PsurRiskMinimisationEffectivenessOut(BaseModel):
    outcome: str = "NOT_ASSESSABLE"
    comment: str = ""


class PsurBenefitRiskOut(BaseModel):
    """Section 10 structured sub-tables — PDF narrative reports only."""

    key_benefits: list[PsurKeyBenefitOut] = []
    key_risks: list[PsurKeyRiskOut] = []
    missing_information: list[PsurMissingInformationItemOut] = []
    integrated_effects_table: list[PsurIntegratedEffectsRowOut] = []
    patient_hcp_perspective: PsurPatientHcpPerspectiveOut = PsurPatientHcpPerspectiveOut()
    risk_minimisation_effectiveness: PsurRiskMinimisationEffectivenessOut = PsurRiskMinimisationEffectivenessOut()


class PsurUncertaintyOut(BaseModel):
    category: str
    description: str
    impact_on_conclusion: str
    addressed_by_mah: str
    rationale: str


class PsurRecommendationOut(BaseModel):
    """The AI's non-binding starting point for Section 12 — see
    AiPsurRecommendation in schemas.py. Never the assessor's actual
    decision, which this app records separately once an assessor sets it."""

    actions: list[str] = []
    overall_outcome: Optional[str] = None
    basis: str = ""


class PsurNigerianContextOut(BaseModel):
    """Nigeria-specific facts for Sections 5 and 7 — see
    AiPsurNigerianContext in schemas.py. Never carries VigiFlow figures:
    this service has no VigiFlow integration."""

    nigerian_exposure_provided: bool = False
    nigerian_exposure_evidence: Optional[str] = None
    nigerian_case_count_provided: bool = False
    nigerian_case_count_evidence: Optional[str] = None
    vigiflow_reconciliation_provided: bool = False
    vigiflow_reconciliation_evidence: Optional[str] = None


class ReviewResponse(BaseModel):
    findings: list[PsurFindingOut]
    ai_used: bool
    prompt_version: str
    pages_extracted: Optional[int] = None
    truncated: bool = False
    model: Optional[str] = None
    error: Optional[str] = None
    product: Optional[str] = None
    reporting_period: Optional[str] = None
    mah: Optional[str] = None
    screening: Optional[PsurScreeningOut] = None
    benefit_risk: Optional[PsurBenefitRiskOut] = None
    special_populations: list[PsurSpecialPopulationItemOut] = []
    uncertainties: list[PsurUncertaintyOut] = []
    nigerian_context: Optional[PsurNigerianContextOut] = None
    ai_recommendation: Optional[PsurRecommendationOut] = None


class ReviewPdfTextRequest(BaseModel):
    filename: str
    extractedText: str
    product: str = ""
    reportingPeriod: str = ""


@router.get("/status")
async def ai_status():
    return {"configured": is_ai_configured()}


@router.post("/review-pdf", response_model=ReviewResponse)
async def review_pdf(
    file: UploadFile = File(...),
    product: str = Form(""),
    reportingPeriod: str = Form(""),
    # Two different jobs reach this endpoint: the Review Officer runs the AI
    # check to screen an incoming report, and an Evaluator runs it during
    # scientific review.
    user: AuthenticatedUser = Depends(require_any_permission("psur.screen", "psur.evaluate")),
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
            max_output_tokens=6000,
        )
        parsed = AiPsurReview.model_validate(completion.data)
        return ReviewResponse(
            findings=[PsurFindingOut(**f.model_dump()) for f in parsed.findings],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            pages_extracted=total_pages,
            truncated=truncated,
            model=completion.model,
            product=parsed.product,
            reporting_period=parsed.reporting_period,
            mah=parsed.mah,
            screening=PsurScreeningOut(**parsed.screening.model_dump()) if parsed.screening else None,
            benefit_risk=PsurBenefitRiskOut(**parsed.benefit_risk.model_dump()) if parsed.benefit_risk else None,
            special_populations=[
                PsurSpecialPopulationItemOut(**p.model_dump()) for p in parsed.special_populations
            ],
            uncertainties=[PsurUncertaintyOut(**u.model_dump()) for u in parsed.uncertainties],
            nigerian_context=(
                PsurNigerianContextOut(**parsed.nigerian_context.model_dump())
                if parsed.nigerian_context
                else None
            ),
            ai_recommendation=(
                PsurRecommendationOut(**parsed.ai_recommendation.model_dump()) if parsed.ai_recommendation else None
            ),
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


@router.post("/review-pdf-text", response_model=ReviewResponse)
async def review_pdf_text(
    request: ReviewPdfTextRequest,
    user: AuthenticatedUser = Depends(require_permission("psur.evaluate")),
):
    """Run the deferred scientific review after screening has handed a PDF
    to an evaluator. The extracted text is retained by the document record
    because the original PDF bytes are intentionally not stored."""
    text = request.extractedText.strip()
    if not text:
        return ReviewResponse(
            findings=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="No extracted text is available for scientific review.",
        )

    truncated = len(text) >= MAX_PDF_CHARS
    try:
        payload = {
            "filename": request.filename,
            "declaredProduct": request.product or None,
            "declaredReportingPeriod": request.reportingPeriod or None,
            "totalPages": None,
            "truncated": truncated,
            "extractedText": text[:MAX_PDF_CHARS],
        }
        completion = await structured_completion(
            system_prompt=PSUR_REVIEW_PDF_PROMPT,
            user_content=json.dumps(payload),
            max_output_tokens=6000,
        )
        parsed = AiPsurReview.model_validate(completion.data)
        return ReviewResponse(
            findings=[PsurFindingOut(**f.model_dump()) for f in parsed.findings],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            truncated=truncated,
            model=completion.model,
            product=parsed.product,
            reporting_period=parsed.reporting_period,
            mah=parsed.mah,
            screening=PsurScreeningOut(**parsed.screening.model_dump()) if parsed.screening else None,
            benefit_risk=PsurBenefitRiskOut(**parsed.benefit_risk.model_dump()) if parsed.benefit_risk else None,
            special_populations=[
                PsurSpecialPopulationItemOut(**p.model_dump()) for p in parsed.special_populations
            ],
            uncertainties=[PsurUncertaintyOut(**u.model_dump()) for u in parsed.uncertainties],
            nigerian_context=(
                PsurNigerianContextOut(**parsed.nigerian_context.model_dump())
                if parsed.nigerian_context
                else None
            ),
            ai_recommendation=(
                PsurRecommendationOut(**parsed.ai_recommendation.model_dump())
                if parsed.ai_recommendation
                else None
            ),
        )
    except AiNotConfiguredError as exc:
        logger.info("Deferred PSUR PDF AI review skipped: %s", exc)
        return ReviewResponse(findings=[], ai_used=False, prompt_version=PROMPT_VERSION, error=str(exc))
    except AiRequestError as exc:
        logger.exception("Deferred PSUR PDF AI review failed")
        return ReviewResponse(
            findings=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error=f"AI review unavailable: {exc}",
        )
    except Exception:
        logger.exception("Deferred PSUR PDF AI review returned unusable output")
        return ReviewResponse(
            findings=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
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
    # Same two callers as /review-pdf above.
    user: AuthenticatedUser = Depends(require_any_permission("psur.screen", "psur.evaluate")),
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
            screening=PsurScreeningOut(**parsed.screening.model_dump()) if parsed.screening else None,
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
    # Rewrites the report's content, so this is evaluator work: neither the
    # officer nor the peer reviewer may reach it.
    user: AuthenticatedUser = Depends(require_permission("psur.evaluate")),
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


# ---------------------------------------------------------------------------
# NAFDAC PSUR Administrative Screening Checklist
# ---------------------------------------------------------------------------


class ScreeningCheckOut(BaseModel):
    id: str
    status: str
    deficiency: str = ""


class SubmissionDetailsOut(BaseModel):
    product_name: str = ""
    active_substance: str = ""
    nafdac_reg_no: str = ""
    mah: str = ""
    qppv: str = ""
    qppv_contact: str = ""
    ibd: str = ""
    first_nafdac_registration_date: str = ""
    dlp: str = ""
    interval_covered: str = ""


class AdministrativeScreeningResponse(BaseModel):
    submission_details: Optional[SubmissionDetailsOut] = None
    checks: list[ScreeningCheckOut] = []
    ai_used: bool
    prompt_version: str
    pages_extracted: Optional[int] = None
    truncated: bool = False
    model: Optional[str] = None
    error: Optional[str] = None
    extracted_text: Optional[str] = None


@router.post("/screen-pdf", response_model=AdministrativeScreeningResponse)
async def screen_pdf(
    file: UploadFile = File(...),
    product: str = Form(""),
    reportingPeriod: str = Form(""),
    # The Review Officer's own check, and only theirs. Deliberately narrower
    # than /review-pdf: an evaluator has no business screening a submission,
    # and by the time they see it the officer has already decided.
    user: AuthenticatedUser = Depends(require_permission("psur.screen")),
):
    """Complete the 16-item administrative screening checklist from a PDF.

    A separate call from /review-pdf on purpose. Screening happens on
    receipt, before the report is allocated for scientific assessment, so a
    submission that gets returned to the MAH never costs a full scientific
    review. It also keeps the two prompts focused on one job each.

    Item 8 (timeliness) is deliberately absent from the result: it is date
    arithmetic against a fixed policy and the application computes it from
    the extracted DLP, rather than asking a model to do sums that decide
    whether an MAH was late.
    """
    raw = await file.read()
    try:
        text, total_pages = _extract_pdf_text(raw)
    except Exception as exc:
        logger.error("PDF text extraction failed for %s: %s", file.filename, exc)
        return AdministrativeScreeningResponse(
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            extracted_text=None,
            error="Could not extract text from this PDF.",
        )

    if not text.strip():
        return AdministrativeScreeningResponse(
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            pages_extracted=total_pages,
            extracted_text=text,
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
            system_prompt=PSUR_SCREENING_PDF_PROMPT,
            user_content=json.dumps(payload),
            # Fifteen checks that must each cite their evidence need room to
            # do it; at 2000 the model started truncating its reasoning into
            # bare verdicts.
            max_output_tokens=4000,
        )
        parsed = AiPsurAdministrativeScreening.model_validate(completion.data)

        # No usable rows is a FAILURE, not an assessment.
        #
        # Left unsaid, this arrives at the officer as sixteen rows of
        # "cannot tell from the document" — indistinguishable from a model
        # that read the submission carefully and genuinely could not
        # answer. They are opposite situations: one needs the officer to
        # fill the form in by hand, the other is a bug. Say which.
        if not parsed.checks:
            logger.error(
                "PSUR screening returned no usable checks for %s (model=%s)",
                file.filename,
                completion.model,
            )
            return AdministrativeScreeningResponse(
                submission_details=SubmissionDetailsOut(
                    **parsed.submission_details.model_dump()
                ),
                checks=[],
                ai_used=False,
                prompt_version=PROMPT_VERSION,
                pages_extracted=total_pages,
                truncated=truncated,
                model=completion.model,
                extracted_text=text,
                error=(
                    "The AI returned no usable screening answers, so the checklist below is "
                    "blank and must be completed by hand."
                ),
            )

        return AdministrativeScreeningResponse(
            submission_details=SubmissionDetailsOut(**parsed.submission_details.model_dump()),
            checks=[ScreeningCheckOut(**c.model_dump()) for c in parsed.checks],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            pages_extracted=total_pages,
            truncated=truncated,
            model=completion.model,
            extracted_text=text,
        )
    except AiNotConfiguredError as exc:
        logger.info("PSUR screening skipped: %s", exc)
        return AdministrativeScreeningResponse(
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            pages_extracted=total_pages,
            extracted_text=text,
            error=str(exc),
        )
    except AiRequestError as exc:
        logger.error("PSUR screening failed: %s", exc)
        return AdministrativeScreeningResponse(
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            pages_extracted=total_pages,
            extracted_text=text,
            error=str(exc),
        )
