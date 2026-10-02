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

import { CRITERION_SECTIONS, evidenceCriteria } from "./assessment-memo";
import type { AssessmentSection, EvidenceEntry } from "@/types/pv";

function ev(overrides: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    id: "e1",
    section: "S4_RSI",
    sourceType: "REFERENCE_SAFETY_INFORMATION",
    citation: "https://dailymed.nlm.nih.gov/example",
    content: "RSI updated to emphasise the warfarin interaction.",
    origin: "assessor",
    addedBy: "Evaluator",
    addedAt: "2026-10-02T09:00:00Z",
    acceptedBy: "Evaluator",
    acceptedAt: "2026-10-02T09:01:00Z",
    ...overrides,
  };
}

function section(id: AssessmentSection["section"], evidence: EvidenceEntry[]): AssessmentSection {
  return { section: id, evidence };
}

describe("which working section feeds which criterion", () => {
  it("maps each evidence criterion to at least one section", () => {
    for (const id of ["RSI_CHANGES", "WORLDWIDE_ACTIONS", "PATIENT_EXPOSURE", "RELEVANT_STUDIES"] as const) {
      expect(CRITERION_SECTIONS[id].length).toBeGreaterThan(0);
    }
  });

  it("feeds criterion 7 from the RSI section", () => {
    expect(CRITERION_SECTIONS.RSI_CHANGES).toContain("S4_RSI");
  });

  it("feeds criterion 9 from the exposure section", () => {
    expect(CRITERION_SECTIONS.PATIENT_EXPOSURE).toContain("S5_EXPOSURE_ACTIONS");
  });

  it("never draws memo evidence from the screening step", () => {
    for (const sections of Object.values(CRITERION_SECTIONS)) {
      expect(sections).not.toContain("ADMIN_SCREENING");
    }
  });
});

describe("the evidence criteria", () => {
  it("renders accepted, cited evidence with its citation", () => {
    const out = evidenceCriteria([section("S4_RSI", [ev()])]);
    const rsi = out.find((c) => c.id === "RSI_CHANGES")!;
    expect(rsi.remarks).toContain("warfarin");
    expect(rsi.citations).toEqual(["https://dailymed.nlm.nih.gov/example"]);
    expect(rsi.unestablished).toBe(false);
  });

  it("marks a criterion with no evidence unestablished", () => {
    const out = evidenceCriteria([section("S4_RSI", [])]);
    expect(out.find((c) => c.id === "RSI_CHANGES")!.unestablished).toBe(true);
  });

  it("ignores an unaccepted candidate", () => {
    const candidate = ev();
    delete (candidate as { acceptedBy?: string }).acceptedBy;
    const out = evidenceCriteria([section("S4_RSI", [candidate])]);
    expect(out.find((c) => c.id === "RSI_CHANGES")!.unestablished).toBe(true);
  });

  it("ignores an uncited entry", () => {
    const out = evidenceCriteria([section("S4_RSI", [ev({ citation: "" })])]);
    expect(out.find((c) => c.id === "RSI_CHANGES")!.unestablished).toBe(true);
  });

  // Review Focus 5.
  it("marks a criterion unestablished when its accepted evidence has no content", () => {
    const out = evidenceCriteria([section("S4_RSI", [ev({ content: "   " })])]);
    const rsi = out.find((c) => c.id === "RSI_CHANGES")!;
    expect(rsi.unestablished).toBe(true);
    expect(rsi.remarks).not.toBe("");
  });

  it("joins several entries and keeps every citation", () => {
    const out = evidenceCriteria([
      section("S4_RSI", [
        ev({ id: "a", content: "First change.", citation: "https://example.test/a" }),
        ev({ id: "b", content: "Second change.", citation: "https://example.test/b" }),
      ]),
    ]);
    const rsi = out.find((c) => c.id === "RSI_CHANGES")!;
    expect(rsi.remarks).toContain("First change.");
    expect(rsi.remarks).toContain("Second change.");
    expect(rsi.citations).toEqual(["https://example.test/a", "https://example.test/b"]);
  });

  it("returns the five non-factual criteria", () => {
    expect(evidenceCriteria([]).map((c) => c.id)).toEqual([
      "RSI_CHANGES",
      "WORLDWIDE_ACTIONS",
      "PATIENT_EXPOSURE",
      "RELEVANT_STUDIES",
      "OVERALL_SAFETY_EVALUATION",
    ]);
  });
});
