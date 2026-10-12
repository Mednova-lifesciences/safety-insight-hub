import type { LineListIssue } from "@/types/pv";

/**
 * Format findings the main rules cannot see, read from the file's own cell
 * text (rawRows) rather than the mapped values:
 *
 *  - INVALID_DATE_FORMAT for every date column other than the vaccination
 *    and onset dates (which runValidation already checks). Report dates were
 *    never format-checked, so "5/4/20255" reached export unread and
 *    unreported. Only a value with a digit in it is a malformed date; a
 *    blank, "-" or a word is a missing value, reported elsewhere.
 *  - STRAY_CHARACTER: a typed value (date, code, batch, dose, age) with a
 *    spreadsheet text marker or a stray separator at its edge. The mapped
 *    value is cleaned on read (stripSpreadsheetTextMarkers) so every check
 *    passed, while the file — and the fixed file — kept "3/4/2025'". Only
 *    reported when removing the character leaves the letters and digits
 *    exactly as they were; never on identifiers, names, phone numbers or
 *    free text, and never for "-", "+" or "." (they change a value).
 *
 * Both codes are in CORRECTABLE_RULE_CODES: Fix offers them, and the AI's
 * answer still has to pass both guards.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{1,2}-\d{1,2}-\d{2,4}$/;

/** Date fields runValidation does not format-check. */
const OTHER_DATE_FIELDS = new Set([
  "report_date",
  "state_received_date",
  "national_received_date",
  "date_of_birth",
]);

/** Fields whose values are typed (a date, a code, a batch, an amount), so a
 *  stray character at the edge is never part of the value. */
const TYPED_FIELDS = new Set([
  "vaccination_date",
  "onset_date",
  "report_date",
  "state_received_date",
  "national_received_date",
  "date_of_birth",
  "vaccine_batch",
  "diluent_batch",
  "dose",
  "age",
  "age_months",
  "sex",
  "outcome",
  "serious_code",
  "reaction_code",
]);

const alnum = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The value without a stray edge character: spreadsheet text markers (')
 *  at either end, a leading : ; or , and — except on reaction codes, whose
 *  delimiters the reaction rule handles — a trailing , ; or :. */
function withoutStrayEdges(value: string, field: string): string {
  let v = value.trim().replace(/^'+/, "").replace(/'+$/, "").trim();
  v = v.replace(/^[:;,]+\s*/, "");
  if (field !== "reaction_code") v = v.replace(/\s*[,;:]+$/, "");
  return v.trim();
}

export function formatFindings(
  headers: string[],
  mapping: Record<string, string>,
  rawRows: Record<string, string | undefined>[],
): LineListIssue[] {
  const issues: LineListIssue[] = [];
  const mapped = headers.filter((h) => mapping[h]);
  rawRows.forEach((r, i) => {
    const row = i + 1;
    for (const header of mapped) {
      const field = mapping[header]!;
      const raw = String(r[header] ?? "").trim();
      if (!raw) continue;
      const clean = TYPED_FIELDS.has(field) ? withoutStrayEdges(raw, field) : raw;
      if (clean !== raw && clean !== "" && alnum(clean) === alnum(raw)) {
        issues.push({
          row,
          column: header,
          severity: "LOW",
          confidence: "HIGH",
          code: "STRAY_CHARACTER",
          message: `"${raw}" has a stray character at its edge; the value itself is "${clean}".`,
          value: raw,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_FORMAT_INVALID",
          affectedFields: [field],
          fixable: true,
        });
        continue;
      }
      if (OTHER_DATE_FIELDS.has(field) && /\d/.test(clean) && !DATE_RE.test(clean)) {
        issues.push({
          row,
          column: header,
          severity: "MEDIUM",
          confidence: "HIGH",
          code: "INVALID_DATE_FORMAT",
          message: `"${raw}" does not look like a valid date.`,
          value: raw,
          source: "rule",
          sources: ["rule"],
          issueType: "FIELD_FORMAT_INVALID",
          affectedFields: [field],
          fixable: true,
        });
      }
    }
  });
  return issues;
}
