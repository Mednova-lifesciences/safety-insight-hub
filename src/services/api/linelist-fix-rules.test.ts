import { describe, expect, it } from "vitest";
import { runValidation, withoutSettledDuplicates, type ParsedRow } from "./linelist";
import { routeFinding } from "./linelist-fix-routing";
import { getSourceProfile } from "@/services/e2b-r3/source-profiles/registry";
import type { LineListIssue } from "@/types/pv";

const COLUMNS = ["Case ID", "Seriousness", "Outcome"];
const MAPPING = { "Case ID": "case_id", Seriousness: "seriousness", Outcome: "outcome" } as const;
const validate = (rows: ParsedRow[]) =>
  runValidation(COLUMNS, { ...MAPPING }, rows, getSourceProfile("generic-verbatim"));

describe("a death marked non-serious", () => {
  it("is corrected to the file's own word for serious, by a named rule", () => {
    const issues = validate([
      { case_id: "T-1", seriousness: "Non-serious", outcome: "Died" },
      { case_id: "T-2", seriousness: "Serious", outcome: "Recovered" },
    ]);
    const fatal = issues.find((i) => i.code === "FATAL_OUTCOME_NOT_MARKED_SERIOUS")!;
    expect(fatal.suggestion).toEqual({
      value: "Serious",
      rule: "fatal-outcome-serious",
      version: "1",
    });
  });

  it("uses Yes when the file writes seriousness as Yes / No", () => {
    const issues = validate([
      { case_id: "T-1", seriousness: "No", outcome: "Died" },
      { case_id: "T-2", seriousness: "Yes", outcome: "Recovered" },
      { case_id: "T-3", seriousness: "Yes", outcome: "Recovered" },
    ]);
    expect(
      issues.find((i) => i.code === "FATAL_OUTCOME_NOT_MARKED_SERIOUS")!.suggestion?.value,
    ).toBe("Yes");
  });

  it("is applied by Fix without the AI", () => {
    const [fatal] = validate([
      { case_id: "T-1", seriousness: "Non-serious", outcome: "Died" },
    ]).filter((i) => i.code === "FATAL_OUTCOME_NOT_MARKED_SERIOUS");
    expect(
      routeFinding(fatal!, {
        keptRows: new Set([1]),
        changeLog: [],
        recoveryCells: new Set(),
        mapping: { ...MAPPING },
      }),
    ).toBe("deterministic");
  });
});

describe("one finding per malformed cell", () => {
  const issue = (code: string, column: string, suggestion?: string): LineListIssue => ({
    row: 1,
    column,
    severity: "MEDIUM",
    confidence: "HIGH",
    code,
    message: "m",
    value: "x",
    source: "rule",
    sources: ["rule"],
    fixable: true,
    ...(suggestion ? { suggestion: { value: suggestion, rule: "r", version: "1" } } : {}),
  });

  it("drops the bare 'malformed' finding when a rule corrects the same cell", () => {
    const out = withoutSettledDuplicates([
      issue("INVALID_DATE_FORMAT", "Date of Onset"),
      issue("INVALID_DATE_FORMAT", "Date of Onset", "18/10/2026"),
      issue("UNRECOGNISED_SERIOUSNESS_VALUE", "Seriousness"),
      issue("UNRECOGNISED_SERIOUSNESS_VALUE", "Seriousness", "Serious"),
    ]);
    expect(out.map((i) => [i.code, i.suggestion?.value])).toEqual([
      ["INVALID_DATE_FORMAT", "18/10/2026"],
      ["UNRECOGNISED_SERIOUSNESS_VALUE", "Serious"],
    ]);
  });

  it("keeps it when no rule corrects the cell, and keeps different problems", () => {
    const out = withoutSettledDuplicates([
      issue("INVALID_DATE_FORMAT", "Report Date"),
      issue("FATAL_OUTCOME_NOT_MARKED_SERIOUS", "Seriousness"),
      issue("UNRECOGNISED_SERIOUSNESS_VALUE", "Outcome", "Serious"),
    ]);
    expect(out).toHaveLength(3);
  });
});
