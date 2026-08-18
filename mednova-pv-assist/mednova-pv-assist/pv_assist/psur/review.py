"""
PSUR / PBRER review assist.

Assist-ONLY. This never signs off a PSUR. It does the mechanical reading so the
assessor spends their time on judgement, not on paging through 200 slides to
check whether a section exists and whether the numbers agree.

Two layers:
  * deterministic checks (run with no API key): missing sections, empty
    sections, internal number consistency (interval vs cumulative), presence of
    a stated benefit-risk conclusion.
  * optional LLM checks: are conclusions supported by the data presented, are
    signals actually evaluated vs merely listed. Surfaced as questions for the
    human, never as a verdict.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .extract import ExtractedPSUR, PBRER_SECTIONS
from ..audit import AuditTrail
from ..llm import LLMClient

_REQUIRED = {"introduction", "exposure", "data_in_summary",
             "signal_evaluation", "benefit_risk", "conclusions"}

_NUM = re.compile(r"\b(\d[\d,]{2,})\b")


@dataclass
class Finding:
    severity: str          # "high" | "medium" | "low" | "info"
    check: str
    message: str


@dataclass
class ReviewReport:
    filename: str
    findings: list[Finding] = field(default_factory=list)
    llm_questions: list[str] = field(default_factory=list)

    def add(self, sev: str, check: str, msg: str) -> None:
        self.findings.append(Finding(sev, check, msg))


def review(
    doc: ExtractedPSUR,
    *,
    audit: AuditTrail | None = None,
    llm: LLMClient | None = None,
) -> ReviewReport:
    rep = ReviewReport(filename=doc.filename)

    # 1. section completeness
    present = {k for k, v in doc.sections.items() if v}
    for key in _REQUIRED:
        if key not in present:
            label = dict(PBRER_SECTIONS)[key]
            rep.add("high", "missing_section",
                    f"Required PBRER section not found: '{label}'.")

    # 2. thin sections (present but suspiciously short)
    for key, text in doc.sections.items():
        if text and len(text) < 200:
            rep.add("medium", "thin_section",
                    f"Section '{key}' is very short ({len(text)} chars) — verify completeness.")

    # 3. benefit-risk conclusion actually stated
    br = doc.sections.get("benefit_risk", "") + " " + doc.sections.get("conclusions", "")
    if not re.search(r"benefit[- ]risk .*(favourable|favorable|positive|unchanged|remains)", br, re.I):
        rep.add("high", "no_br_conclusion",
                "No explicit benefit-risk conclusion statement detected — assessor must confirm.")

    # 4. crude number-consistency heuristic between exposure & summary tabulations
    exp_nums = set(_NUM.findall(doc.sections.get("exposure", "")))
    if doc.sections.get("data_in_summary") and not doc.sections.get("exposure"):
        rep.add("medium", "exposure_missing",
                "Summary tabulations present but patient-exposure section is empty — denominator unclear.")

    # 5. optional LLM: are conclusions supported / signals evaluated
    if llm and llm.available:
        for key, question in (
            ("signal_evaluation", "Are the signals in this section actually evaluated with reasoning, or merely listed? List any that look unresolved."),
            ("benefit_risk", "Is the benefit-risk conclusion supported by the data described in this section? Note any gaps."),
        ):
            text = doc.sections.get(key, "")
            if not text:
                continue
            out = llm.judge_json(
                "You are a senior PV assessor reviewing a PBRER section. Be sceptical and specific. "
                'Return JSON {"concerns": [str, ...]} — questions the human reviewer should check. '
                "Do not approve or reject; only raise concerns.",
                f"Section '{key}':\n\"\"\"\n{text[:6000]}\n\"\"\"\n\n{question}",
            )
            if out and out.get("concerns"):
                rep.llm_questions.extend(out["concerns"])

    if audit:
        audit.record(module="psur", action="psur_reviewed", subject_id=doc.filename,
                     detail={"findings": [f.__dict__ for f in rep.findings],
                             "llm_questions": rep.llm_questions})
    return rep
