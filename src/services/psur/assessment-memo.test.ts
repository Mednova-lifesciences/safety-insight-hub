import { describe, expect, it } from "vitest";
import {
  factualCriteria,
  MEMO_CRITERIA,
  MEMO_REFERENCE_PREFIX,
  NOT_ASSESSED,
  NOT_STATED,
  withAssessorInput,
} from "./assessment-memo";
import type { PsurSubmissionDetails } from "@/types/pv";

function details(overrides: Partial<PsurSubmissionDetails> = {}): PsurSubmissionDetails {
  return {
    productName: "Tramadol-50 (Tramadol 50mg) Capsule",
    activeSubstance: "Tramadol",
    nafdacRegNo: "A4-100123",
    mah: "Justeen Pharm",
    qppv: "",
    qppvContact: "",
    ibd: "1977",
    firstNafdacRegistrationDate: "",
    dlp: "2024-11-12",
    intervalCovered: "12 November 2021 to 12 November 2024",
    dateReceived: "2026-09-03T00:00:00Z",
    ...overrides,
  };
}

describe("the criteria table", () => {
  it("has the form's eleven rows, numbered 1 to 11", () => {
    expect(MEMO_CRITERIA).toHaveLength(11);
    expect(MEMO_CRITERIA.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("starts with Product Identity and ends with the overall safety evaluation", () => {
    expect(MEMO_CRITERIA[0]!.id).toBe("PRODUCT_IDENTITY");
    expect(MEMO_CRITERIA[10]!.id).toBe("OVERALL_SAFETY_EVALUATION");
  });
});

describe("the reference prefix", () => {
  it("is the fixed NAFDAC PV prefix, so the assessor types only the number", () => {
    expect(MEMO_REFERENCE_PREFIX).toBe("NAFDAC/PV/GCIOMS/");
  });
});

describe("the six factual criteria", () => {
  it("fills them from the submission details", () => {
    const out = factualCriteria(details(), "Narcotic Analgesic");
    const by = (id: string) => out.find((c) => c.id === id)!;
    expect(by("PRODUCT_IDENTITY").remarks).toContain("Tramadol");
    expect(by("REPORTING_INTERVAL").remarks).toBe("12 November 2021 to 12 November 2024");
    expect(by("THERAPEUTIC_CATEGORY").remarks).toBe("Narcotic Analgesic");
    expect(by("DATE_RECEIVED").remarks).toBe("3 September 2026");
    expect(by("INTERNATIONAL_BIRTH_DATE").remarks).toBe("1977");
  });

  it("marks a blank Nigeria Birth Date unestablished rather than printing nothing", () => {
    // The form says "(if available)", and the supplied memo leaves it
    // blank — but a blank cell reads as NAFDAC's omission.
    const out = factualCriteria(details(), "Narcotic Analgesic");
    const nbd = out.find((c) => c.id === "NIGERIA_BIRTH_DATE")!;
    expect(nbd.unestablished).toBe(true);
    expect(nbd.remarks).not.toBe("");
  });

  it("marks a missing therapeutic category unestablished", () => {
    const out = factualCriteria(details(), "");
    expect(out.find((c) => c.id === "THERAPEUTIC_CATEGORY")!.unestablished).toBe(true);
  });

  it("returns only the six factual criteria", () => {
    expect(factualCriteria(details(), "x").map((c) => c.id)).toEqual([
      "PRODUCT_IDENTITY",
      "REPORTING_INTERVAL",
      "THERAPEUTIC_CATEGORY",
      "DATE_RECEIVED",
      "INTERNATIONAL_BIRTH_DATE",
      "NIGERIA_BIRTH_DATE",
    ]);
  });

  it("carries no citations — these are facts off the submission, not research", () => {
    for (const c of factualCriteria(details(), "x")) expect(c.citations).toEqual([]);
  });
});

import { CRITERION_SECTIONS, evidenceCriteria } from "./assessment-memo";
import type { AssessmentSection, EvidenceEntry } from "@/types/pv";

function ev(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id: "e1",
    section: "S4_RSI",
    sourceType: "REFERENCE_SAFETY_INFORMATION",
    citation: "https://dailymed.nlm.nih.gov/example",
    content: "RSI updated to emphasise the warfarin interaction.",
    origin: "assessor",
    addedBy: "Evaluator",
    addedAt: "2026-10-02T09:00:00Z",
    acceptedBy: "Evaluator",
    acceptedAt: "2026-10-02T09:01:00Z",
    ...overrides,
  };
}

function section(id: AssessmentSection["section"], evidence: EvidenceEntry[]): AssessmentSection {
  return { section: id, evidence };
}

describe("which working section feeds which criterion", () => {
  it("maps each evidence criterion to at least one section", () => {
    for (const id of ["RSI_CHANGES", "WORLDWIDE_ACTIONS", "PATIENT_EXPOSURE", "RELEVANT_STUDIES"] as const) {
      expect(CRITERION_SECTIONS[id].length).toBeGreaterThan(0);
    }
  });

  it("feeds criterion 7 from the RSI section", () => {
    expect(CRITERION_SECTIONS.RSI_CHANGES).toContain("S4_RSI");
  });

  it("feeds criterion 9 from the exposure section", () => {
    expect(CRITERION_SECTIONS.PATIENT_EXPOSURE).toContain("S5_EXPOSURE_ACTIONS");
  });

  it("never draws memo evidence from the screening step", () => {
    for (const sections of Object.values(CRITERION_SECTIONS)) {
      expect(sections).not.toContain("ADMIN_SCREENING");
    }
  });
});

describe("the evidence criteria", () => {
  it("renders accepted, cited evidence with its citation", () => {
    const out = evidenceCriteria([section("S4_RSI", [ev()])]);
    const rsi = out.find((c) => c.id === "RSI_CHANGES")!;
    expect(rsi.remarks).toContain("warfarin");
    expect(rsi.citations).toEqual(["https://dailymed.nlm.nih.gov/example"]);
    expect(rsi.unestablished).toBe(false);
  });

  it("marks a criterion with no evidence unestablished", () => {
    const out = evidenceCriteria([section("S4_RSI", [])]);
    expect(out.find((c) => c.id === "RSI_CHANGES")!.unestablished).toBe(true);
  });

  it("ignores an unaccepted candidate", () => {
    const candidate = ev();
    delete (candidate as { acceptedBy?: string }).acceptedBy;
    const out = evidenceCriteria([section("S4_RSI", [candidate])]);
    expect(out.find((c) => c.id === "RSI_CHANGES")!.unestablished).toBe(true);
  });

  it("ignores an uncited entry", () => {
    const out = evidenceCriteria([section("S4_RSI", [ev({ citation: "" })])]);
    expect(out.find((c) => c.id === "RSI_CHANGES")!.unestablished).toBe(true);
  });

  // Review Focus 5.
  it("marks a criterion unestablished when its accepted evidence has no content", () => {
    const out = evidenceCriteria([section("S4_RSI", [ev({ content: "   " })])]);
    const rsi = out.find((c) => c.id === "RSI_CHANGES")!;
    expect(rsi.unestablished).toBe(true);
    expect(rsi.remarks).not.toBe("");
  });

  it("joins several entries and keeps every citation", () => {
    const out = evidenceCriteria([
      section("S4_RSI", [
        ev({ id: "a", content: "First change.", citation: "https://example.test/a" }),
        ev({ id: "b", content: "Second change.", citation: "https://example.test/b" }),
      ]),
    ]);
    const rsi = out.find((c) => c.id === "RSI_CHANGES")!;
    expect(rsi.remarks).toContain("First change.");
    expect(rsi.remarks).toContain("Second change.");
    expect(rsi.citations).toEqual(["https://example.test/a", "https://example.test/b"]);
  });

  it("returns the five non-factual criteria", () => {
    expect(evidenceCriteria([]).map((c) => c.id)).toEqual([
      "RSI_CHANGES",
      "WORLDWIDE_ACTIONS",
      "PATIENT_EXPOSURE",
      "RELEVANT_STUDIES",
      "OVERALL_SAFETY_EVALUATION",
    ]);
  });
});

import { buildAssessmentMemoModel } from "./assessment-memo";
import type { CiomsMatrix } from "@/types/pv";

function matrix(): CiomsMatrix {
  return {
    epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
    effectivenessOfProduct: { seriousness: 3, duration: 3, incidence: 0 },
    adrs: [{ reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } }],
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    referenceNumber: "NAFDAC/PV/GCIOMS/455/III",
    memoDate: "2026-09-17",
    to: "D (Drug R&R)",
    from: "D (PV)",
    signatory: "Director (PV)",
    productNameAndStrength: "Tramadol-50 (Tramadol 50mg) Capsule",
    therapeuticCategory: "Narcotic Analgesic",
    details: details(),
    sections: [] as AssessmentSection[],
    matrix: matrix(),
    confirmedBandLabel: "",
    confirmedVerdict: "",
    analysisOfMatrix: "",
    conclusion: "",
    ...overrides,
  };
}

describe("the assembled memo", () => {
  it("carries all eleven criteria in form order", () => {
    const m = buildAssessmentMemoModel(input())!;
    expect(m.criteria).toHaveLength(11);
    expect(m.criteria.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("computes the totals rather than taking them", () => {
    const m = buildAssessmentMemoModel(input())!;
    expect(m.totals).toEqual({ epidemiology: 6, effectiveness: 6, adrs: [4] });
  });

  it("records that a provisional rubric was used", () => {
    expect(buildAssessmentMemoModel(input())!.provisionalRubricUsed).toBe(true);
  });

  it("leaves band and verdict EMPTY until the assessor confirms them", () => {
    const m = buildAssessmentMemoModel(input())!;
    expect(m.bandLabel).toBe("");
    expect(m.benefitRiskVerdict).toBe("");
  });

  it("uses the assessor's confirmed band and verdict when given", () => {
    const m = buildAssessmentMemoModel(
      input({ confirmedBandLabel: "Medium", confirmedVerdict: "Positive Benefit-Risk Balance" }),
    )!;
    expect(m.bandLabel).toBe("Medium");
    expect(m.benefitRiskVerdict).toBe("Positive Benefit-Risk Balance");
  });

  it("refuses to build when a score is invalid", () => {
    const bad = matrix();
    bad.adrs[0]!.scores.seriousness = -1;
    expect(buildAssessmentMemoModel(input({ matrix: bad }))).toBeNull();
  });

  it("keeps the reference number exactly as the assessor completed it", () => {
    const m = buildAssessmentMemoModel(input())!;
    expect(m.referenceNumber).toBe("NAFDAC/PV/GCIOMS/455/III");
  });
});

describe("what an empty criterion says", () => {
  it("criteria 1-6 blame the submission; criteria 7-11 say NAFDAC did not assess them", () => {
    const facts = factualCriteria(
      {
        productName: "",
        activeSubstance: "",
        nafdacRegNo: "",
        mah: "",
        qppv: "",
        qppvContact: "",
        ibd: "",
        firstNafdacRegistrationDate: "",
        dlp: "",
        intervalCovered: "",
        dateReceived: "",
      },
      "",
    );
    expect(facts.every((c) => c.remarks === NOT_STATED)).toBe(true);
    const researched = evidenceCriteria([]);
    expect(researched.map((c) => c.remarks)).toEqual(Array(5).fill(NOT_ASSESSED));
    expect(NOT_ASSESSED).toBe("Not assessed");
  });
});

describe("the brief highlights", () => {
  it("prints the assessor's highlight before the research under its criterion", () => {
    const criteria = withAssessorInput(
      [
        {
          id: "RSI_CHANGES",
          number: 7,
          label: "RSI",
          remarks: "DIES added to section 4.4.",
          citations: ["SmPC v7.2"],
          unestablished: false,
        },
        {
          id: "WORLDWIDE_ACTIONS",
          number: 8,
          label: "Actions",
          remarks: "Not assessed",
          citations: [],
          unestablished: true,
        },
      ],
      { RSI_CHANGES: "Yes" },
      "",
      { RSI_CHANGES: "One safety update.", WORLDWIDE_ACTIONS: "None this interval." },
    );
    expect(criteria[0]!.remarks).toBe("One safety update.\n\nDIES added to section 4.4.");
    expect(criteria[1]!.remarks).toBe("None this interval.");
    expect(criteria[1]!.unestablished).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review finding I4: no working section may lose its evidence silently.
// ---------------------------------------------------------------------------

import { SECTIONS_NOT_IN_MEMO } from "./assessment-memo";
import { PSUR_V4_TEMPLATE_SECTIONS } from "@/types/pv";

describe("every template section is accounted for (finding I4)", () => {
  it("is either mapped to a criterion or named in the exclusion list", () => {
    for (const section of PSUR_V4_TEMPLATE_SECTIONS) {
      const mapped = Object.values(CRITERION_SECTIONS).some((ids) => ids.includes(section.id));
      const excluded = SECTIONS_NOT_IN_MEMO.includes(section.id);
      expect(
        mapped || excluded,
        `${section.id} is neither mapped to a memo criterion nor named in SECTIONS_NOT_IN_MEMO`,
      ).toBe(true);
    }
  });

  it("never maps a section both ways", () => {
    for (const section of PSUR_V4_TEMPLATE_SECTIONS) {
      const mapped = Object.values(CRITERION_SECTIONS).some((ids) => ids.includes(section.id));
      expect(mapped && SECTIONS_NOT_IN_MEMO.includes(section.id)).toBe(false);
    }
  });

  it("carries special-populations evidence into the memo", () => {
    // S9 was absent from the original projection, so an accepted, cited
    // paediatric signal recorded there vanished with no warning anywhere.
    const out = evidenceCriteria([
      {
        section: "S9_SPECIAL_POPULATIONS",
        evidence: [
          ev({ id: "s9", section: "S9_SPECIAL_POPULATIONS", content: "Paediatric seizure risk." }),
        ],
      },
    ]);
    expect(out.some((c) => c.remarks.includes("Paediatric seizure risk."))).toBe(true);
  });

  it("excludes the screening step by name, not by omission", () => {
    expect(SECTIONS_NOT_IN_MEMO).toContain("ADMIN_SCREENING");
  });
});

// ---------------------------------------------------------------------------
// Review finding I3: S5 feeds criteria 8 and 9, so an untagged exposure
// count printed as a worldwide regulatory action.
// ---------------------------------------------------------------------------

describe("an untagged entry only answers the criterion it fits (finding I3)", () => {
  const exposure = () =>
    ev({
      id: "x",
      section: "S5_EXPOSURE_ACTIONS",
      sourceType: "VIGIFLOW_NIGERIA",
      content: "38,400 treatment courses in Nigeria.",
    });

  it("does not print a VigiFlow exposure count as a worldwide regulatory action", () => {
    const out = evidenceCriteria([{ section: "S5_EXPOSURE_ACTIONS", evidence: [exposure()] }]);
    expect(out.find((c) => c.id === "PATIENT_EXPOSURE")!.remarks).toContain("38,400");
    expect(out.find((c) => c.id === "WORLDWIDE_ACTIONS")!.remarks).not.toContain("38,400");
  });

  it("does not print a regulatory action as patient exposure data", () => {
    const action = ev({
      id: "a",
      section: "S5_EXPOSURE_ACTIONS",
      sourceType: "WORLDWIDE_REGULATORY_ACTIONS",
      content: "Health Canada restricted the indication.",
    });
    const out = evidenceCriteria([{ section: "S5_EXPOSURE_ACTIONS", evidence: [action] }]);
    expect(out.find((c) => c.id === "WORLDWIDE_ACTIONS")!.remarks).toContain("Health Canada");
    expect(out.find((c) => c.id === "PATIENT_EXPOSURE")!.remarks).not.toContain("Health Canada");
  });

  it("still honours an explicit criterion tag over the source type", () => {
    // The assessor's own routing decision wins: they may have a reason to
    // file a VigiFlow figure under the actions criterion.
    const tagged = { ...exposure(), criterion: "WORLDWIDE_ACTIONS" as const };
    const out = evidenceCriteria([{ section: "S5_EXPOSURE_ACTIONS", evidence: [tagged] }]);
    expect(out.find((c) => c.id === "WORLDWIDE_ACTIONS")!.remarks).toContain("38,400");
  });
});

// ---------------------------------------------------------------------------
// Review finding I7: a matrix nobody has scored must not render as a
// table of zeros that reads like a finding of zero risk.
// ---------------------------------------------------------------------------

describe("an unscored matrix does not render as zeros (finding I7)", () => {
  const blank = {
    epidemiologyOfDisease: { seriousness: 0, duration: 0, incidence: 0 },
    effectivenessOfProduct: { seriousness: 0, duration: 0, incidence: 0 },
    adrs: [],
  };

  it("refuses to build a memo from a matrix nobody has scored", () => {
    expect(buildAssessmentMemoModel(input({ matrix: blank }))).toBeNull();
  });

  it("builds once a reaction has been scored, even with the other rows at zero", () => {
    const m = buildAssessmentMemoModel(
      input({
        matrix: {
          ...blank,
          adrs: [{ reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } }],
        },
      }),
    );
    expect(m).not.toBeNull();
  });

  it("builds when the disease rows are scored even before any reaction is", () => {
    const m = buildAssessmentMemoModel(
      input({
        matrix: {
          ...blank,
          epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
        },
      }),
    );
    expect(m).not.toBeNull();
  });

  it("still builds the supplied memo's own matrix, which scores one cell zero", () => {
    expect(buildAssessmentMemoModel(input())).not.toBeNull();
  });
});
