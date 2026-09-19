import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTabularFile } from "./tabular-parse";
import { rowLabel, safeCorrections } from "./linelist";

function xlsxFile(rows: (string | number)[][]): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const buffer = new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
  return new File([buffer], "t.xlsx");
}

describe("finding a case in the original file", () => {
  it("records the real file row of every case row, past titles, blank and legend rows", async () => {
    const parsed = await parseTabularFile(
      xlsxFile([
        ["ONDO STATE AEFI LINE LIST"],
        [],
        ["Case ID", "Patient name", "Vaccine", "Reaction", "Outcome"],
        ["OND-1", "Ada Obi", "Penta", "Fever", "Recovered"],
        [],
        ["OND-2", "Bola Ade", "BCG", "Rash", "Recovering"],
        ["KEY: 1 = Fever"],
        ["OND-3", "Chi Eze", "OPV", "Pain", "Recovered"],
      ]),
    );
    expect(parsed.rows.map((r) => r[0])).toEqual(["OND-1", "OND-2", "OND-3"]);
    expect(parsed.sourceRowNumbers).toEqual([4, 6, 8]);
  });

  it("labels a row by file row and the file's own case ID", () => {
    const job = {
      sourceRowNumbers: [4, 6],
      parsedRows: [{ case_id: "OND-1" }, {}],
    };
    expect(rowLabel(job, 1)).toBe("File row 4 (case OND-1)");
    expect(rowLabel(job, 2)).toBe("File row 6");
    expect(rowLabel({}, 3)).toBe("Row 3");
    expect(rowLabel(job, 0)).toBe("Whole file");
  });
});

describe("Fix Issues never rewrites what it was not asked to fix", () => {
  const mapping = { "Case ID": "case_id", Onset: "onset_date", Dose: "dose" };
  const requested = [
    { row: 1, column: "Onset" },
    { row: 2, column: "Case ID" },
  ];

  it("keeps only corrections for requested cells, and never the case-ID column", () => {
    const corrections = [
      { row: 1, column: "Onset", new_value: "2026-08-10" }, // asked for — kept
      { row: 1, column: "Dose", new_value: "1ST" }, // not asked for — dropped
      { row: 2, column: "Case ID", new_value: "OND-0002" }, // an ID — dropped even if asked
    ];
    expect(safeCorrections(corrections, requested, mapping)).toEqual([
      { row: 1, column: "Onset", new_value: "2026-08-10" },
    ]);
  });
});
