"""
AI assistance for the E2B(R3) C.1.7 question — "does this case fulfil the
local criteria for an expedited report?".

The rule itself is deterministic and lives in the frontend engine
(services/e2b-r3/c17-rule.ts): a case is expedited when it is serious. That
rule settles every case whose line list states seriousness. This endpoint
exists only for the rest: a row that never says whether it is serious, where
the words of the case may still show it (an anaphylaxis, a death in the
outcome column, a hospital admission written into a narrative).

What comes back is a SUGGESTION, and the whole pipeline treats it as one:
it is stored separately from the regulatory assessment, it cannot finalize
anything, and a qualified assessor still decides. See the trust boundary in
supabase/migrations/*_e2b_c17_trusted_lifecycle.sql.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..ai.client import AiNotConfiguredError, AiRequestError, is_ai_configured, structured_completion
from ..ai.prompts import C17_EXPEDITED_ASSESS_PROMPT, PROMPT_VERSION
from ..ai.schemas import AiC17Assessment, AiC17Evidence
from ..dependencies import AuthenticatedUser, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


class C17AssessRequest(BaseModel):
    """One case, in its own words, plus the rule it is being judged by."""

    caseId: str
    reactions: list[str] = []
    outcomes: list[str] = []
    seriousnessAsReported: Optional[str] = None
    narrative: Optional[str] = None
    ruleName: str
    ruleVersion: str
    criteria: list[str] = []


class C17Evidence(BaseModel):
    """A statement from the case, and where in the case it was read."""

    statement: str
    sourceFields: list[str] = []


class C17AssessResponse(BaseModel):
    recommendation: str
    confidence: float
    supportingEvidence: list[C17Evidence] = []
    contradictingEvidence: list[C17Evidence] = []
    missingInformation: list[str] = []
    reasoningSummary: str = ""
    ai_used: bool
    prompt_version: str
    model: Optional[str] = None
    error: Optional[str] = None


def _evidence(items: list[AiC17Evidence]) -> list[C17Evidence]:
    return [C17Evidence(statement=i.statement, sourceFields=i.source_fields) for i in items]


def _unavailable(reason: str) -> C17AssessResponse:
    """Unavailable is never an answer about the case: it stays NEEDS_REVIEW."""
    return C17AssessResponse(
        recommendation="NEEDS_REVIEW",
        confidence=0.0,
        missingInformation=[reason],
        reasoningSummary="No suggestion was made; a qualified reviewer must decide.",
        ai_used=False,
        prompt_version=PROMPT_VERSION,
        error=reason,
    )


@router.get("/status")
async def ai_e2b_status():
    return {"configured": is_ai_configured()}


@router.post("/c17", response_model=C17AssessResponse)
async def assess_c17(
    request: C17AssessRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    payload: dict[str, Any] = {
        "caseId": request.caseId,
        "reactions": request.reactions,
        "outcomes": request.outcomes,
        "seriousnessAsReported": request.seriousnessAsReported,
        "narrative": request.narrative,
        "rule": {
            "name": request.ruleName,
            "version": request.ruleVersion,
            "expeditedWhenAnyOf": request.criteria,
        },
    }

    try:
        completion = await structured_completion(
            system_prompt=C17_EXPEDITED_ASSESS_PROMPT,
            user_content=json.dumps(payload),
            max_output_tokens=900,
        )
        parsed = AiC17Assessment.model_validate(completion.data)
        return C17AssessResponse(
            recommendation=parsed.recommendation,
            confidence=parsed.confidence,
            supportingEvidence=_evidence(parsed.supporting_evidence),
            contradictingEvidence=_evidence(parsed.contradicting_evidence),
            missingInformation=parsed.missing_information,
            reasoningSummary=parsed.reasoning_summary,
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            model=completion.model,
        )
    except AiNotConfiguredError as exc:
        logger.info("C.1.7 AI assessment skipped: %s", exc)
        return _unavailable(str(exc))
    except AiRequestError as exc:
        logger.error("C.1.7 AI assessment failed: %s", exc)
        return _unavailable("AI assessment unavailable.")
    except Exception as exc:  # unusable model output
        logger.error("C.1.7 AI assessment returned unusable output: %s", exc)
        return _unavailable("AI assessment returned an unusable response.")
