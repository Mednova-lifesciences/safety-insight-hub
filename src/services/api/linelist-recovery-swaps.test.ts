import { describe, expect, it } from "vitest";
import { generateRecoveryProposal } from "./linelist-recovery";

/**
 * Transposed values — two columns holding each other's data.
 *
 * Distinct from a column SHIFT, where a whole run of values slides one
 * column sideways. A swap is the easier case and the engine handles it:
 * both values are still in the row, each one simply fits the other's
 * field. A shift that pushed a value out of the row entirely is the hard
 * case, and the right answer there is to recover nothing.
 *
 * This is a DETERMINISTIC value-shape matcher, not the AI. Every move it
 * proposes carries fixerType "deterministic". The AI column mapper works
 * at the header level; the AI row reviewer flags
 * STRUCTURAL_COLUMN_SHIFT. This is a third, separate mechanism.
 */

const MAPPING: Record<string, string> = {
  "Case ID": "case_id",
  Patient: "patient_identifier",
  Age: "age",
  Sex: "sex",
  "Hospital Number": "patient_id",
  "Date of Onset": "onset_date",
};

describe("two columns holding each other's values", () => {
  it("proposes both halves of an age/patient swap", () => {
    const proposal = generateRecoveryProposal(
      {
        "Case ID": "OG-901",
        Patient: "3",
        Age: "A.A.",
        Sex: "F",
        "Hospital Number": "OGH/2026/04130",
        "Date of Onset": "2026-08-23",
      },
      MAPPING,
    );
    expect(proposal?.overallConfidence).toBe("high");
    expect(
      proposal?.moves.map((m) => [m.sourceColumn, m.targetField, m.sourceValue]).sort(),
    ).toEqual([
      ["Age", "patient_identifier", "A.A."],
      ["Patient", "age", "3"],
    ]);
  });

  it("proposes both halves of an age/sex swap", () => {
    const proposal = generateRecoveryProposal(
      { "Case ID": "OG-903", Patient: "B.O.", Age: "F", Sex: "3", "Date of Onset": "2026-08-23" },
      MAPPING,
    );
    expect(proposal?.moves.map((m) => [m.sourceColumn, m.targetField]).sort()).toEqual([
      ["Age", "sex"],
      ["Sex", "age"],
    ]);
  });

  it("marks the moves deterministic, not AI-inferred", () => {
    const proposal = generateRecoveryProposal(
      { "Case ID": "OG-901", Patient: "3", Age: "A.A.", Sex: "F" },
      MAPPING,
    );
    for (const move of proposal!.moves) expect(move.fixerType).toBe("deterministic");
  });
});

describe("what it deliberately will not do", () => {
  it("invents no age, but still rescues the date that displaced it", () => {
    // A date landed in Age and the real age is nowhere in the row. Two
    // separate obligations: do not invent an age (there is nothing to
    // pull), and do not destroy the date (its own column is sitting
    // empty). Pull-only recovery failed the second one — it either left
    // the date stranded or, if something could be pulled into Age,
    // overwrote it.
    const proposal = generateRecoveryProposal(
      {
        "Case ID": "OG-902",
        Patient: "A.A.",
        Age: "2026-08-23",
        Sex: "F",
        "Date of Onset": "",
      },
      MAPPING,
    );
    expect(proposal?.moves).toEqual([
      expect.objectContaining({
        sourceColumn: "Age",
        targetField: "onset_date",
        sourceValue: "2026-08-23",
      }),
    ]);
    // Nothing was invented for age.
    expect(proposal?.moves.some((m) => m.targetField === "age")).toBe(false);
  });

  it("rescues the displaced value AND fills the column it vacated", () => {
    // The case that used to lose data outright: the date in Age would be
    // overwritten by the pulled age, and never written anywhere else.
    const proposal = generateRecoveryProposal(
      {
        "Case ID": "OG-905",
        Patient: "3",
        Age: "2026-08-23",
        Sex: "F",
        "Date of Onset": "",
      },
      MAPPING,
    );
    expect(proposal?.moves.map((m) => [m.sourceColumn, m.targetField]).sort()).toEqual([
      ["Age", "onset_date"],
      ["Patient", "age"],
    ]);
  });

  it("does not push a value that fits several fields equally", () => {
    // A bare date fits onset_date, vaccination_date and report_date. With
    // more than one of them mapped there is no single right answer, and
    // guessing one would put a vaccination date in the onset column.
    const ambiguous: Record<string, string> = {
      ...MAPPING,
      "Date of Vaccination": "vaccination_date",
      "Report Date": "report_date",
    };
    const proposal = generateRecoveryProposal(
      {
        "Case ID": "OG-907",
        Patient: "A.A.",
        Age: "2026-08-23",
        Sex: "F",
        "Date of Onset": "",
        "Date of Vaccination": "",
        "Report Date": "",
      },
      ambiguous,
    );
    expect(proposal).toBeNull();
  });

  it("never pushes onto a column already holding a valid value", () => {
    const proposal = generateRecoveryProposal(
      {
        "Case ID": "OG-908",
        Patient: "A.A.",
        Age: "2026-08-23",
        Sex: "F",
        "Date of Onset": "2026-08-25",
      },
      MAPPING,
    );
    // Date of Onset already holds a real onset date; the stray value in
    // Age is a review item, not a licence to overwrite it.
    expect(proposal).toBeNull();
  });

  it("never moves a value into a case id or a patient record number", () => {
    // isProtectedIdentifier. Rewriting an identifier by shape-matching is
    // how a case gets attributed to the wrong patient, so recovery is
    // barred from those fields entirely even when a value looks like it
    // would fit.
    const proposal = generateRecoveryProposal(
      {
        "Case ID": "3",
        Patient: "A.A.",
        Age: "OGH/2026/04130",
        "Hospital Number": "F",
        Sex: "M",
      },
      MAPPING,
    );
    const targets = (proposal?.moves ?? []).map((m) => m.targetField);
    expect(targets).not.toContain("case_id");
    expect(targets).not.toContain("patient_id");
  });

  it("treats an empty column as nothing to recover from", () => {
    const proposal = generateRecoveryProposal(
      { "Case ID": "OG-904", Patient: "", Age: "A.A.", Sex: "F" },
      MAPPING,
    );
    // "A.A." in Age is still wrong, but Patient is blank, so there is no
    // pair to transpose — and a blank is never treated as a source value.
    expect(proposal?.moves.some((m) => m.sourceValue === "")).toBeFalsy();
  });
});
