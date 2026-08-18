"""
Seriousness triage.

Input : a case with a free-text narrative and the reporter's seriousness answer
Output: a flag when the NARRATIVE implies serious but the FIELD says non-serious
        (or the field is blank). We never flip the field — we surface the
        mismatch with the exact evidence so an assessor decides in seconds
        instead of reading every case cold.

This is the safest, highest-yield of the four use cases: the criteria are
well-defined and reading unstructured text for defined criteria is exactly what
this kind of system is good at.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from .criteria import scan, CriterionHit
from ..audit import AuditTrail
from ..llm import LLMClient


@dataclass
class SeriousnessResult:
    case_id: str
    reported_serious: bool | None       # what the reporter ticked (None = blank)
    narrative_suggests_serious: bool
    matched_criteria: list[dict[str, Any]]
    mismatch: bool                       # the thing worth a human's attention
    priority: str                        # "high" | "review" | "ok"
    llm_opinion: dict[str, Any] | None


_LLM_SYSTEM = (
    "You are a pharmacovigilance case-triage assistant. Read an adverse event "
    "narrative and decide which ICH seriousness criteria are supported by the "
    "text: death, life_threatening, hospitalisation, disability, congenital, "
    "medically_important. Only report a criterion if the narrative supports it. "
    'Return JSON: {"serious": bool, "criteria": [..], "reasoning": "one line"}.'
)


def analyze(
    case_id: str,
    narrative: str,
    reported_serious: bool | None,
    *,
    audit: AuditTrail | None = None,
    llm: LLMClient | None = None,
) -> SeriousnessResult:
    hits: list[CriterionHit] = scan(narrative)
    narrative_serious = len(hits) > 0

    llm_opinion = None
    if llm and llm.available:
        llm_opinion = llm.judge_json(
            _LLM_SYSTEM,
            f"Case {case_id} narrative:\n\"\"\"\n{narrative}\n\"\"\"",
        )
        # LLM can raise, never lower: if it sees seriousness the rules missed,
        # trust the flag; if it says non-serious but rules hit, keep the flag.
        if llm_opinion and llm_opinion.get("serious"):
            narrative_serious = True

    mismatch = narrative_serious and (reported_serious is not True)

    if mismatch:
        priority = "high"
    elif reported_serious is None and not narrative_serious:
        priority = "review"      # blank field, nothing obvious — still worth a glance
    else:
        priority = "ok"

    result = SeriousnessResult(
        case_id=case_id,
        reported_serious=reported_serious,
        narrative_suggests_serious=narrative_serious,
        matched_criteria=[asdict(h) for h in hits],
        mismatch=mismatch,
        priority=priority,
        llm_opinion=llm_opinion,
    )

    if audit and mismatch:
        audit.record(
            module="seriousness",
            action="seriousness_mismatch_flagged",
            subject_id=case_id,
            confidence=0.9 if llm_opinion and llm_opinion.get("serious") else 0.7,
            detail={
                "reported_serious": reported_serious,
                "criteria": [h.label for h in hits],
                "evidence": [h.evidence for h in hits],
            },
            actor="system" if not llm_opinion else f"llm:{llm.model}",
        )
    return result
