import { unitForSpelling } from "./linelist-onset";

/**
 * Deterministic normalisation: corrections that follow from the value
 * itself under a named, versioned rule, so Fix applies them without the AI
 * and gives the same answer every run. Each rule states the fields it may
 * touch, the precondition that makes the result unambiguous, and what it
 * must never do. Anything outside a rule's precondition is not corrected
 * here (it may still be flagged elsewhere, or offered to the AI).
 *
 * Never applied to identifiers, names, phone numbers, addresses or free
 * text: those fields are not in any rule's field list.
 */

export interface Normalisation {
  value: string;
  rule: string;
  version: string;
  /** What changed, for the finding's message and the change log. */
  why: string;
}

export interface NormalisationRule {
  id: string;
  version: string;
  fields: readonly string[];
  precondition: string;
  never: string;
  apply: (value: string, field: string) => Omit<Normalisation, "rule" | "version"> | null;
}

const alnum = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const matchCase = (written: string, word: string) =>
  written === written.toUpperCase() ? word.toUpperCase() : word;

const ORDINAL = (n: number) =>
  n % 100 >= 11 && n % 100 <= 13
    ? "th"
    : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
const ORDINAL_SUFFIXES = new Set(["st", "nd", "rd", "th"]);

const TYPED_FIELDS = [
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
] as const;

export const NORMALISATION_RULES: readonly NormalisationRule[] = [
  {
    id: "stray-edge-character",
    version: "1",
    fields: TYPED_FIELDS,
    precondition:
      "a spreadsheet text marker (') at either end, a leading : ; or , — or, except on reaction codes, a trailing , ; or : — and removing it leaves the letters and digits exactly as they were",
    never: "removes '-', '+' or '.', or any character inside the value",
    apply: (value, field) => {
      let v = value.trim().replace(/^'+/, "").replace(/'+$/, "").trim();
      v = v.replace(/^[:;,]+\s*/, "");
      if (field !== "reaction_code") v = v.replace(/\s*[,;:]+$/, "");
      v = v.trim();
      return v && v !== value.trim() && alnum(v) === alnum(value)
        ? { value: v, why: "a stray character at the edge removed" }
        : null;
    },
  },
  {
    id: "interval-unit-spelling",
    version: "1",
    fields: ["onset_interval"],
    precondition:
      "every part is a number and a unit word that the onset reader's dictionary maps to exactly one unit (minutes, hours, days, weeks), and at least one word is a non-standard spelling",
    never: "guesses a unit for a word the dictionary does not know, or changes a number",
    apply: (value) => {
      const v = value.trim();
      const part = /(\d+(?:\.\d+)?)(\s*)([A-Za-z]+)\.?/g;
      let changed = false;
      let ok = true;
      const out = v.replace(part, (_m, n: string, gap: string, word: string) => {
        const unit = unitForSpelling(word);
        if (!unit) {
          ok = false;
          return _m;
        }
        if (unit.standard) return `${n}${gap}${word}`;
        changed = true;
        return `${n}${gap || " "}${matchCase(word, Number(n) === 1 ? unit.singular : unit.plural)}`;
      });
      const leftover = v.replace(part, "").replace(/[\s,&]|and/gi, "");
      return ok && changed && !leftover
        ? { value: out, why: "the time unit's spelling standardised" }
        : null;
    },
  },
  {
    id: "dose-decimal-comma",
    version: "1",
    fields: ["dose"],
    precondition:
      "one number with a decimal comma followed by a volume unit (ml), e.g. 0,5ML — the unit shows it is one quantity",
    never: "touches a comma without a unit after it (it may separate two values)",
    apply: (value) => {
      const m = /^(\d+),(\d+)(\s*)(ml)$/i.exec(value.trim());
      return m
        ? { value: `${m[1]}.${m[2]}${m[3]}${m[4]}`, why: "decimal comma written as a point" }
        : null;
    },
  },
  {
    id: "ordinal-suffix-typo",
    version: "1",
    fields: ["dose"],
    precondition:
      "a number followed by two letters that are not an ordinal suffix at all, one letter away from the only correct suffix for that number (1at → 1st, 2nf → 2nd)",
    never:
      "changes the number, or a valid suffix that merely mismatches the number (1nd stays: 1st or 2nd?)",
    apply: (value) => {
      const m = /^(\d{1,2})([A-Za-z]{2})(\s+dose)?$/i.exec(value.trim());
      if (!m) return null;
      const n = Number(m[1]);
      const written = m[2]!;
      const lower = written.toLowerCase();
      const right = ORDINAL(n);
      if (ORDINAL_SUFFIXES.has(lower)) return null;
      const diff = [...lower].filter((c, i) => c !== right[i]).length;
      return diff === 1
        ? {
            value: `${m[1]}${matchCase(written, right)}${m[3] ?? ""}`,
            why: "ordinal suffix typo corrected",
          }
        : null;
    },
  },
  {
    id: "code-list-delimiters",
    version: "1",
    fields: ["reaction_code"],
    precondition:
      "the value is only numeric codes separated by delimiters; a trailing delimiter is dropped and AND / & / + between codes is written as a comma",
    never: "touches a value with any word other than AND, or changes, adds or reorders a code",
    apply: (value) => {
      const v = value.trim();
      if (!/^\d+(\s*(,|;|\/|&|\+|\band\b)\s*\d+)*\s*[,;/]?\s*$/i.test(v)) return null;
      const out = v.replace(/\s*[,;/]\s*$/, "").replace(/\s*(?:&|\+|\band\b)\s*/gi, ", ");
      return out !== v ? { value: out, why: "code-list delimiters made consistent" } : null;
    },
  },
  {
    id: "unit-in-own-column",
    version: "1",
    fields: ["age", "age_months"],
    precondition:
      "a whole number followed by the column's own unit (years in an age-in-years column, months in a months column)",
    never: 'removes a unit that differs from the column\'s ("9 months" in a years column stays)',
    apply: (value, field) => {
      const unit =
        field === "age_months"
          ? /^(\d{1,3})\s*(months?|mths?|mos?)\.?$/i
          : /^(\d{1,3})\s*(years?|yrs?)\.?$/i;
      const m = unit.exec(value.trim());
      return m ? { value: m[1]!, why: "the column's own unit removed from the number" } : null;
    },
  },
];

/** The first rule that applies to this value in this field, if any. */
export function normalise(field: string, value: string): Normalisation | null {
  if (!value.trim()) return null;
  for (const rule of NORMALISATION_RULES) {
    if (!rule.fields.includes(field)) continue;
    const r = rule.apply(value, field);
    if (r && r.value !== value) return { ...r, rule: rule.id, version: rule.version };
  }
  return null;
}
