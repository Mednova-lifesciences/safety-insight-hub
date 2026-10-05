import type { LineListChange, LineListDecision, LineListIssue } from "@/types/pv";
import { describeChangesForRow } from "./linelist-change-log";
import { decisionFor, describeDecision } from "./linelist-decisions";

/**
 * The fixed line list as CSV — for `.csv` uploads, and for every upload
 * until the corrected-workbook download (plan 2b) exists.
 *
 * Three columns are added after the original ones. A dropped case stays,
 * marked, so the file still lines up row for row with what was submitted;
 * a stepped-down case is held for later and left out. The source form's
 * code list goes back at the bottom so a re-upload rediscovers it.
 */

export const FIXED_FILE_COLUMNS = ["Changes made", "Decision", "Still needs review"] as const;

export function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function stillNeedsReviewFor(
  row: number,
  issues: LineListIssue[],
  unresolved: { row: number; column: string; reason: string }[],
): string {
  const lines = [
    ...issues.filter((i) => i.row === row).map((i) => `${i.column}: ${i.message}`),
    ...unresolved.filter((u) => u.row === row).map((u) => `${u.column}: ${u.reason}`),
  ];
  return [...new Set(lines)].join(" · ");
}

export interface FixedCsvInput {
  columns: string[];
  /** One record per data row, keyed by original header; row N is index N-1. */
  rows: Record<string, string>[];
  changeLog: LineListChange[];
  decisions: LineListDecision[];
  issues: LineListIssue[];
  unresolved: { row: number; column: string; reason: string }[];
  /** The sparse rows the parser preserved — usually the code list. */
  preservedSourceText: string[];
}

export function buildFixedCsv(input: FixedCsvInput): string {
  const header = [...input.columns, ...FIXED_FILE_COLUMNS].map(escapeCsvCell).join(",");
  const body: string[] = [];
  input.rows.forEach((record, idx) => {
    const row = idx + 1;
    const decision = decisionFor(input.decisions, row);
    if (decision?.decision === "STEP_DOWN") return;
    body.push(
      [
        ...input.columns.map((c) => record[c] ?? ""),
        describeChangesForRow(input.changeLog, row),
        decision ? describeDecision(decision) : "",
        stillNeedsReviewFor(row, input.issues, input.unresolved),
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  });
  const lines = [header, ...body];
  if (input.preservedSourceText.length > 0) {
    lines.push("", escapeCsvCell("# ORIGINAL SOURCE TEXT — preserved from uploaded file"));
    lines.push(...input.preservedSourceText.map(escapeCsvCell));
  }
  return lines.join("\n");
}
