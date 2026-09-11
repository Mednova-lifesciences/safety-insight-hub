import { describe, expect, it } from "vitest";
import {
  buildComplianceDirectiveModel,
  buildExecutiveSummaryModel,
  buildRequiredAction,
} from "./document-model";
import type { PsurDocument, PsurFinding } from "@/types/pv";

function baseDoc(overrides: Partial<PsurDocument> = {}): PsurDocument {
  return {
    id: "psur-test-1",
    filename: "test-report.pdf",
    product: "Amlodipine besilate",
    reportingPeriod: "01 Jan 2026 - 30 Jun 2026",
    uploadedAt: "2026-01-01T00:00:00Z",
    uploadedBy: "L. Mensah",
    stage: "REVIEWED",
    pages: 10,
    sourceType: "PDF",
    ...overrides,
  };
}

function mahFinding(overrides: Partial<PsurFinding> = {}): PsurFinding {
  return {
    id: "pf-1",
    category: "MISSING_SECTION",
    severity: "HIGH",
    section: "4. Reference Safety Information (RSI)",
    description: "No RSI section found in the submission.",
    evidence: "No heading matching RSI content between sections 3 and 5.",
    suggestedSource: { type: "REQUEST_FROM_MAH", note: "Ask the MAH to supply the current RSI." },
    v4Section: "S4_RSI",
    deficiencyType: "MISSING_REQUIRED_SECTION",
    assistGenerated: true,
    humanAssessment: "ACCEPTED",
    source: "ai",
    ...overrides,
  };
}

describe("buildExecutiveSummaryModel — MAH info", () => {
  it("shows 'Not extracted' when the document has no MAH, never invents one", () => {
    const model = buildExecutiveSummaryModel(baseDoc(), []);
    expect(model.meta.mah).toBe("Not extracted from the submitted document");
  });

  it("shows the extracted MAH when present", () => {
    const model = buildExecutiveSummaryModel(baseDoc({ mah: "Acme Pharmaceuticals Ltd" }), []);
    expect(model.meta.mah).toBe("Acme Pharmaceuticals Ltd");
  });
});

describe("buildExecutiveSummaryModel — Sections 10-13 pending vs recorded", () => {
  it("Section 10 reads 'not recorded' when benefitRisk is absent", () => {
    const model = buildExecutiveSummaryModel(baseDoc(), []);
    expect(model.benefitRisk.recorded).toBe(false);
    expect(model.benefitRisk.data).toBeNull();
  });

  it("Section 10 flags AI-draft vs assessor-owned via assistGenerated", () => {
    const aiDraft = buildExecutiveSummaryModel(
      baseDoc({
        benefitRisk: {
          keyBenefits: [],
          keyRisks: [],
          missingInformation: [],
          integratedEffectsTable: [],
          patientHcpPerspective: { available: false, summary: "" },
          riskMinimisationEffectiveness: { outcome: "NOT_ASSESSABLE", comment: "" },
          assistGenerated: true,
        },
      }),
      [],
    );
    expect(aiDraft.benefitRisk.assessorOwned).toBe(false);
  });

  it("Section 11 is PENDING when uncertainties were never touched", () => {
    const model = buildExecutiveSummaryModel(baseDoc(), []);
    expect(model.uncertainties.status).toBe("PENDING");
  });

  it("Section 11 is CONFIRMED_NONE only when the assessor explicitly confirmed it", () => {
    const model = buildExecutiveSummaryModel(
      baseDoc({
        uncertaintiesNoneConfirmed: {
          by: "A. Reviewer",
          at: "2026-01-01T00:00:00Z",
          rationale: "none",
        },
      }),
      [],
    );
    expect(model.uncertainties.status).toBe("CONFIRMED_NONE");
  });

  it("Section 12: AI recommendation is exposed SEPARATELY, never as the assessor's decision", () => {
    const model = buildExecutiveSummaryModel(
      baseDoc({
        aiRecommendation: {
          actions: ["REQUEST_ADDITIONAL_INFO_FROM_MAH"],
          overallOutcome: "UNCERTAIN_REQUIRES_FOLLOWUP",
          basis: "AI basis",
        },
      }),
      [],
    );
    expect(model.regulatoryDecision).toBeNull();
    expect(model.aiRecommendation?.overallOutcome).toBe("UNCERTAIN_REQUIRES_FOLLOWUP");
  });

  it("Section 12: the assessor's actual decision is reported once recorded, independent of any AI suggestion", () => {
    const model = buildExecutiveSummaryModel(
      baseDoc({
        aiRecommendation: { actions: [], overallOutcome: "UNFAVOURABLE", basis: "AI basis" },
        regulatoryDecision: {
          actions: ["CONTINUE_ROUTINE_PV"],
          overallOutcome: "FAVOURABLE",
          basis: "Assessor basis",
          decidedBy: "A. Reviewer",
          decidedAt: "2026-01-02T00:00:00Z",
        },
      }),
      [],
    );
    expect(model.regulatoryDecision?.overallOutcome).toBe("FAVOURABLE");
    // The AI's own (different) suggestion is still available for comparison but never overwrites this.
    expect(model.aiRecommendation?.overallOutcome).toBe("UNFAVOURABLE");
  });

  it("Section 13 is null (pending) until a real conclusion is recorded", () => {
    const empty = buildExecutiveSummaryModel(
      baseDoc({ signOff: { conclusion: "", reviewerConfidence: undefined, references: "" } }),
      [],
    );
    expect(empty.signOff).toBeNull();

    const recorded = buildExecutiveSummaryModel(
      baseDoc({
        signOff: { conclusion: "Overall favourable.", reviewerConfidence: "HIGH", references: "" },
      }),
      [],
    );
    expect(recorded.signOff?.conclusion).toBe("Overall favourable.");
  });
});

describe("buildExecutiveSummaryModel — findings overview", () => {
  it("separates MAH-action vs assessor-internal, and resolved vs outstanding, among accepted findings", () => {
    const mah = mahFinding({ id: "pf-mah" });
    const internal = mahFinding({
      id: "pf-internal",
      suggestedSource: undefined,
      category: "CONSISTENCY",
      deficiencyType: undefined,
    });
    const resolvedMah = mahFinding({
      id: "pf-resolved",
      resolved: true,
      resolution: "RSI supplied.",
    });
    const dismissed = mahFinding({ id: "pf-dismissed", humanAssessment: "DISMISSED" });
    const pending = mahFinding({ id: "pf-pending", humanAssessment: null });

    const model = buildExecutiveSummaryModel(baseDoc(), [
      mah,
      internal,
      resolvedMah,
      dismissed,
      pending,
    ]);
    expect(model.findings.total).toBe(5);
    expect(model.findings.accepted).toBe(3);
    expect(model.findings.dismissed).toBe(1);
    expect(model.findings.pending).toBe(1);
    expect(model.findings.mahActionCount).toBe(2); // mah + resolvedMah
    expect(model.findings.assessorInternalCount).toBe(1);
    expect(model.findings.resolvedCount).toBe(1);
    expect(model.findings.outstandingCount).toBe(2);
  });
});

describe("buildRequiredAction — grounded, non-invented instructions", () => {
  it("a missing required section reuses the V4 template's own real sub-item checklist", () => {
    const action = buildRequiredAction(mahFinding());
    expect(action).toContain("Reference Safety Information (RSI)");
    expect(action).toContain("RSI type (SmPC/CDS/CCDS) and version");
    expect(action.startsWith("Provide")).toBe(true);
  });

  it("an incomplete (not missing) section uses 'Complete' rather than 'Provide'", () => {
    const action = buildRequiredAction(mahFinding({ deficiencyType: "INCOMPLETE_INFORMATION" }));
    expect(action.startsWith("Complete")).toBe(true);
  });

  it("a non-section finding with a REQUEST_FROM_MAH source reuses that source's own vetted note", () => {
    const f = mahFinding({
      category: "SIGNAL",
      deficiencyType: "INADEQUATE_EVIDENCE",
      v4Section: "S8_SIGNAL_EVALUATION",
      suggestedSource: {
        type: "REQUEST_FROM_MAH",
        note: "Ask the MAH for the closed-signal evaluation outcome.",
      },
    });
    expect(buildRequiredAction(f)).toBe("Ask the MAH for the closed-signal evaluation outcome.");
  });

  it("falls back to the finding's own description when nothing more specific is available", () => {
    const f = mahFinding({
      category: "CONSISTENCY",
      deficiencyType: undefined,
      v4Section: undefined,
      suggestedSource: undefined,
      description: "Cumulative case counts do not reconcile.",
    });
    expect(buildRequiredAction(f)).toBe("Cumulative case counts do not reconcile.");
  });
});

describe("buildComplianceDirectiveModel — narrower, action-oriented, MAH-facing only", () => {
  it("scenario: accepted-but-resolved deficiencies do NOT appear in the action table", () => {
    const resolved = mahFinding({ id: "pf-resolved", resolved: true, resolution: "RSI supplied." });
    const model = buildComplianceDirectiveModel(baseDoc(), [resolved]);
    expect(model.deficiencies).toHaveLength(0);
    expect(model.resolvedCount).toBe(1);
  });

  it("scenario: dismissed findings never appear as outstanding MAH requirements", () => {
    const dismissed = mahFinding({ id: "pf-dismissed", humanAssessment: "DISMISSED" });
    const model = buildComplianceDirectiveModel(baseDoc(), [dismissed]);
    expect(model.deficiencies).toHaveLength(0);
    expect(model.dismissedCount).toBe(1);
  });

  it("scenario: assessor-internal observations (accepted, no MAH source) never appear in the directive", () => {
    const internal = mahFinding({
      id: "pf-internal",
      suggestedSource: undefined,
      category: "CONSISTENCY",
      deficiencyType: undefined,
    });
    const model = buildComplianceDirectiveModel(baseDoc(), [internal]);
    expect(model.deficiencies).toHaveLength(0);
  });

  it("scenario: pending (not yet reviewed) findings never appear in the directive", () => {
    const pending = mahFinding({ id: "pf-pending", humanAssessment: null });
    const model = buildComplianceDirectiveModel(baseDoc(), [pending]);
    expect(model.deficiencies).toHaveLength(0);
  });

  it("only accepted, MAH-facing, NOT YET resolved findings appear — and each gets a human-friendly reference, never the raw finding id", () => {
    const a = mahFinding({ id: "pf-real-uuid-aaaa" });
    const b = mahFinding({ id: "pf-real-uuid-bbbb", severity: "LOW", section: "Other section" });
    const model = buildComplianceDirectiveModel(baseDoc(), [a, b]);
    expect(model.deficiencies).toHaveLength(2);
    for (const d of model.deficiencies) {
      expect(d.referenceNo).toMatch(/^DEF-\d+$/);
      expect(d.referenceNo).not.toContain("pf-real-uuid");
    }
    expect(model.deficiencies.every((d) => d.status === "OUTSTANDING")).toBe(true);
  });

  it("orders deficiencies by severity, most severe first", () => {
    const low = mahFinding({ id: "pf-low", severity: "LOW" });
    const high = mahFinding({ id: "pf-high", severity: "HIGH" });
    const model = buildComplianceDirectiveModel(baseDoc(), [low, high]);
    expect(model.deficiencies[0]!.severity).toBe("HIGH");
    expect(model.deficiencies[1]!.severity).toBe("LOW");
  });

  it("only surfaces regulatoryContext when the assessor's decision includes an MAH-facing action", () => {
    const internalOnly = buildComplianceDirectiveModel(
      baseDoc({
        regulatoryDecision: {
          actions: ["CONTINUE_ROUTINE_PV"],
          overallOutcome: "FAVOURABLE",
          basis: "x",
          decidedBy: "A",
          decidedAt: "2026-01-01T00:00:00Z",
        },
      }),
      [],
    );
    expect(internalOnly.regulatoryContext).toBeNull();

    const mahFacing = buildComplianceDirectiveModel(
      baseDoc({
        regulatoryDecision: {
          actions: ["CONTINUE_ROUTINE_PV", "SUBMIT_UPDATE_RMP"],
          overallOutcome: "FAVOURABLE_WITH_CONDITIONS",
          basis: "x",
          decidedBy: "A",
          decidedAt: "2026-01-01T00:00:00Z",
        },
      }),
      [],
    );
    expect(mahFacing.regulatoryContext?.mahFacingActions).toEqual(["SUBMIT_UPDATE_RMP"]);
  });

  it("never presents an AI recommendation as the regulatory context — only the assessor's own decision", () => {
    const model = buildComplianceDirectiveModel(
      baseDoc({
        aiRecommendation: {
          actions: ["SUBMIT_UPDATE_RMP"],
          overallOutcome: "UNFAVOURABLE",
          basis: "AI basis",
        },
      }),
      [],
    );
    expect(model.regulatoryContext).toBeNull();
  });
});
