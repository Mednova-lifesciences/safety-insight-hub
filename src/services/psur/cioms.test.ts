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

import { bandFor, PROVISIONAL_CIOMS_RUBRIC, proposeVerdict } from "./cioms";
import type { CiomsRubric } from "@/types/pv";

describe("the provisional rubric", () => {
  it("is marked provisional and says where it came from", () => {
    expect(PROVISIONAL_CIOMS_RUBRIC.provisional).toBe(true);
    expect(PROVISIONAL_CIOMS_RUBRIC.provenance.toLowerCase()).toContain("provisional");
    expect(PROVISIONAL_CIOMS_RUBRIC.provenance).toContain("Tramadol");
  });

  it("labels the supplied memo's total of 6 as medium", () => {
    // The memo reads "a medium efficacy score of 6".
    expect(bandFor(6)?.label.toLowerCase()).toBe("medium");
  });

  // Review Focus 4.
  it("returns no label for a total in no band, rather than the nearest", () => {
    const narrow: CiomsRubric = {
      provenance: "test",
      provisional: true,
      bands: [{ label: "Low", min: 0, max: 2 }],
    };
    expect(bandFor(9, narrow)).toBeUndefined();
  });

  it("returns no label when no rubric is configured at all", () => {
    const none: CiomsRubric = { provenance: "test", provisional: true, bands: [] };
    expect(bandFor(6, none)).toBeUndefined();
  });

  it("treats band bounds as inclusive", () => {
    const r: CiomsRubric = {
      provenance: "test",
      provisional: true,
      bands: [
        { label: "Low", min: 0, max: 3 },
        { label: "High", min: 4 },
      ],
    };
    expect(bandFor(3, r)?.label).toBe("Low");
    expect(bandFor(4, r)?.label).toBe("High");
  });
});

describe("proposing a verdict", () => {
  it("proposes positive when every ADR total is below the epidemiology total", () => {
    // The memo's own reasoning: 5 & 4 & 5 against 6.
    const out = proposeVerdict({ epidemiology: 6, effectiveness: 6, adrs: [5, 4, 5] });
    expect(out?.verdict).toBe("Positive Benefit-Risk Balance");
    expect(out?.reasoning).toContain("6");
  });

  it("does not propose positive when an ADR total reaches the epidemiology total", () => {
    const out = proposeVerdict({ epidemiology: 6, effectiveness: 6, adrs: [5, 6] });
    expect(out?.verdict).not.toBe("Positive Benefit-Risk Balance");
  });

  it("proposes nothing when no ADR has been scored", () => {
    expect(proposeVerdict({ epidemiology: 6, effectiveness: 6, adrs: [] })).toBeUndefined();
  });

  it("proposes nothing when the rubric carries no verdict rule", () => {
    const noRule: CiomsRubric = { provenance: "test", provisional: true, bands: [] };
    expect(proposeVerdict({ epidemiology: 6, effectiveness: 6, adrs: [5] }, noRule)).toBeUndefined();
  });
});
