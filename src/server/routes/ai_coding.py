"""
AI-assisted coding-term suggestions.

This never touches the licensed MedDRA/WHODrug dictionaries — this app only
has the small demo dictionary seeded in supabase/migrations/007_pv_dictionary_terms.sql,
and that stays the sole source of anything presented as an actual dictionary
entry (real code, real dictionary_version). What this module adds is a
clearly-separate, clearly-labelled AI candidate: a standardised term name
the model believes verbatim text plausibly maps to, for a human coder to
verify against the real dictionary themselves — never a code, never framed
as an actual dictionary hit. See CODING_TERM_SUGGEST_PROMPT and
AiCodingCandidate's code-shaped-term rejection in schemas.py for the two
layers that enforce this.
"""
from __future__ import annotations

import json
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..ai.client import AiNotConfiguredError, AiRequestError, is_ai_configured, structured_completion
from ..ai.prompts import CODING_TERM_SUGGEST_PROMPT, PROMPT_VERSION
from ..ai.schemas import AiCodingSuggestion
from ..dependencies import AuthenticatedUser, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


class CodingSuggestRequest(BaseModel):
    dictionary: Literal["MedDRA", "WHODrug"]
    text: str


class CodingCandidateOut(BaseModel):
    term: str
    rationale: str
    confidence: float


class CodingSuggestResponse(BaseModel):
    candidates: list[CodingCandidateOut]
    ai_used: bool
    prompt_version: str
    model: Optional[str] = None
    error: Optional[str] = None


@router.get("/status")
async def ai_coding_status():
    return {"configured": is_ai_configured()}


@router.post("/suggest", response_model=CodingSuggestResponse)
async def suggest_coding_terms(
    request: CodingSuggestRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    text = request.text.strip()
    if not text:
        return CodingSuggestResponse(candidates=[], ai_used=False, prompt_version=PROMPT_VERSION)

    try:
        payload = {"dictionary": request.dictionary, "text": text}
        completion = await structured_completion(
            system_prompt=CODING_TERM_SUGGEST_PROMPT,
            user_content=json.dumps(payload),
            max_output_tokens=800,
        )
        parsed = AiCodingSuggestion.model_validate(completion.data)
        return CodingSuggestResponse(
            candidates=[
                CodingCandidateOut(term=c.term, rationale=c.rationale, confidence=c.confidence)
                for c in parsed.candidates
            ],
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            model=completion.model,
        )
    except AiNotConfiguredError as exc:
        logger.info("Coding term suggestion skipped: %s", exc)
        return CodingSuggestResponse(
            candidates=[], ai_used=False, prompt_version=PROMPT_VERSION, error=str(exc)
        )
    except AiRequestError as exc:
        logger.error("Coding term suggestion failed: %s", exc)
        return CodingSuggestResponse(
            candidates=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI coding suggestions unavailable.",
        )
    except Exception as exc:  # malformed/unvalidatable model output, or a rejected code-shaped term
        logger.error("Coding term suggestion returned unusable output: %s", exc)
        return CodingSuggestResponse(
            candidates=[],
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI coding suggestions returned an unusable response.",
        )
