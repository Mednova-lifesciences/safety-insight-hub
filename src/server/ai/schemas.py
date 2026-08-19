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
    severity: Literal["ERROR", "WARNING"]
    code: str
    message: str
    value: Optional[str] = None
    fixable: bool = False


class AiLineListAnalysis(BaseModel):
    # Required, not defaulted: a response missing this key entirely means
    # the model didn't follow the schema at all, which should fail
    # validation and trigger the rule-based fallback — not be silently
    # read as "zero issues found". The prompt always asks for the key
    # explicitly, even when the answer is an empty list.
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
