import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildFixedCsv, exportFilename, spreadsheetSafe } from "./linelist-fixed-csv";

// The cleaned-CSV contract, checked by parsing the output with a
// standards-compliant CSV reader (SheetJS, raw text — no type coercion).
const parse = (csv: string) =>
  XLSX.utils.sheet_to_json<string[]>(
    XLSX.read(csv, { type: "string", raw: true }).Sheets["Sheet1"]!,
    {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    },
  );

const columns = ["Case ID", "Patient No", "Dose", "Note", "Phone", "Empty", "Calc"];
const rows = [
  {
    "Case ID": "001234",
    "Patient No": " HN-07 ",
    Dose: "0.5ML",
    Note: 'a, "quoted" note\nwith newline',
    Phone: "+2348031234567",
    Empty: "",
    Calc: "=1+1",
  },
  {
    "Case ID": "000777",
    "Patient No": "HN-08",
    Dose: "1st",
    Note: "Ünïcode ✓ 中文",
    Phone: "08031234567",
    Empty: "",
    Calc: "-",
  },
  {
    "Case ID": "A-3",
    "Patient No": "N/A",
    Dose: "0",
    Note: "NIL",
    Phone: "",
    Empty: "",
    Calc: "@SUM(A1)",
  },
];
const csv = (over: Partial<Parameters<typeof buildFixedCsv>[0]> = {}) =>
  buildFixedCsv({
    columns,
    rows,
    changeLog: [],
    decisions: [],
    issues: [],
    unresolved: [],
    preservedSourceText: [],
    ...over,
  });

describe("the cleaned CSV preserves every value and the structure", () => {
  const out = parse(csv());
  it("keeps the header (original columns first), row count and row order", () => {
    expect(out[0]!.slice(0, columns.length)).toEqual(columns);
    expect(out.slice(1).map((r) => r[0])).toEqual(["001234", "000777", "A-3"]);
  });
  it("round-trips identifiers with leading zeros and spaces exactly", () => {
    expect(out[1]![0]).toBe("001234");
    expect(out[2]![0]).toBe("000777");
    expect(out[1]![1]).toBe(" HN-07 ");
  });
  it("round-trips quotes, commas, embedded newlines, Unicode, empties and literal placeholders", () => {
    expect(out[1]![3]).toBe('a, "quoted" note\nwith newline');
    expect(out[2]![3]).toBe("Ünïcode ✓ 中文");
    expect(out[1]![5]).toBe("");
    expect([out[3]![1], out[3]![2], out[3]![3]]).toEqual(["N/A", "0", "NIL"]);
  });
  it("leaves numbers, phone numbers and a lone dash as they are", () => {
    expect(out[1]![4]).toBe("+2348031234567");
    expect(out[2]![4]).toBe("08031234567");
    expect(out[2]![6]).toBe("-");
  });
  it("neutralises cells a spreadsheet would run as a formula, with a leading apostrophe", () => {
    expect(out[1]![6]).toBe("'=1+1");
    expect(out[3]![6]).toBe("'@SUM(A1)");
  });
  it("writes the source header text when it differs from the column key", () => {
    const withHeader = parse(csv({ headerText: { "Patient No": " Patient No " } }));
    expect(withHeader[0]![1]).toBe(" Patient No ");
  });
});

describe("formula policy", () => {
  it.each([["=A1"], ["+cmd"], ["-x+1"], ["@x"], ["\tTAB"]])("%j is neutralised", (v) =>
    expect(spreadsheetSafe(v)).toBe(`'${v}`),
  );
  it.each([
    ["-"],
    ["-4"],
    ["+234 803 123 4567"],
    ["0.5"],
    ["2026-02-03"],
    ["(080) 123"],
    ["text"],
    [""],
  ])("%j is unchanged", (v) => expect(spreadsheetSafe(v)).toBe(v));
});

describe("export filename", () => {
  it.each([
    ["2026, ONDO STATE AEFI.xlsx", "2026_ONDO_STATE_AEFI-fixed.csv"],
    ["../../etc/passwd.csv", "passwd-fixed.csv"],
    ['a<b>:"c|d?*.csv', "a_b_c_d-fixed.csv"],
    [".csv", "line-list-fixed.csv"],
  ])("%j → %j", (source, want) => expect(exportFilename(source, "fixed")).toBe(want));
  it("is never longer than 100 characters", () =>
    expect(exportFilename("x".repeat(300) + ".csv", "fixed").length).toBeLessThanOrEqual(100));
});
