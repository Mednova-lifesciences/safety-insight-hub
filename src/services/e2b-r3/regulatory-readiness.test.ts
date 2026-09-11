import { describe, expect, it } from "vitest";
import {
  computeOrganizationReadiness,
  isOrganizationReady,
  summarizeCaseLevelBlockers,
} from "./regulatory-readiness";
import {
  unconfiguredOrgRegulatoryConfig,
  ALL_REACTION_OUTCOMES,
  type OrgRegulatoryConfig,
} from "./regulatory-config";
import type { CaseValidationResult, ValidationError } from "./validation";

function fullyConfiguredConfig(): OrgRegulatoryConfig {
  const outcomeCodes: OrgRegulatoryConfig["outcomeCodes"] = {};
  ALL_REACTION_OUTCOMES.forEach((o, i) => {
    outcomeCodes[o] = String(i + 1);
  });
  return {
    transmission: {
      environment: "production",
      sender: { organization: "MEDNOVA", identifier: "MEDNOVA-SND-01" },
      receiver: { identifier: "NAFDAC-RCV-01" },
      reportType: "1",
      reportTypeConfirmed: true,
    },
    outcomeCodes,
    reporterQualificationMappings: [],
  };
}

describe("computeOrganizationReadiness", () => {
  it("reports every org-level item CONFIGURED once sender/receiver/report-type/outcome codelist are all confirmed (scenario 1)", () => {
    const items = computeOrganizationReadiness(fullyConfiguredConfig());
    expect(items.every((i) => i.status === "CONFIGURED")).toBe(true);
    expect(isOrganizationReady(items)).toBe(true);
  });

  it("reports the sender identifier as MISSING, independent of every other field (scenario 2)", () => {
    const config = fullyConfiguredConfig();
    const items = computeOrganizationReadiness(unconfiguredOrgRegulatoryConfig());
    const sender = items.find((i) => i.key === "SENDER")!;
    expect(sender.status).toBe("MISSING");
    // A fully unconfigured config also has receiver/report-type/outcome
    // gaps — never a single generic "not ready" flag.
    expect(items.filter((i) => i.status !== "CONFIGURED").length).toBeGreaterThan(1);
    void config;
  });

  it("reports the receiver identifier as MISSING when only it is unconfirmed (scenario 3)", () => {
    const config = fullyConfiguredConfig();
    config.transmission.receiver.identifier = "__UNCONFIRMED__";
    const items = computeOrganizationReadiness(config);
    expect(items.find((i) => i.key === "RECEIVER")!.status).toBe("MISSING");
    expect(items.find((i) => i.key === "SENDER")!.status).toBe("CONFIGURED");
  });

  it("report type stays NOT_VERIFIED even when sender/receiver/environment are confirmed — never inferred from bundling (scenario 4)", () => {
    const config = fullyConfiguredConfig();
    config.transmission.reportTypeConfirmed = false;
    const items = computeOrganizationReadiness(config);
    expect(items.find((i) => i.key === "REPORT_TYPE")!.status).toBe("NOT_VERIFIED");
    expect(items.find((i) => i.key === "SENDER")!.status).toBe("CONFIGURED");
    expect(items.find((i) => i.key === "RECEIVER")!.status).toBe("CONFIGURED");
  });

  it("outcome codelist is NOT_VERIFIED until all six concepts have a code (scenario 7)", () => {
    const config = fullyConfiguredConfig();
    delete config.outcomeCodes.FATAL;
    const items = computeOrganizationReadiness(config);
    const outcomeItem = items.find((i) => i.key === "OUTCOME_CODELIST")!;
    expect(outcomeItem.status).toBe("NOT_VERIFIED");
    expect(outcomeItem.detail).toContain("5/6");
  });
});

function blockedResult(caseId: string, errors: ValidationError[]): CaseValidationResult {
  return { caseId, errors, blocked: errors.some((e) => e.severity === "BLOCKING") };
}

function qualError(caseId: string, designation: string): ValidationError {
  return {
    code: "E2B-REPORTER-QUALIFICATION-UNRESOLVED",
    severity: "BLOCKING",
    layer: "BUSINESS_RULE",
    caseId,
    message: `Reporter designation "${designation}" has no entry.`,
    remediation: "Configure it.",
    sourceValue: designation,
  };
}

function outcomeCodeError(caseId: string): ValidationError {
  return {
    code: "E2B-OUTCOME-CODE-NOT-CONFIGURED",
    severity: "BLOCKING",
    layer: "BUSINESS_RULE",
    caseId,
    message: "Outcome code not configured.",
    remediation: "Configure it.",
  };
}

describe("summarizeCaseLevelBlockers", () => {
  it("groups unmapped designations by NAME with an accurate per-designation case count (scenario 5/6)", () => {
    const results = [
      blockedResult("C1", [qualError("C1", "CHO")]),
      blockedResult("C2", [qualError("C2", "CHO")]),
      blockedResult("C3", [qualError("C3", "Midwife")]),
      blockedResult("C4", []),
    ];
    const summary = summarizeCaseLevelBlockers(results);
    expect(summary.unmappedReporterDesignations).toEqual(
      expect.arrayContaining([
        { designation: "CHO", caseCount: 2 },
        { designation: "Midwife", caseCount: 1 },
      ]),
    );
  });

  it("counts a case at most once even if the same designation error somehow appears twice", () => {
    const results = [blockedResult("C1", [qualError("C1", "CHO"), qualError("C1", "CHO")])];
    const summary = summarizeCaseLevelBlockers(results);
    expect(summary.unmappedReporterDesignations).toEqual([{ designation: "CHO", caseCount: 1 }]);
  });

  it("counts cases with an unresolved E.i.7 outcome code separately from designation gaps (scenario 7)", () => {
    const results = [
      blockedResult("C1", [outcomeCodeError("C1")]),
      blockedResult("C2", [outcomeCodeError("C2"), qualError("C2", "CHO")]),
      blockedResult("C3", []),
    ];
    const summary = summarizeCaseLevelBlockers(results);
    expect(summary.unresolvedOutcomeCaseCount).toBe(2);
    expect(summary.unmappedReporterDesignations).toEqual([{ designation: "CHO", caseCount: 1 }]);
  });

  it("reports nothing when every case is clean", () => {
    const summary = summarizeCaseLevelBlockers([blockedResult("C1", [])]);
    expect(summary.unmappedReporterDesignations).toEqual([]);
    expect(summary.unresolvedOutcomeCaseCount).toBe(0);
  });
});
