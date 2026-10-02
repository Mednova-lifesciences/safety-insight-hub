import { describe, expect, it } from "vitest";
import { factualCriteria, MEMO_CRITERIA, MEMO_REFERENCE_PREFIX } from "./assessment-memo";
import type { PsurSubmissionDetails } from "@/types/pv";

function details(overrides: Partial<PsurSubmissionDetails> = {}): PsurSubmissionDetails {
  return {
    productName: "Tramadol-50 (Tramadol 50mg) Capsule",
    activeSubstance: "Tramadol",
    nafdacRegNo: "A4-100123",
    mah: "Justeen Pharm",
    qppv: "",
    qppvContact: "",
    ibd: "1977",
    firstNafdacRegistrationDate: "",
    dlp: "2024-11-12",
    intervalCovered: "12 November 2021 to 12 November 2024",
    dateReceived: "2026-09-03T00:00:00Z",
    ...overrides,
  };
}

describe("the criteria table", () => {
  it("has the form's eleven rows, numbered 1 to 11", () => {
    expect(MEMO_CRITERIA).toHaveLength(11);
    expect(MEMO_CRITERIA.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("starts with Product Identity and ends with the overall safety evaluation", () => {
    expect(MEMO_CRITERIA[0]!.id).toBe("PRODUCT_IDENTITY");
    expect(MEMO_CRITERIA[10]!.id).toBe("OVERALL_SAFETY_EVALUATION");
  });
});

describe("the reference prefix", () => {
  it("is the fixed NAFDAC PV prefix, so the assessor types only the number", () => {
    expect(MEMO_REFERENCE_PREFIX).toBe("NAFDAC/PV/GCIOMS/");
  });
});

describe("the six factual criteria", () => {
  it("fills them from the submission details", () => {
    const out = factualCriteria(details(), "Narcotic Analgesic");
    const by = (id: string) => out.find((c) => c.id === id)!;
    expect(by("PRODUCT_IDENTITY").remarks).toContain("Tramadol");
    expect(by("REPORTING_INTERVAL").remarks).toBe("12 November 2021 to 12 November 2024");
    expect(by("THERAPEUTIC_CATEGORY").remarks).toBe("Narcotic Analgesic");
    expect(by("DATE_RECEIVED").remarks).toBe("2026-09-03");
    expect(by("INTERNATIONAL_BIRTH_DATE").remarks).toBe("1977");
  });

  it("marks a blank Nigeria Birth Date unestablished rather than printing nothing", () => {
    // The form says "(if available)", and the supplied memo leaves it
    // blank — but a blank cell reads as NAFDAC's omission.
    const out = factualCriteria(details(), "Narcotic Analgesic");
    const nbd = out.find((c) => c.id === "NIGERIA_BIRTH_DATE")!;
    expect(nbd.unestablished).toBe(true);
    expect(nbd.remarks).not.toBe("");
  });

  it("marks a missing therapeutic category unestablished", () => {
    const out = factualCriteria(details(), "");
    expect(out.find((c) => c.id === "THERAPEUTIC_CATEGORY")!.unestablished).toBe(true);
  });

  it("returns only the six factual criteria", () => {
    expect(factualCriteria(details(), "x").map((c) => c.id)).toEqual([
      "PRODUCT_IDENTITY",
      "REPORTING_INTERVAL",
      "THERAPEUTIC_CATEGORY",
      "DATE_RECEIVED",
      "INTERNATIONAL_BIRTH_DATE",
      "NIGERIA_BIRTH_DATE",
    ]);
  });

  it("carries no citations — these are facts off the submission, not research", () => {
    for (const c of factualCriteria(details(), "x")) expect(c.citations).toEqual([]);
  });
});
