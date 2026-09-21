import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIELD_KEYWORDS, inferPatientRecordNumberSource } from "./linelist";
import { mapColumnsByKeywords } from "./tabular-parse";

/** The shipped sample line list, read exactly as the upload path reads it. */
describe("sample-linelist-50-cases.csv", () => {
  it("has its Hospital Number column understood as a hospital record number", () => {
    const csv = readFileSync(
      join(__dirname, "..", "..", "..", "sample-linelist-50-cases.csv"),
      "utf-8",
    ).split(/\r?\n/);
    const headers = csv[1]!.split(",");
    const mapping = mapColumnsByKeywords(headers, FIELD_KEYWORDS);
    expect(mapping["Hospital Number"]).toBe("patient_id");
    expect(mapping["Patient"]).toBe("patient_identifier");
    expect(mapping["Case ID"]).toBe("case_id");
    expect(inferPatientRecordNumberSource("Hospital Number")).toBe("HOSPITAL");
    // ...and every row has one.
    const rows = csv.slice(2).filter(Boolean);
    const at = headers.indexOf("Hospital Number");
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.split(",")[at]?.trim())).toBe(true);
  });
});
