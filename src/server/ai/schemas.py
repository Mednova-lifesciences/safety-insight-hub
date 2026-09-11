"""
Pydantic models that every OpenAI response is validated against before the
application uses it. This is the actual safety boundary — "never blindly
parse untrusted model output" — not the JSON-mode request itself. A
response that doesn't validate is treated exactly like a failed request:
the caller falls back to deterministic behaviour.
"""
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------------------------------------------------------------- Line-list --

_KNOWN_LINELIST_ISSUE_TYPES = {
    "FIELD_MISSING",
    "FIELD_VALUE_INVALID",
    "FIELD_FORMAT_INVALID",
    "FIELD_CONTENT_MISMATCH",
    "CROSS_FIELD_CONTRADICTION",
    "DATE_CHRONOLOGY",
    "STRUCTURAL_COLUMN_SHIFT",
    "DUPLICATE_RECORD",
}


_KNOWN_LINELIST_SEVERITIES = {"CRITICAL", "HIGH", "MEDIUM", "LOW"}


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

    @field_validator("severity", mode="before")
    @classmethod
    def _normalize_severity(cls, v):
        # Reproduced live: a real response otherwise well-formed across 30+
        # findings had one finding's severity come back as
        # "FIELD_CONTENT_MISMATCH" (an issueType value, not a severity) —
        # a strict Literal here rejected the *entire* batch over that one
        # field on one finding, discarding every other valid finding along
        # with it. Same reasoning as issueType below: degrade an
        # unrecognised value to a safe default so one bad field doesn't
        # sink the whole response.
        if isinstance(v, str) and v.strip().upper() in _KNOWN_LINELIST_SEVERITIES:
            return v.strip().upper()
        return "MEDIUM"

    @field_validator("issueType", mode="before")
    @classmethod
    def _normalize_issue_type(cls, v):
        # This app uses plain JSON mode, not OpenAI's schema-constrained
        # output — nothing stops the model from returning a slightly-off
        # or invented classification for one finding among many. A strict
        # Literal would fail *the entire batch's* validation over that one
        # field on one finding, which is exactly the kind of fragility
        # that turned a working endpoint into one that reproducibly failed
        # after this field was added. Degrade an unrecognised value to
        # "not classified" instead of rejecting the whole response.
        if isinstance(v, str) and v.strip().upper() in _KNOWN_LINELIST_ISSUE_TYPES:
            return v.strip().upper()
        return None

    @field_validator("affectedFields", mode="before")
    @classmethod
    def _normalize_affected_fields(cls, v):
        # Same reasoning as issueType: a model returning null, a bare
        # string, or something else non-list here must degrade to "no
        # fields given" rather than fail the whole response's validation.
        if isinstance(v, list):
            return [str(item) for item in v if isinstance(item, str)]
        if isinstance(v, str) and v.strip():
            return [v.strip()]
        return []


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

_KNOWN_PSUR_CATEGORIES = {"MISSING_SECTION", "CONSISTENCY", "NUMERICAL", "SIGNAL", "BENEFIT_RISK"}
_KNOWN_PSUR_SEVERITIES = {"HIGH", "MEDIUM", "LOW"}
# Every one of these is a place the NAFDAC PSUR/PBRER assessor template
# itself already names as somewhere to check for missing evidence
# (VigiFlow's Nigerian component, requesting info from the MAH, literature
# review, the RSI/SmPC, other regulators' actions, patient/HCP feedback,
# RMP/PASS) — never invented. This is a fixed category + a short note,
# deliberately never a specific document title, URL, or citation: an LLM
# naming a fabricated-but-authoritative-sounding source in a regulatory
# tool is exactly the failure mode this schema exists to make impossible.
_KNOWN_PSUR_SOURCE_TYPES = {
    "VIGIFLOW_NIGERIA",
    "REQUEST_FROM_MAH",
    "PUBLISHED_LITERATURE",
    "REFERENCE_SAFETY_INFORMATION",
    "WORLDWIDE_REGULATORY_ACTIONS",
    "PATIENT_HCP_FEEDBACK",
    "RISK_MANAGEMENT_PLAN",
    "OTHER",
}
# Only these categories are genuinely about missing EXTERNAL evidence;
# CONSISTENCY/NUMERICAL findings are about an internal contradiction to
# resolve, not something a source pointer helps with.
_PSUR_CATEGORIES_ALLOWING_SOURCE = {"MISSING_SECTION", "SIGNAL", "BENEFIT_RISK"}

# The 14 sections of the NAFDAC PSUR/PBRER Evaluation Form V4
# (docs/NAFDAC_PSUR_Template_V4_Proposed.docx) — mirrors
# PSUR_V4_TEMPLATE_SECTIONS in src/types/pv.ts (TS-side source of truth
# for the frontend). Two runtimes, deliberately duplicated; keep both in
# sync if the template's section list ever changes.
_KNOWN_V4_SECTIONS = {
    "ADMIN_SCREENING", "S1_PRODUCT_REGULATORY", "S2_WORLDWIDE_STATUS", "S3_THERAPEUTIC_CONTEXT",
    "S4_RSI", "S5_EXPOSURE_ACTIONS", "S6_LITERATURE", "S7_AGGREGATE_SAFETY_DATA",
    "S8_SIGNAL_EVALUATION", "S9_SPECIAL_POPULATIONS", "S10_BENEFIT_RISK", "S11_UNCERTAINTIES",
    "S12_REGULATORY_DECISION", "S13_CONCLUSION_SIGNOFF",
}

# The 10 deficiency categories from the product-owner spec — a richer,
# OPTIONAL classification layered on top of the 5-value `category` above
# (which stays for backward compatibility). Never force a finding into
# one of these if the evidence doesn't support it.
_KNOWN_DEFICIENCY_TYPES = {
    "MISSING_INFORMATION", "INCOMPLETE_INFORMATION", "INADEQUATE_EVIDENCE", "INCONSISTENCY",
    "UNCLEAR_AMBIGUOUS_INFORMATION", "UNSUPPORTED_CLAIM", "MISSING_REQUIRED_SECTION",
    "INSUFFICIENT_LOCAL_EVIDENCE", "ADDITIONAL_LITERATURE_REQUIRED", "DATA_DISCREPANCY",
}


class AiPsurSuggestedSource(BaseModel):
    type: Literal[
        "VIGIFLOW_NIGERIA",
        "REQUEST_FROM_MAH",
        "PUBLISHED_LITERATURE",
        "REFERENCE_SAFETY_INFORMATION",
        "WORLDWIDE_REGULATORY_ACTIONS",
        "PATIENT_HCP_FEEDBACK",
        "RISK_MANAGEMENT_PLAN",
        "OTHER",
    ]
    note: str

    @field_validator("type", mode="before")
    @classmethod
    def _normalize_type(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_PSUR_SOURCE_TYPES:
            return v.strip().upper()
        return "OTHER"


class AiPsurFinding(BaseModel):
    category: Literal["MISSING_SECTION", "CONSISTENCY", "NUMERICAL", "SIGNAL", "BENEFIT_RISK"]
    severity: Literal["HIGH", "MEDIUM", "LOW"]
    section: str
    description: str
    evidence: str
    suggested_source: Optional[AiPsurSuggestedSource] = None
    # Which of the 14 real V4 template sections this finding is actually
    # about — None when the model couldn't confidently place it (never
    # forced), NOT a free-text guess.
    v4_section: Optional[str] = None
    # Richer, optional classification alongside `category` — see
    # _KNOWN_DEFICIENCY_TYPES. None is a legitimate value, not a failure.
    deficiency_type: Optional[str] = None

    # Same fragility as AiLineListFinding.severity above, and the same fix:
    # one finding with an off-enum category or severity would otherwise
    # fail the entire review's validation, discarding every other finding.
    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_PSUR_CATEGORIES:
            return v.strip().upper()
        return "CONSISTENCY"

    @field_validator("severity", mode="before")
    @classmethod
    def _normalize_severity(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_PSUR_SEVERITIES:
            return v.strip().upper()
        return "MEDIUM"

    @field_validator("v4_section", mode="before")
    @classmethod
    def _normalize_v4_section(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_V4_SECTIONS:
            return v.strip().upper()
        return None

    @field_validator("deficiency_type", mode="before")
    @classmethod
    def _normalize_deficiency_type(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_DEFICIENCY_TYPES:
            return v.strip().upper()
        return None

    # A CONSISTENCY/NUMERICAL finding is about an internal contradiction,
    # not missing external evidence — silently drop a source suggestion
    # here rather than let the model attach one to the wrong kind of
    # finding (never fail the whole finding over it).
    @model_validator(mode="after")
    def _drop_source_on_disallowed_category(self):
        if self.category not in _PSUR_CATEGORIES_ALLOWING_SOURCE:
            self.suggested_source = None
        return self


_KNOWN_ADMIN_CHECK_IDS = {
    "FOLLOWS_E2C_R2_TEMPLATE", "DLP_CORRECTLY_STATED",
    "MANDATORY_SECTIONS_PRESENT_OR_JUSTIFIED", "RECEIVED_WITHIN_TIMEFRAME",
}
_KNOWN_TRISTATE = {"YES", "NO", "NOT_ASSESSABLE"}


class AiPsurAdministrativeCheck(BaseModel):
    """One row of the Administrative Completeness Check — run BEFORE
    detailed scientific review, per the V4 template's own instruction
    that a deficient submission should be identifiable before scientific
    assessment begins."""

    id: Literal[
        "FOLLOWS_E2C_R2_TEMPLATE", "DLP_CORRECTLY_STATED",
        "MANDATORY_SECTIONS_PRESENT_OR_JUSTIFIED", "RECEIVED_WITHIN_TIMEFRAME",
    ]
    label: str
    status: Literal["YES", "NO", "NOT_ASSESSABLE"]
    comment: str

    @field_validator("id", mode="before")
    @classmethod
    def _normalize_id(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_ADMIN_CHECK_IDS:
            return v.strip().upper()
        return "MANDATORY_SECTIONS_PRESENT_OR_JUSTIFIED"

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_TRISTATE:
            return v.strip().upper()
        return "NOT_ASSESSABLE"


_KNOWN_SECTION_STATUSES = {
    "ADEQUATELY_ADDRESSED", "PRESENT_BUT_INCOMPLETE", "MISSING", "NOT_APPLICABLE",
}


class AiPsurSectionCoverage(BaseModel):
    """Coarse 'how well is this V4 section addressed' check — distinct
    from the deep per-field findings in `AiPsurReview.findings`, but no
    longer a bare presence boolean: judge whether the required CONTENT is
    actually covered (never merely whether a matching heading exists), and
    use NOT_APPLICABLE (with a justification) rather than MISSING when a
    requirement genuinely doesn't apply to this product/submission.
    ASSESSOR_PENDING is deliberately NOT a value the model can choose —
    that state means "not assessed at all," which only applies when this
    schema wasn't populated in the first place."""

    section: Literal[
        "ADMIN_SCREENING", "S1_PRODUCT_REGULATORY", "S2_WORLDWIDE_STATUS", "S3_THERAPEUTIC_CONTEXT",
        "S4_RSI", "S5_EXPOSURE_ACTIONS", "S6_LITERATURE", "S7_AGGREGATE_SAFETY_DATA",
        "S8_SIGNAL_EVALUATION", "S9_SPECIAL_POPULATIONS", "S10_BENEFIT_RISK", "S11_UNCERTAINTIES",
        "S12_REGULATORY_DECISION", "S13_CONCLUSION_SIGNOFF",
    ]
    status: Literal["ADEQUATELY_ADDRESSED", "PRESENT_BUT_INCOMPLETE", "MISSING", "NOT_APPLICABLE"]
    comment: str
    # Required (by the prompt's own instruction, not enforced here) only
    # when status is NOT_APPLICABLE — None is legitimate for every other
    # status.
    not_applicable_justification: Optional[str] = None

    @field_validator("section", mode="before")
    @classmethod
    def _normalize_section(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_V4_SECTIONS:
            return v.strip().upper()
        return "S1_PRODUCT_REGULATORY"

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, v):
        # Same fragility/fix as every other enum-ish field on plain JSON
        # mode: one off-enum value must degrade, not fail the whole
        # response. A model that returns the old boolean shape (present:
        # true/false) is also tolerated here via the pre-validator on
        # AiPsurScreening below, which upgrades it before this runs.
        if isinstance(v, str) and v.strip().upper() in _KNOWN_SECTION_STATUSES:
            return v.strip().upper()
        return "MISSING"

    @model_validator(mode="after")
    def _require_justification_shape(self):
        # A NOT_APPLICABLE with no justification is a bare guess wearing
        # the "justified" status's clothes — downgrade it rather than let
        # an unjustified not-applicable through. Never invents a reason;
        # just refuses to accept the claim without one.
        if self.status == "NOT_APPLICABLE" and not (self.not_applicable_justification or "").strip():
            self.status = "PRESENT_BUT_INCOMPLETE"
        return self


class AiPsurScreening(BaseModel):
    """Administrative Completeness Check result — a RECOMMENDATION for
    the assessor, never an automatic accept/reject (see prompts.py)."""

    administrative_checks: list[AiPsurAdministrativeCheck] = []
    section_coverage: list[AiPsurSectionCoverage] = []
    recommendation: Literal["PROCEED_TO_SCIENTIFIC_REVIEW", "RETURN_TO_MAH_FIRST"] = "PROCEED_TO_SCIENTIFIC_REVIEW"

    @field_validator("section_coverage", mode="before")
    @classmethod
    def _upgrade_legacy_present_boolean(cls, v):
        # Plain JSON mode gives no hard guarantee the model follows this
        # prompt version's shape exactly — tolerate the old `present:
        # bool` shape by upgrading it to `status` before AiPsurSectionCoverage
        # validates each entry, rather than let one old-shaped item sink
        # the model's entire section_coverage list.
        if not isinstance(v, list):
            return v
        upgraded = []
        for item in v:
            if isinstance(item, dict) and "status" not in item and "present" in item:
                item = {**item, "status": "PRESENT_BUT_INCOMPLETE" if item.get("present") else "MISSING"}
            upgraded.append(item)
        return upgraded

    @field_validator("recommendation", mode="before")
    @classmethod
    def _normalize_recommendation(cls, v):
        if isinstance(v, str) and v.strip().upper() in {"PROCEED_TO_SCIENTIFIC_REVIEW", "RETURN_TO_MAH_FIRST"}:
            return v.strip().upper()
        return "PROCEED_TO_SCIENTIFIC_REVIEW"


_KNOWN_EVIDENCE_QUALITY = {"HIGH", "MODERATE", "LOW", "VERY_LOW", "NOT_ASSESSABLE"}


class AiPsurKeyBenefit(BaseModel):
    benefit: str
    evidence_source: str
    magnitude: str
    evidence_quality: Literal["HIGH", "MODERATE", "LOW", "VERY_LOW", "NOT_ASSESSABLE"] = "NOT_ASSESSABLE"

    @field_validator("evidence_quality", mode="before")
    @classmethod
    def _normalize_quality(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_EVIDENCE_QUALITY:
            return v.strip().upper()
        return "NOT_ASSESSABLE"


class AiPsurKeyRisk(BaseModel):
    kind: Literal["IDENTIFIED", "POTENTIAL"] = "POTENTIAL"
    risk: str
    severity: str
    frequency: str
    # The template requires an appropriate denominator/category AND the
    # data source for any frequency estimate — never a bare number.
    frequency_data_source: str
    reversibility: str
    duration: str
    preventability_risk_management: str
    comment: str

    @field_validator("kind", mode="before")
    @classmethod
    def _normalize_kind(cls, v):
        if isinstance(v, str) and v.strip().upper() in {"IDENTIFIED", "POTENTIAL"}:
            return v.strip().upper()
        return "POTENTIAL"


class AiPsurMissingInformationItem(BaseModel):
    missing_information: str
    risk_minimisation_implication: str


class AiPsurIntegratedEffectsRow(BaseModel):
    dimension: Literal["CONDITION_UNMET_NEED", "CURRENT_TREATMENT_OPTIONS", "BENEFIT", "RISK", "RISK_MANAGEMENT"]
    evidence_and_uncertainty: str
    reviewer_conclusion: str

    @field_validator("dimension", mode="before")
    @classmethod
    def _normalize_dimension(cls, v):
        known = {"CONDITION_UNMET_NEED", "CURRENT_TREATMENT_OPTIONS", "BENEFIT", "RISK", "RISK_MANAGEMENT"}
        if isinstance(v, str) and v.strip().upper() in known:
            return v.strip().upper()
        return "BENEFIT"


class AiPsurRiskMinimisationEffectiveness(BaseModel):
    outcome: Literal["NOT_APPLICABLE", "EFFECTIVE", "PARTIALLY_EFFECTIVE", "NOT_EFFECTIVE", "NOT_ASSESSABLE"] = (
        "NOT_ASSESSABLE"
    )
    comment: str = ""

    @field_validator("outcome", mode="before")
    @classmethod
    def _normalize_outcome(cls, v):
        known = {"NOT_APPLICABLE", "EFFECTIVE", "PARTIALLY_EFFECTIVE", "NOT_EFFECTIVE", "NOT_ASSESSABLE"}
        if isinstance(v, str) and v.strip().upper() in known:
            return v.strip().upper()
        return "NOT_ASSESSABLE"


class AiPsurPatientHcpPerspective(BaseModel):
    available: bool = False
    summary: str = ""


class AiPsurBenefitRisk(BaseModel):
    """Section 10 (Benefit-Risk Assessment) structured sub-tables. Every
    field the model could not genuinely support from the actual document
    text should read as empty/NOT_ASSESSABLE rather than be fabricated —
    see PSUR_V4_ASSESSMENT_PROMPT's explicit instruction on this."""

    key_benefits: list[AiPsurKeyBenefit] = []
    key_risks: list[AiPsurKeyRisk] = []
    missing_information: list[AiPsurMissingInformationItem] = []
    integrated_effects_table: list[AiPsurIntegratedEffectsRow] = []
    patient_hcp_perspective: AiPsurPatientHcpPerspective = Field(default_factory=AiPsurPatientHcpPerspective)
    risk_minimisation_effectiveness: AiPsurRiskMinimisationEffectiveness = Field(
        default_factory=AiPsurRiskMinimisationEffectiveness
    )


_KNOWN_SPECIAL_POPULATION_AREAS = {
    "PREGNANCY_LACTATION", "PAEDIATRIC", "GERIATRIC", "HEPATIC_IMPAIRMENT", "RENAL_IMPAIRMENT",
    "OVERDOSE_MISUSE_ABUSE_MEDICATION_ERROR", "OFF_LABEL_USE", "OTHER_MISSING_INFORMATION",
}


class AiPsurSpecialPopulationItem(BaseModel):
    """One of Section 9's 8 fixed areas. Judge each independently from
    what the text actually says — do not assume every area is deficient
    simply because it isn't explicitly named; use NOT_APPLICABLE (with a
    justification) when a product genuinely has no relevance to an area
    (e.g. no paediatric indication) rather than MISSING."""

    area: Literal[
        "PREGNANCY_LACTATION", "PAEDIATRIC", "GERIATRIC", "HEPATIC_IMPAIRMENT", "RENAL_IMPAIRMENT",
        "OVERDOSE_MISUSE_ABUSE_MEDICATION_ERROR", "OFF_LABEL_USE", "OTHER_MISSING_INFORMATION",
    ]
    status: Literal["ADEQUATELY_ADDRESSED", "PRESENT_BUT_INCOMPLETE", "MISSING", "NOT_APPLICABLE"]
    comment: str
    not_applicable_justification: Optional[str] = None

    @field_validator("area", mode="before")
    @classmethod
    def _normalize_area(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_SPECIAL_POPULATION_AREAS:
            return v.strip().upper()
        return "OTHER_MISSING_INFORMATION"

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_SECTION_STATUSES:
            return v.strip().upper()
        return "MISSING"

    @model_validator(mode="after")
    def _require_justification_shape(self):
        if self.status == "NOT_APPLICABLE" and not (self.not_applicable_justification or "").strip():
            self.status = "PRESENT_BUT_INCOMPLETE"
        return self


_KNOWN_UNCERTAINTY_CATEGORIES = {
    "DATA_LIMITATIONS_UNDERREPORTING", "LIMITED_NIGERIAN_EXPOSURE", "MISSING_SUBPOPULATION_DATA",
    "SHORT_FOLLOWUP_DURATION", "STUDY_DESIGN_LIMITATIONS", "LIMITED_GENERALISABILITY", "OTHER",
}


class AiPsurUncertainty(BaseModel):
    category: Literal[
        "DATA_LIMITATIONS_UNDERREPORTING", "LIMITED_NIGERIAN_EXPOSURE", "MISSING_SUBPOPULATION_DATA",
        "SHORT_FOLLOWUP_DURATION", "STUDY_DESIGN_LIMITATIONS", "LIMITED_GENERALISABILITY", "OTHER",
    ]
    description: str
    impact_on_conclusion: Literal["LOW", "MODERATE", "HIGH"] = "MODERATE"
    addressed_by_mah: Literal["YES", "PARTIALLY", "NO"] = "NO"
    rationale: str

    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_UNCERTAINTY_CATEGORIES:
            return v.strip().upper()
        return "OTHER"

    @field_validator("impact_on_conclusion", mode="before")
    @classmethod
    def _normalize_impact(cls, v):
        if isinstance(v, str) and v.strip().upper() in {"LOW", "MODERATE", "HIGH"}:
            return v.strip().upper()
        return "MODERATE"

    @field_validator("addressed_by_mah", mode="before")
    @classmethod
    def _normalize_addressed(cls, v):
        if isinstance(v, str) and v.strip().upper() in {"YES", "PARTIALLY", "NO"}:
            return v.strip().upper()
        return "NO"


_KNOWN_RISK_MINIMISATION_ACTIONS = {
    "NO_ACTION_REQUIRED", "CONTINUE_ROUTINE_PV", "REQUEST_ADDITIONAL_INFO_FROM_MAH", "REQUEST_MAH_CLARIFICATION",
    "TARGETED_COMMUNICATION_SAFETY_LETTER", "SUBMIT_UPDATE_RMP", "PROPOSAL_FOR_PASS", "UPDATE_SMPC_PIL_LABEL",
    "REFER_TO_EXPERT_ADVISORY_COMMITTEE", "RECOMMEND_SUSPENSION_WITHDRAWAL",
}
_KNOWN_OVERALL_OUTCOMES = {
    "FAVOURABLE", "FAVOURABLE_WITH_CONDITIONS", "UNCERTAIN_REQUIRES_FOLLOWUP", "UNFAVOURABLE",
}


class AiPsurRecommendation(BaseModel):
    """The AI's NON-BINDING starting point for Section 12 — kept as a
    structurally separate model from any assessor-owned decision record
    so it can never be mistaken for, or silently promoted to, the actual
    regulatory conclusion. The assessor decides; this only proposes."""

    actions: list[
        Literal[
            "NO_ACTION_REQUIRED", "CONTINUE_ROUTINE_PV", "REQUEST_ADDITIONAL_INFO_FROM_MAH",
            "REQUEST_MAH_CLARIFICATION", "TARGETED_COMMUNICATION_SAFETY_LETTER", "SUBMIT_UPDATE_RMP",
            "PROPOSAL_FOR_PASS", "UPDATE_SMPC_PIL_LABEL", "REFER_TO_EXPERT_ADVISORY_COMMITTEE",
            "RECOMMEND_SUSPENSION_WITHDRAWAL",
        ]
    ] = []
    overall_outcome: Optional[
        Literal["FAVOURABLE", "FAVOURABLE_WITH_CONDITIONS", "UNCERTAIN_REQUIRES_FOLLOWUP", "UNFAVOURABLE"]
    ] = None
    basis: str = ""

    @field_validator("actions", mode="before")
    @classmethod
    def _normalize_actions(cls, v):
        if not isinstance(v, list):
            return []
        return [a.strip().upper() for a in v if isinstance(a, str) and a.strip().upper() in _KNOWN_RISK_MINIMISATION_ACTIONS]

    @field_validator("overall_outcome", mode="before")
    @classmethod
    def _normalize_outcome(cls, v):
        if isinstance(v, str) and v.strip().upper() in _KNOWN_OVERALL_OUTCOMES:
            return v.strip().upper()
        return None


class AiPsurReview(BaseModel):
    findings: list[AiPsurFinding]  # required — see AiLineListAnalysis for why
    # Best-effort extraction from the document text itself — the frontend
    # seeds the document record with "Not yet extracted" placeholders that
    # otherwise never get filled in for a PDF upload (there was nowhere for
    # an extracted value to come back to). None when the model couldn't
    # confidently identify either from the (possibly truncated) text.
    product: Optional[str] = None
    reporting_period: Optional[str] = None
    # Marketing Authorisation Holder — Section 1 requires it, extracted the
    # same best-effort way as product/reporting_period. None when the text
    # doesn't state it confidently; never guessed from the product name or
    # any other inference.
    mah: Optional[str] = None
    # Administrative Completeness Check — runs as part of the same call
    # for a PDF (screening + scientific review share the same extracted
    # text, so one call is more coherent than two that could disagree).
    screening: Optional[AiPsurScreening] = None
    # Section 10 structured sub-tables — PDF narrative reports only.
    benefit_risk: Optional[AiPsurBenefitRisk] = None
    # Section 9 — one entry per fixed special-population/special-situation
    # area (PDF narrative reports only, same reasoning as benefit_risk).
    special_populations: list[AiPsurSpecialPopulationItem] = []
    # Section 11 — one row per identified uncertainty.
    uncertainties: list[AiPsurUncertainty] = []
    # AI's non-binding starting point for Section 12 — see AiPsurRecommendation.
    ai_recommendation: Optional[AiPsurRecommendation] = None


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


# ----------------------------------------------------------- WhatsApp intake --

class AiWhatsAppSuspectProduct(BaseModel):
    reportedName: str
    activeIngredient: Optional[str] = None
    dose: Optional[str] = None
    route: Optional[str] = None
    indication: Optional[str] = None
    batchNumber: Optional[str] = None


class AiWhatsAppReaction(BaseModel):
    reportedTerm: str
    onsetDate: Optional[str] = None
    outcome: Optional[
        Literal["RECOVERED", "RECOVERING", "NOT_RECOVERED", "RECOVERED_WITH_SEQUELAE", "FATAL", "UNKNOWN"]
    ] = None


class AiWhatsAppDynamicField(BaseModel):
    """Same purpose as AiIcsrDynamicField: meaningful information the
    reporter gave that doesn't map to any canonical ICSR field — surfaced
    to the human reviewer to keep or dismiss, never silently dropped or
    silently added to the case record."""

    label: str
    value: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class AiWhatsAppRequiredQuestionStatus(BaseModel):
    questionId: str
    answered: bool = False
    answerSummary: Optional[str] = None


class AiWhatsAppTurnResult(BaseModel):
    """One turn of the WhatsApp intake conversation. `reply` is always
    required — even when isComplete is true, it should be a closing
    message (e.g. thanking the reporter), since the human on WhatsApp
    always needs *something* sent back. Every other field mirrors the
    conversation's accumulated state, not just what was said in this
    turn — the caller replaces its stored state with these values
    wholesale rather than trying to merge deltas, since the model has the
    full transcript already."""

    reply: str
    isComplete: bool = False
    # None = not asked yet; True/False once the reporter has answered.
    wantsAnotherProduct: Optional[bool] = None
    reporterName: Optional[str] = None
    reporterQualification: Optional[str] = None
    reporterContact: Optional[str] = None
    patientIdentifier: Optional[str] = None
    patientAge: Optional[str] = None
    patientSex: Optional[Literal["MALE", "FEMALE", "UNKNOWN"]] = None
    suspectProducts: list[AiWhatsAppSuspectProduct] = Field(default_factory=list)
    reactions: list[AiWhatsAppReaction] = Field(default_factory=list)
    narrative: Optional[str] = None
    dynamicFields: list[AiWhatsAppDynamicField] = Field(default_factory=list)
    requiredQuestionsStatus: list[AiWhatsAppRequiredQuestionStatus] = Field(default_factory=list)

    @field_validator(
        "reporterName", "reporterQualification", "reporterContact",
        "patientIdentifier", "patientAge", "narrative", mode="before",
    )
    @classmethod
    def _blank_to_none(cls, v):
        if isinstance(v, str) and v.strip().lower() in ("", "unknown", "n/a", "none", "null"):
            return None
        return v


# ------------------------------------------------------------------ Coding --

_CODE_LIKE_TERM = re.compile(r"^[\d.\-]+$|^[A-Za-z]{1,4}-?\d+$")


class AiCodingCandidate(BaseModel):
    term: str
    rationale: str
    confidence: float = Field(ge=0, le=1)

    @field_validator("term")
    @classmethod
    def reject_code_like_terms(cls, v: str) -> str:
        # Defense in depth on top of CODING_TERM_SUGGEST_PROMPT's explicit
        # "never output a code" rule: a genuine standardised MedDRA/WHODrug
        # term name is always a real word/phrase, never a bare number or a
        # short letter+digit code pattern. If the model slips and returns
        # something code-shaped anyway, fail validation for this candidate
        # rather than risk a fabricated code reaching a reviewer looking
        # like a verified one — the caller falls back the same way it does
        # for any other unusable AI response.
        stripped = v.strip()
        if not stripped or _CODE_LIKE_TERM.match(stripped):
            raise ValueError("term looks like a fabricated code, not a standardised term name")
        return stripped


class AiCodingSuggestion(BaseModel):
    candidates: list[AiCodingCandidate] = Field(default_factory=list)


# ------------------------------------------------------------- Literature --

_KNOWN_RISK_LEVELS = {"HIGH", "MODERATE", "LOW"}


class AiLiteratureAnalysis(BaseModel):
    # Defaults (rather than required fields) so one omitted key degrades to
    # an empty reading instead of failing the whole response — the caller
    # always shows the keyword engine's result alongside this anyway.
    is_safety_relevant: bool = False
    products: list[str] = Field(default_factory=list)
    reaction_terms: list[str] = Field(default_factory=list)
    seriousness_criteria: list[str] = Field(default_factory=list)
    risk_level: Literal["HIGH", "MODERATE", "LOW"] = "MODERATE"
    summary: str = ""
    rationale: str = ""

    @model_validator(mode="before")
    @classmethod
    def _accept_camel_case_keys(cls, data):
        # The prompt demands snake_case keys, but models occasionally drift
        # back to camelCase — accept either rather than failing validation
        # over key spelling (the same fragility that sank issueType once).
        if isinstance(data, dict):
            for src, dst in {
                "isSafetyRelevant": "is_safety_relevant",
                "reactionTerms": "reaction_terms",
                "seriousnessCriteria": "seriousness_criteria",
                "riskLevel": "risk_level",
            }.items():
                if src in data and dst not in data:
                    data[dst] = data[src]
        return data

    @field_validator("is_safety_relevant", mode="before")
    @classmethod
    def _normalize_boolean(cls, v):
        # Models sometimes answer "true"/"yes"/"false" as strings.
        if isinstance(v, str):
            lowered = v.strip().lower()
            if lowered in ("true", "yes", "1"):
                return True
            if lowered in ("false", "no", "0"):
                return False
        return v

    @field_validator("risk_level", mode="before")
    @classmethod
    def _normalize_risk_level(cls, v):
        # Plain JSON mode — nothing constrains the model to the enum. An
        # off-enum risk level should degrade to the keyword engine's
        # conservative default (MODERATE) rather than fail the whole
        # response; the caller merges this with its own deterministic
        # rating and always shows the human both.
        if isinstance(v, str) and v.strip().upper() in _KNOWN_RISK_LEVELS:
            return v.strip().upper()
        return "MODERATE"

    @field_validator("products", "reaction_terms", "seriousness_criteria", mode="before")
    @classmethod
    def _drop_blank_entries(cls, v):
        if not isinstance(v, list):
            return []
        return [item.strip() for item in v if isinstance(item, str) and item.strip()]
