import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mapColumnsByKeywords } from "./tabular-parse";
import { parseTabularFile } from "./tabular-parse";
import {
  FIELD_KEYWORDS,
  mergeFindings,
  runValidation,
  type ParsedRow,
  type TargetField,
} from "./linelist";
import type { LineListIssue } from "@/types/pv";

/** Same in-memory-xlsx helper as tabular-parse.test.ts, duplicated here
 *  rather than shared so this file can be read on its own. */
function xlsxFile(rows: (string | number)[][], name = "test.xlsx"): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const buffer = new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
  return new File([buffer], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function issue(overrides: Partial<LineListIssue>): LineListIssue {
  return {
    row: 1,
    column: "Reporter Phone Number",
    severity: "HIGH",
    confidence: "HIGH",
    code: "TEST_CODE",
    message: "test",
    value: null,
    source: "rule",
    fixable: false,
    ...overrides,
  };
}

describe("runValidation — document structure never reaches the rule engine", () => {
  it("real Ondo-style letterhead file: no NO_COLUMNS_MAPPED, no spurious column-shift from title rows", async () => {
    const file = xlsxFile([
      ["FEDERAL REPUBLIC OF NIGERIA"],
      ["FEDERAL MINISTRY OF HEALTH"],
      ["AEFI LINE LIST FORM — ONDO STATE"],
      ["Reporting period: February 2026"],
      [],
      [
        "S/N",
        "Patient Identifier",
        "Sex",
        "Age",
        "Suspect Product",
        "Reaction/Event",
        "Onset Date",
        "Seriousness",
        "Outcome",
        "Vaccine Batch No",
        "Dose",
        "Reporter Phone Number",
        "Reporter Designation",
      ],
      [
        1,
        "P001",
        "F",
        2,
        "MR",
        "Fever",
        "2026-02-03",
        "NON SERIOUS",
        "Recovered",
        "0125N084A",
        "1st",
        "08012345678",
        "Nurse",
      ],
      [
        2,
        "P002",
        "M",
        1,
        "OPV",
        "Rash",
        "2026-02-04",
        "NON SERIOUS",
        "Recovering",
        "0125N084B",
        "2nd",
        "08023456789",
        "CHEW",
      ],
    ]);
    const parsed = await parseTabularFile(file);
    const mapping = mapColumnsByKeywords(parsed.headers, FIELD_KEYWORDS);
    const parsedRows: ParsedRow[] = parsed.rows.map((row) => {
      const r: ParsedRow = {};
      parsed.headers.forEach((h, i) => {
        const field = mapping[h];
        if (field && row[i]) r[field] = row[i];
      });
      return r;
    });

    const issues = runValidation(parsed.headers, mapping, parsedRows);

    expect(issues.some((i) => i.code === "NO_COLUMNS_MAPPED")).toBe(false);
    expect(issues.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toBe(false);
    expect(issues.some((i) => i.code === "FIELD_CONTENT_MISMATCH")).toBe(false);
    // The letterhead text must never surface as a finding's value/message.
    expect(issues.every((i) => !JSON.stringify(i).includes("FEDERAL REPUBLIC"))).toBe(true);
  });

  it("an unmapped/unknown column is never treated as a shifted canonical column", () => {
    // "Remarks / Comments" deliberately has no entry — mapColumns() never
    // maps it to any canonical field, so it's absent here exactly as it
    // would be after a real mapColumnsByKeywords() call.
    const mapping: Record<string, TargetField> = { "Patient Name": "patient_identifier" };
    const rows: ParsedRow[] = [
      { patient_identifier: "P1", product: "MR", reaction: "Fever" },
      { patient_identifier: "P2", product: "OPV", reaction: "Rash" },
      { patient_identifier: "P3", product: "MR", reaction: "Fever" },
      { patient_identifier: "P4", product: "OPV", reaction: "Rash" },
      { patient_identifier: "P5", product: "MR", reaction: "Fever" },
    ];
    const issues = runValidation(["Patient Name", "Remarks / Comments"], mapping, rows);
    expect(issues.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toBe(false);
  });
});

describe("runValidation — column-shift detection (whole column vs single value)", () => {
  function rowsWithPhoneDesignationSwap(): ParsedRow[] {
    // Whole-column evidence: reporter_phone holds designation-like text in
    // every row, and reporter_designation sits empty in those same rows.
    const designations = ["Nurse", "CHEW", "Midwife", "Doctor", "Health Worker", "Nurse"];
    return designations.map((d) => ({
      patient_identifier: "P",
      product: "MR",
      reaction: "Fever",
      reporter_phone: d,
      reporter_designation: "",
    }));
  }

  it("flags a whole-column shift when most values don't match the field's shape and the swap partner is empty", () => {
    const mapping: Record<string, TargetField> = {
      Phone: "reporter_phone",
      Designation: "reporter_designation",
    };
    const issues = runValidation(["Phone", "Designation"], mapping, rowsWithPhoneDesignationSwap());

    const shift = issues.find((i) => i.code === "POSSIBLE_COLUMN_SHIFT");
    expect(shift).toBeTruthy();
    expect(shift!.confidence).toBe("LOW");
    expect(["HIGH", "MEDIUM"]).toContain(shift!.severity);
    expect(shift!.column).toBe("Phone");
    // Never presented as a certainty.
    expect(shift!.message.toLowerCase()).toContain("possible");
    // One finding for the column, not one per row.
    expect(issues.filter((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toHaveLength(1);
  });

  it("does NOT escalate a single bad value into a column-wide shift", () => {
    const mapping: Record<string, TargetField> = { Phone: "reporter_phone" };
    const rows: ParsedRow[] = [
      { reporter_phone: "08012345678" },
      { reporter_phone: "08023456789" },
      { reporter_phone: "Ikoya Health Centre" }, // the one bad value
      { reporter_phone: "08034567890" },
      { reporter_phone: "08045678901" },
      { reporter_phone: "08056789012" },
    ];
    const issues = runValidation(["Phone"], mapping, rows);

    expect(issues.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toBe(false);
    const mismatch = issues.find((i) => i.code === "FIELD_CONTENT_MISMATCH");
    expect(mismatch).toBeTruthy();
    expect(mismatch!.row).toBe(3);
    expect(mismatch!.value).toBe("Ikoya Health Centre");
    expect(mismatch!.confidence).toBe("LOW");
  });

  it("does not flag anything when the whole column looks normal", () => {
    const mapping: Record<string, TargetField> = {
      Phone: "reporter_phone",
      Sex: "sex",
      Age: "age",
    };
    const rows: ParsedRow[] = [
      { reporter_phone: "08012345678", sex: "F", age: "34" },
      { reporter_phone: "08023456789", sex: "M", age: "2" },
      { reporter_phone: "08034567890", sex: "Female", age: "45 years" },
    ];
    const issues = runValidation(["Phone", "Sex", "Age"], mapping, rows);
    expect(issues.some((i) => i.code === "POSSIBLE_COLUMN_SHIFT")).toBe(false);
    expect(issues.some((i) => i.code === "FIELD_CONTENT_MISMATCH")).toBe(false);
  });
});

describe("runValidation — seriousness value spelling variants", () => {
  it("does not flag real seriousness spellings that use a space instead of an underscore/hyphen", () => {
    // Real regression: a real AEFI form spelled it "NON SERIOUS" (space),
    // which the old exact-string set didn't recognise at all.
    const mapping: Record<string, TargetField> = { Seriousness: "seriousness" };
    const rows: ParsedRow[] = [
      { seriousness: "NON SERIOUS" },
      { seriousness: "NON-SERIOUS" },
      { seriousness: "NONSERIOUS" },
      { seriousness: "NON_SERIOUS" },
      { seriousness: "SERIOUS" },
    ];
    const issues = runValidation(["Seriousness"], mapping, rows);
    expect(issues.some((i) => i.code === "UNRECOGNISED_SERIOUSNESS_VALUE")).toBe(false);
  });

  it("still flags a genuinely unrecognised seriousness value", () => {
    const mapping: Record<string, TargetField> = { Seriousness: "seriousness" };
    const rows: ParsedRow[] = [{ seriousness: "MAYBE" }];
    const issues = runValidation(["Seriousness"], mapping, rows);
    expect(issues.some((i) => i.code === "UNRECOGNISED_SERIOUSNESS_VALUE")).toBe(true);
  });
});

describe("mergeFindings — AI can add, never erase, deterministic findings", () => {
  it("keeps every rule finding even when AI returns nothing", () => {
    const rule = [issue({ code: "SERIOUSNESS_CONTRADICTION", row: 4 })];
    const merged = mergeFindings(rule, []);
    expect(merged).toEqual(rule);
  });

  it("collapses an AI finding on the exact same cell into the rule's version", () => {
    const rule = [issue({ code: "DATE_CHRONOLOGY_VIOLATION", row: 5, column: "Vaccination Date" })];
    const ai = [
      issue({
        code: "AI_VACCINATION_AFTER_ONSET",
        row: 5,
        column: "vaccination date", // different case, same cell
        source: "ai",
        message: "Vaccination date occurs after reporting date.",
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.code).toBe("DATE_CHRONOLOGY_VIOLATION");
  });

  it("keeps an AI finding on a different cell as additive", () => {
    const rule = [issue({ code: "MISSING_DOSE", row: 2, column: "Dose" })];
    const ai = [
      issue({
        code: "AMBIGUOUS_REACTION_TERM",
        row: 7,
        column: "Reaction",
        source: "ai",
      }),
    ];
    const merged = mergeFindings(rule, ai);
    expect(merged).toHaveLength(2);
    expect(merged.map((i) => i.code).sort()).toEqual(["AMBIGUOUS_REACTION_TERM", "MISSING_DOSE"]);
  });
});
