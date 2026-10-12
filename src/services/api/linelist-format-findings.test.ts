import { describe, expect, it } from "vitest";
import { formatFindings } from "./linelist-format-findings";
import { isCorrectableRuleFinding } from "./linelist";

// Synthetic rows only. Column names are deliberately unlike any real form,
// so nothing here depends on one file's layout.
const mapping = {
  Ref: "case_id",
  "Pt no": "patient_identifier",
  Given: "vaccination_date",
  "Notified on": "report_date",
  "Reached state": "state_received_date",
  "Reached national": "national_received_date",
  Lot: "vaccine_batch",
  "Diluent lot": "diluent_batch",
  Codes: "reaction_code",
  Months: "age_months",
  Notes: "medical_history",
  Phone: "reporter_phone",
} as const;
const row = (over: Record<string, string> = {}) => ({
  Ref: "Q-77",
  "Pt no": "H-1",
  Given: "3/4/2025",
  "Notified on": "5/4/2025",
  "Reached state": "6/4/2025",
  "Reached national": "",
  Lot: "AB123",
  "Diluent lot": "77001",
  Codes: "3",
  Months: "4",
  Notes: "none",
  Phone: "08012345678",
  ...over,
});
const find = (rows: Record<string, string>[]) => formatFindings(Object.keys(row()), mapping, rows);

describe("report dates get the same format check as the vaccination date", () => {
  it("flags a malformed report date in any date column, as a correctable finding", () => {
    const out = find([row({ "Notified on": "5/4/20255" }), row({ "Reached state": "6/4//2025" })]);
    expect(out.map((i) => [i.row, i.column, i.code])).toEqual([
      [1, "Notified on", "INVALID_DATE_FORMAT"],
      [2, "Reached state", "INVALID_DATE_FORMAT"],
    ]);
    expect(out.every((i) => isCorrectableRuleFinding(i))).toBe(true);
  });
  it("leaves well-formed dates, blanks and placeholders alone", () => {
    expect(
      find([row({ "Notified on": "2025-04-05", "Reached state": "-", "Reached national": "" })]),
    ).toEqual([]);
  });
  it("does not re-check the vaccination date (the main rules already do)", () => {
    expect(find([row({ Given: "3/4/20255" })])).toEqual([]);
  });
  it("reports a date with words but no digits as unreadable only when it has a digit", () => {
    expect(find([row({ "Notified on": "unknown" })])).toEqual([]);
    expect(find([row({ "Notified on": "5-Apr" })]).map((i) => i.code)).toEqual([
      "INVALID_DATE_FORMAT",
    ]);
  });
});

describe("stray characters at the edge of a typed value", () => {
  it("flags a trailing spreadsheet text marker on a date, with the clean value", () => {
    const [i] = find([row({ Given: "3/4/2025'" })]);
    expect(i).toMatchObject({
      row: 1,
      column: "Given",
      code: "STRAY_CHARACTER",
      value: "3/4/2025'",
      fixable: true,
    });
    expect(i!.message).toContain('"3/4/2025"');
    expect(isCorrectableRuleFinding(i!)).toBe(true);
  });
  it("flags a leading colon or semicolon on a batch number", () => {
    const out = find([row({ "Diluent lot": ":77001" }), row({ Lot: "; AB123" })]);
    expect(out.map((i) => [i.row, i.column])).toEqual([
      [1, "Diluent lot"],
      [2, "Lot"],
    ]);
  });
  it("never touches identifiers, free text or phone numbers", () => {
    expect(
      find([row({ Ref: "Q-77'", "Pt no": ":H-1", Notes: "rash; fever,", Phone: "'08012345678" })]),
    ).toEqual([]);
  });
  it("does not report a leading minus, plus or decimal point — they change a value's meaning", () => {
    expect(find([row({ Months: "-4" }), row({ Lot: ".5" }), row({ Lot: "+AB123" })])).toEqual([]);
  });
  it("leaves a reaction code's trailing delimiter to the reaction rule", () => {
    expect(find([row({ Codes: "3," })])).toEqual([]);
  });
  it("removing the character must leave the letters and digits exactly as they were", () => {
    expect(find([row({ Lot: "AB'123" })])).toEqual([]);
  });
  it("works whatever the column order and with columns it does not know", () => {
    const headers = ["Extra", ...Object.keys(row()).reverse()];
    const out = formatFindings(headers, mapping, [{ Extra: "x'", ...row({ Lot: "AB123'" }) }]);
    expect(out.map((i) => i.column)).toEqual(["Lot"]);
  });
});
