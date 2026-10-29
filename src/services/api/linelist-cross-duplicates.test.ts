import { describe, expect, it } from "vitest";
import {
  batchKey,
  duplicateDropNote,
  findCrossFileDuplicates,
  pairKey,
  productKey,
  scorePair,
  type CrossFileCase,
} from "./linelist-cross-duplicates";

const base: Omit<CrossFileCase, "jobId" | "filename" | "row"> = {
  product: "Measles-Rubella vaccine",
  vaccinationDate: "12/03/2026",
  sex: "F",
  age: "9",
  ageUnit: "months",
  patientIdentifier: "Adebola Esther",
  batch: "MR-2231A",
  reaction: "Fever, Rash",
  onsetDate: "13/03/2026",
  facility: "PHC Oke-Aro",
};

const inA = (row: number, over: Partial<CrossFileCase> = {}): CrossFileCase => ({
  jobId: "job-a",
  filename: "facility.csv",
  row,
  ...base,
  ...over,
});
const inB = (row: number, over: Partial<CrossFileCase> = {}): CrossFileCase => ({
  jobId: "job-b",
  filename: "state.xlsx",
  row,
  ...base,
  ...over,
});

describe("keys", () => {
  it("compares products without the word vaccine, case or punctuation", () => {
    expect(productKey("Measles-Rubella vaccine")).toBe(productKey("MEASLES RUBELLA"));
    expect(productKey("HPV")).not.toBe(productKey("MR"));
    expect(productKey("MR vaccine")).toBe(productKey("Measles-Rubella"));
    expect(productKey("Penta")).toBe(productKey("Pentavalent"));
  });

  it("treats placeholder batches as no batch", () => {
    for (const p of ["-", "NIL", "N/A", "na", " ", "0", "Unknown"]) expect(batchKey(p)).toBeNull();
    expect(batchKey("mr 2231-a")).toBe("MR2231A");
  });

  it("gives a pair the same key from either side", () => {
    expect(pairKey(inA(1), inB(4))).toBe(pairKey(inB(4), inA(1)));
  });
});

describe("scorePair", () => {
  it("lists every field that agrees", () => {
    const s = scorePair(inA(1), inB(1));
    expect(s.matched.sort()).toEqual(
      ["age", "batch", "facility", "initials", "onset", "reaction", "sex"].sort(),
    );
    expect(s.conflicting).toEqual([]);
  });

  it("allows age ±1 and onset ±2 days, and reads initials from a full name", () => {
    const s = scorePair(
      inA(1),
      inB(1, { age: "10", onsetDate: "2026-03-15", patientIdentifier: "A.E." }),
    );
    expect(s.matched).toEqual(expect.arrayContaining(["age", "onset", "initials"]));
  });

  it("does not compare ages in different units", () => {
    const s = scorePair(inA(1), inB(1, { age: "9", ageUnit: "years" }));
    expect(s.matched).not.toContain("age");
    expect(s.conflicting).not.toContain("age");
  });

  it("penalises a different sex", () => {
    const s = scorePair(inA(1), inB(1, { sex: "Male" }));
    expect(s.conflicting).toContain("sex");
  });
});

describe("findCrossFileDuplicates", () => {
  it("finds a true duplicate in another file", () => {
    const pairs = findCrossFileDuplicates([inA(1)], [inB(7, { vaccinationDate: "2026-03-14" })]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.b.row).toBe(7);
    expect(pairs[0]!.vaccinationDaysApart).toBe(2);
  });

  it("never pairs rows of the same file", () => {
    expect(findCrossFileDuplicates([inA(1)], [inA(2)])).toEqual([]);
  });

  it("blocks on product and a vaccination date within 3 days", () => {
    expect(findCrossFileDuplicates([inA(1)], [inB(1, { product: "HPV vaccine" })])).toEqual([]);
    expect(findCrossFileDuplicates([inA(1)], [inB(1, { vaccinationDate: "16/03/2026" })])).toEqual(
      [],
    );
    expect(
      findCrossFileDuplicates([inA(1)], [inB(1, { vaccinationDate: "15/03/2026" })]),
    ).toHaveLength(1);
  });

  it("does not match a near-miss: same clinic, day and vaccine, different child", () => {
    const sibling = inB(2, {
      sex: "M",
      age: "3",
      patientIdentifier: "Tunde Bello",
      batch: "MR-2231A",
      reaction: "Fever",
      onsetDate: "13/03/2026",
    });
    expect(findCrossFileDuplicates([inA(1)], [sibling])).toEqual([]);
  });

  it("does not match on product and date alone", () => {
    const sparse = inB(3, {
      sex: undefined,
      age: undefined,
      patientIdentifier: undefined,
      batch: undefined,
      reaction: "Swelling",
      onsetDate: undefined,
      facility: "General Hospital Akure",
    });
    expect(findCrossFileDuplicates([inA(1)], [sparse])).toEqual([]);
  });

  it("leaves out a pair a person marked not a duplicate", () => {
    const a = inA(1);
    const b = inB(1);
    expect(findCrossFileDuplicates([a], [b], new Set([pairKey(b, a)]))).toEqual([]);
  });

  it("skips rows without a readable product or vaccination date", () => {
    expect(findCrossFileDuplicates([inA(1, { vaccinationDate: "soon" })], [inB(1)])).toEqual([]);
    expect(findCrossFileDuplicates([inA(1)], [inB(1, { product: "" })])).toEqual([]);
  });

  it("orders the strongest pairs first", () => {
    const weaker = inB(2, { batch: "-", facility: "Other PHC", onsetDate: undefined });
    const pairs = findCrossFileDuplicates([inA(1)], [weaker, inB(1)]);
    expect(pairs.map((p) => p.b.row)).toEqual([1, 2]);
  });
});

describe("duplicateDropNote", () => {
  it("names the other file and row", () => {
    expect(duplicateDropNote(inB(7, { caseId: "NG-ON-0042" }))).toBe(
      'Duplicate of row 7 (case NG-ON-0042) in "state.xlsx".',
    );
  });
});
