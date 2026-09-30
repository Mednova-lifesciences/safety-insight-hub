import { describe, expect, it } from "vitest";
import { generateRecoveryProposal } from "./linelist-recovery";

/**
 * Identifiers are never a move SOURCE.
 *
 * Recovery already refused to write INTO case_id, patient_id and
 * previous_case_id. It did not refuse to read OUT of them, and that was
 * the more dangerous direction once a move began clearing the column it
 * came from: a letters-only case id ("OGAEFI") is name-shaped, so it was
 * proposed as the patient's name at high confidence, and C.1.1 — the one
 * value a regulator and a reporting facility use to refer to the same
 * case — was blanked.
 *
 * The principle: an identifier is never a value that wandered. A case id
 * is the case id even when it looks like something else.
 */

const MAPPING: Record<string, string> = {
  "Case ID": "case_id",
  Patient: "patient_identifier",
  Age: "age",
  Sex: "sex",
  "Hospital Number": "patient_id",
};

describe("a protected identifier is never read out of", () => {
  it("does not offer a name-shaped case id as the patient's name", () => {
    const proposal = generateRecoveryProposal(
      { "Case ID": "OGAEFI", Patient: "3", Sex: "F" },
      MAPPING,
    );
    // The "3" in Patient is an age and the Age column is empty, so
    // rescuing it there is correct and expected. What must NOT happen is
    // the case id being offered as the patient's name — which would also
    // have emptied the Case ID column, since a move clears its origin.
    const sources = (proposal?.moves ?? []).map((m) => m.sourceColumn);
    expect(sources).not.toContain("Case ID");
    expect((proposal?.moves ?? []).map((m) => m.targetField)).not.toContain("patient_identifier");
  });

  it("refuses entirely when the case id is the only candidate", () => {
    // Nothing else in the row can fill the broken patient column, and the
    // case id is barred, so there is no proposal at all.
    expect(
      generateRecoveryProposal(
        { "Case ID": "OGAEFI", Patient: "3", Sex: "F" },
        { "Case ID": "case_id", Patient: "patient_identifier", Sex: "sex" },
      ),
    ).toBeNull();
  });

  it("does not offer an age-shaped hospital number as the age", () => {
    const proposal = generateRecoveryProposal(
      { "Case ID": "OG-901", Patient: "A.A.", Age: "xx", Sex: "F", "Hospital Number": "123" },
      MAPPING,
    );
    const sources = (proposal?.moves ?? []).map((m) => m.sourceColumn);
    expect(sources).not.toContain("Hospital Number");
  });

  it("does not relocate a case id that is itself holding something odd", () => {
    // case_id's own compatibility test is deliberately loose, but if a
    // case id column ever does read as broken, its value must still not
    // be pushed into another field and the column emptied.
    const proposal = generateRecoveryProposal(
      { "Case ID": "3", Patient: "A.A.", Age: "", Sex: "F" },
      MAPPING,
    );
    const sources = (proposal?.moves ?? []).map((m) => m.sourceColumn);
    expect(sources).not.toContain("Case ID");
  });

  it("still repairs a genuine swap between unprotected columns", () => {
    // The guard must not disable ordinary recovery.
    const proposal = generateRecoveryProposal(
      { "Case ID": "OG-901", Patient: "3", Age: "A.A.", Sex: "F" },
      MAPPING,
    );
    expect(proposal?.moves.map((m) => [m.sourceColumn, m.targetField]).sort()).toEqual([
      ["Age", "patient_identifier"],
      ["Patient", "age"],
    ]);
  });

  it("leaves a clean row entirely alone", () => {
    expect(
      generateRecoveryProposal(
        {
          "Case ID": "OG-901",
          Patient: "A.A.",
          Age: "3",
          Sex: "F",
          "Hospital Number": "OGH/2026/04130",
        },
        MAPPING,
      ),
    ).toBeNull();
  });
});
