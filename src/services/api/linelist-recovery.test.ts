import { describe, expect, it } from "vitest";
import { applyRecoveryProposal, generateRecoveryProposal, recoverRows } from "./linelist-recovery";

describe("semantic structural recovery", () => {
  it("reassigns a name-age swap when the values are clearly incompatible", () => {
    const row = {
      "Patient Name": "23",
      "Patient Age": "ADEOLA TEST",
      "Sex": "Female",
    };
    const mapping = {
      "Patient Name": "patient_identifier",
      "Patient Age": "age",
      "Sex": "sex",
    };

    const proposal = generateRecoveryProposal(row, mapping);
    expect(proposal).not.toBeNull();
    expect(proposal?.overallConfidence).toBe("high");
    expect(proposal?.moves.some((move) => move.targetField === "patient_identifier")).toBe(true);
    expect(proposal?.moves.some((move) => move.targetField === "age")).toBe(true);

    const repaired = applyRecoveryProposal(row, mapping, proposal!);
    expect(repaired).not.toBeNull();
    expect(repaired!["Patient Name"]).toBe("ADEOLA TEST");
    expect(repaired!["Patient Age"]).toBe("23");
  });

  it("does not rewrite case IDs or patient IDs automatically", () => {
    const row = {
      "Case ID": "CASE-123",
      "Patient Name": "23",
      "Patient Age": "ADEOLA TEST",
      "Patient MRN": "MRN-01",
    };
    const mapping = {
      "Case ID": "case_id",
      "Patient Name": "patient_identifier",
      "Patient Age": "age",
      "Patient MRN": "patient_id",
    };

    const proposal = generateRecoveryProposal(row, mapping);
    expect(proposal).not.toBeNull();
    expect(proposal?.moves.some((move) => move.targetField === "case_id")).toBe(false);
    expect(proposal?.moves.some((move) => move.targetField === "patient_id")).toBe(false);
  });

  it("rejects a proposal when a row value is not actually present in the source row", () => {
    const row = {
      "Patient Name": "Alice",
      "Patient Age": "32",
    };
    const mapping = {
      "Patient Name": "patient_identifier",
      "Patient Age": "age",
    };

    const proposal = generateRecoveryProposal(row, mapping);
    expect(proposal).toBeNull();
    const repaired = applyRecoveryProposal(row, mapping, {
      rowIndex: 0,
      moves: [{
        sourceColumn: "Patient Name",
        sourceValue: "Bob",
        targetField: "patient_identifier",
        reason: "invented",
        confidence: "high",
        fixerType: "ai",
      }],
      overallConfidence: "high",
    });
    expect(repaired).toBeNull();
  });

  it("leaves a row alone when the data is already consistent", () => {
    const rows = [{
      "Patient Name": "ADEOLA TEST",
      "Patient Age": "23",
      "Sex": "Female",
    }];
    const mapping = {
      "Patient Name": "patient_identifier",
      "Patient Age": "age",
      "Sex": "sex",
    };

    expect(generateRecoveryProposal(rows[0]!, mapping)).toBeNull();
    expect(recoverRows(["Patient Name", "Patient Age", "Sex"], mapping, rows).applied).toBe(0);
  });
});
