import { describe, expect, it } from "vitest";
import { mapAiScientificAppraisal, mergeAppraisalFindings } from "./scientific-appraisal";
import { buildRequiredAction } from "./document-model";
import { requiresMahAction } from "./finding-ownership";
import type { AiPsurAppraisalResponse } from "@/services/api/ai";
import type { PsurFinding } from "@/types/pv";

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
      finding({ id: "c1", deficiencyType: "MISSING_REQUIRED_SECTION", category: "MISSING_SECTION" }),
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
