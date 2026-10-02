import { describe, expect, it } from "vitest";
import { matrixTotals, rowTotal } from "./cioms";
import type { CiomsMatrix } from "@/types/pv";

/** The matrix exactly as the supplied Tramadol memo prints it. */
function tramadolMatrix(): CiomsMatrix {
  return {
    epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
    effectivenessOfProduct: { seriousness: 3, duration: 3, incidence: 0 },
    adrs: [
      { reaction: "Respiratory depression", scores: { seriousness: 3, duration: 1, incidence: 1 } },
      { reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } },
      { reaction: "Serotonin syndrome", scores: { seriousness: 3, duration: 1, incidence: 1 } },
    ],
  };
}

describe("row totals", () => {
  it("sums the three rows", () => {
    expect(rowTotal({ seriousness: 2, duration: 2, incidence: 2 })).toBe(6);
  });

  it("accepts a legitimate zero", () => {
    // The supplied memo scores Effectiveness -> Incidence as 0.
    expect(rowTotal({ seriousness: 3, duration: 3, incidence: 0 })).toBe(6);
  });

  // Review Focus 3.
  it("refuses a negative score rather than summing it", () => {
    expect(rowTotal({ seriousness: -1, duration: 2, incidence: 2 })).toBeUndefined();
  });

  it("refuses a non-integer score", () => {
    expect(rowTotal({ seriousness: 1.5, duration: 2, incidence: 2 })).toBeUndefined();
  });

  it("refuses a non-finite score", () => {
    expect(rowTotal({ seriousness: Number.NaN, duration: 2, incidence: 2 })).toBeUndefined();
  });
});

describe("matrix totals", () => {
  it("reproduces the supplied memo's figures", () => {
    // The memo prints 6, 6, and "5 & 4 & 5".
    expect(matrixTotals(tramadolMatrix())).toEqual({
      epidemiology: 6,
      effectiveness: 6,
      adrs: [5, 4, 5],
    });
  });

  it("refuses the whole matrix when any score is invalid", () => {
    const bad = tramadolMatrix();
    bad.adrs[1]!.scores.duration = -3;
    expect(matrixTotals(bad)).toBeUndefined();
  });

  it("handles a matrix with no ADRs scored yet", () => {
    const m = tramadolMatrix();
    m.adrs = [];
    expect(matrixTotals(m)).toEqual({ epidemiology: 6, effectiveness: 6, adrs: [] });
  });
});
