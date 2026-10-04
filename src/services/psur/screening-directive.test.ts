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

/**
 * Section A — the submission's identifying particulars.
 *
 * These are not checklist items and carry no item number, so they never
 * reached the MAH as anything to act on: a blank one appeared in the
 * letter's header as "Not stated in the submission" and nowhere else, and
 * four of them (QPPV, QPPV contact, IBD, first registration date) were not
 * in the directive at all.
 */
describe("submission details that were never stated", () => {
  it("lists exactly the blank fields, and nothing that was supplied", () => {
    // The fixture supplies product name, reg no, MAH, DLP and interval.
    const m = buildScreeningDirectiveModel(docWith(emptyChecks()))!;
    expect(m.missingDetailRows.map((r) => r.label)).toEqual([
      "Active substance",
      "Qualified Person for Pharmacovigilance",
      "QPPV telephone and e-mail",
      "International Birth Date",
      "Date of first NAFDAC registration",
    ]);
  });

  it("gives every one of them something the MAH can actually do", () => {
    const m = buildScreeningDirectiveModel(docWith(emptyChecks()))!;
    for (const row of m.missingDetailRows) {
      expect(row.action.length).toBeGreaterThan(20);
      // An instruction, not a restatement of the gap.
      expect(row.action).toMatch(/^(State|Name|Submit|Provide|Attach|Confirm)/);
    }
  });

  it("reaches the four fields the letter's header never carried", () => {
    const m = buildScreeningDirectiveModel(docWith(emptyChecks()))!;
    const labels = m.missingDetailRows.map((r) => r.label).join(" | ");
    for (const field of [
      "Qualified Person for Pharmacovigilance",
      "QPPV telephone and e-mail",
      "International Birth Date",
      "Date of first NAFDAC registration",
    ]) {
      expect(labels).toContain(field);
    }
  });

  it("is empty when the submission stated everything", () => {
    const doc = docWith(emptyChecks());
    const complete: PsurDocument = {
      ...doc,
      administrativeScreening: {
        ...doc.administrativeScreening!,
        submissionDetails: {
          productName: "Test product",
          activeSubstance: "Paracetamol",
          nafdacRegNo: "A4-1",
          mah: "Test MAH",
          qppv: "Dr A Obi",
          qppvContact: "08030000000 / qppv@example.com",
          ibd: "2019-01-01",
          firstNafdacRegistrationDate: "2020-03-01",
          dlp: "2026-06-30",
          intervalCovered: "01 Jul 2025 - 30 Jun 2026",
          dateReceived: "2026-08-13T09:00:00Z",
        },
      },
    };
    expect(buildScreeningDirectiveModel(complete)!.missingDetailRows).toEqual([]);
  });

  it("never asks the MAH for the date received", () => {
    // The system took the upload, so it always knows that one, and it is
    // not something an MAH can supply.
    const m = buildScreeningDirectiveModel(docWith(emptyChecks()))!;
    expect(m.missingDetailRows.map((r) => r.label).join(" ")).not.toContain("received");
  });

  it("is independent of the checklist — a gap is not a failing check", () => {
    // Section A blanks must not inflate the "N of 16 failing" count, and
    // must still be reported when every check passes.
    const allPass = emptyChecks().map((c) => ({ ...c, status: "YES" as const }));
    const m = buildScreeningDirectiveModel(docWith(allPass))!;
    expect(m.failedRows).toEqual([]);
    expect(m.missingDetailRows.length).toBe(5);
  });
});
