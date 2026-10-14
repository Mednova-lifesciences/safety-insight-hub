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
/** Every date field, for the calendar check. */
const DATE_FIELDS = new Set([
  "vaccination_date",
  "onset_date",
  "report_date",
  "state_received_date",
  "national_received_date",
  "date_of_birth",
]);

/** Whether a date-shaped value names a day that exists: d/m/y (or m/d/y
 *  when the day-first reading is impossible because the middle part is
 *  above 12), or y-m-d. Null when the value is not date-shaped at all. */
function dateExists(raw: string): boolean | null {
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(raw);
  const ymd = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(raw);
  const real = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();
  if (ymd) return real(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  if (!dmy) return null;
  const y = dmy[3]!.length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  const [a, b] = [Number(dmy[1]), Number(dmy[2])];
  return real(y, b, a) || (b > 12 && real(y, a, b));
}

/** A unit written in an age column that is not that column's unit. */
const OTHER_AGE_UNIT: Record<string, RegExp> = {
  age: /^\d+(\.\d+)?\s*(months?|mths?|mos?|weeks?|wks?|days?|dys?)\.?$/i,
  age_months: /^\d+(\.\d+)?\s*(years?|yrs?|weeks?|wks?|days?|dys?)\.?$/i,
};

/** Fields with a controlled vocabulary in practice, where a word used once
 *  that is one letter from a word the column uses often is worth a look.
 *  Detection only: with no approved dictionary, nothing is ever rewritten. */
const SPELLING_FIELDS = new Set(["product", "reporter_designation"]);
const SPELLING_MIN_COMMON = 5;
const SPELLING_RATIO = 10;

/** One edit apart: one letter inserted, removed, changed, or two adjacent
 *  letters swapped. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff = [...a].map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0);
    return (
      diff.length === 1 ||
      (diff.length === 2 &&
        diff[1] === diff[0]! + 1 &&
        a[diff[0]!] === b[diff[1]!] &&
        a[diff[1]!] === b[diff[0]!])
    );
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  for (let k = 0; k < long.length; k++)
    if (long.slice(0, k) + long.slice(k + 1) === short) return true;
  return false;
}

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
  // How often each word appears in each spelling-checked column.
  const wordCounts = new Map<string, Map<string, number>>();
  for (const header of mapped.filter((h) => SPELLING_FIELDS.has(mapping[h]!))) {
    const counts = new Map<string, number>();
    for (const r of rawRows)
      for (const w of String(r[header] ?? "")
        .toUpperCase()
        .match(/[A-Z]{5,}/g) ?? [])
        counts.set(w, (counts.get(w) ?? 0) + 1);
    wordCounts.set(header, counts);
  }
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
      if (DATE_FIELDS.has(field) && dateExists(raw) === false) {
        issues.push(
          finding(
            row,
            header,
            field,
            raw,
            "IMPOSSIBLE_DATE",
            "HIGH",
            `"${raw}" is not a real calendar date. It is never corrected automatically — check the source.`,
            false,
          ),
        );
        continue;
      }
      if (OTHER_AGE_UNIT[field]?.test(raw)) {
        issues.push(
          finding(
            row,
            header,
            field,
            raw,
            "AGE_UNIT_MISMATCH",
            "MEDIUM",
            `"${raw}": this column is in ${field === "age" ? "years" : "months"}. Not converted automatically — a person enters it in the right column or unit.`,
            false,
          ),
        );
        continue;
      }
      const counts = wordCounts.get(header);
      if (counts) {
        const likely = (raw.toUpperCase().match(/[A-Z]{5,}/g) ?? [])
          .filter((w) => (counts.get(w) ?? 0) === 1)
          .map((w) => {
            const near = [...counts].find(
              ([o, n]) =>
                n >= SPELLING_MIN_COMMON &&
                n >= SPELLING_RATIO * (counts.get(w) ?? 1) &&
                oneEditApart(w, o),
            );
            return near ? { w, o: near[0], n: near[1] } : null;
          })
          .find(Boolean);
        if (likely) {
          issues.push(
            finding(
              row,
              header,
              field,
              raw,
              "POSSIBLE_MISSPELLING",
              "LOW",
              `"${likely.w}" appears once in this column; "${likely.o}" appears ${likely.n} times. Possibly a misspelling — check it; it is never changed automatically.`,
              false,
            ),
          );
          continue;
        }
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
