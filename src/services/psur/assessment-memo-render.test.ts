import { describe, expect, it } from "vitest";
import { renderAssessmentMemoText } from "../api/psur";
import type { AssessmentMemoModel } from "@/types/pv";

function model(overrides: Partial<AssessmentMemoModel> = {}): AssessmentMemoModel {
  return {
    referenceNumber: "NAFDAC/PV/GCIOMS/455/III",
    memoDate: "2026-09-17",
    to: "D (Drug R&R)",
    from: "D (PV)",
    subject: "Submission of Periodic Safety Update Report (PSUR) for Tramadol-50",
    productNameAndStrength: "Tramadol-50 (Tramadol 50mg) Capsule",
    signatory: "Director (PV)",
    signatoryTitle: "Director (PV)",
    locationAddress: "CHQ Abuja",
    mahName: "Example Pharma Ltd",
    criteria: [
      {
        id: "PRODUCT_IDENTITY",
        number: 1,
        label: "Product Identity",
        remarks: "Tramadol",
        citations: [],
        unestablished: false,
      },
      {
        id: "RSI_CHANGES",
        number: 7,
        label: "Changes to reference safety information",
        remarks: "RSI updated for the warfarin interaction.",
        citations: ["https://example.test/dsu"],
        unestablished: false,
      },
      {
        id: "RELEVANT_STUDIES",
        number: 10,
        label: "Studies containing relevant safety information",
        remarks: "Not stated in the submission",
        citations: [],
        unestablished: true,
      },
    ],
    matrix: {
      epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
      effectivenessOfProduct: { seriousness: 3, duration: 3, incidence: 0 },
      adrs: [{ reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } }],
    },
    totals: { epidemiology: 6, effectiveness: 6, adrs: [4] },
    bandLabel: "Medium",
    benefitRiskVerdict: "Positive Benefit-Risk Balance",
    analysisOfMatrix: "The product has a medium efficacy score of 6.",
    conclusion: "The product possesses a Positive Benefit-Risk Balance.",
    provisionalRubricUsed: true,
    ...overrides,
  };
}

describe("the rendered memo", () => {
  it("opens with the memo header and the reference", () => {
    const out = renderAssessmentMemoText(model());
    expect(out).toContain("INTERNAL MEMO");
    expect(out).toContain("NAFDAC/PV/GCIOMS/455/III");
    expect(out).toContain("To:");
    expect(out).toContain("D (Drug R&R)");
  });

  it("separates the memo from the report", () => {
    // One document, two parts — the supplied example uses a page break.
    expect(renderAssessmentMemoText(model())).toContain("THE REPORT OF THE REVIEW");
  });

  it("prints each criterion with its number and remarks", () => {
    const out = renderAssessmentMemoText(model());
    expect(out).toContain("1. Product Identity");
    expect(out).toContain("Tramadol");
    expect(out).toContain("RSI updated for the warfarin interaction.");
  });

  it("prints the citation behind a researched criterion", () => {
    expect(renderAssessmentMemoText(model())).toContain("https://example.test/dsu");
  });

  it("prints the matrix totals", () => {
    const out = renderAssessmentMemoText(model());
    expect(out).toContain("Epidemiology of Disease");
    expect(out).toContain("Seizures");
  });

  it("says a provisional rubric was used", () => {
    expect(renderAssessmentMemoText(model()).toLowerCase()).toContain("provisional");
  });

  it("does not claim a band or verdict the assessor never confirmed", () => {
    const out = renderAssessmentMemoText(
      model({ bandLabel: "", benefitRiskVerdict: "", analysisOfMatrix: "", conclusion: "" }),
    );
    expect(out).not.toContain("Positive Benefit-Risk Balance");
    expect(out).not.toContain("Medium");
  });

  it("writes the score comparison from the totals, so it cannot go stale", () => {
    // A Peer Reviewer may change a score after the analysis was written; the
    // sentence is rebuilt from the totals every time the memo is produced.
    const out = renderAssessmentMemoText(
      model({
        totals: { epidemiology: 6, effectiveness: 6, adrs: [5, 4, 5] },
        matrix: {
          epidemiologyOfDisease: { seriousness: 2, duration: 2, incidence: 2 },
          effectivenessOfProduct: { seriousness: 3, duration: 3, incidence: 0 },
          adrs: [
            { reaction: "Respiratory Depression", scores: { seriousness: 3, duration: 1, incidence: 1 } },
            { reaction: "Seizures", scores: { seriousness: 2, duration: 1, incidence: 1 } },
            { reaction: "Serotonin Syndrome", scores: { seriousness: 3, duration: 1, incidence: 1 } },
          ],
        },
      }),
    );
    // The supplied memo's own sentence, reproduced from its own numbers.
    expect(out).toContain(
      "The critical adverse drug reaction risk profile is less than the epidemiology of the " +
        "disease itself; a score of 5 & 4 & 5, respectively, vs. a score of 6.",
    );
    expect(out).toContain("The product has a medium efficacy score of 6.");
    expect(out).toContain("5 & 4 & 5");
  });

  it("says 'not less than' when a reaction reaches the disease's score", () => {
    const out = renderAssessmentMemoText(
      model({ totals: { epidemiology: 6, effectiveness: 6, adrs: [6] } }),
    );
    expect(out).toContain("is not less than the epidemiology of the disease itself; a score of 6 vs.");
  });

  it("shows an unestablished criterion as not stated, never as a blank", () => {
    const out = renderAssessmentMemoText(model());
    expect(out).toContain("Not stated in the submission");
  });
});
