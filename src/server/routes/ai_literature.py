"""
AI-assisted local literature screening.

NAFDAC GVP requires weekly screening of local medical literature that is
rarely indexed internationally. The deterministic keyword engine on the
frontend (src/services/literature/screener.ts) does the first-pass
flagging; this endpoint gives the reviewer a structured clinical reading
of a flagged article — products, reactions, seriousness criteria and a
risk rationale. It never creates or decides anything by itself: its
output is labelled AI assist and a human decides whether the article
becomes a signal or a case.
"""
from __future__ import annotations

import json
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..ai.client import AiNotConfiguredError, AiRequestError, is_ai_configured, structured_completion
from ..ai.prompts import LITERATURE_ANALYSIS_PROMPT, PROMPT_VERSION
from ..ai.schemas import AiLiteratureAnalysis
from ..dependencies import AuthenticatedUser, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


class LiteratureAnalyzeRequest(BaseModel):
    title: str
    text: str


class LiteratureAnalysisOut(BaseModel):
    is_safety_relevant: bool
    products: list[str]
    reaction_terms: list[str]
    seriousness_criteria: list[str]
    risk_level: Literal["HIGH", "MODERATE", "LOW"]
    summary: str
    rationale: str


class LiteratureAnalyzeResponse(BaseModel):
    analysis: Optional[LiteratureAnalysisOut]
    ai_used: bool
    prompt_version: str
    model: Optional[str] = None
    error: Optional[str] = None


@router.get("/status")
async def ai_literature_status():
    return {"configured": is_ai_configured()}


@router.post("/analyze", response_model=LiteratureAnalyzeResponse)
async def analyze_literature(
    request: LiteratureAnalyzeRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    text = request.text.strip()
    if not text:
        return LiteratureAnalyzeResponse(analysis=None, ai_used=False, prompt_version=PROMPT_VERSION)

    try:
        payload = {"title": request.title.strip(), "text": text}
        completion = await structured_completion(
            system_prompt=LITERATURE_ANALYSIS_PROMPT,
            user_content=json.dumps(payload),
            max_output_tokens=900,
        )
        parsed = AiLiteratureAnalysis.model_validate(completion.data)
        return LiteratureAnalyzeResponse(
            analysis=LiteratureAnalysisOut(
                is_safety_relevant=parsed.is_safety_relevant,
                products=parsed.products,
                reaction_terms=parsed.reaction_terms,
                seriousness_criteria=parsed.seriousness_criteria,
                risk_level=parsed.risk_level,
                summary=parsed.summary,
                rationale=parsed.rationale,
            ),
            ai_used=True,
            prompt_version=PROMPT_VERSION,
            model=completion.model,
        )
    except AiNotConfiguredError as exc:
        logger.info("Literature analysis skipped: %s", exc)
        return LiteratureAnalyzeResponse(
            analysis=None, ai_used=False, prompt_version=PROMPT_VERSION, error=str(exc)
        )
    except AiRequestError as exc:
        logger.error("Literature analysis failed: %s", exc)
        return LiteratureAnalyzeResponse(
            analysis=None,
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI literature analysis unavailable.",
        )
    except Exception as exc:  # malformed/unvalidatable model output
        logger.error("Literature analysis returned unusable output: %s", exc)
        return LiteratureAnalyzeResponse(
            analysis=None,
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI literature analysis returned an unusable response.",
        )
