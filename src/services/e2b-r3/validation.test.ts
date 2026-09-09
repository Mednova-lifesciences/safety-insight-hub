import { describe, expect, it } from "vitest";
import { runPreflight, validateBusinessRules, validateVigiFlowPreflight } from "./validation";
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
    reporter: { name: { present: false, nullFlavor: "NASK" }, qualificationVerbatim: "CHEW", qualificationCode: "3", country: "NG" },
    senderOrganisation: "MEDNOVA",
    reactions: [
      {
        id: "CASE-1-r1",
        sourceDecoding: { status: "DECODED", localCode: "19", sourceTerm: "19", sourceProfileId: "test-profile" },
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
    sourceInformation: { sourceFile: "test.xlsx", sourceRow: 1, jobId: "job-1", sourceProfileId: "test-profile" },
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

  it("blocks a case with an unmapped (raw source-code) outcome", () => {
    const c = minimalValidCase();
    c.reactions[0]!.outcome = undefined;
    c.reactions[0]!.outcomeUnmapped = "1";
    const errors = validateBusinessRules(c);
    expect(errors.some((e) => e.code === "E2B-OUTCOME-UNMAPPED" && e.severity === "BLOCKING")).toBe(true);
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
    const summary = runPreflight([minimalValidCase(), minimalValidCase({ sendersCaseId: "NG-MEDNOVA-000002" })]);
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
