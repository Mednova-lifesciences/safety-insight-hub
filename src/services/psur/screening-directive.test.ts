import { describe, expect, it } from "vitest";
import { buildScreeningDirectiveModel } from "./screening-directive";
import { SCREENING_CHECKS, emptyChecks } from "./screening-checklist";
import type { PsurDocument, PsurScreeningCheckItem } from "@/types/pv";

function docWith(checks: PsurScreeningCheckItem[]): PsurDocument {
  return {
    id: "psur-t",
    filename: "report.pdf",
    product: "Test product",
    reportingPeriod: "01 Jul 2025 - 30 Jun 2026",
    uploadedAt: "2026-08-13T09:00:00Z",
    uploadedBy: "Officer",
    stage: "REVIEWED",
    pages: 10,
    workflowStage: "RETURNED_TO_MAH",
    administrativeScreening: {
      performedAt: "2026-08-13T09:05:00Z",
      submissionDetails: {
        productName: "Test product",
        activeSubstance: "",
        nafdacRegNo: "A4-1",
        mah: "Test MAH",
        qppv: "",
        qppvContact: "",
        ibd: "",
        firstNafdacRegistrationDate: "",
        dlp: "2026-06-30",
        intervalCovered: "01 Jul 2025 - 30 Jun 2026",
        dateReceived: "2026-08-13T09:00:00Z",
      },
      checks,
      assistGenerated: false,
      outcome: {
        decision: "COMPLIANCE_DIRECTIVE",
        citedItems: [13],
        deficiencies: "Address the items below.",
        conclusions: "Administratively incomplete.",
        officerName: "Officer",
        mahResponseDeadline: "2026-09-30",
        nextPsurDueDate: "2027-06-30",
        by: "Officer",
        at: "2026-08-14T10:00:00Z",
      },
    },
  };
}

describe("a directive says what to DO, not only what is wrong", () => {
  it("gives every failed item an action the MAH can act on", () => {
    const checks = emptyChecks().map((c) =>
      c.id === "LITERATURE_IN_OWN_WORDS"
        ? { ...c, status: "NO" as const, deficiency: "No literature section found." }
        : { ...c, status: "YES" as const, deficiency: "Present." },
    );
    const row = buildScreeningDirectiveModel(docWith(checks))!.failedRows[0]!;
    // "Item 13 failed" is not something anyone can comply with.
    expect(row.action).toContain("literature section");
    expect(row.action).toContain("own words");
    expect(row.deficiency).toContain("No literature section found");
    expect(row.label).toBeTruthy();
  });

  it("has an action for every one of the sixteen checks", () => {
    // A failure with no remedy beside it would leave the MAH guessing, so
    // there must be no check that can appear on a directive without one.
    const allFailed = SCREENING_CHECKS.map((d) => ({
      id: d.id,
      status: "NO" as const,
      deficiency: "x",
      assistGenerated: false,
    }));
    const m = buildScreeningDirectiveModel(docWith(allFailed))!;
    expect(m.failedRows).toHaveLength(16);
    for (const r of m.failedRows) {
      expect(r.action, `item ${r.number}`).toBeTruthy();
      expect(r.action.length, `item ${r.number} action is too terse`).toBeGreaterThan(40);
    }
  });

  it("gives unresolved items an action too", () => {
    // "We could not tell" is itself a request for information.
    const checks = emptyChecks();
    const m = buildScreeningDirectiveModel(docWith(checks))!;
    expect(m.unresolvedRows).toHaveLength(16);
    for (const r of m.unresolvedRows) expect(r.action).toBeTruthy();
  });

  it("carries both dates and the citation", () => {
    const m = buildScreeningDirectiveModel(docWith(emptyChecks()))!;
    expect(m.mahResponseDeadline).toBe("2026-09-30");
    expect(m.nextPsurDueDate).toBe("2027-06-30");
    expect(m.outcomeLabel).toBe("Compliance directive");
  });
});
