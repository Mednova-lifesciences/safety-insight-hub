"""
PSUR / PBRER extraction.

PSURs land as PDF (email attachment or the Google uploader). This pulls text and
splits it into the ICH E2C(R2) / GVP Module VII sections so the review layer can
check each one. Falls back gracefully if a heading isn't found — a missing
section is itself a finding.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


# Canonical PBRER section headings (ICH E2C(R2)). Order matters.
PBRER_SECTIONS = [
    ("introduction", r"introduction"),
    ("worldwide_authorisation", r"worldwide marketing authori[sz]ation status"),
    ("actions_safety", r"actions taken .* safety reasons"),
    ("reference_safety_info", r"changes to reference safety information"),
    ("exposure", r"estimated exposure|patient exposure"),
    ("data_in_summary", r"data in summary tabulations"),
    ("signal_evaluation", r"signal.*evaluation|summaries of significant"),
    ("risk_evaluation", r"evaluation of (?:the )?risks"),
    ("benefit_evaluation", r"benefit evaluation"),
    ("benefit_risk", r"benefit[- ]risk (?:analysis|assessment|evaluation)"),
    ("conclusions", r"conclusions?( and actions?)?"),
]


@dataclass
class ExtractedPSUR:
    filename: str
    full_text: str
    sections: dict[str, str]        # canonical key -> section text (may be "")
    page_count: int


def extract(pdf_path: str) -> ExtractedPSUR:
    import pdfplumber

    pages: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for pg in pdf.pages:
            pages.append(pg.extract_text() or "")
    full = "\n".join(pages)

    # Build a regex that finds any known heading, then slice between them.
    heading_res = [(key, re.compile(rf"^\s*(?:\d+\.?\s*)?{pat}", re.IGNORECASE | re.MULTILINE))
                   for key, pat in PBRER_SECTIONS]

    marks: list[tuple[int, str]] = []
    for key, rx in heading_res:
        m = rx.search(full)
        if m:
            marks.append((m.start(), key))
    marks.sort()

    sections: dict[str, str] = {key: "" for key, _ in PBRER_SECTIONS}
    for i, (pos, key) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(full)
        sections[key] = full[pos:end].strip()

    return ExtractedPSUR(
        filename=pdf_path.split("/")[-1],
        full_text=full,
        sections=sections,
        page_count=len(pages),
    )
