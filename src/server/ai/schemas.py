"""
Pydantic models that every OpenAI response is validated against before the
application uses it. This is the actual safety boundary — "never blindly
parse untrusted model output" — not the JSON-mode request itself. A
response that doesn't validate is treated exactly like a failed request:
the caller falls back to deterministic behaviour.
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------- Line-list --

class AiLineListFinding(BaseModel):
    row: int
    column: str
    severity: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    code: str
    message: str
    value: Optional[str] = None
    fixable: bool = False
    # Required, not defaulted: forces the model to actually make the call
    # explicit (see LINELIST_ANALYSIS_PROMPT) rather than this silently
    # reading as confident when the model just omitted the field. LOW means
    # this finding depended on inferring an unfamiliar column's role, a
    # typo/near-miss judgment call, or a plausibility check rather than an
    # exact rule — the app gates auto-fix on this (see ai_linelist.py).
    confidence: Literal["HIGH", "LOW"]
    # Normalized, engine-agnostic classification of *what kind* of problem
    # this is — lets the app safely recognise when this finding describes
    # the same underlying issue as a deterministic rule finding, without
    # depending on `code` (freely invented by the model, and will not
    # reliably match a rule's fixed code string). Optional: a response
    # missing it still validates and the finding still displays, it just
    # isn't eligible to merge with an equivalent rule finding. See
    # LINELIST_ANALYSIS_PROMPT for the exact enum and merge semantics.
    issueType: Optional[
        Literal[
            "FIELD_MISSING",
            "FIELD_VALUE_INVALID",
            "FIELD_FORMAT_INVALID",
            "FIELD_CONTENT_MISMATCH",
            "CROSS_FIELD_CONTRADICTION",
            "DATE_CHRONOLOGY",
            "STRUCTURAL_COLUMN_SHIFT",
            "DUPLICATE_RECORD",
        ]
    ] = None
    # Canonical field name(s) (from the `mapping` values given in the
    # request, e.g. "seriousness", "onset_date") this finding is actually
    # about — more than one for a cross-field finding, e.g.
    # ["vaccination_date", "onset_date"] for a chronology conflict.
    affectedFields: list[str] = Field(default_factory=list)


class AiLineListAnalysis(BaseModel):
    # Required, not defaulted: a response missing this key entirely means
    # the model didn't follow the schema at all, which should fail
    # validation and trigger the rule-based fallback — not be silently
    # read as "zero issues found". The prompt always asks for the key
    # explicitly, even when the answer is an empty list.
    findings: list[AiLineListFinding]


class AiLineListAdversarialReview(BaseModel):
    """Pass 2's output *is* the final finding list, in the same shape as
    Pass 1 — the adversarial reviewer returns findings it actually stands
    behind (with severity/confidence adjusted where warranted), having
    dropped ones it couldn't support and added any material ones it found
    while re-examining the same rows. Required, not defaulted, for the
    same reason as AiLineListAnalysis.findings above."""

    findings: list[AiLineListFinding]


class AiLineListCorrection(BaseModel):
    row: int
    column: str
    new_value: str
    reason: str


class AiLineListUnresolved(BaseModel):
    row: int
    column: str
    reason: str


class AiLineListFix(BaseModel):
    corrections: list[AiLineListCorrection]
    unresolved: list[AiLineListUnresolved]


# ---------------------------------------------------------------------- PSUR --

class AiPsurFinding(BaseModel):
    category: Literal["MISSING_SECTION", "CONSISTENCY", "NUMERICAL", "SIGNAL", "BENEFIT_RISK"]
    severity: Literal["HIGH", "MEDIUM", "LOW"]
    section: str
    description: str
    evidence: str


class AiPsurReview(BaseModel):
    findings: list[AiPsurFinding]  # required — see AiLineListAnalysis for why


class AiPsurResolution(BaseModel):
    finding_id: str
    resolution_text: str
    row: Optional[int] = None
    column: Optional[str] = None
    new_value: Optional[str] = None


class AiPsurUnresolved(BaseModel):
    finding_id: str
    reason: str


class AiPsurFix(BaseModel):
    resolutions: list[AiPsurResolution]
    unresolved: list[AiPsurUnresolved]


# ---------------------------------------------------------------------- ICSR --

class AiIcsrDrugFinding(BaseModel):
    """One suspected drug found in the image. The singular product* fields
    on AiIcsrExtraction always mirror suspectedDrugs[0] (backward
    compatibility for callers that only read the singular fields) — this
    array is the source of truth when there is more than one suspect
    drug on the same report."""

    productName: Optional[str] = None
    productDose: Optional[str] = None
    productRoute: Optional[str] = None
    productIndication: Optional[str] = None
    therapyStartDate: Optional[str] = None
    productAction: Optional[str] = None
    batchNumber: Optional[str] = None
    expiryDate: Optional[str] = None


class AiIcsrConcomitantMed(BaseModel):
    name: Optional[str] = None
    dose: Optional[str] = None
    indication: Optional[str] = None


class AiIcsrDynamicField(BaseModel):
    """A meaningful, clearly-labeled field the model found on the source
    document that does not map to any canonical ICSR field above (e.g. a
    facility LGA, a hospital department, a country-specific reporting
    code). The canonical fields remain the single source of truth for
    validation/E2B/workflow — this exists so that real information on a
    real form is never silently dropped just because our fixed schema
    has no slot for it."""

    label: str
    value: Optional[str] = None
    # The label exactly as it appeared on the source document — the model
    # is instructed to prefer this over inventing a standardized name.
    originalLabel: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class AiIcsrExtraction(BaseModel):
    reporterName: Optional[str] = None
    reporterQualification: Optional[str] = None
    reporterCountry: Optional[str] = None
    reporterContact: Optional[str] = None
    patientIdentifier: Optional[str] = None
    patientAge: Optional[str] = None
    patientSex: Optional[Literal["MALE", "FEMALE", "UNKNOWN"]] = None
    patientWeightKg: Optional[str] = None
    patientMedicalHistory: Optional[str] = None
    productName: Optional[str] = None
    productDose: Optional[str] = None
    productRoute: Optional[str] = None
    productIndication: Optional[str] = None
    therapyStartDate: Optional[str] = None
    productAction: Optional[str] = None
    reactionTerm: Optional[str] = None
    onsetDate: Optional[str] = None
    endDate: Optional[str] = None
    outcome: Optional[
        Literal["RECOVERED", "RECOVERING", "NOT_RECOVERED", "RECOVERED_WITH_SEQUELAE", "FATAL", "UNKNOWN"]
    ] = None
    reportedSeriousness: Optional[Literal["SERIOUS", "NON_SERIOUS", "UNASSESSED"]] = None
    narrative: Optional[str] = None
    additionalInformation: Optional[str] = None
    # Every suspected drug on the report, including the same one already
    # mirrored into the singular product* fields above as element 0.
    suspectedDrugs: list[AiIcsrDrugFinding] = Field(default_factory=list)
    concomitantMedicines: list[AiIcsrConcomitantMed] = Field(default_factory=list)
    # Exact strings from the known seriousness-criteria checkbox list that
    # the prompt provides — only ones actually marked/ticked in the image.
    seriousnessCriteria: list[str] = Field(default_factory=list)
    # Meaningful fields found on the document that don't map to any of the
    # canonical fields above — see AiIcsrDynamicField's own doc comment.
    dynamicFields: list[AiIcsrDynamicField] = Field(default_factory=list)
    lowConfidenceFields: list[str] = Field(default_factory=list)

    @field_validator("*", mode="before")
    @classmethod
    def blank_to_none(cls, v):
        # The model sometimes returns "" or "unknown"/"n/a" instead of a
        # real null — normalise those to None so the frontend doesn't
        # render a fake-looking value.
        if isinstance(v, str) and v.strip().lower() in ("", "unknown", "n/a", "none", "null"):
            return None
        return v
