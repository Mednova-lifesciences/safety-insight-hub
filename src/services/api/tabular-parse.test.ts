import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mapColumnsByKeywords } from "./tabular-parse";
import { parseTabularFile } from "./tabular-parse";
import { FIELD_KEYWORDS } from "./linelist";

/** Builds a real .xlsx File in memory from a grid of cell values, so tests
 *  exercise the actual SheetJS read path (not a hand-rolled matrix) — the
 *  same thing the browser hands parseTabularFile() on a real upload. */
function xlsxFile(
  rows: (string | number)[][],
  opts?: { merges?: { s: [number, number]; e: [number, number] }[]; name?: string },
): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (opts?.merges) {
    sheet["!merges"] = opts.merges.map((m) => ({
      s: { r: m.s[0], c: m.s[1] },
      e: { r: m.e[0], c: m.e[1] },
    }));
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const buffer = new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
  return new File([buffer], opts?.name ?? "test.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function csvFile(text: string, name = "test.csv"): File {
  return new File([text], name, { type: "text/csv" });
}

describe("parseTabularFile — clean files (no regression)", () => {
  it("uses row 1 as the header when it already looks like one", async () => {
    const file = xlsxFile([
      ["Case ID", "Patient Name", "Product", "Reaction", "Onset Date"],
      ["C001", "Jane Doe", "MR", "Fever", "2026-01-05"],
      ["C002", "John Smith", "OPV", "Rash", "2026-01-06"],
    ]);
    const result = await parseTabularFile(file);
    expect(result.headers).toEqual([
      "Case ID",
      "Patient Name",
      "Product",
      "Reaction",
      "Onset Date",
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.headerRowNumber).toBe(1);
    expect(result.skippedRows).toBe(0);
  });

  it("parses a clean CSV the same way", async () => {
    const file = csvFile(
      "Case ID,Patient Name,Product,Reaction,Onset Date\nC001,Jane Doe,MR,Fever,2026-01-05\n",
    );
    const result = await parseTabularFile(file);
    expect(result.headers[0]).toBe("Case ID");
    expect(result.rows).toHaveLength(1);
    expect(result.skippedRows).toBe(0);
  });
});

describe("parseTabularFile — government-form letterhead before the real header", () => {
  it("skips title/letterhead rows and finds the real header further down", async () => {
    const file = xlsxFile([
      ["FEDERAL REPUBLIC OF NIGERIA"],
      ["FEDERAL MINISTRY OF HEALTH"],
      ["NATIONAL PRIMARY HEALTH CARE DEVELOPMENT AGENCY"],
      ["AEFI LINE LIST — ONDO STATE"],
      ["REPORTING PERIOD: FEBRUARY 2026"],
      [],
      [
        "S/N",
        "Patient Name",
        "Sex",
        "Age",
        "Facility",
        "Date of Immunisation",
        "Vaccine",
        "Reaction",
        "Outcome",
      ],
      [1, "Jane Doe", "F", 2, "Ode-Erinje PHC", "2026-02-03", "MR", "Fever", "Recovered"],
      [2, "John Smith", "M", 1, "Ikoya Health Facility", "2026-02-04", "OPV", "Rash", "Recovering"],
    ]);
    const result = await parseTabularFile(file);

    expect(result.headers).toContain("Patient Name");
    expect(result.headers).toContain("Date of Immunisation");
    expect(result.headerRowNumber).toBe(7);
    expect(result.skippedRows).toBe(6);
    expect(result.rows).toHaveLength(2);
    expect(result.warnings.join(" ")).toMatch(/skipped/i);

    // The actual bug this regression test targets: the letterhead text must
    // never be mistaken for a data row, a header, or a mapped column.
    expect(result.headers).not.toContain("FEDERAL REPUBLIC OF NIGERIA");
    expect(result.rows.flat()).not.toContain("FEDERAL REPUBLIC OF NIGERIA");
  });

  it("maps most canonical fields once the real header is found (no false NO_COLUMNS_MAPPED)", async () => {
    const file = xlsxFile([
      ["FEDERAL REPUBLIC OF NIGERIA"],
      ["ONDO STATE MINISTRY OF HEALTH — AEFI LINE LIST"],
      [],
      [
        "S/N",
        "Patient Identifier",
        "Sex",
        "Age",
        "Suspect Product",
        "Reaction/Event",
        "Date of Last Immunisation",
        "Onset Date",
        "Seriousness",
        "Outcome",
        "Vaccine Batch No",
        "Dose",
        "Reporter Phone Number",
      ],
      [
        1,
        "P001",
        "F",
        2,
        "MR",
        "Fever",
        "2026-02-03",
        "2026-02-03",
        "NON SERIOUS",
        "Recovered",
        "0125N084A",
        "1st",
        "08012345678",
      ],
    ]);
    const result = await parseTabularFile(file);
    const mapping = mapColumnsByKeywords(result.headers, FIELD_KEYWORDS);

    // The specific bug reported: real headers below a letterhead block used
    // to map to nothing at all, tripping NO_COLUMNS_MAPPED.
    expect(Object.keys(mapping).length).toBeGreaterThanOrEqual(8);
    expect(mapping["Date of Last Immunisation"]).toBe("vaccination_date");
    expect(mapping["Reporter Phone Number"]).toBe("reporter_phone");
  });

  it("maps a form's only reaction-ish column to the required `reaction` field, not the optional `reaction_code`", async () => {
    // Real regression: a real AEFI form's only reaction column is phrased
    // "Reaction type (Codes -see 1 below )" — a keyword change meant to
    // catch a *separately-coded* reaction column instead claimed this one
    // for reaction_code, leaving the required `reaction` field completely
    // unmapped and flagging every single row MISSING_REACTION.
    const file = xlsxFile([
      [
        "S/N",
        "Patient Identifier",
        "Sex",
        "Age",
        "Suspect Product",
        "Reaction type (Codes -see 1 below )",
        "Outcome",
      ],
      [1, "P001", "F", 2, "MR", "8", "Recovered"],
    ]);
    const result = await parseTabularFile(file);
    const mapping = mapColumnsByKeywords(result.headers, FIELD_KEYWORDS);
    expect(mapping["Reaction type (Codes -see 1 below )"]).toBe("reaction");
  });
});

describe("parseTabularFile — two-row (merged) headers", () => {
  it("combines a merged parent header with its sub-header row", async () => {
    const file = xlsxFile(
      [
        ["S/N", "Patient Name", "Age", "", "Reaction"],
        ["", "", "Years", "Months", ""],
        [1, "Jane Doe", 1, 2, "Fever"],
        [2, "John Smith", 0, 9, "Rash"],
      ],
      { merges: [{ s: [0, 2], e: [0, 3] }] }, // "Age" spans columns C:D on the header row
    );
    const result = await parseTabularFile(file);

    expect(result.headers).toContain("Age Years");
    expect(result.headers).toContain("Age Months");
    expect(result.headerRowNumber).toBe(1);
    // the sub-header row itself must be consumed, not treated as a data row
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.every((c) => c !== "Years" && c !== "Months"))).toBe(true);
  });
});

describe("parseTabularFile — structural noise inside the data region", () => {
  it("drops fully blank rows and an exact repeat of the header row", async () => {
    const file = xlsxFile([
      ["Case ID", "Patient Name", "Reaction"],
      ["C001", "Jane Doe", "Fever"],
      ["", "", ""],
      ["Case ID", "Patient Name", "Reaction"], // header reprinted mid-sheet
      ["C002", "John Smith", "Rash"],
    ]);
    const result = await parseTabularFile(file);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r[0])).toEqual(["C001", "C002"]);
  });

  it("drops a repeated federal letterhead band reappearing mid-sheet (real Ondo AEFI regression)", async () => {
    // Reproduces an actual failure observed against "2026, ONDO STATE
    // AEFI.xlsx": a real prior run's executive summary showed 41
    // STRUCTURAL_ROW findings at rows 201-203+, each row containing only
    // "FEDERAL REPUBLIC OF NIGERIA" — the letterhead is reprinted partway
    // down the sheet (a paginated government-form export flattened into
    // one sheet), well past the real header, so it isn't caught by the
    // pre-header letterhead skip at all. Only the AI's own structural-row
    // judgement caught it before this fix; the parser now drops it
    // deterministically, before validation ever sees it.
    const rows: (string | number)[][] = [
      ["S/N", "Patient Identifier", "Sex", "Age", "Suspect Product", "Reaction", "Onset Date"],
    ];
    for (let i = 1; i <= 200; i++) {
      rows.push([i, `P${i}`, i % 2 ? "F" : "M", 5, "MR", "Fever", "2026-02-03"]);
    }
    // The repeated letterhead band — one populated cell per row, exactly
    // matching what was actually observed.
    rows.push(["FEDERAL REPUBLIC OF NIGERIA"]);
    rows.push(["FEDERAL MINISTRY OF HEALTH"]);
    rows.push(["AEFI LINE LIST FORM — ONDO STATE"]);
    rows.push([201, "P201", "F", 6, "OPV", "Rash", "2026-02-04"]);

    const file = xlsxFile(rows);
    const result = await parseTabularFile(file);

    expect(result.rows).toHaveLength(201);
    expect(result.rows.every((r) => r[1] !== "" && !r[1]!.includes("FEDERAL"))).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/sparse row/i);
  });
});

describe("parseTabularFile — numeric cells that Excel would render in scientific notation", () => {
  it("recovers the plain-integer phone number instead of a lossy-looking exponential string", async () => {
    // Real regression: a phone number typed into a plain (General-format)
    // numeric cell — not text — comes back from Excel/SheetJS as
    // "2.34805E+12" once it's long enough. The cell's actual stored value
    // is still the full 13 digits; only the display convention is lossy.
    const file = xlsxFile([
      ["S/N", "Patient Identifier", "Reporter Phone Number"],
      [1, "P001", 2348054535217],
    ]);
    const result = await parseTabularFile(file);
    const phoneColIndex = result.headers.indexOf("Reporter Phone Number");
    expect(result.rows[0]![phoneColIndex]).toBe("2348054535217");
  });

  it("leaves an ordinary text-formatted phone number untouched", async () => {
    const file = xlsxFile([
      ["S/N", "Patient Identifier", "Reporter Phone Number"],
      [1, "P001", "08012345678"],
    ]);
    const result = await parseTabularFile(file);
    const phoneColIndex = result.headers.indexOf("Reporter Phone Number");
    expect(result.rows[0]![phoneColIndex]).toBe("08012345678");
  });
});

describe("parseTabularFile — multi-sheet workbooks", () => {
  it("picks the sheet that actually looks like the case table, not the first sheet", async () => {
    const notesSheet = XLSX.utils.aoa_to_sheet([
      ["Instructions"],
      ["Fill in one row per adverse event."],
      ["Contact the LGA office for questions."],
    ]);
    const dataSheet = XLSX.utils.aoa_to_sheet([
      ["Case ID", "Patient Name", "Sex", "Age", "Reaction", "Outcome"],
      ["C001", "Jane Doe", "F", 2, "Fever", "Recovered"],
      ["C002", "John Smith", "M", 1, "Rash", "Recovering"],
      ["C003", "Amaka Okafor", "F", 3, "Swelling", "Recovered"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, notesSheet, "Notes");
    XLSX.utils.book_append_sheet(workbook, dataSheet, "Cases");
    const buffer = new Uint8Array(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
    );
    const file = new File([buffer], "multi-sheet.xlsx");

    const result = await parseTabularFile(file);
    expect(result.sheetName).toBe("Cases");
    expect(result.rows).toHaveLength(3);
  });
});
