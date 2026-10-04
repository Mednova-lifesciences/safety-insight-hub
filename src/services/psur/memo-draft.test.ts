import { describe, expect, it } from "vitest";
import type {
  AssessmentSection,
  EvidenceEntry,
  MemoCriterion,
  MemoCriterionId,
  PsurDocument,
} from "@/types/pv";
import { buildAssessmentMemoModel } from "./assessment-memo";
import {
  acceptEvidence,
  appendEvidence,
  defaultMemoDraft,
  evidenceForCriterion,
  formatMemoDate,
  homeSection,
  memoBlockers,
  memoInputFromDocument,
  rejectEvidence,
  reviseEvidence,
  searchSubstance,
  memoWarnings,
  verdictFromSection12,
  OUTCOME_VERDICT,
} from "./memo-draft";
import { renderableEvidence } from "./evidence";

const AT = "2026-10-04T00:00:00.000Z";

function entry(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id: "ev1",
    section: "S4_RSI",
    sourceType: "REFERENCE_SAFETY_INFORMATION",
    citation: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=abc",
    content: "Boxed warning strengthened in 02/2023.",
    origin: "ai",
    addedBy: "Eve Evaluator",
    addedAt: AT,
    ...overrides,
  };
}

function doc(overrides: Partial<PsurDocument> = {}): PsurDocument {
  return {
    id: "psur_1",
    filename: "tramadol.pdf",
    product: "Tramadol-50",
    reportingPeriod: "12 November 2021 to 12 November 2024",
    uploadedAt: "2026-09-03T09:00:00.000Z",
    uploadedBy: "Officer",
    stage: "REVIEWED",
    pages: 40,
    administrativeScreening: {
      performedAt: AT,
      assistGenerated: false,
      checks: [],
      submissionDetails: {
        productName: "Tramadol-50 (Tramadol 50mg) Capsule",
        activeSubstance: "Tramadol",
        nafdacRegNo: "",
        mah: "Example Pharma Ltd, 1 Marina Road, Lagos",
        qppv: "",
        qppvContact: "",
        ibd: "1977",
        firstNafdacRegistrationDate: "",
        dlp: "12 November 2024",
        intervalCovered: "12 November 2021 to 12 November 2024",
        dateReceived: "2026-09-03",
      },
    },
    ...overrides,
  } as PsurDocument;
}

describe("evidence transitions", () => {
  it("files new evidence under the criterion's first section", () => {
    expect(homeSection("RSI_CHANGES")).toBe("S4_RSI");
    expect(homeSection("RELEVANT_STUDIES")).toBe("S6_LITERATURE");
    expect(() => homeSection("PRODUCT_IDENTITY")).toThrow();
  });

  it("refuses evidence with no citation", () => {
    expect(() => appendEvidence([], entry({ citation: "  " }))).toThrow(/citation/);
  });

  it("a candidate renders only once accepted", () => {
    const s1 = appendEvidence([], entry());
    expect(renderableEvidence(s1.evidence)).toHaveLength(0);
    const s2 = acceptEvidence([s1], "ev1", "Eve Evaluator", AT);
    expect(renderableEvidence(s2.evidence)).toHaveLength(1);
  });

  it("a rejected candidate stays on record and never renders", () => {
    const s1 = appendEvidence([], entry());
    const s2 = rejectEvidence([s1], "ev1", "Eve Evaluator", AT);
    expect(s2.evidence).toHaveLength(1);
    expect(renderableEvidence(s2.evidence)).toHaveLength(0);
    expect(() => acceptEvidence([s2], "ev1", "Eve", AT)).toThrow();
  });

  it("accepted evidence cannot be rejected, only revised", () => {
    const s = acceptEvidence([appendEvidence([], entry())], "ev1", "Eve", AT);
    expect(() => rejectEvidence([s], "ev1", "Eve", AT)).toThrow(/revising/);
  });

  it("a revision supersedes without touching the original", () => {
    const accepted = acceptEvidence([appendEvidence([], entry())], "ev1", "Eve", AT);
    const original = accepted.evidence[0]!;
    const revised = reviseEvidence(
      [accepted],
      original,
      { content: "Corrected wording.", citation: original.citation },
      "ev2",
      "Pat Peer",
      AT,
    );
    expect(revised.evidence).toHaveLength(2);
    expect(revised.evidence[0]).toEqual(original);
    expect(renderableEvidence(revised.evidence).map((e) => e.content)).toEqual([
      "Corrected wording.",
    ]);
    const statuses = evidenceForCriterion([revised], "RSI_CHANGES").map((x) => x.status);
    expect(statuses).toEqual(["SUPERSEDED", "ACCEPTED"]);
  });
});

describe("the memo draft", () => {
  it("is pre-filled only with what the document states", () => {
    const d = defaultMemoDraft(doc(), new Date(2026, 8, 17));
    expect(d.memoDate).toBe("17 September 2026");
    expect(d.productNameAndStrength).toBe("Tramadol-50 (Tramadol 50mg) Capsule");
    expect(d.mahName).toBe("Example Pharma Ltd");
    expect(d.referenceSuffix).toBe("");
    expect(d.bandConfirmed).toBe("");
    expect(d.verdictConfirmed).toBe("");
  });

  it("searches registries for the active substance", () => {
    expect(searchSubstance(doc())).toBe("Tramadol");
  });

  it("lists what blocks generation until the assessor has done it", () => {
    const d = defaultMemoDraft(doc());
    expect(memoBlockers(d, undefined)).toContain("Enter the memo reference number.");
    expect(memoBlockers(d, undefined)).toContain("Confirm the benefit-risk verdict.");
    const done = {
      ...d,
      referenceSuffix: "455/III",
      signatory: "For: Director",
      bandConfirmed: "Medium",
      verdictConfirmed: "Positive Benefit-Risk Balance",
      conclusion: "The product possesses a positive balance.",
    };
    const matrix = {
      epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
      effectivenessOfProduct: { seriousness: 3, duration: 3, incidence: 0 },
      adrs: [{ reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } }],
    };
    expect(memoBlockers(done, matrix)).toEqual([]);
  });

  it("projects answers, enumeration and evidence into the memo", () => {
    const sections: AssessmentSection[] = [
      acceptEvidence([appendEvidence([], entry())], "ev1", "Eve", AT),
    ];
    const draft = {
      ...defaultMemoDraft(doc()),
      referenceSuffix: "455/III",
      answers: {
        RSI_CHANGES: "Yes" as const,
        WORLDWIDE_ACTIONS: "No" as const,
        PATIENT_EXPOSURE_AFRICAN: "Yes" as const,
        PATIENT_EXPOSURE_NIGERIAN: "Yes" as const,
      },
      overallSafetyEnumeration: "Respiratory Depression\n\nSeizures\n",
    };
    const m = buildAssessmentMemoModel(
      memoInputFromDocument(
        doc({
          assessmentSections: sections,
          ciomsMatrix: {
            epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
            effectivenessOfProduct: { seriousness: 3, duration: 3, incidence: 0 },
            adrs: [{ reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } }],
          },
        }),
        draft,
      ),
    )!;
    const by = Object.fromEntries(m.criteria.map((c) => [c.id, c])) as Record<
      MemoCriterionId,
      MemoCriterion
    >;
    expect(m.referenceNumber).toBe("NAFDAC/PV/GCIOMS/455/III");
    expect(by.RSI_CHANGES.answer).toBe("Yes");
    expect(by.RSI_CHANGES.citations).toHaveLength(1);
    // "No" with nothing behind it is a finding, not a gap.
    expect(by.WORLDWIDE_ACTIONS.answer).toBe("No");
    expect(by.WORLDWIDE_ACTIONS.unestablished).toBe(false);
    expect(by.PATIENT_EXPOSURE.answer).toBe("African component: Yes\nNigerian component: Yes");
    expect(by.OVERALL_SAFETY_EVALUATION.remarks).toBe("Respiratory Depression\nSeizures");
    // Unanswered with no evidence still says so.
    expect(by.RELEVANT_STUDIES.unestablished).toBe(true);
    expect(by.INTERNATIONAL_BIRTH_DATE.remarks).toBe("1977");
    expect(m.mahName).toBe("Example Pharma Ltd");
  });

  it("prints evidence only under the criterion it was gathered for", () => {
    // S5 feeds both criterion 8 and criterion 9. A VigiFlow count filed
    // there once printed under "worldwide regulatory actions" as well.
    const vigiflow = entry({
      id: "vf",
      section: "S5_EXPOSURE_ACTIONS",
      criterion: "PATIENT_EXPOSURE",
      sourceType: "VIGIFLOW_NIGERIA",
      citation: "VigiFlow, searched by hand",
      content: "4 ADR reports on VigiFlow.",
    });
    const sections = [acceptEvidence([appendEvidence([], vigiflow)], "vf", "Eve", AT)];
    const m = buildAssessmentMemoModel(
      memoInputFromDocument(
        doc({
          assessmentSections: sections,
          ciomsMatrix: {
            epidemiologyOfDisease: { seriousness: 1, duration: 1, incidence: 1 },
            effectivenessOfProduct: { seriousness: 1, duration: 1, incidence: 1 },
            adrs: [],
          },
        }),
        defaultMemoDraft(doc()),
      ),
    )!;
    const remarks = (id: MemoCriterionId) => m.criteria.find((c) => c.id === id)!.remarks;
    expect(remarks("PATIENT_EXPOSURE")).toContain("VigiFlow");
    expect(remarks("WORLDWIDE_ACTIONS")).not.toContain("VigiFlow");
    expect(evidenceForCriterion(sections, "WORLDWIDE_ACTIONS")).toHaveLength(0);
    expect(evidenceForCriterion(sections, "PATIENT_EXPOSURE")).toHaveLength(1);
  });

  it("files each criterion's evidence in a section no other criterion reads", () => {
    const homes = (
      [
        "RSI_CHANGES",
        "WORLDWIDE_ACTIONS",
        "PATIENT_EXPOSURE",
        "RELEVANT_STUDIES",
        "OVERALL_SAFETY_EVALUATION",
      ] as MemoCriterionId[]
    ).map(homeSection);
    expect(new Set(homes).size).toBe(homes.length);
  });

  it("writes the date the way the memo does", () => {
    expect(formatMemoDate(new Date(2026, 0, 5))).toBe("5 January 2026");
  });
});

describe("the memo verdict and the Section 12 decision", () => {
  const decided = (outcome: "FAVOURABLE" | "FAVOURABLE_WITH_CONDITIONS" | "UNFAVOURABLE") =>
    doc({
      regulatoryDecision: {
        actions: ["CONTINUE_ROUTINE_PV"],
        overallOutcome: outcome,
        basis: "b",
        decidedBy: "Eve",
        decidedAt: AT,
      },
    } as Partial<PsurDocument>);

  it("words a favourable outcome the way the supplied memo does", () => {
    expect(OUTCOME_VERDICT.FAVOURABLE).toBe("Positive Benefit-Risk Balance");
  });

  it("a new draft's verdict starts from the Section 12 decision", () => {
    expect(defaultMemoDraft(decided("FAVOURABLE_WITH_CONDITIONS")).verdictConfirmed).toBe(
      "Positive Benefit-Risk Balance, subject to conditions",
    );
  });

  it("with no Section 12 decision the verdict starts empty, and that is said", () => {
    const d = doc();
    expect(verdictFromSection12(d)).toBeUndefined();
    expect(defaultMemoDraft(d).verdictConfirmed).toBe("");
    expect(memoWarnings(d, defaultMemoDraft(d)).join(" ")).toMatch(/Section 12 has no overall/);
  });

  it("warns when the memo and Section 12 disagree, and is quiet when they agree", () => {
    const d = decided("UNFAVOURABLE");
    const agreeing = defaultMemoDraft(d);
    expect(memoWarnings(d, agreeing)).toEqual([]);
    const disagreeing = { ...agreeing, verdictConfirmed: "Positive Benefit-Risk Balance" };
    expect(memoWarnings(d, disagreeing).join(" ")).toMatch(/differs from the Section 12 outcome/);
  });

  it("a disagreement warns but never blocks generation", () => {
    const d = decided("UNFAVOURABLE");
    const draft = {
      ...defaultMemoDraft(d),
      referenceSuffix: "1/I",
      signatory: "S",
      bandConfirmed: "Medium",
      verdictConfirmed: "Positive Benefit-Risk Balance",
      conclusion: "c",
    };
    const matrix = {
      epidemiologyOfDisease: { seriousness: 1, duration: 1, incidence: 1 },
      effectivenessOfProduct: { seriousness: 1, duration: 1, incidence: 1 },
      adrs: [{ reaction: "Rash", scores: { seriousness: 1, duration: 1, incidence: 1 } }],
    };
    expect(memoBlockers(draft, matrix)).toEqual([]);
    expect(memoWarnings(d, draft)).toHaveLength(1);
  });
});
