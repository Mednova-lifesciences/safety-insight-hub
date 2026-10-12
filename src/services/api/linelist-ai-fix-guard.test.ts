import { describe, expect, it } from "vitest";
import { acceptedAiCorrections, isDerivedValue } from "./linelist-ai-fix-guard";

/**
 * Whatever the AI answers, Fix only applies a correction the data already
 * supports. Found in an audit: an invented date, an invented age and a
 * changed record number were all applied, a refused move still emptied
 * its source cell, and two conflicting answers for one cell were both
 * applied, the last silently winning.
 */

describe("a value the AI may write is derived from what is there", () => {
  it.each([
    ["02/02/2026'", "02/02/2026", "stray character removed"],
    ["8.19.21", "8, 19, 21", "separators changed"],
    ["28 PAIN AT THE INJECTION SITE", "28", "the leading part kept"],
    ["10 MINITES", "10 MINUTES", "a letter typo"],
    ["1at", "1st", "a letter typo"],
    ["28/1/20226", "28/1/2026", "a repeated digit dropped"],
    ["10/08/2026", "2026-08-10", "day-first date written as ISO"],
    ["  fever ", "Fever", "spaces and case"],
  ])("%s → %s (%s)", (from, to) => {
    expect(isDerivedValue(from, to, [])).toBe(true);
  });

  it.each([
    ["02/02/2026'", "15/09/2019", "an invented date"],
    ["4/2/26", "7", "an invented age"],
    ["4/2/26", "4/2/25", "a digit changed — a different year"],
    ["1/2/26", "2/1/26", "day and month swapped"],
    ["MALE", "HN0000", "an invented record number"],
    ["5", "6", "a short value changed"],
  ])("%s → %s is refused (%s)", (from, to) => {
    expect(isDerivedValue(from, to, [])).toBe(false);
  });

  it("a value another cell of the same row holds may be written (a swap)", () => {
    expect(isDerivedValue("3", "MALE", ["MALE", "3", "4/2/26"])).toBe(true);
  });
});

describe("which AI corrections Fix applies", () => {
  const mapping = {
    ID: "case_id",
    "Hospital No": "patient_id",
    Sex: "sex",
    Age: "age",
    "Vacc date": "vaccination_date",
    "Report date": "report_date",
  };
  const rows = [
    {
      ID: "T-1",
      "Hospital No": "MALE",
      Sex: "3",
      Age: "4/2/26",
      "Vacc date": "",
      "Report date": "",
    },
  ];
  const asked = [
    { row: 1, column: "Sex" },
    { row: 1, column: "Age" },
    { row: 1, column: "Hospital No" },
  ];
  // Two date columns are empty in this row; the file-wide fill rates show
  // the vaccination date is the one normally filled.
  const fill = { "Vacc date": 0.95, "Report date": 0.3 };
  const run = (
    corrections: { row: number; column: string; new_value: string; reason?: string }[],
  ) =>
    acceptedAiCorrections(
      corrections.map((c) => ({ reason: "r", ...c })),
      asked,
      rows,
      mapping,
      "ai-move",
      fill,
    );

  it("never writes an invented value", () => {
    const r = run([{ row: 1, column: "Age", new_value: "7" }]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0]).toMatchObject({ row: 1, column: "Age" });
  });

  it("never touches the case ID or the patient record number", () => {
    const r = run([
      { row: 1, column: "Hospital No", new_value: "MALE " },
      { row: 1, column: "ID", new_value: "T-1" },
    ]);
    expect(r.accepted).toEqual([]);
  });

  it("applies a move into an empty cell, both halves", () => {
    const r = run([
      { row: 1, column: "Vacc date", new_value: "4/2/26" },
      { row: 1, column: "Age", new_value: "" },
    ]);
    expect(r.accepted.map((c) => c.column).sort()).toEqual(["Age", "Vacc date"]);
    expect(new Set(r.accepted.map((c) => c.group)).size).toBe(1);
  });

  it("does not empty a cell when its move is refused", () => {
    // The destination value was reformatted, so the move is refused — and
    // the source must keep its value, or the date is lost.
    const r = run([
      { row: 1, column: "Vacc date", new_value: "2026-02-04" },
      { row: 1, column: "Age", new_value: "" },
    ]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((c) => c.column).sort()).toEqual(["Age", "Vacc date"]);
  });

  it("does not empty a cell on its own", () => {
    expect(run([{ row: 1, column: "Sex", new_value: "" }]).accepted).toEqual([]);
  });

  it("changes nothing when the AI gives two different answers for one cell", () => {
    const r = run([
      { row: 1, column: "Sex", new_value: "3 " },
      { row: 1, column: "Sex", new_value: "MALE" },
    ]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0]!.reason).toMatch(/conflicting/i);
  });

  it("applies one of two identical answers", () => {
    const r = run([
      { row: 1, column: "Sex", new_value: "3" },
      { row: 1, column: "Sex", new_value: "3" },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.accepted.length).toBeLessThanOrEqual(1);
  });

  it("refuses a cell it was not asked about", () => {
    expect(run([{ row: 1, column: "Report date", new_value: "4/2/26" }]).accepted).toEqual([]);
  });
});
