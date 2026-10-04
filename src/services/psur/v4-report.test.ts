import { describe, expect, it } from "vitest";
import type { AssessmentSection, PsurDocument, PsurFinding } from "@/types/pv";
import { AI_DRAFT_NOTE, buildV4ReportModel, type V4Block } from "./v4-report";
import { defaultFieldForCriterion, fieldForEvidence } from "./v4-fields";

const AT = "2026-10-04T12:00:00.000Z";

function doc(overrides: Partial<PsurDocument> = {}): PsurDocument {
  return {
    id: "psur_1",
    filename: "amoxiclav.pdf",
    product: "Amoxiclav",
    reportingPeriod: "01 Sep 2025 – 31 Aug 2026",
    uploadedAt: "2026-10-04T09:00:00.000Z",
    uploadedBy: "Officer",
    stage: "REVIEWED",
    pages: 14,
    administrativeScreening: {
      performedAt: AT,
      assistGenerated: false,
      checks: [],
      submissionDetails: {
        productName: "Amoxicillin/Clavulanate 500/125 mg tablets",
        activeSubstance: "Amoxicillin / Clavulanate",
        nafdacRegNo: "A4-100123",
        mah: "Zephyr Pharma Nigeria Limited",
        qppv: "",
        qppvContact: "",
        ibd: "17 March 2014",
        firstNafdacRegistrationDate: "05 June 2018",
        dlp: "31 August 2026",
        intervalCovered: "01 Sep 2025 – 31 Aug 2026",
        dateReceived: "2026-10-04",
      },
    },
    ...overrides,
  } as PsurDocument;
}

const evidence = (
  id: string,
  content: string,
  citation: string,
  extra: Partial<AssessmentSection["evidence"][number]> = {},
) => ({
  id,
  section: "S4_RSI" as const,
  sourceType: "REFERENCE_SAFETY_INFORMATION" as const,
  citation,
  content,
  origin: "assessor" as const,
  addedBy: "Eve",
  addedAt: AT,
  acceptedBy: "Eve",
  acceptedAt: AT,
  ...extra,
});

function field(model: ReturnType<typeof buildV4ReportModel>, section: number, labelStart: string) {
  const s = model.sections.find((x) => x.number === section)!;
  return s.blocks.find(
    (b): b is Extract<V4Block, { kind: "field" }> =>
      b.kind === "field" && b.label.startsWith(labelStart),
  );
}

describe("the V4 report keeps the template's structure", () => {
  it("has the administrative check and sections 1 to 13, in order, with the template's titles", () => {
    const m = buildV4ReportModel(doc(), []);
    expect(m.title).toBe("PSUR/PBRER EVALUATION FORM");
    expect(m.sections.map((s) => s.number)).toEqual([
      null,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
    ]);
    expect(m.sections[0]!.title).toBe("Administrative Completeness Check");
    expect(m.sections.find((s) => s.number === 10)!.title).toBe("Benefit-Risk Assessment");
    expect(m.sections.find((s) => s.number === 11)!.title).toBe(
      "Uncertainties Affecting the Benefit-Risk Assessment",
    );
  });

  it("fills Section 1 from the screening, saying so when something was not stated", () => {
    const m = buildV4ReportModel(doc(), []);
    const t = m.sections.find((s) => s.number === 1)!.blocks[0] as Extract<
      V4Block,
      { kind: "table" }
    >;
    const row = (label: string) => t.rows.find((r) => r[0] === label)![1];
    expect(row("NAFDAC Registration Number")).toBe("A4-100123");
    expect(row("Nigerian Birth Date (NBD)")).toBe("05 June 2018");
    expect(row("Therapeutic Indication(s)")).toBe("Not stated in the submission");
  });

  it("an unanswered assessment field reads 'Not assessed', never blank", () => {
    const m = buildV4ReportModel(doc(), []);
    expect(field(m, 6, "Briefly highlight studies")!.value).toBe("Not assessed");
  });
});

describe("research goes into the field it answers, with numbered references", () => {
  const sections: AssessmentSection[] = [
    {
      section: "S4_RSI",
      evidence: [
        evidence(
          "e1",
          "SmPC v7.2 added DIES to section 4.4.",
          "Submitted PSUR, Appendix I, p. 12",
          {
            criterion: "RSI_CHANGES",
          },
        ),
        evidence("e2", "SmPC version 7.2.", "Submitted PSUR, Appendix I, p. 1", {
          v4Field: "S4_TYPE_VERSION",
        }),
      ],
    },
    {
      section: "S6_LITERATURE",
      evidence: [
        evidence(
          "e3",
          "A 2026 cohort found more GI adverse events.",
          "Savage TJ et al. JAMA 2026",
          {
            section: "S6_LITERATURE",
            criterion: "RELEVANT_STUDIES",
          },
        ),
        // The same source cited twice keeps one number.
        evidence(
          "e4",
          "The same cohort found no excess hepatotoxicity.",
          "Savage TJ et al. JAMA 2026",
          {
            section: "S6_LITERATURE",
            criterion: "RELEVANT_STUDIES",
          },
        ),
      ],
    },
  ];

  it("prints each piece in its field with its reference number", () => {
    const m = buildV4ReportModel(doc({ assessmentSections: sections }), []);
    // Numbered in order of appearance: "RSI type" comes first in Section 4.
    expect(field(m, 4, "RSI type")!.value).toBe("SmPC version 7.2. [1]");
    expect(field(m, 4, "Changes made to the RSI")!.value).toBe(
      "SmPC v7.2 added DIES to section 4.4. [2]",
    );
    expect(field(m, 6, "Briefly highlight studies")!.value).toContain("[3]");
  });

  it("numbers each source once and lists them all under Section 13 References", () => {
    const m = buildV4ReportModel(doc({ assessmentSections: sections }), []);
    expect(m.references).toEqual([
      "Submitted PSUR, Appendix I, p. 1",
      "Submitted PSUR, Appendix I, p. 12",
      "Savage TJ et al. JAMA 2026",
    ]);
    const refs = m.sections
      .find((s) => s.number === 13)!
      .blocks.find(
        (b): b is Extract<V4Block, { kind: "list" }> =>
          b.kind === "list" && b.title === "References",
      )!;
    expect(refs.items.slice(0, 3)).toEqual([
      "[1] Submitted PSUR, Appendix I, p. 1",
      "[2] Submitted PSUR, Appendix I, p. 12",
      "[3] Savage TJ et al. JAMA 2026",
    ]);
  });

  it("never prints a candidate nobody accepted", () => {
    const unaccepted: AssessmentSection[] = [
      {
        section: "S4_RSI",
        evidence: [
          {
            ...evidence("c1", "Unreviewed AI text.", "x"),
            acceptedBy: undefined,
            acceptedAt: undefined,
          },
        ],
      },
    ];
    const m = buildV4ReportModel(doc({ assessmentSections: unaccepted }), []);
    expect(JSON.stringify(m)).not.toContain("Unreviewed AI text");
    expect(m.references).toEqual([]);
  });

  it("a memo criterion implies its V4 field when none was chosen", () => {
    expect(defaultFieldForCriterion("PATIENT_EXPOSURE")).toBe("S7_VIGIFLOW");
    expect(fieldForEvidence(evidence("x", "c", "s", { criterion: "WORLDWIDE_ACTIONS" }))).toBe(
      "S2_ACTIONS",
    );
  });
});

describe("findings and decisions", () => {
  it("lists a section's accepted findings, marking those NAFDAC resolved", () => {
    const f = {
      id: "f1",
      category: "MISSING_SECTION",
      severity: "MEDIUM",
      section: "RSI",
      description: "RSI changes are not described.",
      evidence: "",
      v4Section: "S4_RSI",
      assistGenerated: true,
      humanAssessment: "ACCEPTED",
      resolved: true,
      researchResolution: {
        by: "Eve",
        at: AT,
        content: "SmPC v7.2 added DIES.",
        citation: "Appendix I",
      },
    } as PsurFinding;
    const m = buildV4ReportModel(doc(), [f]);
    const list = m.sections
      .find((s) => s.number === 4)!
      .blocks.find((b): b is Extract<V4Block, { kind: "list" }> => b.kind === "list")!;
    expect(list.items[0]).toContain(
      "Resolved by NAFDAC during this assessment: SmPC v7.2 added DIES. [1]",
    );
    expect(m.references).toContain("Appendix I");
  });

  it("ticks the Section 12 outcome and prints the follow-up deadline the template asks for", () => {
    const m = buildV4ReportModel(
      doc({
        regulatoryDecision: {
          actions: ["CONTINUE_ROUTINE_PV"],
          overallOutcome: "FAVOURABLE_WITH_CONDITIONS",
          basis: "b",
          followUpRequired: "Reconcile Nigerian cases with VigiFlow",
          mahResponseDeadline: "2026-12-31",
          decidedBy: "Eve",
          decidedAt: AT,
        },
      }),
      [],
    );
    const s12 = m.sections.find((s) => s.number === 12)!;
    const outcomes = s12.blocks.filter(
      (b): b is Extract<V4Block, { kind: "ticks" }> => b.kind === "ticks",
    )[1]!;
    expect(outcomes.options.filter((o) => o.checked).map((o) => o.label)).toEqual([
      "Favourable with conditions",
    ]);
    expect(field(m, 12, "Follow-up information required")!.value).toBe(
      "Reconcile Nigerian cases with VigiFlow. Deadline: 31 December 2026.",
    );
  });
});

describe("research kept out of the memo", () => {
  it("still prints in the V4 field chosen for it", () => {
    const f = {
      id: "f2",
      category: "MISSING_SECTION",
      severity: "MEDIUM",
      section: "Product info",
      description: "No separate Date of Review.",
      evidence: "",
      v4Section: "S1_PRODUCT_REGULATORY",
      assistGenerated: true,
      humanAssessment: "ACCEPTED",
      resolved: true,
      researchResolution: {
        by: "Eve",
        at: AT,
        content: "Date of review taken as the QPPV signature date, 12 September 2026.",
        citation: "Submitted PSUR, title page",
        v4Field: "S1_FURTHER",
      },
    } as PsurFinding;
    const m = buildV4ReportModel(doc(), [f]);
    expect(field(m, 1, "Further assessment")!.value).toBe(
      "Date of review taken as the QPPV signature date, 12 September 2026. [1]",
    );
    expect(m.references).toEqual(["Submitted PSUR, title page"]);
  });
});

describe("the evaluator's Sections 1-8 answers", () => {
  const screened = (extra: Partial<PsurDocument> = {}) =>
    doc({
      screening: {
        performedAt: AT,
        administrativeChecks: [],
        sectionCoverage: [
          {
            section: "S2_WORLDWIDE_STATUS",
            status: "ADEQUATELY_ADDRESSED",
            comment: "Authorised in 14 countries; no safety actions.",
            source: "ai",
          },
        ],
        recommendation: "PROCEED_TO_SCIENTIFIC_REVIEW",
        assistGenerated: true,
      },
      ...extra,
    });
  const blocks = (m: ReturnType<typeof buildV4ReportModel>, n: number) =>
    m.sections.find((s) => s.number === n)!.blocks;
  const ticks = (m: ReturnType<typeof buildV4ReportModel>, n: number) =>
    blocks(m, n)
      .filter((b): b is Extract<V4Block, { kind: "ticks" }> => b.kind === "ticks")
      .flatMap((b) => b.options.map((o) => o.checked));

  it("marks an assessment nobody reviewed as the AI's draft", () => {
    const m = buildV4ReportModel(screened(), []);
    expect(field(m, 2, "Reviewer's assessment")!.value).toContain("Authorised in 14 countries");
    expect(blocks(m, 2)).toContainEqual({ kind: "instruction", text: AI_DRAFT_NOTE });
  });

  it("prints the evaluator's own wording once reviewed, without the AI note", () => {
    const m = buildV4ReportModel(
      screened({
        v4SectionAnswers: {
          assessments: {
            S2_WORLDWIDE_STATUS: { text: "Adequate. No action needed.", by: "Eve", at: AT },
          },
        },
      }),
      [],
    );
    expect(field(m, 2, "Reviewer's assessment")!.value).toBe("Adequate. No action needed.");
    expect(blocks(m, 2)).not.toContainEqual({ kind: "instruction", text: AI_DRAFT_NOTE });
  });

  it("uses the evaluator's ticks over what the research implies", () => {
    const vigiflow = evidence("e1", "4 Nigerian ICSRs.", "VigiFlow, searched 4 October 2026", {
      v4Field: "S7_VIGIFLOW",
    });
    const withResearch = (answers?: PsurDocument["v4SectionAnswers"]) =>
      screened({
        assessmentSections: [
          { section: "S7_AGGREGATE_SAFETY_DATA", evidence: [vigiflow] } as AssessmentSection,
        ],
        v4SectionAnswers: answers,
      });
    // No answers: VigiFlow research implies VigiFlow was checked.
    expect(ticks(buildV4ReportModel(withResearch(), []), 7)).toEqual([false, true]);
    expect(ticks(buildV4ReportModel(withResearch(), []), 2)).toEqual([false]);
    const m = buildV4ReportModel(
      withResearch({ s2Inconsistent: true, s7AdrTabulation: true, s7VigiflowChecked: false }),
      [],
    );
    expect(ticks(m, 7)).toEqual([true, false]);
    expect(ticks(m, 2)).toEqual([true]);
  });
});

describe("Section 2's 'If yes, explain'", () => {
  const explain = (answers: PsurDocument["v4SectionAnswers"]) =>
    field(buildV4ReportModel(doc({ v4SectionAnswers: answers }), []), 2, "If yes, explain")!.value;

  it("prints the evaluator's explanation when the box is ticked", () => {
    expect(
      explain({
        s2Inconsistent: true,
        s2Explanation: "FDA DIES warning not in the Nigerian SmPC.",
      }),
    ).toBe("FDA DIES warning not in the Nigerian SmPC.");
  });

  it("says 'Not assessed' when ticked without an explanation, and stays blank when not ticked", () => {
    expect(explain({ s2Inconsistent: true })).toBe("Not assessed");
    expect(explain({ s2Inconsistent: false })).toBe("");
  });
});
