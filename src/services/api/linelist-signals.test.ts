import { describe, expect, it } from "vitest";
import {
  disproportionality,
  screenLineLists,
  UMC_MIN_REPORTS,
  type ScreenCase,
} from "./linelist-signals";

let row = 0;
function c(product: string, ...reactions: string[]): ScreenCase {
  row += 1;
  return { jobId: "job-1", filename: "TEST.csv", row, caseId: `TST-${row}`, product, reactions };
}

describe("disproportionality", () => {
  it("matches a hand-worked 2×2 table (a=3, b=1, c=2, d=20)", () => {
    const r = disproportionality(3, 1, 2, 20);
    // PRR = (3/4)/(2/22) = 8.25; ROR = (3·20)/(1·2) = 30
    expect(r.prr.value).toBeCloseTo(8.25, 6);
    expect(r.ror.value).toBeCloseTo(30, 6);
    // Yates χ² = 26·(|60−2| − 13)² / (4·22·5·21) = 52650 / 9240
    expect(r.chiSquare).toBeCloseTo(52650 / 9240, 6);
    // ln PRR ± 1.96·√(1/3 − 1/4 + 1/2 − 1/22)
    expect(r.prr.lower).toBeCloseTo(1.96, 1);
    expect(r.prr.upper).toBeCloseTo(34.7, 0);
    // ln ROR ± 1.96·√(1/3 + 1 + 1/2 + 1/20)
    expect(r.ror.lower).toBeCloseTo(2.04, 1);
    expect(r.corrected).toBe(false);
  });

  it("adds 0.5 to every cell when one is zero, and says so", () => {
    const r = disproportionality(3, 0, 2, 20);
    expect(r.corrected).toBe(true);
    expect(Number.isFinite(r.ror.value)).toBe(true);
    expect(Number.isFinite(r.prr.upper)).toBe(true);
  });
});

describe("screenLineLists", () => {
  const background = () => [
    ...Array.from({ length: 10 }, () => c("Pentavalent", "Fever")),
    ...Array.from({ length: 10 }, () => c("BCG", "Injection site swelling")),
    ...Array.from({ length: 5 }, () => c("OPV", "Fever")),
  ];

  it("flags a pair with N ≥ 3, PRR ≥ 2 and χ² ≥ 4 as a candidate", () => {
    const cases = [...background(), ...Array.from({ length: 4 }, () => c("HPV", "Syncope"))];
    const r = screenLineLists(cases);
    const hpv = r.candidates.find((p) => p.product === "HPV");
    expect(hpv).toMatchObject({ reaction: "Syncope", a: 4, b: 0 });
    expect(hpv!.cases).toHaveLength(4);
    expect(hpv!.cases[0]).toMatchObject({ filename: "TEST.csv", jobId: "job-1" });
  });

  it("never flags a pair with fewer than 3 reports, however disproportionate", () => {
    const cases = [
      ...background(),
      c("Measles", "Thrombocytopenia"),
      c("Measles", "Thrombocytopenia"),
    ];
    const r = screenLineLists(cases);
    const pair = r.pairs.find((p) => p.reaction === "Thrombocytopenia")!;
    expect(pair.a).toBe(2);
    expect(pair.prr.value).toBeGreaterThan(2);
    expect(pair.candidate).toBe(false);
  });

  it("counts a case once per distinct reaction, and once per pair", () => {
    const r = screenLineLists([c("HPV", "Syncope", "syncope ", "Headache"), c("BCG", "Fever")]);
    expect(r.totalReports).toBe(2);
    const syncope = r.pairs.find((p) => p.reaction === "Syncope")!;
    expect(syncope.a).toBe(1);
    expect(r.pairs.filter((p) => p.product === "HPV")).toHaveLength(2);
  });

  it("groups words the organisation coded to the same MedDRA term", () => {
    const codings = [
      { termKey: "FAINTING", code: "10042772", label: "Syncope" },
      { termKey: "PASSED OUT", code: "10042772", label: "Syncope" },
    ];
    const cases = [
      ...background(),
      c("HPV", "Fainting"),
      c("HPV", "passed out"),
      c("HPV", "Fainting"),
    ];
    const r = screenLineLists(cases, codings);
    const pair = r.pairs.find((p) => p.product === "HPV")!;
    expect(pair).toMatchObject({
      reaction: "Syncope",
      reactionSource: "MEDDRA",
      meddraCode: "10042772",
      a: 3,
    });
  });

  it("uses the product aliases (MR = Measles rubella)", () => {
    const r = screenLineLists([c("MR", "Rash"), c("Measles Rubella", "Rash"), c("BCG", "Fever")]);
    expect(r.pairs.find((p) => p.reaction === "Rash")!.a).toBe(2);
  });

  it("leaves out cases with no product or no reaction, and counts them", () => {
    const r = screenLineLists([c("", "Fever"), c("BCG"), c("BCG", "Fever")]);
    expect(r).toMatchObject({ totalReports: 1, unusable: 2 });
  });

  it("marks a pool under the UMC minimum as small", () => {
    expect(screenLineLists(background()).smallPool).toBe(true);
    const big = Array.from({ length: UMC_MIN_REPORTS }, (_, i) =>
      c(i % 2 ? "BCG" : "OPV", "Fever"),
    );
    expect(screenLineLists(big).smallPool).toBe(false);
  });

  it("flags nothing when the pool has a single product", () => {
    const r = screenLineLists(
      Array.from({ length: 6 }, (_, i) => c("BCG", i < 3 ? "Fever" : "Rash")),
    );
    expect(r.candidates).toHaveLength(0);
  });
});
