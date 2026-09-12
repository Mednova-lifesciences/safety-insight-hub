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

describe("buildComplianceDirectiveModel — MAH-facing deficiencies are not lost to suggestedSource", () => {
  it("an accepted missing-section finding reaches the directive even with a research-y source", () => {
    // Regression for the reproduced failure: the assessor accepted a HIGH
    // "6. Literature is missing" finding, the Executive Summary listed it
    // as outstanding, and the directive still printed
    // "DEFICIENCIES REQUIRING MAH ACTION (0)" — because its suggested
    // source was PUBLISHED_LITERATURE rather than REQUEST_FROM_MAH.
    const literature = mahFinding({
      id: "pf-lit",
      section: "6. Literature",
      description: '"6. Literature" was assessed as missing from this submission.',
      evidence: "No literature review section found in the submitted document.",
      v4Section: "S6_LITERATURE",
      deficiencyType: "MISSING_REQUIRED_SECTION",
      suggestedSource: {
        type: "PUBLISHED_LITERATURE",
        note: "Screen published safety literature for this active substance.",
      },
      humanAssessment: "ACCEPTED",
    });

    const model = buildComplianceDirectiveModel(baseDoc(), [literature]);
    expect(model.deficiencies).toHaveLength(1);
    expect(model.deficiencies[0]!.v4SectionLabel).toBe("6. Literature");
    expect(model.deficiencies[0]!.requiredAction).toContain("Provide");
    // The pointer to where evidence can be found is still carried through,
    // it just no longer decides whether the MAH hears about the gap.
    expect(model.deficiencies[0]!.suggestedSource?.label).toBe("Published literature");
  });

  it("the executive summary counts that same finding as MAH action, not assessor-internal", () => {
    const literature = mahFinding({
      id: "pf-lit",
      v4Section: "S6_LITERATURE",
      deficiencyType: "MISSING_REQUIRED_SECTION",
      suggestedSource: { type: "PUBLISHED_LITERATURE", note: "Screen the literature." },
      humanAssessment: "ACCEPTED",
    });
    const model = buildExecutiveSummaryModel(baseDoc(), [literature]);
    expect(model.findings.mahActionCount).toBe(1);
    expect(model.findings.assessorInternalCount).toBe(0);
  });

  it("a genuinely assessor-resolvable finding still stays out of the directive", () => {
    const vigiflow = mahFinding({
      id: "pf-vf",
      category: "NUMERICAL",
      deficiencyType: "DATA_DISCREPANCY",
      suggestedSource: { type: "VIGIFLOW_NIGERIA", note: "Compare against VigiFlow." },
      humanAssessment: "ACCEPTED",
    });
    expect(buildComplianceDirectiveModel(baseDoc(), [vigiflow]).deficiencies).toHaveLength(0);
  });
});

describe("buildComplianceDirectiveModel — assessor ownership overrides", () => {
  const override = (owner: "MAH" | "ASSESSOR") => ({
    owner,
    by: "A. Okafor",
    at: "2026-09-12T09:00:00Z",
    rationale: "I can close this from VigiFlow without going back to the MAH.",
  });

  it("an assessor can remove a derived-MAH deficiency from the directive", () => {
    const f = mahFinding({
      deficiencyType: "MISSING_REQUIRED_SECTION",
      humanAssessment: "ACCEPTED",
      actionOwnerOverride: override("ASSESSOR"),
    });
    expect(buildComplianceDirectiveModel(baseDoc(), [f]).deficiencies).toHaveLength(0);
  });

  it("an assessor can add an assessor-resolvable finding to the directive, with attribution", () => {
    const f = mahFinding({
      category: "NUMERICAL",
      deficiencyType: "DATA_DISCREPANCY",
      suggestedSource: { type: "VIGIFLOW_NIGERIA", note: "Check VigiFlow." },
      humanAssessment: "ACCEPTED",
      actionOwnerOverride: override("MAH"),
    });
    const model = buildComplianceDirectiveModel(baseDoc(), [f]);
    expect(model.deficiencies).toHaveLength(1);
    // The directive must show a human made this call, not the rules.
    expect(model.deficiencies[0]!.ownershipOverride?.by).toBe("A. Okafor");
    expect(model.deficiencies[0]!.ownershipOverride?.rationale).toContain("VigiFlow");
  });

  it("an override that merely agrees with the derivation adds no attribution noise", () => {
    const f = mahFinding({
      deficiencyType: "MISSING_REQUIRED_SECTION",
      humanAssessment: "ACCEPTED",
      actionOwnerOverride: override("MAH"),
    });
    const model = buildComplianceDirectiveModel(baseDoc(), [f]);
    expect(model.deficiencies).toHaveLength(1);
    expect(model.deficiencies[0]!.ownershipOverride).toBeNull();
  });
});

describe("buildRequiredAction — an assessor referral states what the MAH must do", () => {
  it("uses the assessor's referral rationale rather than restating the observation", () => {
    const f = mahFinding({
      category: "NUMERICAL",
      deficiencyType: "DATA_DISCREPANCY",
      description: "MAH-reported Nigerian case count is not reconciled against VigiFlow.",
      suggestedSource: { type: "VIGIFLOW_NIGERIA", note: "Check VigiFlow." },
      actionOwnerOverride: {
        owner: "MAH",
        by: "A. Okafor",
        at: "2026-09-12T09:00:00Z",
        rationale: "VigiFlow shows 41 Nigerian ICSRs against the MAH's 34; account for the gap.",
      },
    });
    expect(buildRequiredAction(f)).toBe(
      "VigiFlow shows 41 Nigerian ICSRs against the MAH's 34; account for the gap.",
    );
  });

  it("a missing section still uses the V4 sub-item checklist, not the rationale", () => {
    const f = mahFinding({
      deficiencyType: "MISSING_REQUIRED_SECTION",
      v4Section: "S4_RSI",
      actionOwnerOverride: {
        owner: "MAH",
        by: "A. Okafor",
        at: "2026-09-12T09:00:00Z",
        rationale: "Confirming this is for the MAH.",
      },
    });
    expect(buildRequiredAction(f)).toContain("RSI type (SmPC/CDS/CCDS) and version");
  });

  it("an override to ASSESSOR never becomes a required action", () => {
    const f = mahFinding({
      category: "NUMERICAL",
      deficiencyType: "DATA_DISCREPANCY",
      description: "Counts differ.",
      suggestedSource: undefined,
      actionOwnerOverride: {
        owner: "ASSESSOR",
        by: "A. Okafor",
        at: "2026-09-12T09:00:00Z",
        rationale: "I will close this from VigiFlow.",
      },
    });
    expect(buildRequiredAction(f)).toBe("Counts differ.");
  });
});

describe("the Compliance Directive reads as a standalone regulatory letter", () => {
  const INTERNAL = [
    /\bbelow\b/i,
    /\babove\b/i,
    /\bin this UI\b/i,
    /\bon the assessment page\b/i,
    /\bAI[- ]generated\b/i,
    /\bsystem-generated finding\b/i,
    /\bAI finding\b/i,
    /\bsection coverage panel\b/i,
    /\breview findings panel\b/i,
    /\bsub-tables\b/i,
  ];

  function allProse(m: ReturnType<typeof buildComplianceDirectiveModel>): string {
    return [
      m.introduction,
      ...m.deficiencies.flatMap((d) => [
        d.whatWasIdentified,
        d.whyMaterial,
        d.requiredAction,
        d.assessorObservation ?? "",
        d.suggestedSource?.note ?? "",
      ]),
    ].join("\n");
  }

  it("strips the internal phrasing that reached a real directive", () => {
    // Verbatim from a generated directive: the S9 coverage comment, written
    // for a UI panel, became the MAH-facing "why this matters".
    const f = mahFinding({
      v4Section: "S9_SPECIAL_POPULATIONS",
      section: "9. Special Populations, Special Situations & Missing Information",
      evidence: "Derived from the special-population/special-situation area assessments below.",
      humanAssessment: "ACCEPTED",
    });
    const m = buildComplianceDirectiveModel(baseDoc(), [f]);
    expect(m.deficiencies[0]!.whyMaterial).not.toMatch(/below/i);
    expect(m.deficiencies[0]!.whyMaterial).toMatch(/NAFDAC PSUR\/PBRER evaluation template/i);
  });

  it("carries no internal language anywhere in its prose", () => {
    const m = buildComplianceDirectiveModel(baseDoc(), [
      mahFinding({
        evidence: "See the section coverage panel below for the AI-generated finding.",
        humanAssessment: "ACCEPTED",
      }),
    ]);
    const prose = allProse(m);
    for (const re of INTERNAL) expect(prose).not.toMatch(re);
  });

  it("never emits an empty field after stripping", () => {
    const m = buildComplianceDirectiveModel(baseDoc(), [
      mahFinding({ evidence: "See below.", humanAssessment: "ACCEPTED" }),
    ]);
    expect(m.deficiencies[0]!.whyMaterial.trim().length).toBeGreaterThan(0);
  });
});

describe("Compliance Directive — follow-up dates", () => {
  const decision = (over: Record<string, string>) => ({
    actions: ["REQUEST_ADDITIONAL_INFO_FROM_MAH"] as const,
    overallOutcome: "UNCERTAIN_REQUIRES_FOLLOWUP" as const,
    basis: "b",
    decidedBy: "A. Okafor",
    decidedAt: "2026-09-12T09:00:00Z",
    ...over,
  });

  it("a saved response deadline appears, formatted for a letter", () => {
    const m = buildComplianceDirectiveModel(
      baseDoc({ regulatoryDecision: decision({ mahResponseDeadline: "2026-10-31" }) as never }),
      [],
    );
    expect(m.followUp.responseDeadline).toBe("31 October 2026");
  });

  it("the next PSUR due date is carried separately and never conflated", () => {
    const m = buildComplianceDirectiveModel(
      baseDoc({
        regulatoryDecision: decision({
          mahResponseDeadline: "2026-10-31",
          nextPsurDueDate: "2027-06-30",
        }) as never,
      }),
      [],
    );
    expect(m.followUp.responseDeadline).toBe("31 October 2026");
    expect(m.followUp.nextPsurDueDate).toBe("30 June 2027");
    expect(m.followUp.responseDeadline).not.toBe(m.followUp.nextPsurDueDate);
  });

  it("a missing date is null, never invented or derived from the other", () => {
    const m = buildComplianceDirectiveModel(
      baseDoc({ regulatoryDecision: decision({ nextPsurDueDate: "2027-06-30" }) as never }),
      [],
    );
    expect(m.followUp.responseDeadline).toBeNull();
    expect(m.followUp.nextPsurDueDate).toBe("30 June 2027");
  });

  it("no regulatory decision at all yields no dates", () => {
    const m = buildComplianceDirectiveModel(baseDoc(), []);
    expect(m.followUp.responseDeadline).toBeNull();
    expect(m.followUp.nextPsurDueDate).toBeNull();
    expect(m.followUp.informationRequired).toBeNull();
  });
});

describe("Compliance Directive — signatory block", () => {
  it("uses the saved Section 13 names and dates", () => {
    const m = buildComplianceDirectiveModel(
      baseDoc({
        signOff: {
          conclusion: "c",
          reviewerConfidence: "LOW",
          references: "r",
          evaluatorName: "A. Okafor",
          evaluatorSignedAt: "2026-09-12T10:00:00Z",
          peerReviewerName: "N. Bello",
          peerReviewedAt: "2026-09-12T11:00:00Z",
        },
      }),
      [],
    );
    expect(m.signatory.evaluatorName).toBe("A. Okafor");
    expect(m.signatory.peerReviewerName).toBe("N. Bello");
    expect(m.signatory.evaluatorSignedAtLabel).toContain("2026-09-12");
  });

  it("leaves unsigned fields null rather than inventing a name or date", () => {
    const m = buildComplianceDirectiveModel(baseDoc(), []);
    expect(m.signatory.evaluatorName).toBeNull();
    expect(m.signatory.evaluatorSignedAtLabel).toBeNull();
    expect(m.signatory.peerReviewerName).toBeNull();
    expect(m.signatory.peerReviewedAtLabel).toBeNull();
  });

  it("does not leak the assessor's internal confidence to the MAH", () => {
    const m = buildComplianceDirectiveModel(
      baseDoc({
        signOff: {
          conclusion: "c",
          reviewerConfidence: "LOW",
          references: "r",
          evaluatorName: "A. Okafor",
        },
      }),
      [],
    );
    expect(JSON.stringify(m.signatory)).not.toMatch(/LOW|confidence/i);
  });
});

describe("Executive Summary and Compliance Directive stay consistent", () => {
  it("both read the same authoritative state for the same document", () => {
    const doc = baseDoc({
      regulatoryDecision: {
        actions: ["REQUEST_ADDITIONAL_INFO_FROM_MAH"],
        overallOutcome: "UNCERTAIN_REQUIRES_FOLLOWUP",
        basis: "Mandatory sections absent.",
        mahResponseDeadline: "2026-10-31",
        nextPsurDueDate: "2027-06-30",
        decidedBy: "A. Okafor",
        decidedAt: "2026-09-12T09:00:00Z",
      },
      signOff: {
        conclusion: "Uncertain.",
        reviewerConfidence: "LOW",
        references: "r",
        evaluatorName: "A. Okafor",
      },
    });
    const findings = [mahFinding({ humanAssessment: "ACCEPTED" })];

    const exec = buildExecutiveSummaryModel(doc, findings);
    const dir = buildComplianceDirectiveModel(doc, findings);

    // One accepted MAH-facing deficiency, counted the same way in both.
    expect(exec.findings.mahActionCount).toBe(1);
    expect(dir.deficiencies).toHaveLength(1);
    // The same regulatory decision drives both.
    expect(exec.regulatoryDecision?.overallOutcome).toBe(dir.regulatoryContext?.overallOutcome);
    // The evaluator named in Section 13 is the one who signs the directive.
    expect(dir.signatory.evaluatorName).toBe(doc.signOff?.evaluatorName);
    // …but the directive never carries the internal confidence rating.
    expect(exec.signOff?.reviewerConfidence).toBe("LOW");
    expect(JSON.stringify(dir)).not.toMatch(/reviewerConfidence/);
  });

  it("a dismissed finding appears in neither document's action list", () => {
    const doc = baseDoc();
    const findings = [mahFinding({ humanAssessment: "DISMISSED" })];
    expect(buildComplianceDirectiveModel(doc, findings).deficiencies).toHaveLength(0);
    expect(buildExecutiveSummaryModel(doc, findings).findings.mahActionCount).toBe(0);
  });

  it("an accepted-but-resolved deficiency leaves the directive but stays counted", () => {
    // Acceptance, resolution and MAH-facing are three different things.
    const doc = baseDoc();
    const findings = [mahFinding({ humanAssessment: "ACCEPTED", resolved: true })];
    expect(buildComplianceDirectiveModel(doc, findings).deficiencies).toHaveLength(0);
    const exec = buildExecutiveSummaryModel(doc, findings);
    expect(exec.findings.accepted).toBe(1);
    expect(exec.findings.resolvedCount).toBe(1);
    expect(exec.findings.outstandingCount).toBe(0);
  });
});
