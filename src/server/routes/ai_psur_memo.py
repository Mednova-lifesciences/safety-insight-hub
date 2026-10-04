"""
Research retrieval and paste routing for the PSUR assessment memo.

Both end at an assessor (spec section 7): research returns CANDIDATES, each
carrying a citation that came from a public registry, and routing PROPOSES a
criterion for pasted text. Nothing here writes to the assessment; the
browser saves what the assessor accepts.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..ai.client import AiNotConfiguredError, structured_completion
from ..ai.prompts import PROMPT_VERSION, PSUR_EVIDENCE_ROUTE_PROMPT, PSUR_RESEARCH_SUMMARY_PROMPT
from ..ai.research import RESEARCH_CRITERIA, Source, research
from ..ai.schemas import AiEvidenceRoute, AiResearchSummary
from ..dependencies import AuthenticatedUser, require_permission

logger = logging.getLogger(__name__)
router = APIRouter()


class ResearchRequest(BaseModel):
    criterion: str
    substance: str
    interval: str = ""


class ResearchCandidateOut(BaseModel):
    source_id: str
    source_type: str
    registry: str
    title: str
    citation: str
    url: str
    published: str = ""
    in_interval: Optional[bool] = None
    # The remark proposed for the memo: the model's summary when it ran, the
    # source's own text otherwise. Either way only a candidate until an
    # assessor accepts it.
    content: str
    excerpt: str
    relevance: str = "MEDIUM"
    summarised_by_ai: bool = False


class RegistryOut(BaseModel):
    name: str
    query: str
    count: int
    error: Optional[str] = None


class ResearchResponse(BaseModel):
    criterion: str
    candidates: list[ResearchCandidateOut]
    registries: list[RegistryOut]
    ai_used: bool
    prompt_version: str
    error: Optional[str] = None


def _candidate(src: Source, content: str, relevance: str, by_ai: bool) -> ResearchCandidateOut:
    return ResearchCandidateOut(
        source_id=src.id,
        source_type=src.source_type,
        registry=src.registry,
        title=src.title,
        citation=src.citation,
        url=src.url,
        published=src.published,
        in_interval=src.in_interval,
        content=content,
        excerpt=src.excerpt,
        relevance=relevance,
        summarised_by_ai=by_ai,
    )


def keep_grounded(summary: AiResearchSummary, sources: list[Source]) -> list[ResearchCandidateOut]:
    """Pair each model remark with the source it names, dropping the rest.

    This is the guarantee the feature rests on: the citation printed in the
    memo is the registry's, attached here, and a remark naming a source that
    was never retrieved has nothing to attach to, so it goes.
    """
    by_id = {s.id: s for s in sources}
    out: list[ResearchCandidateOut] = []
    used: set[str] = set()
    for c in summary.candidates:
        src = by_id.get(c.source_id.strip().upper())
        if src is None:
            logger.warning("PSUR research: dropped a remark naming unknown source %r", c.source_id)
            continue
        if src.id in used or not c.remark.strip():
            continue
        used.add(src.id)
        out.append(_candidate(src, c.remark.strip(), c.relevance, True))
    return out


def _empty(criterion: str, error: str) -> ResearchResponse:
    return ResearchResponse(
        criterion=criterion, candidates=[], registries=[], ai_used=False, prompt_version=PROMPT_VERSION, error=error
    )


@router.post("/research", response_model=ResearchResponse)
async def research_criterion(
    request: ResearchRequest,
    # Evidence gathering is assessment work. The Peer Reviewer holds
    # psur.evaluate too, because they may add and accept evidence (spec
    # section 10).
    user: AuthenticatedUser = Depends(require_permission("psur.evaluate")),
):
    criterion = request.criterion.strip().upper()
    substance = request.substance.strip()
    if criterion not in RESEARCH_CRITERIA:
        return _empty(criterion, "This criterion is not researched from public sources.")
    if not substance:
        return _empty(criterion, "Enter the active substance to search for.")

    found = await research(criterion, substance, request.interval)
    registries = [RegistryOut(name=r.name, query=r.query, count=r.count, error=r.error) for r in found.registries]
    raw = [_candidate(s, s.excerpt, "MEDIUM", False) for s in found.sources]
    if not found.sources:
        return ResearchResponse(
            criterion=criterion, candidates=[], registries=registries, ai_used=False, prompt_version=PROMPT_VERSION
        )

    try:
        payload = {
            "criterion": criterion,
            "product": substance,
            "reporting_interval": request.interval,
            "sources": [
                {
                    "id": s.id,
                    "registry": s.registry,
                    "title": s.title,
                    "published": s.published,
                    "within_reporting_interval": s.in_interval,
                    "text": s.excerpt,
                }
                for s in found.sources
            ],
        }
        completion = await structured_completion(
            system_prompt=PSUR_RESEARCH_SUMMARY_PROMPT,
            user_content=json.dumps(payload),
        )
        grounded = keep_grounded(AiResearchSummary.model_validate(completion.data), found.sources)
        # Sources the model judged irrelevant still reach the assessor, after
        # the summarised ones and marked LOW, so nothing retrieved is hidden.
        summarised = {c.source_id for c in grounded}
        rest = [c.model_copy(update={"relevance": "LOW"}) for c in raw if c.source_id not in summarised]
        return ResearchResponse(
            criterion=criterion,
            candidates=grounded + rest,
            registries=registries,
            ai_used=True,
            prompt_version=PROMPT_VERSION,
        )
    except AiNotConfiguredError as exc:
        logger.info("PSUR research summary skipped: %s", exc)
        return ResearchResponse(
            criterion=criterion, candidates=raw, registries=registries, ai_used=False, prompt_version=PROMPT_VERSION
        )
    except Exception as exc:  # noqa: BLE001 — the sources are still useful unsummarised
        logger.error("PSUR research summary failed: %s", exc)
        return ResearchResponse(
            criterion=criterion,
            candidates=raw,
            registries=registries,
            ai_used=False,
            prompt_version=PROMPT_VERSION,
            error="AI summary unavailable; showing the sources' own text.",
        )


class RouteEvidenceRequest(BaseModel):
    text: str


class RouteEvidenceResponse(BaseModel):
    criterion: str
    confidence: float
    reason: str
    ai_used: bool
    prompt_version: str


_ROUTE_KEYWORDS = {
    "PATIENT_EXPOSURE": (
        "vigiflow", "exposure", "nigeria", "nigerian", "africa", "african", "patient-years", "units sold",
    ),
    "WORLDWIDE_ACTIONS": (
        "mhra", "fda", "ema", "regulatory", "withdraw", "suspend", "recall", "drug safety update",
        "dhpc", "safety communication",
    ),
    "RSI_CHANGES": (
        "rsi", "reference safety information", "smpc", "label", "core safety", "ccsi", "boxed warning",
    ),
    "RELEVANT_STUDIES": ("study", "trial", "cohort", "meta-analysis", "systematic review", "doi", "pmid", "et al"),
    "OVERALL_SAFETY_EVALUATION": (
        "risk", "seriousness", "respiratory depression", "seizure", "syndrome", "important identified",
    ),
}


def route_by_keywords(text: str) -> RouteEvidenceResponse:
    """Deterministic fallback: the criterion whose vocabulary the text uses most."""
    low = text.lower()
    scores = {c: sum(low.count(k) for k in kws) for c, kws in _ROUTE_KEYWORDS.items()}
    total = sum(scores.values())
    if total == 0:
        return RouteEvidenceResponse(
            criterion="OVERALL_SAFETY_EVALUATION",
            confidence=0.0,
            reason="No criterion-specific wording found; please choose the criterion.",
            ai_used=False,
            prompt_version=PROMPT_VERSION,
        )
    best = max(scores, key=lambda c: scores[c])
    hits = [k for k in _ROUTE_KEYWORDS[best] if k in low][:3]
    return RouteEvidenceResponse(
        criterion=best,
        confidence=round(scores[best] / total, 2),
        reason="Mentions " + ", ".join(f"'{h}'" for h in hits) + ".",
        ai_used=False,
        prompt_version=PROMPT_VERSION,
    )


@router.post("/route-evidence", response_model=RouteEvidenceResponse)
async def route_evidence(
    request: RouteEvidenceRequest,
    user: AuthenticatedUser = Depends(require_permission("psur.evaluate")),
):
    text = request.text.strip()[:8000]
    if not text:
        return route_by_keywords("")
    try:
        completion = await structured_completion(
            system_prompt=PSUR_EVIDENCE_ROUTE_PROMPT, user_content=text, max_output_tokens=400
        )
        parsed = AiEvidenceRoute.model_validate(completion.data)
        return RouteEvidenceResponse(
            criterion=parsed.criterion,
            confidence=parsed.confidence,
            reason=parsed.reason,
            ai_used=True,
            prompt_version=PROMPT_VERSION,
        )
    except AiNotConfiguredError:
        return route_by_keywords(text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("PSUR evidence routing fell back to keywords: %s", exc)
        return route_by_keywords(text)
