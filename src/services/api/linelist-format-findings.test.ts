import { describe, expect, it } from "vitest";
import { formatFindings } from "./linelist-format-findings";
import { routeFinding } from "./linelist-fix-routing";

const ctx = {
  keptRows: new Set([1, 2, 3]),
  changeLog: [],
  recoveryCells: new Set<string>(),
  mapping: {},
};
const offered = (i: Parameters<typeof routeFinding>[0]) =>
  ["deterministic", "sent_to_ai"].includes(routeFinding(i, ctx));

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
    expect(out.every((i) => offered(i))).toBe(true);
  });
  it("leaves well-formed dates, blanks and placeholders alone", () => {
    expect(
      find([row({ "Notified on": "2025-04-05", "Reached state": "-", "Reached national": "" })]),
    ).toEqual([]);
  });
  it("does not re-check the vaccination date's format (the main rules do), but a year typo gets the rule's suggestion", () => {
    expect(find([row({ Given: "3/4/2025x" })])).toEqual([]);
    expect(find([row({ Given: "3/4/20255" })])).toEqual([
      expect.objectContaining({
        code: "INVALID_DATE_FORMAT",
        suggestion: { value: "3/4/2025", rule: "date-year-repeated-digit", version: "1" },
      }),
    ]);
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
    expect(offered(i!)).toBe(true);
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
  it("settles a reaction code's trailing delimiter by rule, with the rule named", () => {
    const [i] = find([row({ Codes: "3," })]);
    expect(i).toMatchObject({
      code: "REACTION_CODE_DELIMITER",
      suggestion: { value: "3", rule: "code-list-delimiters", version: "1" },
    });
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

describe("findings carry the rule's suggestion; flags never do", () => {
  const more = {
    ...mapping,
    Dose: "dose",
    Onset: "onset_interval",
    Mobile: "reporter_phone",
  } as Record<string, string>;
  const r = (over: Record<string, string>) => ({
    ...row(),
    Dose: "1st",
    Onset: "2 hours",
    Mobile: "08031234567",
    ...over,
  });
  const run = (rows: Record<string, string>[], country?: string) =>
    formatFindings([...Object.keys(row()), "Dose", "Onset", "Mobile"], more, rows, country);
  it("a misspelt interval unit is settled by rule", () => {
    expect(run([r({ Onset: "10 MINITES" })])).toEqual([
      expect.objectContaining({
        code: "INTERVAL_UNIT_TYPO",
        fixable: true,
        suggestion: { value: "10 MINUTES", rule: "interval-unit-spelling", version: "1" },
      }),
    ]);
  });
  it("an unseen misspelling uses the same dictionary, and an unknown word is not guessed", () => {
    expect(run([r({ Onset: "3 HOURES" })])[0]?.suggestion?.value).toBe("3 HOURS");
    expect(run([r({ Onset: "2 dyas" })])).toEqual([]);
  });
  it.each([
    ["10", "DOSE_IMPLAUSIBLE"],
    ["5 mL", "DOSE_IMPLAUSIBLE"],
    ["0.5MI", "DOSE_UNIT_UNRECOGNISED"],
  ])("dose %j is flagged %s, never corrected", (dose, code) => {
    const [i] = run([r({ Dose: dose })]);
    expect(i).toMatchObject({ code, fixable: false });
    expect(i!.suggestion).toBeUndefined();
  });
  it.each([["1st"], ["0.5ml"], ["0.5 mL"], ["3"], ["1 dose"]])("dose %j is fine", (dose) =>
    expect(run([r({ Dose: dose })])).toEqual([]),
  );
  it("a phone that lost its leading 0 is flagged only where the form's country fixes the format", () => {
    const [i] = run([r({ Mobile: "8031234567" })], "NG");
    expect(i).toMatchObject({ code: "PHONE_LEADING_ZERO_MISSING", fixable: false });
    expect(i!.message).toContain("08031234567");
    expect(run([r({ Mobile: "8031234567" })])).toEqual([]);
    expect(run([r({ Mobile: "+2348031234567" })], "NG")).toEqual([]);
    expect(run([r({ Mobile: "1234567890" })], "NG")).toEqual([]);
  });
});

describe("codes joined by a word are flagged, never rewritten", () => {
  it.each([["12 AND 20"], ["2 and 5"], ["3 OR 4"], ["2 + 5"]])("%j", (codes) => {
    const out = formatFindings(Object.keys(row()), mapping, [row({ Codes: codes })]);
    expect(out).toEqual([
      expect.objectContaining({ code: "REACTION_CODE_DELIMITER_WORD", fixable: false }),
    ]);
    expect(out[0]!.suggestion).toBeUndefined();
  });
});

describe("detection: impossible dates, unit mismatches and likely misspellings (flags only)", () => {
  const cols = {
    ...mapping,
    Age: "age",
    Vaccine: "product",
    Role: "reporter_designation",
  } as Record<string, string>;
  const headers = [...Object.keys(row()), "Age", "Vaccine", "Role"];
  const base2 = (over: Record<string, string> = {}) => ({
    ...row(),
    Age: "4",
    Vaccine: "MEASLES RUBELLA",
    Role: "Nurse",
    ...over,
  });
  const codes = (rows: Record<string, string>[]) =>
    formatFindings(headers, cols, rows).map((i) => [i.row, i.column, i.code, i.fixable]);
  it.each([["31/04/2025"], ["30/02/2026"], ["2025-02-30"], ["31.06.2025"]])(
    "impossible date %j is flagged, never corrected",
    (d) => expect(codes([base2({ Given: d })])).toEqual([[1, "Given", "IMPOSSIBLE_DATE", false]]),
  );
  it.each([["29/02/2024"], ["30/04/2025"], ["12/31/2025"], ["2025-12-31"], ["3/4/25"]])(
    "real date %j is not flagged",
    (d) => expect(codes([base2({ Given: d })])).toEqual([]),
  );
  it.each([["18 months"], ["3 weeks"], ["10 days"], ["6 mths"]])(
    "%j in a years column is flagged",
    (a) => expect(codes([base2({ Age: a })])).toEqual([[1, "Age", "AGE_UNIT_MISMATCH", false]]),
  );
  it.each([["4"], ["4 years"], ["97"], ["0.5"]])("%j in a years column is no unit mismatch", (a) =>
    expect(codes([base2({ Age: a })]).filter((c) => c[2] === "AGE_UNIT_MISMATCH")).toEqual([]),
  );
  it("a word used once, one letter from a word the column uses often, is flagged with the evidence", () => {
    const rows = [
      ...Array.from({ length: 12 }, () => base2()),
      base2({ Vaccine: "MEASELES RUBELLA" }),
    ];
    const out = formatFindings(headers, cols, rows).filter(
      (i) => i.code === "POSSIBLE_MISSPELLING",
    );
    expect(out).toEqual([expect.objectContaining({ row: 13, column: "Vaccine", fixable: false })]);
    expect(out[0]!.message).toContain("MEASLES");
    expect(out[0]!.suggestion).toBeUndefined();
  });
  it("a rare but different word is not flagged, nor is a word the column does not use often", () => {
    const rows = [
      ...Array.from({ length: 12 }, () => base2()),
      base2({ Vaccine: "YELLOW FEVER" }),
      base2({ Vaccine: "MEASLESS" }),
    ];
    expect(
      formatFindings(headers, cols, rows)
        .filter((i) => i.code === "POSSIBLE_MISSPELLING")
        .map((i) => i.row),
    ).toEqual([14]);
    const few = [base2(), base2(), base2({ Vaccine: "MEASELES RUBELLA" })];
    expect(
      formatFindings(headers, cols, few).filter((i) => i.code === "POSSIBLE_MISSPELLING"),
    ).toEqual([]);
  });
  it("never checks spelling in free text or identifiers", () => {
    const rows = [
      ...Array.from({ length: 12 }, () => base2({ Notes: "patient stable" })),
      base2({ Notes: "patient stabel", Ref: "Q-78" }),
    ];
    expect(
      formatFindings(headers, cols, rows).filter((i) => i.code === "POSSIBLE_MISSPELLING"),
    ).toEqual([]);
  });
});
