import type { LineListIssue } from "@/types/pv";
import { normalise } from "./linelist-normalise";

/**
 * Findings read from the file's own cell text (rawRows) rather than the
 * mapped values, which are cleaned on read and so hide what the file — and
 * the fixed file — still holds.
 *
 *  - A value a normalisation rule can settle (linelist-normalise): a stray
 *    character, a misspelt interval unit, a decimal comma or ordinal typo
 *    in a dose, inconsistent delimiters in a code list, a column's own unit
 *    in a number. The finding carries the rule's `suggestion`; Fix applies
 *    it without the AI, so every run gives the same answer.
 *  - INVALID_DATE_FORMAT for every date column other than the vaccination
 *    and onset dates (which runValidation already checks). Only a value
 *    with a digit in it is a malformed date; a blank, "-" or a word is a
 *    missing value, reported elsewhere. Offered to the AI; never guessed.
 *  - Flags for a person, never corrected: an implausible vaccine dose or
 *    an unrecognised dose unit, and a phone number that lost its leading 0
 *    (only where the source form's country fixes the national format).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{1,2}-\d{1,2}-\d{2,4}$/;

/** Date fields runValidation does not format-check. */
const OTHER_DATE_FIELDS = new Set([
  "report_date",
  "state_received_date",
  "national_received_date",
  "date_of_birth",
]);

/** The finding code for each normalisation rule. */
const RULE_CODE: Record<string, string> = {
  "stray-edge-character": "STRAY_CHARACTER",
  "date-year-repeated-digit": "INVALID_DATE_FORMAT",
  "date-doubled-separator": "INVALID_DATE_FORMAT",
  "interval-unit-spelling": "INTERVAL_UNIT_TYPO",
  "dose-decimal-comma": "DOSE_DECIMAL_COMMA",
  "ordinal-suffix-typo": "DOSE_TYPO",
  "code-list-delimiters": "REACTION_CODE_DELIMITER",
  "unit-in-own-column": "UNIT_IN_NUMERIC_FIELD",
};

/** Mobile numbers written without the national trunk 0, by country: the
 *  digits that remain and the full form. Only countries listed here are
 *  checked — no guessing for others. */
const NATIONAL_MOBILE: Record<string, { lost: RegExp; full: (d: string) => string }> = {
  NG: { lost: /^[789][01]\d{8}$/, full: (d) => `0${d}` },
};

/** Vaccine doses: an ordinal or small dose number, or a volume with a unit.
 *  A bare number above this, or a volume above MAX_ML, is flagged. */
const MAX_DOSE_NUMBER = 5;
const MAX_ML = 2;
const KNOWN_DOSE_UNIT = /^(ml|mls|dose|doses)$/i;

export function formatFindings(
  headers: string[],
  mapping: Record<string, string>,
  rawRows: Record<string, string | undefined>[],
  country?: string,
): LineListIssue[] {
  const issues: LineListIssue[] = [];
  const mapped = headers.filter((h) => mapping[h]);
  const finding = (
    row: number,
    column: string,
    field: string,
    raw: string,
    code: string,
    severity: LineListIssue["severity"],
    message: string,
    fixable: boolean,
    extra: Partial<LineListIssue> = {},
  ): LineListIssue => ({
    row,
    column,
    severity,
    confidence: "HIGH",
    code,
    message,
    value: raw,
    source: "rule",
    sources: ["rule"],
    issueType: "FIELD_FORMAT_INVALID",
    affectedFields: [field],
    fixable,
    ...extra,
  });
  rawRows.forEach((r, i) => {
    const row = i + 1;
    for (const header of mapped) {
      const field = mapping[header]!;
      const raw = String(r[header] ?? "").trim();
      if (!raw) continue;
      const n = normalise(field, raw);
      if (n) {
        issues.push(
          finding(
            row,
            header,
            field,
            raw,
            RULE_CODE[n.rule] ?? "NORMALISATION",
            "LOW",
            `"${raw}" → "${n.value}": ${n.why} (rule ${n.rule} v${n.version}).`,
            true,
            { suggestion: { value: n.value, rule: n.rule, version: n.version } },
          ),
        );
        continue;
      }
      if (OTHER_DATE_FIELDS.has(field) && /\d/.test(raw) && !DATE_RE.test(raw)) {
        issues.push(
          finding(
            row,
            header,
            field,
            raw,
            "INVALID_DATE_FORMAT",
            "MEDIUM",
            `"${raw}" does not look like a valid date.`,
            true,
          ),
        );
        continue;
      }
      if (field === "reaction_code" && /\d\s*\b(and|or)\b\s*\d|\d\s*\+\s*\d/i.test(raw)) {
        issues.push(
          finding(
            row,
            header,
            field,
            raw,
            "REACTION_CODE_DELIMITER_WORD",
            "MEDIUM",
            `"${raw}": codes joined by a word. Export may not read them as separate codes; a person rewrites them (a word such as OR can change the meaning).`,
            false,
          ),
        );
        continue;
      }
      if (field === "dose") {
        const m = /^(\d+(?:[.,]\d+)?)\s*([A-Za-z]*)$/.exec(raw);
        const amount = m ? Number(m[1]!.replace(",", ".")) : NaN;
        const unit = m?.[2] ?? "";
        if (m && unit && !KNOWN_DOSE_UNIT.test(unit) && !/^(st|nd|rd|th)$/i.test(unit)) {
          issues.push(
            finding(
              row,
              header,
              field,
              raw,
              "DOSE_UNIT_UNRECOGNISED",
              "MEDIUM",
              `"${raw}": the unit "${unit}" is not a recognised dose unit. Not corrected — more than one unit could be meant.`,
              false,
            ),
          );
        } else if (m && !unit && Number.isInteger(amount) && amount > MAX_DOSE_NUMBER) {
          issues.push(
            finding(
              row,
              header,
              field,
              raw,
              "DOSE_IMPLAUSIBLE",
              "MEDIUM",
              `"${raw}" is neither a usual dose number nor a volume. Check the source; it is never changed automatically.`,
              false,
            ),
          );
        } else if (m && /^ml/i.test(unit) && amount > MAX_ML) {
          issues.push(
            finding(
              row,
              header,
              field,
              raw,
              "DOSE_IMPLAUSIBLE",
              "MEDIUM",
              `${raw} is an unusually large vaccine volume. Check the source; it is never changed automatically.`,
              false,
            ),
          );
        }
      }
      const national = country ? NATIONAL_MOBILE[country] : undefined;
      if (field === "reporter_phone" && national) {
        const digits = raw.replace(/[\s-]/g, "");
        if (national.lost.test(digits)) {
          issues.push(
            finding(
              row,
              header,
              field,
              raw,
              "PHONE_LEADING_ZERO_MISSING",
              "LOW",
              `"${raw}" looks like a mobile number whose leading 0 was lost (a spreadsheet number): probably ${national.full(digits)}. Confirm before changing it.`,
              false,
            ),
          );
        }
      }
    }
  });
  return issues;
}
