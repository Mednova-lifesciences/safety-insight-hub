import { describe, expect, it } from "vitest";
import type { AssessmentSection, MemoCriterion, PsurFinding } from "@/types/pv";
import { evidenceCriteria } from "./assessment-memo";
import { buildComplianceDirectiveModel } from "./document-model";
import {
  canResolveWithResearch,
  criterionForFinding,
  fileFindingResearch,
  reopenedFinding,
  resolvedFinding,
  searchCriterionFor,
  withdrawEvidence,
  findingsFor,
  isPending,
} from "./finding-research";
import { evidenceForCriterion } from "./memo-draft";
import type { PsurDocument } from "@/types/pv";

const AT = "2026-10-04T12:00:00.000Z";

function finding(overrides: Partial<PsurFinding> = {}): PsurFinding {
  return {
    id: "f1",
    category: "MISSING_SECTION",
    severity: "MEDIUM",
    section: "Reference Safety Information",
    description: "Changes to the RSI during the interval are not described.",
    evidence: "Section 4 lists the SmPC version but no changes.",
    v4Section: "S4_RSI",
    deficiencyType: "INCOMPLETE_INFORMATION",
    suggestedSource: { type: "REQUEST_FROM_MAH", note: "Ask for the RSI change history." },
    assistGenerated: true,
    humanAssessment: "ACCEPTED",
    ...overrides,
  } as PsurFinding;
}

const research = {
  content: "SmPC v7.2 (March 2026) added drug-induced enterocolitis syndrome to section 4.4.",
  citation: "Submitted PSUR, Appendix I, p. 12",
  criterion: "RSI_CHANGES" as const,
  origin: "assessor" as const,
};

function memoRow(sections: AssessmentSection[], id: MemoCriterion["id"]) {
  return evidenceCriteria(sections).find((c) => c.id === id)!;
}

describe("which memo criterion a finding's research belongs under", () => {
  it("follows the section the finding is about", () => {
    expect(criterionForFinding(finding({ v4Section: "S4_RSI" }))).toBe("RSI_CHANGES");
    expect(criterionForFinding(finding({ v4Section: "S7_AGGREGATE_SAFETY_DATA" }))).toBe(
      "PATIENT_EXPOSURE",
    );
    expect(criterionForFinding(finding({ v4Section: "S11_UNCERTAINTIES" }))).toBe(
      "OVERALL_SAFETY_EVALUATION",
    );
  });

  it("leaves it to the assessor where no criterion covers the section", () => {
    expect(criterionForFinding(finding({ v4Section: "S1_PRODUCT_REGULATORY" }))).toBeUndefined();
    expect(criterionForFinding(finding({ v4Section: undefined }))).toBeUndefined();
  });

  it("searches published literature when the criterion has no registry of its own", () => {
    expect(searchCriterionFor("RSI_CHANGES")).toBe("RSI_CHANGES");
    expect(searchCriterionFor("PATIENT_EXPOSURE")).toBe("RELEVANT_STUDIES");
    expect(searchCriterionFor(undefined)).toBe("RELEVANT_STUDIES");
  });
});

describe("resolving a finding with research", () => {
  it("only an accepted finding can be resolved", () => {
    expect(canResolveWithResearch(finding())).toBe(true);
    expect(canResolveWithResearch(finding({ humanAssessment: "DISMISSED" }))).toBe(false);
    expect(canResolveWithResearch(finding({ humanAssessment: null }))).toBe(false);
    expect(() =>
      fileFindingResearch([], finding({ humanAssessment: null }), research, "e1", "Eve", AT),
    ).toThrow(/Accept the finding/);
  });

  it("needs both the research and its source", () => {
    expect(() =>
      fileFindingResearch([], finding(), { ...research, citation: " " }, "e1", "Eve", AT),
    ).toThrow(/source/);
    expect(() =>
      fileFindingResearch([], finding(), { ...research, content: "" }, "e1", "Eve", AT),
    ).toThrow(/research found/);
  });

  it("files the research in the memo, accepted and cited, under the chosen criterion", () => {
    const { sections, evidenceId } = fileFindingResearch([], finding(), research, "e1", "Eve", AT);
    expect(evidenceId).toBe("e1");
    const row = memoRow(sections, "RSI_CHANGES");
    expect(row.remarks).toContain("enterocolitis");
    expect(row.citations).toEqual(["Submitted PSUR, Appendix I, p. 12"]);
    const [entry] = sections.flatMap((s) => s.evidence);
    expect(entry!.findingId).toBe("f1");
    expect(entry!.acceptedBy).toBe("Eve");
  });

  it("marks the finding resolved and keeps it — it does not disappear", () => {
    const resolved = resolvedFinding(finding(), research, "e1", "Eve", AT);
    expect(resolved.resolved).toBe(true);
    expect(resolved.humanAssessment).toBe("ACCEPTED");
    expect(resolved.researchResolution).toMatchObject({
      by: "Eve",
      evidenceId: "e1",
      criterion: "RSI_CHANGES",
    });
    expect(resolved.description).toBe(finding().description);
  });

  it("puts the finding in the MAH feedback letter as resolved by NAFDAC", () => {
    const resolved = resolvedFinding(finding(), research, "e1", "Eve", AT);
    const letter = buildComplianceDirectiveModel(
      { id: "d", product: "P", reportingPeriod: "R", filename: "f.pdf" } as PsurDocument,
      [resolved],
    );
    expect(letter.deficiencies).toHaveLength(1);
    expect(letter.deficiencies[0]!.status).toBe("RESOLVED_BY_NAFDAC");
  });

  it("an edit under the same criterion supersedes the old research, which stays on record", () => {
    const first = fileFindingResearch([], finding(), research, "e1", "Eve", AT);
    const f1 = resolvedFinding(finding(), research, first.evidenceId, "Eve", AT);
    const edited = {
      ...research,
      content: "Corrected: SmPC v7.2 added DIES to sections 4.4 and 4.8.",
    };
    const second = fileFindingResearch(first.sections, f1, edited, "e2", "Pat", AT);
    expect(second.evidenceId).toBe("e2");
    expect(memoRow(second.sections, "RSI_CHANGES").remarks).toBe(edited.content);
    const statuses = evidenceForCriterion(second.sections, "RSI_CHANGES").map((x) => x.status);
    expect(statuses).toEqual(["SUPERSEDED", "ACCEPTED"]);
  });

  it("moving the research to another criterion withdraws it from the first", () => {
    const first = fileFindingResearch([], finding(), research, "e1", "Eve", AT);
    const f1 = resolvedFinding(finding(), research, first.evidenceId, "Eve", AT);
    const moved = fileFindingResearch(
      first.sections,
      f1,
      { ...research, criterion: "OVERALL_SAFETY_EVALUATION" },
      "e2",
      "Eve",
      AT,
    );
    expect(memoRow(moved.sections, "RSI_CHANGES").unestablished).toBe(true);
    expect(memoRow(moved.sections, "OVERALL_SAFETY_EVALUATION").remarks).toContain("enterocolitis");
    expect(evidenceForCriterion(moved.sections, "RSI_CHANGES").map((x) => x.status)).toEqual([
      "WITHDRAWN",
    ]);
  });

  it("research kept out of the memo still resolves the finding", () => {
    const { sections, evidenceId } = fileFindingResearch(
      [],
      finding(),
      { ...research, criterion: undefined },
      "e1",
      "Eve",
      AT,
    );
    expect(evidenceId).toBeUndefined();
    expect(sections).toEqual([]);
    expect(
      resolvedFinding(finding(), { ...research, criterion: undefined }, undefined, "Eve", AT)
        .resolved,
    ).toBe(true);
  });
});

describe("reopening a resolved finding", () => {
  it("withdraws its research from the memo, keeping it on record", () => {
    const { sections } = fileFindingResearch([], finding(), research, "e1", "Eve", AT);
    const after = withdrawEvidence(sections, "e1", "Eve", AT);
    expect(after.evidence).toHaveLength(1);
    expect(after.evidence[0]!.withdrawnBy).toBe("Eve");
    expect(memoRow([after], "RSI_CHANGES").unestablished).toBe(true);
  });

  it("the finding goes back to unresolved, still accepted, still listed", () => {
    const resolved = resolvedFinding(finding(), research, "e1", "Eve", AT);
    const reopened = reopenedFinding(resolved);
    expect(reopened.resolved).toBe(false);
    expect(reopened.researchResolution).toBeUndefined();
    expect(reopened.resolution).toBeUndefined();
    expect(reopened.humanAssessment).toBe("ACCEPTED");
  });
});

describe("the feedback letter's count of resolved points", () => {
  it("counts only points the letter lists — not resolved assessor-internal findings", () => {
    const internal = resolvedFinding(
      finding({
        id: "fi",
        suggestedSource: undefined,
        category: "CONSISTENCY",
        deficiencyType: undefined,
      }),
      research,
      undefined,
      "Eve",
      AT,
    );
    const letter = buildComplianceDirectiveModel(
      { id: "d", product: "P", reportingPeriod: "R", filename: "f.pdf" } as PsurDocument,
      [internal],
    );
    expect(letter.deficiencies).toHaveLength(0);
    expect(letter.resolvedCount).toBe(0);
  });
});

describe("findings by section", () => {
  const f = (id: string, v4Section: string | undefined, humanAssessment?: "ACCEPTED") =>
    ({ id, v4Section, humanAssessment }) as unknown as PsurFinding;
  const all = [f("a", "S1_PRODUCT_REGULATORY"), f("b", "S4_RSI", "ACCEPTED"), f("c", undefined)];

  it("finds a section's own findings, and those with no section", () => {
    expect(findingsFor(all, ["S4_RSI"]).map((x) => x.id)).toEqual(["b"]);
    expect(findingsFor(all, ["ADMIN_SCREENING", undefined]).map((x) => x.id)).toEqual(["c"]);
  });

  it("a finding is pending until someone accepts or dismisses it", () => {
    expect(all.filter(isPending).map((x) => x.id)).toEqual(["a", "c"]);
  });
});
