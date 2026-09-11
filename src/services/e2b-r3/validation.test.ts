import { describe, expect, it } from "vitest";
import {
  runPreflight,
  validateBusinessRules,
  validateVigiFlowPreflight,
  validateCase,
  isOverridable,
  computeCaseEligibility,
  E2B_NON_OVERRIDABLE_CODES,
} from "./validation";
import type { PVCase } from "./types";

function minimalValidCase(overrides: Partial<PVCase> = {}): PVCase {
  return {
    internalCaseId: "job-1",
    sendersCaseId: "NG-MEDNOVA-000001",
    worldwideUniqueId: "NG-MEDNOVA-000001",
    firstSenderOfCase: "2",
    reportType: { present: true, value: "1" },
    dateOfCreation: "2026-09-09T00:00:00Z",
    dateFirstReceived: "2026-09-09T00:00:00Z",
    dateMostRecentInfo: "2026-09-09T00:00:00Z",
    additionalDocumentsAvailable: false,
    fulfilsExpeditedCriteria: { present: true, value: false },
    otherCaseIdentifiersInPreviousTransmissions: { present: false, nullFlavor: "NI" },
    followUp: { isFollowUp: false },
    patient: { identity: { present: true, value: { kind: "INITIALS", initials: "A.B." } } },
    reporter: {
      name: { present: false, nullFlavor: "NASK" },
      qualificationVerbatim: "CHEW",
      qualificationCode: "3",
      country: "NG",
    },
    senderOrganisation: "MEDNOVA",
    reactions: [
      {
        id: "CASE-1-r1",
        sourceDecoding: {
          status: "DECODED",
          localCode: "19",
          sourceTerm: "19",
          sourceProfileId: "test-profile",
        },
        reaction: { sourceValue: "19", status: "UNMAPPED", mappingMethod: "NONE" },
        onsetDate: "2026-02-03",
        outcome: "RECOVERED",
        seriousnessCriteria: {},
      },
    ],
    products: [
      {
        id: "CASE-1-p1",
        characterization: "SUSPECT",
        product: { sourceValue: "MR/MV", status: "UNMAPPED", mappingMethod: "NONE" },
      },
    ],
    sourceInformation: {
      sourceFile: "test.xlsx",
      sourceRow: 1,
      jobId: "job-1",
      sourceProfileId: "test-profile",
    },
    ...overrides,
  };
}

describe("validateBusinessRules", () => {
  it("passes a structurally + administratively complete case with no blocking errors", () => {
    const errors = validateBusinessRules(minimalValidCase());
    expect(errors.filter((e) => e.severity === "BLOCKING")).toHaveLength(0);
  });

  it("blocks when report type (C.1.3 / decision D3) is unresolved", () => {
    const errors = validateBusinessRules(
      minimalValidCase({ reportType: { present: false, nullFlavor: "NASK" } }),
    );
    expect(errors.some((e) => e.code === "E2B-C1.3-UNRESOLVED")).toBe(true);
  });

  it("blocks when sender organisation (C.3.2 / decision D4) is unresolved", () => {
    const errors = validateBusinessRules(minimalValidCase({ senderOrganisation: undefined }));
    expect(errors.some((e) => e.code === "E2B-C3.2-UNRESOLVED")).toBe(true);
  });

  it("blocks when C.1.7 (expedited criteria) is unresolved", () => {
    const errors = validateBusinessRules(
      minimalValidCase({ fulfilsExpeditedCriteria: { present: false, nullFlavor: "NASK" } }),
    );
    expect(errors.some((e) => e.code === "E2B-C1.7-UNRESOLVED")).toBe(true);
  });

  it("blocks a case with no reactions", () => {
    const errors = validateBusinessRules(minimalValidCase({ reactions: [] }));
    expect(errors.some((e) => e.code === "E2B-REACTION-MISSING")).toBe(true);
  });

  it("blocks a case with no suspect/interacting products", () => {
    const errors = validateBusinessRules(minimalValidCase({ products: [] }));
    expect(errors.some((e) => e.code === "E2B-PRODUCT-MISSING")).toBe(true);
  });

  it("does not block on a CONCOMITANT-only product set (needs suspect/interacting)", () => {
    const c = minimalValidCase();
    c.products[0]!.characterization = "CONCOMITANT";
    const errors = validateBusinessRules(c);
    expect(errors.some((e) => e.code === "E2B-PRODUCT-MISSING")).toBe(true);
  });

  it("blocks a case with no identifiable patient", () => {
    const errors = validateBusinessRules(
      minimalValidCase({ patient: { identity: { present: false, nullFlavor: "UNK" } } }),
    );
    expect(errors.some((e) => e.code === "E2B-PATIENT-MISSING")).toBe(true);
  });

  it("blocks a case with no identifiable reporter at all", () => {
    const errors = validateBusinessRules(
      minimalValidCase({ reporter: { name: { present: false, nullFlavor: "NASK" } } }),
    );
    expect(errors.some((e) => e.code === "E2B-REPORTER-MISSING")).toBe(true);
  });

  it("does NOT block on reporter when only qualification (not name) is known — that's this dataset's real shape", () => {
    const errors = validateBusinessRules(minimalValidCase());
    expect(errors.some((e) => e.code === "E2B-REPORTER-MISSING")).toBe(false);
  });

  it("blocks a case with a genuinely UNKNOWN_SOURCE_CODE outcome", () => {
    const c = minimalValidCase();
    c.reactions[0]!.outcome = undefined;
    c.reactions[0]!.outcomeResolution = { rawSourceValue: "1", status: "UNKNOWN_SOURCE_CODE" };
    const errors = validateBusinessRules(c);
    expect(errors.some((e) => e.code === "E2B-OUTCOME-UNMAPPED" && e.severity === "BLOCKING")).toBe(
      true,
    );
  });

  it("blocks a case with a DECODED-but-unmappable outcome using the distinct E2B-OUTCOME-NOT-MAPPABLE code", () => {
    const c = minimalValidCase();
    c.reactions[0]!.outcome = undefined;
    c.reactions[0]!.outcomeResolution = {
      rawSourceValue: "2",
      decodedSourceValue: "Hospitalized",
      status: "HUMAN_REVIEW_REQUIRED",
    };
    const errors = validateBusinessRules(c);
    const found = errors.find((e) => e.code === "E2B-OUTCOME-NOT-MAPPABLE");
    expect(found?.severity).toBe("BLOCKING");
    expect(found?.message).toContain("Hospitalized");
    expect(errors.some((e) => e.code === "E2B-OUTCOME-UNMAPPED")).toBe(false);
  });

  it("warns (not blocks) on a missing reaction onset date", () => {
    const c = minimalValidCase();
    c.reactions[0]!.onsetDate = undefined;
    const errors = validateBusinessRules(c);
    const dateError = errors.find((e) => e.code === "E2B-REACTION-DATE-UNPARSEABLE");
    expect(dateError?.severity).toBe("WARNING");
  });
});

describe("validateVigiFlowPreflight", () => {
  it("blocks on an uncoded (UNMAPPED) reaction — this is the real state of every case today", () => {
    const errors = validateVigiFlowPreflight(minimalValidCase());
    expect(errors.some((e) => e.code === "VIGIFLOW-MEDDRA-MISSING")).toBe(true);
  });

  it("Option A: an uncoded (UNMAPPED) product does NOT block — only an INFO note is surfaced", () => {
    const errors = validateVigiFlowPreflight(minimalValidCase());
    expect(errors.some((e) => e.code === "VIGIFLOW-WHODRUG-OPTION-A-INFO")).toBe(true);
    const infoError = errors.find((e) => e.code === "VIGIFLOW-WHODRUG-OPTION-A-INFO");
    expect(infoError?.severity).toBe("INFO");
    // Confirm the overall case isn't blocked purely by this — a case
    // whose ONLY WHODrug-related finding is this INFO note must not have
    // any BLOCKING error with a WHODrug-shaped code.
    expect(errors.some((e) => e.severity === "BLOCKING" && e.code.includes("WHODRUG"))).toBe(false);
  });

  it("would pass the MedDRA check once a reaction is actually MAPPED — WHODrug coding is never required either way (Option A)", () => {
    const c = minimalValidCase();
    c.reactions[0]!.reaction = {
      sourceValue: "19",
      status: "MAPPED",
      codedTerm: "Pyrexia",
      code: "10037660",
      dictionaryVersion: "27.0",
      mappingMethod: "LICENSED_DICTIONARY",
    };
    const errors = validateVigiFlowPreflight(c);
    expect(errors.some((e) => e.code === "VIGIFLOW-MEDDRA-MISSING")).toBe(false);
    // Product is still UNMAPPED here — still only an INFO note, never blocking.
    expect(errors.some((e) => e.severity === "BLOCKING" && e.code.includes("WHODRUG"))).toBe(false);
  });

  it("blocks when reporter qualification is entirely absent", () => {
    const errors = validateVigiFlowPreflight(
      minimalValidCase({ reporter: { name: { present: false, nullFlavor: "NASK" } } }),
    );
    expect(errors.some((e) => e.code === "VIGIFLOW-REPORTER-QUALIFICATION-MISSING")).toBe(true);
  });
});

describe("runPreflight", () => {
  it("reports BLOCKED for the honest current state (no licensed dictionaries configured)", () => {
    const summary = runPreflight([
      minimalValidCase(),
      minimalValidCase({ sendersCaseId: "NG-MEDNOVA-000002" }),
    ]);
    expect(summary.status).toBe("BLOCKED");
    expect(summary.blockedCases).toBe(2);
    expect(summary.readyCases).toBe(0);
    expect(summary.counts.uncodedReactions).toBeGreaterThan(0);
    // Option A: WHODrug absence is informational, not a blocker — but it's
    // still counted so the UI can show it.
    expect(summary.counts.whodrugNotConfiguredInfo).toBeGreaterThan(0);
  });

  it("reports BLOCKED (not READY, not a crash) for zero cases", () => {
    const summary = runPreflight([]);
    expect(summary.status).toBe("BLOCKED");
    expect(summary.totalCases).toBe(0);
  });
});

describe("isOverridable / computeCaseEligibility — the validated-export override boundary", () => {
  it("a case with zero BLOCKING errors is trivially overridable", () => {
    const c = minimalValidCase();
    // This case still has other BLOCKING errors from validateVigiFlowPreflight
    // (no MedDRA provider configured) in real use, but at the BUSINESS_RULES
    // layer alone it's clean — use that mode to isolate the case.
    const result = validateCase(c, "BUSINESS_RULES");
    expect(result.blocked).toBe(false);
    expect(isOverridable(result)).toBe(true);
  });

  it("a case blocked ONLY on an administrative/mapping issue (C.1.3 unresolved) is overridable", () => {
    const c = minimalValidCase({ reportType: { present: false, nullFlavor: "NASK" } });
    const result = validateCase(c, "BUSINESS_RULES");
    expect(result.blocked).toBe(true);
    expect(result.errors.some((e) => e.code === "E2B-C1.3-UNRESOLVED")).toBe(true);
    expect(isOverridable(result)).toBe(true);
  });

  it("a case blocked on a structural-minimum issue (no identifiable patient) is NEVER overridable", () => {
    const c = minimalValidCase({ patient: { identity: { present: false, nullFlavor: "UNK" } } });
    const result = validateCase(c, "BUSINESS_RULES");
    expect(result.blocked).toBe(true);
    expect(result.errors.some((e) => e.code === "E2B-PATIENT-MISSING")).toBe(true);
    expect(isOverridable(result)).toBe(false);
  });

  it("a case blocked on BOTH a structural-minimum AND an administrative issue is still never overridable", () => {
    const c = minimalValidCase({
      patient: { identity: { present: false, nullFlavor: "UNK" } },
      reportType: { present: false, nullFlavor: "NASK" },
    });
    const result = validateCase(c, "BUSINESS_RULES");
    expect(isOverridable(result)).toBe(false);
  });

  it("E2B_NON_OVERRIDABLE_CODES contains exactly the 4 ICH minimum-content codes plus the 3 case-identity codes", () => {
    expect([...E2B_NON_OVERRIDABLE_CODES].sort()).toEqual(
      [
        "E2B-PATIENT-MISSING",
        "E2B-REPORTER-MISSING",
        "E2B-REACTION-MISSING",
        "E2B-PRODUCT-MISSING",
        "E2B-C1.1-MISSING",
        "E2B-C1.5-MISSING",
        "E2B-C1.8-MISSING",
      ].sort(),
    );
  });

  it("computeCaseEligibility: without an override, nothing blocked is includable", () => {
    const clean = validateCase(minimalValidCase({ sendersCaseId: "NG-1" }), "BUSINESS_RULES");
    const overridableBlocked = validateCase(
      minimalValidCase({
        sendersCaseId: "NG-2",
        reportType: { present: false, nullFlavor: "NASK" },
      }),
      "BUSINESS_RULES",
    );
    const structurallyBlocked = validateCase(
      minimalValidCase({
        sendersCaseId: "NG-3",
        patient: { identity: { present: false, nullFlavor: "UNK" } },
      }),
      "BUSINESS_RULES",
    );
    const eligibility = computeCaseEligibility(
      [clean, overridableBlocked, structurallyBlocked],
      false,
    );
    expect(eligibility.find((e) => e.caseId === "NG-1")).toMatchObject({
      includable: true,
      rescuedByOverride: false,
    });
    expect(eligibility.find((e) => e.caseId === "NG-2")).toMatchObject({
      includable: false,
      rescuedByOverride: false,
    });
    expect(eligibility.find((e) => e.caseId === "NG-3")).toMatchObject({
      includable: false,
      rescuedByOverride: false,
    });
  });

  it("computeCaseEligibility: with an override, the administrative case is rescued but the structural one stays excluded", () => {
    const clean = validateCase(minimalValidCase({ sendersCaseId: "NG-1" }), "BUSINESS_RULES");
    const overridableBlocked = validateCase(
      minimalValidCase({
        sendersCaseId: "NG-2",
        reportType: { present: false, nullFlavor: "NASK" },
      }),
      "BUSINESS_RULES",
    );
    const structurallyBlocked = validateCase(
      minimalValidCase({
        sendersCaseId: "NG-3",
        patient: { identity: { present: false, nullFlavor: "UNK" } },
      }),
      "BUSINESS_RULES",
    );
    const eligibility = computeCaseEligibility(
      [clean, overridableBlocked, structurallyBlocked],
      true,
    );

    const rescued = eligibility.find((e) => e.caseId === "NG-2")!;
    expect(rescued.includable).toBe(true);
    expect(rescued.rescuedByOverride).toBe(true);

    const stillExcluded = eligibility.find((e) => e.caseId === "NG-3")!;
    expect(stillExcluded.includable).toBe(false);
    expect(stillExcluded.rescuedByOverride).toBe(false);
    expect(stillExcluded.nonOverridableErrors.some((e) => e.code === "E2B-PATIENT-MISSING")).toBe(
      true,
    );

    // The already-clean case is unaffected either way.
    const clean1 = eligibility.find((e) => e.caseId === "NG-1")!;
    expect(clean1.includable).toBe(true);
    expect(clean1.rescuedByOverride).toBe(false); // it didn't need rescuing
  });
});
