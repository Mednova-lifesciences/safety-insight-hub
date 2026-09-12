import { describe, expect, it } from "vitest";
import {
  buildAuthoritativeSectionCoverage,
  deriveAssessorActionStatus,
  deriveBenefitRiskSectionStatus,
  deriveStatusFromItems,
  deriveUncertaintiesSectionStatus,
  normalizeSectionCoverage,
  reconcileSectionFindings,
  RECONCILIATION_EXCLUDED_SECTIONS,
} from "./section-consistency";
import type {
  PsurBenefitRiskAssessment,
  PsurFinding,
  PsurSectionCoverage,
  PsurSpecialPopulationItem,
} from "@/types/pv";

function coverage(
  section: PsurSectionCoverage["section"],
  status: PsurSectionCoverage["status"],
  extra: Partial<PsurSectionCoverage> = {},
): PsurSectionCoverage {
  return { section, status, comment: "test comment", source: "ai", ...extra };
}

function finding(overrides: Partial<PsurFinding> = {}): PsurFinding {
  return {
    id: "pf-existing",
    category: "MISSING_SECTION",
    severity: "HIGH",
    section: "Some section",
    description: "existing finding",
    evidence: "existing evidence",
    assistGenerated: true,
    humanAssessment: null,
    source: "ai",
    ...overrides,
  };
}

describe("reconcileSectionFindings — the core consistency fix", () => {
  it("scenario 1: a genuinely missing section synthesizes a matching finding", () => {
    const synthesized = reconcileSectionFindings([coverage("S6_LITERATURE", "MISSING")], []);
    expect(synthesized).toHaveLength(1);
    expect(synthesized[0]!.v4Section).toBe("S6_LITERATURE");
    expect(synthesized[0]!.category).toBe("MISSING_SECTION");
    expect(synthesized[0]!.severity).toBe("HIGH");
    expect(synthesized[0]!.deficiencyType).toBe("MISSING_REQUIRED_SECTION");
  });

  it("scenario 2: present-but-incomplete synthesizes a MEDIUM finding, distinct from missing", () => {
    const synthesized = reconcileSectionFindings(
      [coverage("S8_SIGNAL_EVALUATION", "PRESENT_BUT_INCOMPLETE")],
      [],
    );
    expect(synthesized).toHaveLength(1);
    expect(synthesized[0]!.severity).toBe("MEDIUM");
    expect(synthesized[0]!.deficiencyType).toBe("INCOMPLETE_INFORMATION");
    expect(synthesized[0]!.description).toContain("incomplete");
  });

  it("scenario 3: an adequately addressed section never gets a synthesized deficiency", () => {
    const synthesized = reconcileSectionFindings(
      [coverage("S1_PRODUCT_REGULATORY", "ADEQUATELY_ADDRESSED")],
      [],
    );
    expect(synthesized).toHaveLength(0);
  });

  it("a NOT_APPLICABLE section never gets a synthesized deficiency", () => {
    const synthesized = reconcileSectionFindings(
      [coverage("S9_SPECIAL_POPULATIONS", "NOT_APPLICABLE", { notApplicableJustification: "n/a" })],
      [],
    );
    expect(synthesized).toHaveLength(0);
  });

  it("an ASSESSOR_PENDING section never gets a synthesized deficiency — unknown is not a claimed defect", () => {
    const synthesized = reconcileSectionFindings(
      [coverage("S2_WORLDWIDE_STATUS", "ASSESSOR_PENDING")],
      [],
    );
    expect(synthesized).toHaveLength(0);
  });

  it("scenario 5: Section 6 Literature missing produces a corresponding finding", () => {
    const synthesized = reconcileSectionFindings([coverage("S6_LITERATURE", "MISSING")], []);
    expect(synthesized.some((f) => f.v4Section === "S6_LITERATURE")).toBe(true);
  });

  it("never synthesizes a finding when one already exists for that section (the exact reported bug's fix)", () => {
    const existing = [finding({ v4Section: "S3_THERAPEUTIC_CONTEXT" })];
    const synthesized = reconcileSectionFindings(
      [coverage("S3_THERAPEUTIC_CONTEXT", "MISSING")],
      existing,
    );
    expect(synthesized).toHaveLength(0);
  });

  it("scenario 17: calling reconciliation twice never produces duplicate findings for the same section", () => {
    const cov = [coverage("S4_RSI", "MISSING")];
    const firstPass = reconcileSectionFindings(cov, []);
    const allFindings = [...firstPass];
    const secondPass = reconcileSectionFindings(cov, allFindings);
    expect(secondPass).toHaveLength(0);
  });

  it("excludes ADMIN_SCREENING, S12, and S13 — these are assessor tasks with their own panels, not submission deficiencies", () => {
    const cov = [
      coverage("ADMIN_SCREENING", "MISSING"),
      coverage("S12_REGULATORY_DECISION", "MISSING"),
      coverage("S13_CONCLUSION_SIGNOFF", "MISSING"),
    ];
    expect(reconcileSectionFindings(cov, [])).toHaveLength(0);
    for (const section of [
      "ADMIN_SCREENING",
      "S12_REGULATORY_DECISION",
      "S13_CONCLUSION_SIGNOFF",
    ] as const) {
      expect(RECONCILIATION_EXCLUDED_SECTIONS.has(section)).toBe(true);
    }
  });

  it("synthesizes independently for every genuinely deficient section — the exact multi-section bug reported", () => {
    const cov = [
      coverage("S3_THERAPEUTIC_CONTEXT", "MISSING"),
      coverage("S4_RSI", "MISSING"),
      coverage("S6_LITERATURE", "MISSING"),
      coverage("S9_SPECIAL_POPULATIONS", "MISSING"),
      coverage("S10_BENEFIT_RISK", "MISSING"),
    ];
    // Only S3, S4, S8 (say) had AI-authored findings in the original bug
    // report — the rest had none at all.
    const existing = [
      finding({ v4Section: "S3_THERAPEUTIC_CONTEXT" }),
      finding({ v4Section: "S4_RSI" }),
    ];
    const synthesized = reconcileSectionFindings(cov, existing);
    const coveredSections = new Set(synthesized.map((f) => f.v4Section));
    expect(coveredSections.has("S6_LITERATURE")).toBe(true);
    expect(coveredSections.has("S9_SPECIAL_POPULATIONS")).toBe(true);
    expect(coveredSections.has("S10_BENEFIT_RISK")).toBe(true);
    // S3/S4 already had findings — not duplicated.
    expect(coveredSections.has("S3_THERAPEUTIC_CONTEXT")).toBe(false);
    expect(coveredSections.has("S4_RSI")).toBe(false);
  });
});

describe("normalizeSectionCoverage — legacy `present: boolean` compatibility", () => {
  it("upgrades legacy present:true to PRESENT_BUT_INCOMPLETE, never to ADEQUATELY_ADDRESSED", () => {
    const normalized = normalizeSectionCoverage([
      { section: "S1_PRODUCT_REGULATORY", present: true, comment: "old shape" },
    ]);
    expect(normalized[0]!.status).toBe("PRESENT_BUT_INCOMPLETE");
  });

  it("upgrades legacy present:false to MISSING", () => {
    const normalized = normalizeSectionCoverage([
      { section: "S2_WORLDWIDE_STATUS", present: false, comment: "old shape" },
    ]);
    expect(normalized[0]!.status).toBe("MISSING");
  });

  it("passes through the current status shape unchanged", () => {
    const normalized = normalizeSectionCoverage([
      {
        section: "S1_PRODUCT_REGULATORY",
        status: "ADEQUATELY_ADDRESSED",
        comment: "current shape",
      },
    ]);
    expect(normalized[0]!.status).toBe("ADEQUATELY_ADDRESSED");
  });

  it("returns an empty array for undefined input rather than throwing", () => {
    expect(normalizeSectionCoverage(undefined)).toEqual([]);
  });
});

describe("deriveStatusFromItems — Section 9's per-area aggregation", () => {
  function item(status: PsurSpecialPopulationItem["status"]): PsurSpecialPopulationItem {
    return { area: "PAEDIATRIC", status, comment: "", source: "ai" };
  }

  it("scenario 6: any MISSING area makes the whole section MISSING", () => {
    expect(
      deriveStatusFromItems([
        item("ADEQUATELY_ADDRESSED"),
        item("MISSING"),
        item("NOT_APPLICABLE"),
      ]),
    ).toBe("MISSING");
  });

  it("PRESENT_BUT_INCOMPLETE bubbles up when nothing is missing but something is incomplete", () => {
    expect(
      deriveStatusFromItems([item("ADEQUATELY_ADDRESSED"), item("PRESENT_BUT_INCOMPLETE")]),
    ).toBe("PRESENT_BUT_INCOMPLETE");
  });

  it("all NOT_APPLICABLE-with-justification or adequately addressed reads as adequately addressed overall", () => {
    expect(deriveStatusFromItems([item("ADEQUATELY_ADDRESSED"), item("NOT_APPLICABLE")])).toBe(
      "ADEQUATELY_ADDRESSED",
    );
  });

  it("an empty item list is honestly ASSESSOR_PENDING — never silently 'fine'", () => {
    expect(deriveStatusFromItems([])).toBe("ASSESSOR_PENDING");
  });

  it("does NOT assume every area is deficient just because most are unassessed — a mix of pending and adequate stays pending, not missing", () => {
    expect(deriveStatusFromItems([item("ADEQUATELY_ADDRESSED"), item("ASSESSOR_PENDING")])).toBe(
      "ASSESSOR_PENDING",
    );
  });
});

describe("deriveUncertaintiesSectionStatus — Section 11", () => {
  it("scenario 8: an empty, untouched list is ASSESSOR_PENDING, never treated as 'none apply'", () => {
    expect(deriveUncertaintiesSectionStatus([], undefined)).toBe("ASSESSOR_PENDING");
  });

  it("an explicit assessor confirmation of none reads as ADEQUATELY_ADDRESSED", () => {
    expect(
      deriveUncertaintiesSectionStatus([], {
        by: "A. Reviewer",
        at: "2026-01-01",
        rationale: "none",
      }),
    ).toBe("ADEQUATELY_ADDRESSED");
  });

  it("a recorded uncertainty missing its mandatory rationale is PRESENT_BUT_INCOMPLETE", () => {
    expect(
      deriveUncertaintiesSectionStatus(
        [
          {
            id: "u1",
            category: "OTHER",
            description: "x",
            impactOnConclusion: "LOW",
            addressedByMah: "NO",
            rationale: "",
          },
        ],
        undefined,
      ),
    ).toBe("PRESENT_BUT_INCOMPLETE");
  });

  it("a recorded uncertainty with a rationale is ADEQUATELY_ADDRESSED", () => {
    expect(
      deriveUncertaintiesSectionStatus(
        [
          {
            id: "u1",
            category: "OTHER",
            description: "x",
            impactOnConclusion: "LOW",
            addressedByMah: "NO",
            rationale: "specific tie to this uncertainty",
          },
        ],
        undefined,
      ),
    ).toBe("ADEQUATELY_ADDRESSED");
  });
});

describe("deriveAssessorActionStatus — Sections 12 & 13", () => {
  it("scenario 8: ASSESSOR_PENDING until the assessor's own record exists", () => {
    expect(deriveAssessorActionStatus(false)).toBe("ASSESSOR_PENDING");
  });

  it("ADEQUATELY_ADDRESSED once the assessor's own record exists", () => {
    expect(deriveAssessorActionStatus(true)).toBe("ADEQUATELY_ADDRESSED");
  });
});

describe("deriveBenefitRiskSectionStatus — Section 10", () => {
  const full: PsurBenefitRiskAssessment = {
    keyBenefits: [
      { id: "b1", benefit: "x", evidenceSource: "y", magnitude: "z", evidenceQuality: "HIGH" },
    ],
    keyRisks: [
      {
        id: "r1",
        kind: "IDENTIFIED",
        risk: "x",
        severity: "y",
        frequency: "z",
        frequencyDataSource: "w",
        reversibility: "v",
        duration: "u",
        preventabilityRiskManagement: "t",
        comment: "",
      },
    ],
    missingInformation: [],
    integratedEffectsTable: [
      { dimension: "BENEFIT", evidenceAndUncertainty: "x", reviewerConclusion: "y" },
    ],
    patientHcpPerspective: { available: false, summary: "" },
    riskMinimisationEffectiveness: { outcome: "NOT_ASSESSABLE", comment: "" },
    assistGenerated: true,
  };

  it("no benefit-risk table at all defers to the fallback status", () => {
    expect(deriveBenefitRiskSectionStatus(undefined, "MISSING")).toBe("MISSING");
  });

  it("a fully populated table (benefits, risks, integrated effects) is ADEQUATELY_ADDRESSED", () => {
    expect(deriveBenefitRiskSectionStatus(full, "MISSING")).toBe("ADEQUATELY_ADDRESSED");
  });

  it("a table with only some entries is PRESENT_BUT_INCOMPLETE, not silently upgraded", () => {
    expect(deriveBenefitRiskSectionStatus({ ...full, keyRisks: [] }, "MISSING")).toBe(
      "PRESENT_BUT_INCOMPLETE",
    );
  });

  it("a table with nothing extracted at all is MISSING, not a false PRESENT", () => {
    expect(
      deriveBenefitRiskSectionStatus(
        {
          ...full,
          keyBenefits: [],
          keyRisks: [],
          integratedEffectsTable: [],
          missingInformation: [],
        },
        "ADEQUATELY_ADDRESSED",
      ),
    ).toBe("MISSING");
  });
});

describe("buildAuthoritativeSectionCoverage — the single authoritative model", () => {
  it("scenario 9/13: Section 12's status is driven ONLY by regulatoryDecision — nothing else can influence it", () => {
    const withoutDecision = buildAuthoritativeSectionCoverage({});
    expect(withoutDecision.find((c) => c.section === "S12_REGULATORY_DECISION")!.status).toBe(
      "ASSESSOR_PENDING",
    );

    const withDecision = buildAuthoritativeSectionCoverage({
      regulatoryDecision: {
        actions: [],
        overallOutcome: "FAVOURABLE",
        basis: "x",
        decidedBy: "A. Reviewer",
        decidedAt: "2026-01-01T00:00:00Z",
      },
    });
    const s12 = withDecision.find((c) => c.section === "S12_REGULATORY_DECISION")!;
    expect(s12.status).toBe("ADEQUATELY_ADDRESSED");
    expect(s12.source).toBe("assessor");
  });

  it("scenario 12: Section 13's status is driven by the assessor's sign-off conclusion, and reloads correctly once saved", () => {
    const saved = buildAuthoritativeSectionCoverage({
      signOff: { conclusion: "Overall favourable.", reviewerConfidence: "HIGH", references: "" },
    });
    expect(saved.find((c) => c.section === "S13_CONCLUSION_SIGNOFF")!.status).toBe(
      "ADEQUATELY_ADDRESSED",
    );
  });

  it("scenario 6: S9 coverage is derived from specialPopulations, overriding whatever the raw AI screening said", () => {
    const result = buildAuthoritativeSectionCoverage({
      screening: {
        sectionCoverage: [coverage("S9_SPECIAL_POPULATIONS", "ADEQUATELY_ADDRESSED")],
      },
      specialPopulations: [
        { area: "PREGNANCY_LACTATION", status: "MISSING", comment: "not mentioned", source: "ai" },
      ],
    });
    // The AI's raw screening claimed ADEQUATELY_ADDRESSED, but the real
    // per-area data says otherwise — the derived value must win, proving
    // the two judgements can never silently disagree.
    expect(result.find((c) => c.section === "S9_SPECIAL_POPULATIONS")!.status).toBe("MISSING");
  });

  it("a section with no coarse entry at all defaults to ASSESSOR_PENDING, never MISSING", () => {
    const result = buildAuthoritativeSectionCoverage({ screening: { sectionCoverage: [] } });
    expect(result.find((c) => c.section === "S1_PRODUCT_REGULATORY")!.status).toBe(
      "ASSESSOR_PENDING",
    );
  });

  it("produces exactly one entry per V4 template section, never more or fewer", () => {
    const result = buildAuthoritativeSectionCoverage({});
    expect(result).toHaveLength(14);
    expect(new Set(result.map((c) => c.section)).size).toBe(14);
  });
});

describe("reconciliation after an assessor edits Sections 9-11", () => {
  it("an assessor marking a Section 9 area MISSING yields a corresponding finding", () => {
    // Reproduces the live symptom: the AI found nothing wrong with S9 at
    // upload (so no S9 finding was synthesized), the assessor then marked
    // an area MISSING, and the Section Coverage panel rendered its own
    // "No corresponding finding yet — this should not happen" diagnostic
    // because nothing re-ran reconciliation after the edit.
    const doc = {
      specialPopulations: [
        {
          area: "GERIATRIC",
          status: "MISSING",
          comment: "No geriatric data presented.",
          source: "assessor",
        },
        { area: "PAEDIATRIC", status: "ADEQUATELY_ADDRESSED", comment: "Addressed.", source: "ai" },
      ],
    } as Parameters<typeof buildAuthoritativeSectionCoverage>[0];

    const coverage = buildAuthoritativeSectionCoverage(doc);
    expect(coverage.find((c) => c.section === "S9_SPECIAL_POPULATIONS")?.status).toBe("MISSING");

    const synthesized = reconcileSectionFindings(coverage, []);
    const s9 = synthesized.find((f) => f.v4Section === "S9_SPECIAL_POPULATIONS");
    expect(s9).toBeDefined();
    expect(s9!.deficiencyType).toBe("MISSING_REQUIRED_SECTION");
  });

  it("an assessor emptying the Section 10 benefit-risk tables yields a finding", () => {
    const doc = {
      benefitRisk: {
        keyBenefits: [],
        keyRisks: [],
        missingInformation: [],
        integratedEffectsTable: [],
        patientHcpPerspective: { available: false, summary: "" },
        riskMinimisationEffectiveness: { outcome: "NOT_ASSESSABLE", comment: "" },
        assistGenerated: false,
      },
    } as Parameters<typeof buildAuthoritativeSectionCoverage>[0];

    const coverage = buildAuthoritativeSectionCoverage(doc);
    expect(coverage.find((c) => c.section === "S10_BENEFIT_RISK")?.status).toBe("MISSING");
    expect(
      reconcileSectionFindings(coverage, []).some((f) => f.v4Section === "S10_BENEFIT_RISK"),
    ).toBe(true);
  });

  it("re-running after the edit is idempotent — no duplicate finding for the same section", () => {
    const doc = {
      specialPopulations: [
        { area: "GERIATRIC", status: "MISSING", comment: "No geriatric data.", source: "assessor" },
      ],
    } as Parameters<typeof buildAuthoritativeSectionCoverage>[0];

    const coverage = buildAuthoritativeSectionCoverage(doc);
    const first = reconcileSectionFindings(coverage, []);
    const second = reconcileSectionFindings(coverage, first);
    expect(second.filter((f) => f.v4Section === "S9_SPECIAL_POPULATIONS")).toHaveLength(0);
  });
});

describe("reconciliation is safe and effective to run on every read", () => {
  it("heals a document whose deficient section has no finding", () => {
    // The production case: documents reviewed before the guarantee existed
    // kept a MISSING section with nothing tagged to it, so the deficiency
    // could never be accepted and never reached a Compliance Directive.
    const coverage = buildAuthoritativeSectionCoverage({
      screening: {
        sectionCoverage: [
          {
            section: "S6_LITERATURE",
            status: "MISSING",
            comment: "No literature section.",
            source: "ai",
          },
        ],
      },
    } as Parameters<typeof buildAuthoritativeSectionCoverage>[0]);

    const synthesized = reconcileSectionFindings(coverage, []);
    expect(synthesized.some((f) => f.v4Section === "S6_LITERATURE")).toBe(true);
  });

  it("does nothing on an already-consistent document, so repeat reads never write", () => {
    const coverage = buildAuthoritativeSectionCoverage({
      screening: {
        sectionCoverage: [
          {
            section: "S6_LITERATURE",
            status: "MISSING",
            comment: "No literature section.",
            source: "ai",
          },
        ],
      },
    } as Parameters<typeof buildAuthoritativeSectionCoverage>[0]);

    const first = reconcileSectionFindings(coverage, []);
    expect(reconcileSectionFindings(coverage, first)).toHaveLength(0);
    // And a third read, simulating repeated page opens.
    expect(reconcileSectionFindings(coverage, [...first])).toHaveLength(0);
  });

  it("never synthesizes for sections that are an assessor task, not a submission defect", () => {
    const coverage = buildAuthoritativeSectionCoverage(
      {} as Parameters<typeof buildAuthoritativeSectionCoverage>[0],
    );
    const synthesized = reconcileSectionFindings(coverage, []);
    for (const excluded of RECONCILIATION_EXCLUDED_SECTIONS) {
      expect(synthesized.some((f) => f.v4Section === excluded)).toBe(false);
    }
  });
});
