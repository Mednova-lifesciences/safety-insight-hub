import type { LineListChange, LineListIssue } from "@/types/pv";
import { isCellHeld } from "./linelist-change-log";

/**
 * Where each finding goes when Fix runs — decided once, in one place, and
 * recorded, so a reviewer can tell "not detected" from "detected but not
 * correctable" from "sent to the AI and refused".
 *
 * Routing (before Fix):
 *  - deterministic        a normalisation rule settled it (finding.suggestion)
 *  - sent_to_ai           a rule finding marked fixable or of a correctable
 *                         code; an AI finding the AI marked fixable, or of a
 *                         cell-local category (format, content mismatch)
 *  - unrecognised_category an AI finding with no recognised category: shown
 *                         to a person, never silently skipped
 *  - recovery_cell        a value recovery moves back to its column
 *  - held_by_person       the cell was taken over with Undo
 *  - case_not_kept        the case is dropped or held
 *  - low_confidence_review an AI finding marked fixable but LOW confidence
 *  - protected_identifier a case ID / record number: never sent, reported
 *  - not_correctable      a person decides (contradictions, missing values,
 *                         Settings decisions, AI findings not marked fixable)
 *  - file_level           not about one cell
 *
 * Outcome (after Fix): rule_corrected, rule_skipped_value_changed,
 * ai_corrected, ai_declined, refused_by_server, refused_by_browser,
 * no_change, no_answer — see fixOutcome.
 *
 * AI findings route on their validated category (issueType, an enum the
 * server enforces) and the AI's own fixable flag — never on the wording of
 * the model's code: the same kind of finding must not be fixed or skipped
 * depending on what the model happened to call it.
 */

export type FixRoute =
  | "deterministic"
  | "sent_to_ai"
  | "recovery_cell"
  | "held_by_person"
  | "case_not_kept"
  | "low_confidence_review"
  | "not_correctable"
  | "unrecognised_category"
  | "protected_identifier"
  | "file_level";

export type FixOutcome =
  | "rule_corrected"
  | "rule_skipped_value_changed"
  | "ai_corrected"
  | "ai_declined"
  | "refused_by_server"
  | "refused_by_browser"
  | "no_change"
  | "no_answer";

export interface RoutedFinding {
  row: number;
  column: string;
  code: string;
  route: FixRoute;
  outcome?: FixOutcome | undefined;
}

/** Rule findings an AI correction may settle from the cell or its row. A
 *  rule finding with a deterministic `suggestion` never reaches the AI. */
export const AI_CORRECTABLE_RULE_CODES: readonly string[] = [
  "FIELD_CONTENT_MISMATCH",
  "INVALID_DATE_FORMAT",
  "INVALID_REACTION_CODE",
  "E2B-REACTION-DELIMITER-QUARANTINED",
];

/** AI finding categories a correction can settle from the cell itself. */
export const AI_CORRECTABLE_CATEGORIES: readonly string[] = [
  "FIELD_FORMAT_INVALID",
  "FIELD_CONTENT_MISMATCH",
];

const KNOWN_CATEGORIES = new Set([
  "FIELD_MISSING",
  "FIELD_VALUE_INVALID",
  "FIELD_FORMAT_INVALID",
  "FIELD_CONTENT_MISMATCH",
  "CROSS_FIELD_CONTRADICTION",
  "DATE_CHRONOLOGY",
  "STRUCTURAL_COLUMN_SHIFT",
  "DUPLICATE_RECORD",
]);

const PROTECTED_FIELDS = new Set(["case_id", "patient_id", "previous_case_id"]);

export function routeFinding(
  issue: LineListIssue,
  ctx: {
    keptRows: Set<number>;
    changeLog: LineListChange[];
    recoveryCells: Set<string>;
    mapping: Record<string, string>;
  },
): FixRoute {
  if (issue.row < 1) return "file_level";
  if (!ctx.keptRows.has(issue.row)) return "case_not_kept";
  if (isCellHeld(ctx.changeLog, issue.row, issue.column)) return "held_by_person";
  if (ctx.recoveryCells.has(`${issue.row}:${issue.column}`)) return "recovery_cell";
  if (PROTECTED_FIELDS.has(ctx.mapping[issue.column] ?? "")) return "protected_identifier";
  if (issue.suggestion && issue.source !== "ai") return "deterministic";
  if (issue.source === "ai") {
    const category = issue.issueType ?? "";
    if (!issue.fixable && !KNOWN_CATEGORIES.has(category)) return "unrecognised_category";
    if (!issue.fixable && !AI_CORRECTABLE_CATEGORIES.includes(category)) return "not_correctable";
    return issue.confidence === "LOW" ? "low_confidence_review" : "sent_to_ai";
  }
  // A rule's (or an older stored finding's) own fixable flag, or a code a
  // correction may settle from the row.
  if (issue.fixable) return "sent_to_ai";
  return AI_CORRECTABLE_RULE_CODES.includes(issue.code) &&
    !!issue.value &&
    String(issue.value).trim()
    ? "sent_to_ai"
    : "not_correctable";
}

/** Plain-language reason for each route, for the issue list. */
export const ROUTE_REASON: Record<FixRoute, string> = {
  deterministic: "Corrected by a normalisation rule.",
  sent_to_ai: "Offered to the AI correction.",
  recovery_cell: "Handled by moving a value back to its column.",
  held_by_person: "Kept by a person — Fix leaves this cell alone (Re-apply to hand it back).",
  case_not_kept: "The case is dropped or held, so Fix does not change it.",
  low_confidence_review:
    "Low-confidence AI finding — requires human review before an automatic fix is applied.",
  not_correctable: "A person decides: no rule or safe correction applies to this finding.",
  protected_identifier:
    "Identifiers (case ID, patient record number) are never changed by Fix — a person corrects them at the source.",
  unrecognised_category:
    "The AI's finding has no recognised category, so Fix did not act on it — a person reviews it.",
  file_level: "About the file, not one cell.",
};
