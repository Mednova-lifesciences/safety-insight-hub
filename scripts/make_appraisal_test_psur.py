#!/usr/bin/env python3
"""Build a FICTIONAL test PBRER that reproduces the two errors NAFDAC's
assessors found the review missing (Nov 2026 feedback):

1. The "signals" section lists investigational THERAPEUTIC uses as if they
   were safety signals — alongside one genuine safety signal, so a correct
   appraisal must tell them apart rather than flag everything.
2. A clinical-trial SAE table broken down by INDICATION (erectile
   dysfunction vs pulmonary arterial hypertension), which the MAH's own text
   then describes as "reporting interval and cumulative" data.

The product, MAH, figures and studies are invented for testing. Nothing here
is real safety data.

Usage:  python scripts/make_appraisal_test_psur.py [output.pdf]
Default output: docs/test-psurs/appraisal-test-pbrer-sildenafil.pdf
"""

from __future__ import annotations

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "docs" / "test-psurs" / (
    "appraisal-test-pbrer-sildenafil.pdf"
)

# Numbers used by the tests — keep in one place.
CT_SAE_TABLE = [
    ["System Organ Class", "Erectile dysfunction (N=4,812)", "Pulmonary arterial hypertension (N=1,246)"],
    ["Cardiac disorders", "18", "41"],
    ["Nervous system disorders", "9", "12"],
    ["Respiratory disorders", "4", "37"],
    ["Total SAEs", "31", "90"],
]


def _table(rows):
    t = Table(rows, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return t


def build(out: Path = DEFAULT_OUT) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    ss = getSampleStyleSheet()
    h1, h2, body = ss["Heading1"], ss["Heading2"], ss["BodyText"]
    story = []
    P = lambda text, style=body: story.append(Paragraph(text, style))  # noqa: E731

    P("Periodic Benefit-Risk Evaluation Report (PBRER)", h1)
    P("TEST DOCUMENT — fictional data for software testing only.")
    P("Product: Sildenafil citrate film-coated tablets 20 mg, 50 mg, 100 mg")
    P("Marketing Authorisation Holder: Testline Pharmaceuticals Ltd (fictional)")
    P("Reporting interval: 01 January 2025 to 31 December 2025. Data lock point: 31 December 2025.")
    P("International Birth Date: 27 March 1998. Approved indications: erectile dysfunction "
      "(50 mg, 100 mg); pulmonary arterial hypertension in adults (20 mg).")

    P("1 Introduction", h2)
    P("This PBRER covers the reporting interval above and follows ICH E2C(R2).")

    P("4 Changes to Reference Safety Information", h2)
    P("The Reference Safety Information is the Company Core Data Sheet (CCDS) version 14.0, in "
      "effect at the start of the interval. No safety-related changes were made during the "
      "interval. Listed reactions include headache, flushing, dyspepsia, visual disturbance, "
      "non-arteritic anterior ischaemic optic neuropathy (NAION), priapism and hypotension.")

    P("5 Estimated Exposure", h2)
    P("Worldwide post-marketing exposure in the interval is estimated at 2,400,000 patient-years, "
      "derived from units sold. Cumulative exposure since IBD is estimated at 31,000,000 "
      "patient-years. No Nigeria-specific exposure estimate is available.")

    story.append(PageBreak())
    P("6 Summary Tabulations of Data", h2)
    P("6.1 Serious adverse events from clinical trials", h2)
    P("Table 6.1 presents serious adverse events from company-sponsored clinical trials in the "
      "development programme, by indication.")
    story.append(_table(CT_SAE_TABLE))
    story.append(Spacer(1, 8))
    P("As shown in Table 6.1, 31 SAEs were reported in the reporting interval and 90 SAEs "
      "cumulatively, which is consistent with the known safety profile.")
    P("6.2 Post-marketing data", h2)
    P("During the interval, 1,184 post-marketing case reports were received worldwide, of which "
      "212 were serious. Cumulatively, 98,450 case reports have been received.")

    story.append(PageBreak())
    P("15 Overview of Signals: New, Ongoing or Closed", h2)
    P("The following signals were identified or under evaluation during the reporting interval:")
    story.append(
        _table(
            [
                ["Signal", "Status", "Description"],
                ["Raynaud's phenomenon", "New",
                 "Published investigator-led studies suggest sildenafil may reduce attack frequency "
                 "in secondary Raynaud's phenomenon; evaluation of a possible new indication ongoing."],
                ["Heart failure with preserved ejection fraction", "Ongoing",
                 "Investigational use; a phase II study is exploring exercise capacity outcomes."],
                ["Sudden sensorineural hearing loss", "Ongoing",
                 "Seven new spontaneous cases of sudden hearing loss within 48 hours of dosing; "
                 "cumulative review of causality in progress."],
            ]
        )
    )
    story.append(Spacer(1, 8))
    P("16 Signal and Risk Evaluation", h2)
    P("No new safety concerns were identified. The investigational uses above are being followed "
      "for their therapeutic potential.")

    P("18 Integrated Benefit-Risk Analysis", h2)
    P("The benefit-risk balance of sildenafil remains favourable in all approved indications, "
      "supported in addition by the emerging benefits in Raynaud's phenomenon and heart failure "
      "with preserved ejection fraction.")

    P("19 Conclusions and Actions", h2)
    P("No changes to the RSI or risk-minimisation measures are proposed.")

    SimpleDocTemplate(str(out), pagesize=A4, title="Test PBRER — sildenafil (fictional)").build(story)
    return out


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    print(build(target))
