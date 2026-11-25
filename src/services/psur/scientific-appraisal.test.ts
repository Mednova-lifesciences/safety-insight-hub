import { describe, expect, it } from "vitest";
import {
  appraisalCellKind,
  descriptionOverlap,
  mapAiScientificAppraisal,
  mergeAppraisalFindings,
  wholeSectionKind,
} from "./scientific-appraisal";
import { buildRequiredAction } from "./document-model";
import { requiresMahAction } from "./finding-ownership";
import type { AiPsurAppraisalResponse } from "@/services/api/ai";
import type { PsurFinding, PsurSectionAppraisal } from "@/types/pv";

function finding(overrides: Partial<PsurFinding> = {}): PsurFinding {
  return {
    id: "pf-1",
    category: "SIGNAL",
    severity: "HIGH",
    section: "15. Overview of signals",
    description: "Investigational uses are presented as safety signals.",
    evidence: "Signal table, p.3.",
    v4Section: "S8_SIGNAL_EVALUATION",
    deficiencyType: "MISCLASSIFICATION",
    assistGenerated: true,
    humanAssessment: null,
    source: "ai",
    ...overrides,
  };
}

describe("mergeAppraisalFindings", () => {
  it("keeps the appraisal's version when both passes flag the same misclassification", () => {
    const completeness = [finding({ id: "c1", aiPass: "COMPLETENESS" })];
    const appraisal = [finding({ id: "a1", aiPass: "APPRAISAL" })];
    expect(mergeAppraisalFindings(completeness, appraisal).map((f) => f.id)).toEqual(["a1"]);
  });

  it("keeps everything else from the completeness pass", () => {
    const completeness = [
      finding({
        id: "c1",
        deficiencyType: "MISSING_REQUIRED_SECTION",
        category: "MISSING_SECTION",
        description: "No worldwide regulatory status table is provided for the interval.",
      }),
      // Same type but a different section — not a duplicate.
      finding({ id: "c2", v4Section: "S7_AGGREGATE_SAFETY_DATA" }),
    ];
    const appraisal = [finding({ id: "a1" })];
    expect(mergeAppraisalFindings(completeness, appraisal).map((f) => f.id)).toEqual([
      "c1",
      "c2",
      "a1",
    ]);
  });
});

describe("mapAiScientificAppraisal", () => {
  const base: AiPsurAppraisalResponse = {
    findings: [],
    section_appraisals: [
      {
        v4_section: "S8_SIGNAL_EVALUATION",
        correct: { verdict: "SOUND", reasoning: "" },
        classified: { verdict: "CONCERN", reasoning: "Two items are therapeutic uses." },
        meaningful: { verdict: "NOT_ASSESSABLE", reasoning: "" },
        interpreted: { verdict: "CONCERN", reasoning: "" },
        summary: "Two of three listed signals are not safety signals.",
      },
    ],
    product_context: { active_substance: "sildenafil", approved_indications: ["ED", "PAH"] },
    ai_used: true,
    prompt_version: "x",
    model: "m",
    chunks_total: 2,
    chunks_read: 1,
    unread_pages: ["pages 40-80"],
  };

  it("maps sections, context and unread pages", () => {
    const a = mapAiScientificAppraisal(base, "2026-11-15T00:00:00.000Z");
    expect(a.error).toBeUndefined();
    expect(a.sections[0]?.classified.verdict).toBe("CONCERN");
    expect(a.productContext?.activeSubstance).toBe("sildenafil");
    expect(a.unreadPages).toEqual(["pages 40-80"]);
  });

  it("records a failed appraisal as an error, never as an empty clean result", () => {
    const a = mapAiScientificAppraisal({ ...base, ai_used: false, error: "timeout" });
    expect(a.sections).toEqual([]);
    expect(a.error).toBe("timeout");
  });
});

describe("misclassification and misinterpretation go to the MAH", () => {
  it("routes both to the MAH letter with a specific required action", () => {
    for (const t of ["MISCLASSIFICATION", "MISINTERPRETATION"] as const) {
      const f = finding({ deficiencyType: t });
      expect(requiresMahAction(f)).toBe(true);
      expect(buildRequiredAction(f)).not.toBe(f.description);
    }
  });
});

// Real description pairs from a live review of the fictional test PSUR: the
// same finding raised by both AI passes in different words, and different
// problems that merely share a section.
const REAL = {
  s5Completeness:
    "Worldwide exposure is reported, but no Nigerian exposure denominator is available. The method is described only as being derived from units sold, without the conversion assumptions or interval/cumulative methodology needed to assess the estimate.",
  s5AppraisalMethod:
    "The global exposure estimate is said to be derived from units sold, but the conversion method and assumptions are not stated; the cumulative estimate is specifically reported as having no stated method.",
  s7Completeness:
    "The post-marketing counts are worldwide only and do not provide the required Nigerian interval or cumulative case counts, including serious cases, or a numerical reconciliation with NAFDAC/VigiFlow data.",
  s7AppraisalCounts:
    "The post-marketing case counts are global only and do not provide the required Nigerian interval and cumulative case counts, including serious cases. No explicit comparison with Nigerian VigiFlow figures is presented in the submission.",
  s7AppraisalTable:
    "The report treats the two indication-specific columns as different time periods, stating that 31 SAEs were reported in the interval and 90 were cumulative. The table structure identifies these figures as erectile dysfunction and pulmonary arterial hypertension columns, not interval and cumulative columns.",
  s8HearingCompleteness:
    "Sudden sensorineural hearing loss is a plausible safety signal requiring assessment, but the submission provides only seven cases and states that causality review is ongoing; it does not provide the evaluation conclusion, denominators, detailed case assessment or action.",
  s8HearingAppraisal:
    "Sudden sensorineural hearing loss is a genuine safety signal candidate based on seven new spontaneous cases occurring within 48 hours of dosing, but the submission provides only that a cumulative causality review is in progress and does not provide the evaluation, conclusion or action.",
  s8Raynaud:
    "Raynaud's phenomenon is presented as a new safety signal, but the description concerns possible efficacy and a proposed new indication rather than information suggesting a new or changed product-event safety association.",
};

describe("duplicate findings across the two AI passes", () => {
  it("measures real duplicates well above, and real distinct findings well below, the threshold", () => {
    const dup = [
      descriptionOverlap(REAL.s5Completeness, REAL.s5AppraisalMethod),
      descriptionOverlap(REAL.s7Completeness, REAL.s7AppraisalCounts),
      descriptionOverlap(REAL.s8HearingCompleteness, REAL.s8HearingAppraisal),
    ];
    const distinct = [
      descriptionOverlap(REAL.s7Completeness, REAL.s7AppraisalTable),
      descriptionOverlap(REAL.s8HearingCompleteness, REAL.s8Raynaud),
    ];
    for (const d of dup) expect(d.share).toBeGreaterThanOrEqual(0.6);
    for (const d of distinct) expect(d.share).toBeLessThan(0.3);
  });

  it("drops a completeness finding that restates an appraisal finding in the same section", () => {
    const merged = mergeAppraisalFindings(
      [
        finding({ id: "c5", v4Section: "S5_EXPOSURE_ACTIONS", deficiencyType: "MISSING_REQUIRED_SECTION", description: REAL.s5Completeness }),
        finding({ id: "c7", v4Section: "S7_AGGREGATE_SAFETY_DATA", deficiencyType: "MISSING_REQUIRED_SECTION", description: REAL.s7Completeness }),
        finding({ id: "c8", v4Section: "S8_SIGNAL_EVALUATION", deficiencyType: "INCOMPLETE_INFORMATION", description: REAL.s8HearingCompleteness }),
      ],
      [
        finding({ id: "a5", v4Section: "S5_EXPOSURE_ACTIONS", deficiencyType: "INCONSISTENCY", description: REAL.s5AppraisalMethod }),
        finding({ id: "a7", v4Section: "S7_AGGREGATE_SAFETY_DATA", deficiencyType: "INCONSISTENCY", description: REAL.s7AppraisalCounts }),
        finding({ id: "a8", v4Section: "S8_SIGNAL_EVALUATION", deficiencyType: "INCOMPLETE_INFORMATION", description: REAL.s8HearingAppraisal }),
      ],
    );
    expect(merged.map((f) => f.id)).toEqual(["a5", "a7", "a8"]);
  });

  it("keeps a completeness finding that is about something different", () => {
    const merged = mergeAppraisalFindings(
      [finding({ id: "c7", v4Section: "S7_AGGREGATE_SAFETY_DATA", description: REAL.s7Completeness })],
      [finding({ id: "a7", v4Section: "S7_AGGREGATE_SAFETY_DATA", deficiencyType: "MISINTERPRETATION", description: REAL.s7AppraisalTable })],
    );
    expect(merged.map((f) => f.id)).toEqual(["c7", "a7"]);
  });

  it("never merges across sections, even with identical wording", () => {
    const merged = mergeAppraisalFindings(
      [finding({ id: "c10", v4Section: "S10_BENEFIT_RISK", description: REAL.s7Completeness })],
      [finding({ id: "a7", v4Section: "S7_AGGREGATE_SAFETY_DATA", description: REAL.s7Completeness })],
    );
    expect(merged.map((f) => f.id)).toEqual(["c10", "a7"]);
  });

  it("keeps findings that have no section", () => {
    const merged = mergeAppraisalFindings(
      [finding({ id: "c0", v4Section: undefined, description: REAL.s7Completeness })],
      [finding({ id: "a7", v4Section: "S7_AGGREGATE_SAFETY_DATA", description: REAL.s7Completeness })],
    );
    expect(merged.map((f) => f.id)).toEqual(["c0", "a7"]);
  });

  it("a misclassification in the appraisal replaces the completeness one in that section only", () => {
    const merged = mergeAppraisalFindings(
      [
        finding({ id: "c8", v4Section: "S8_SIGNAL_EVALUATION", deficiencyType: "MISCLASSIFICATION", description: "Items listed as signals are efficacy topics." }),
        finding({ id: "c10", v4Section: "S10_BENEFIT_RISK", deficiencyType: "MISCLASSIFICATION", description: "Benefit statement cites unapproved uses." }),
      ],
      [finding({ id: "a8", v4Section: "S8_SIGNAL_EVALUATION", deficiencyType: "MISCLASSIFICATION", description: REAL.s8Raynaud })],
    );
    expect(merged.map((f) => f.id)).toEqual(["c10", "a8"]);
  });
});

describe("what an unanswered question is called on screen", () => {
  const na = { verdict: "NOT_ASSESSABLE" as const, reasoning: "" };
  const section = (over: Partial<PsurSectionAppraisal> = {}): PsurSectionAppraisal => ({
    v4Section: "S2_WORLDWIDE_STATUS",
    correct: na,
    classified: na,
    meaningful: na,
    interpreted: na,
    summary: "",
    ...over,
  });

  it("calls it 'not in submission' when the MAH left the section out, never a failure", () => {
    expect(appraisalCellKind("NOT_ASSESSABLE", section(), "MISSING")).toBe("NOT_IN_SUBMISSION");
    expect(wholeSectionKind(section(), "MISSING")).toBe("NOT_IN_SUBMISSION");
  });

  it("calls it 'not appraised' when the AI returned nothing — even for a missing section", () => {
    const failed = section({ returned: false });
    expect(appraisalCellKind("NOT_ASSESSABLE", failed, "MISSING")).toBe("NOT_RETURNED");
    expect(appraisalCellKind("NOT_ASSESSABLE", failed, "ADEQUATELY_ADDRESSED")).toBe("NOT_RETURNED");
    expect(wholeSectionKind(failed, "MISSING")).toBe("NOT_RETURNED");
  });

  it("calls it 'not enough detail' when the section is present but too thin", () => {
    for (const status of ["PRESENT_BUT_INCOMPLETE", "ADEQUATELY_ADDRESSED", "ASSESSOR_PENDING", undefined] as const) {
      expect(appraisalCellKind("NOT_ASSESSABLE", section(), status)).toBe("INSUFFICIENT_DETAIL");
    }
  });

  it("treats documents stored before the flag existed as returned", () => {
    expect(appraisalCellKind("NOT_ASSESSABLE", section({ returned: undefined }), "MISSING")).toBe(
      "NOT_IN_SUBMISSION",
    );
  });

  it("shows a real verdict as given, even for a section that is otherwise missing", () => {
    const s11 = section({ meaningful: { verdict: "CONCERN", reasoning: "r" }, classified: { verdict: "SOUND", reasoning: "r" } });
    expect(appraisalCellKind("CONCERN", s11, "MISSING")).toBe("CONCERN");
    expect(appraisalCellKind("SOUND", s11, "MISSING")).toBe("SOUND");
    // A mixed section is not collapsed to a single "nothing to appraise" row.
    expect(wholeSectionKind(s11, "MISSING")).toBeNull();
  });

  it("never reports a section the AI judged as 'nothing to appraise'", () => {
    const judged = section({ correct: { verdict: "SOUND", reasoning: "" } });
    expect(wholeSectionKind(judged, "MISSING")).toBeNull();
  });
});

describe("mapAiScientificAppraisal keeps the not-returned flag", () => {
  it("carries returned=false through, and defaults to true", () => {
    const na = { verdict: "NOT_ASSESSABLE" as const, reasoning: "" };
    const row = { correct: na, classified: na, meaningful: na, interpreted: na, summary: "" };
    const a = mapAiScientificAppraisal({
      findings: [],
      section_appraisals: [
        { v4_section: "S2_WORLDWIDE_STATUS", ...row, returned: false },
        { v4_section: "S3_THERAPEUTIC_CONTEXT", ...row },
      ],
      ai_used: true,
      prompt_version: "x",
      chunks_total: 1,
      chunks_read: 1,
      unread_pages: [],
    });
    expect(a.sections.map((s) => s.returned)).toEqual([false, true]);
  });
});
