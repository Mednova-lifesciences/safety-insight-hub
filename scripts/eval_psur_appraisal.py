#!/usr/bin/env python3
"""LIVE check: does the scientific appraisal catch the errors NAFDAC reported?

Runs the real pipeline (real model, real prompts) on the fictional test
PBRER from make_appraisal_test_psur.py and checks for the four things a
competent assessor would say about it:

  1. Raynaud's phenomenon and HFpEF, listed as "signals", are investigational
     therapeutic uses — NOT safety signals (MISCLASSIFICATION, S8).
  2. Sudden sensorineural hearing loss IS a genuine safety signal and must
     not be dismissed as misclassified.
  3. The clinical-trial SAE table is broken down by INDICATION (ED vs PAH);
     the MAH's reading of it as interval vs cumulative is wrong
     (MISINTERPRETATION, S7 or S5).
  4. The benefit-risk conclusion leans on benefits in unapproved,
     investigational uses (S10).

Needs OPENAI_API_KEY (and optionally OPENAI_APPRAISAL_MODEL). Costs a few
model calls. Exit code 0 only if every check passes.

    python scripts/eval_psur_appraisal.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from make_appraisal_test_psur import build  # noqa: E402
from server.ai.appraisal import APPRAISAL_MODEL, appraise_psur_text  # noqa: E402
from server.ai.client import structured_completion  # noqa: E402
from server.ai.pdf_text import extract_pdf_text  # noqa: E402


def _text(f) -> str:
    return " ".join(
        str(x or "")
        for x in (f.section, f.description, f.evidence, f.scientific_interpretation, f.reviewer_recommendation)
    ).lower()


async def main() -> int:
    pdf = build()
    text, _ = extract_pdf_text(pdf.read_bytes())
    result = await appraise_psur_text(text, complete=structured_completion, filename=pdf.name)
    findings = result.appraisal.findings

    def any_finding(pred) -> bool:
        return any(pred(f) for f in findings)

    misclassified = [f for f in findings if f.deficiency_type == "MISCLASSIFICATION"]
    checks = {
        "1. Raynaud's / HFpEF flagged as not safety signals": any(
            ("raynaud" in _text(f) or "ejection fraction" in _text(f) or "hfpef" in _text(f))
            for f in misclassified
        ),
        "2. Hearing loss NOT dismissed as a non-signal": not any(
            "hearing" in _text(f) and "raynaud" not in _text(f) and "ejection" not in _text(f)
            for f in misclassified
        ),
        "3. ED/PAH table recognised as by-indication, not interval/cumulative": any_finding(
            lambda f: f.deficiency_type in {"MISINTERPRETATION", "DATA_DISCREPANCY", "INCONSISTENCY"}
            and "indication" in _text(f)
            and ("interval" in _text(f) or "cumulative" in _text(f))
        ),
        "4. Benefit-risk relying on investigational benefits flagged": any_finding(
            lambda f: f.v4_section == "S10_BENEFIT_RISK"
            and ("investigational" in _text(f) or "unapproved" in _text(f) or "not approved" in _text(f))
        ),
    }

    print(f"Model: {result.model or APPRAISAL_MODEL}  |  chunks read: {result.chunks_read}/{result.chunks_total}")
    print(f"{len(findings)} findings\n")
    for f in findings:
        print(f"- [{f.v4_section} · {f.deficiency_type} · {f.confidence}] {f.description}")
        if f.scientific_interpretation:
            print(f"    interpretation: {f.scientific_interpretation}")
        if f.reviewer_recommendation:
            print(f"    next step: {f.reviewer_recommendation}")
    print()
    for name, ok in checks.items():
        print(("PASS  " if ok else "FAIL  ") + name)
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
