import type { DropReason, LineListChange, LineListDecision, LineListIssue } from "@/types/pv";
import { describeChangesForRow } from "./linelist-change-log";
import { decisionFor, describeDecision, DROP_REASON_LABELS } from "./linelist-decisions";

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

/** Columns this tool writes into a fixed file, now and in earlier versions.
 *  When that file is uploaded again they are notes about the data, not
 *  data: never mapped, and replaced (not repeated) in the next fixed file. */
export const FIXED_FILE_ANNOTATION_COLUMNS: readonly string[] = [
  ...FIXED_FILE_COLUMNS,
  "Needs review",
  "Unresolved column(s)",
];

export function isFixedFileAnnotationColumn(header: string): boolean {
  return FIXED_FILE_ANNOTATION_COLUMNS.includes(header.trim());
}

const NO_REASON_NOTE = "No reason recorded in the re-uploaded file";

/**
 * The drops a re-uploaded fixed file carries in its Decision column, so a
 * dropped case stays dropped (spec 6.4). Reads what describeDecision wrote:
 * `DROPPED — <reason label>[: <note>]`, also with a plain hyphen or bare.
 * A reason it does not recognise becomes Other, with the text as the note.
 * Held cases never appear in a fixed file; anything else is ignored.
 * `rows` are the data rows in file order; row N is index N-1.
 */
export function decisionsFromFixedFile(
  headers: string[],
  rows: string[][],
  by: string,
  at: string,
): LineListDecision[] {
  const col = headers.findIndex((h) => h.trim() === "Decision");
  if (col < 0) return [];
  const out: LineListDecision[] = [];
  rows.forEach((cells, idx) => {
    const match = /^DROPPED(?:\s*[—-]\s*([\s\S]*))?$/.exec((cells[col] ?? "").trim());
    if (!match) return;
    const text = (match[1] ?? "").trim();
    const colon = text.indexOf(":");
    const label = (colon < 0 ? text : text.slice(0, colon)).trim().toLowerCase();
    const after = colon < 0 ? "" : text.slice(colon + 1).trim();
    const known = (Object.entries(DROP_REASON_LABELS) as [DropReason, string][]).find(
      ([, l]) => l.toLowerCase() === label,
    )?.[0];
    const reason: DropReason = known ?? "OTHER";
    const note = known ? after : text;
    out.push({
      row: idx + 1,
      decision: "DROP",
      reason,
      ...(note ? { note } : reason === "OTHER" ? { note: NO_REASON_NOTE } : {}),
      by,
      at,
    });
  });
  return out;
}

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
  // A job made from a re-uploaded fixed file already has these columns;
  // fresh ones are appended, so the old ones are left out.
  const columns = input.columns.filter((c) => !isFixedFileAnnotationColumn(c));
  const header = [...columns, ...FIXED_FILE_COLUMNS].map(escapeCsvCell).join(",");
  const body: string[] = [];
  input.rows.forEach((record, idx) => {
    const row = idx + 1;
    const decision = decisionFor(input.decisions, row);
    if (decision?.decision === "STEP_DOWN") return;
    body.push(
      [
        ...columns.map((c) => record[c] ?? ""),
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
