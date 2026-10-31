import { mapAgeUnit, mapSex } from "@/services/e2b-r3/mapping";
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
  /** `header` is the column's own header text, for a rule that reads a
   *  unit the header states. */
  apply: (
    value: string,
    field: string,
    header: string,
  ) => Omit<Normalisation, "rule" | "version"> | null;
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
  "age_weeks",
  "age_days",
  "sex",
  "outcome",
  "serious_code",
  "reaction_code",
] as const;

const DATE_FIELDS = [
  "vaccination_date",
  "onset_date",
  "report_date",
  "state_received_date",
  "national_received_date",
  "date_of_birth",
] as const;

/** Typing slips between two words: a letter added, missing or wrong, or
 *  two neighbouring letters swapped, each counting one. */
function slips(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/** Of `choices` (each a group of spellings of one value), the one group
 *  `written` is within a slip of — two for spellings of eight letters or
 *  more — or null when no group is, or more than one is. */
function onlyNear<T>(
  written: string,
  choices: readonly (readonly [T, readonly string[]])[],
): T | null {
  const near = choices.filter(([, words]) =>
    words.some((w) => slips(written, w) <= (w.length >= 8 ? 2 : 1)),
  );
  return near.length === 1 ? near[0]![0] : null;
}

const letterWords = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");

const AGE_UNITS = [
  ["Days", ["day", "days"]],
  ["Weeks", ["week", "weeks"]],
  ["Months", ["month", "months"]],
  ["Years", ["year", "years"]],
  ["Hours", ["hour", "hours"]],
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
    id: "date-year-repeated-digit",
    version: "1",
    fields: [
      "vaccination_date",
      "onset_date",
      "report_date",
      "state_received_date",
      "national_received_date",
      "date_of_birth",
    ],
    precondition:
      "a d/m/y or y-m-d date whose year has five digits, where dropping one digit of an adjacent repeated pair gives exactly one year between 1900 and next year, and the day and month are valid",
    never: "changes a day or month, expands a two-digit year, or picks between two possible years",
    apply: (value) => {
      const v = value.trim();
      const dmy = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{5})$/.exec(v);
      const ymd = /^(\d{5})([/.-])(\d{1,2})\2(\d{1,2})$/.exec(v);
      const m = dmy ?? ymd;
      if (!m) return null;
      const [day, month, year] = dmy ? [m[1]!, m[3]!, m[4]!] : [m[4]!, m[3]!, m[1]!];
      if (!(Number(day) >= 1 && Number(day) <= 31 && Number(month) >= 1 && Number(month) <= 12))
        return null;
      const maxYear = new Date().getFullYear() + 1;
      const years = new Set<string>();
      for (let k = 1; k < year.length; k++)
        if (year[k] === year[k - 1]) {
          const y = year.slice(0, k) + year.slice(k + 1);
          if (Number(y) >= 1900 && Number(y) <= maxYear) years.add(y);
        }
      if (years.size !== 1) return null;
      const y = [...years][0]!;
      const sep = m[2]!;
      return {
        value: dmy ? `${day}${sep}${month}${sep}${y}` : `${y}${sep}${month}${sep}${day}`,
        why: "a repeated digit removed from a five-digit year",
      };
    },
  },
  {
    id: "date-doubled-separator",
    version: "1",
    fields: [
      "vaccination_date",
      "onset_date",
      "report_date",
      "state_received_date",
      "national_received_date",
      "date_of_birth",
    ],
    precondition:
      "a separator written twice (// -- ..) inside a date whose three parts are otherwise a valid d/m/y or y-m-d with one kind of separator",
    never: "merges different separators, or changes any digit",
    apply: (value) => {
      const v = value.trim();
      const out = v.replace(/([/.-])\1+/g, "$1");
      if (out === v) return null;
      const dmy = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{2}|\d{4})$/.exec(out);
      const ymd = /^(\d{4})([/.-])(\d{1,2})\2(\d{1,2})$/.exec(out);
      const [d, m] = dmy ? [dmy[1], dmy[3]] : ymd ? [ymd[4], ymd[3]] : [];
      return d && m && Number(d) >= 1 && Number(d) <= 31 && Number(m) >= 1 && Number(m) <= 12
        ? { value: out, why: "a doubled date separator removed" }
        : null;
    },
  },
  {
    id: "time-letter-for-digit",
    version: "1",
    fields: ["vaccination_time"],
    precondition:
      "a letter O sits where a digit belongs (next to a digit, a colon or another such O), the value has at least one real digit, and replacing those Os with 0 gives a valid clock time (h:mm, with AM/PM 1–12, otherwise 0–23)",
    never: "changes a value that is not then a valid time, or one made only of letters",
    apply: (value) => {
      const v = value.trim();
      if (!/[Oo]/.test(v) || !/\d/.test(v)) return null;
      const out = v.replace(/(?<=[\d:Oo])[Oo]|[Oo](?=[\d:Oo])/g, "0");
      const t = /^(\d{1,2}):(\d{2})(\s*([AaPp])\.?[Mm]\.?)?$/.exec(out);
      if (!t || out === v) return null;
      const h = Number(t[1]);
      const ok = (t[4] ? h >= 1 && h <= 12 : h <= 23) && Number(t[2]) <= 59;
      return ok ? { value: out, why: "a letter O typed for a zero in the time" } : null;
    },
  },
  {
    id: "stray-edge-asterisk",
    version: "1",
    fields: TYPED_FIELDS,
    precondition:
      "an asterisk at either end of a date, batch, dose, age, sex, outcome or code, and removing it leaves the letters and digits exactly as they were",
    never: "removes an asterisk inside the value, or any other character",
    apply: (value) => {
      const v = value
        .trim()
        .replace(/^\*+\s*/, "")
        .replace(/\s*\*+$/, "");
      return v && v !== value.trim() && alnum(v) === alnum(value)
        ? { value: v, why: "a stray asterisk at the edge removed" }
        : null;
    },
  },
  {
    id: "date-letter-for-digit",
    version: "1",
    fields: DATE_FIELDS,
    precondition:
      "a d/m/y or y-m-d date with at least one real digit, in which a letter O stands for 0 or a letter I or l for 1, and replacing them gives a valid day, month and a year from 1900 to next year (or two digits)",
    never: "changes a digit, or a value that is not then a valid date",
    apply: (value) => {
      const v = value.trim();
      if (!/[OoIl]/.test(v) || !/\d/.test(v)) return null;
      const part = "[\\dOoIl]";
      const shape = new RegExp(
        `^(?:${part}{1,2}([/.-])${part}{1,2}\\1(?:${part}{2}|${part}{4})|${part}{4}([/.-])${part}{1,2}\\2${part}{1,2})$`,
      );
      if (!shape.test(v)) return null;
      const out = v.replace(/[Oo]/g, "0").replace(/[Il]/g, "1");
      const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(out);
      const ymd = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(out);
      const [d, m, y] = dmy ? [dmy[1], dmy[2], dmy[3]] : ymd ? [ymd[3], ymd[2], ymd[1]] : [];
      const maxYear = new Date().getFullYear() + 1;
      const yearOk = y?.length === 2 || (Number(y) >= 1900 && Number(y) <= maxYear);
      return d &&
        m &&
        Number(d) >= 1 &&
        Number(d) <= 31 &&
        Number(m) >= 1 &&
        Number(m) <= 12 &&
        yearOk
        ? { value: out, why: "a letter typed for a digit (O for 0, I or l for 1)" }
        : null;
    },
  },
  {
    id: "seriousness-spelling",
    version: "1",
    fields: ["seriousness"],
    precondition:
      "a value the app does not read as serious or non-serious, whose letters are within one typing slip of exactly one of Serious and Non-serious (two for Non-serious), or the phrase 'not serious'",
    never: "changes a value the app already reads, or turns serious into non-serious or back",
    apply: (value) => {
      const l = letterWords(value);
      if (!l || ["serious", "nonserious", "yes", "no", "y", "n"].includes(l)) return null;
      const word =
        l === "notserious"
          ? "Non-serious"
          : onlyNear(l, [
              ["Serious", ["serious"]],
              ["Non-serious", ["nonserious"]],
            ] as const);
      return word ? { value: matchCase(value.trim(), word), why: `read as ${word}` } : null;
    },
  },
  {
    id: "age-unit-spelling",
    version: "1",
    fields: ["age_unit"],
    precondition:
      "a unit the app does not read, of two letters or more, within one typing slip of exactly one of days, weeks, months, years or hours",
    never: "changes a unit the app already reads, or guesses between two units",
    apply: (value) => {
      if (mapAgeUnit(value)) return null;
      const l = letterWords(value);
      if (l.length < 2) return null;
      const unit = onlyNear(l, AGE_UNITS);
      return unit ? { value: matchCase(value.trim(), unit), why: `read as ${unit}` } : null;
    },
  },
  {
    id: "sex-spelling",
    version: "1",
    fields: ["sex"],
    precondition:
      "a value the app does not read as a sex, within one typing slip of exactly one of Male and Female",
    never: "changes a value the app already reads, or turns one sex into the other",
    apply: (value) => {
      if (mapSex(value)) return null;
      const l = letterWords(value);
      if (l.length < 3) return null;
      const sex = onlyNear(l, [
        ["Male", ["male"]],
        ["Female", ["female"]],
      ] as const);
      return sex ? { value: matchCase(value.trim(), sex), why: `read as ${sex}` } : null;
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
    version: "3",
    fields: ["dose"],
    precondition:
      "one number with a decimal comma and one or two decimal digits, followed by a volume unit (ml), e.g. 0,5ML — or such a number (0,5) in a column whose header states mL",
    never:
      "touches a comma with no unit in the cell or the header, more than one comma (it may separate values), or three digits after it (1,000 ml: a thousands separator or a decimal? a person decides)",
    apply: (value, _field, header) => {
      const m = /^(\d+),(\d{1,2})(\s*)(ml)$/i.exec(value.trim());
      if (m)
        return { value: `${m[1]}.${m[2]}${m[3]}${m[4]}`, why: "decimal comma written as a point" };
      const bare = /^(\d{1,2}),(\d{1,2})$/.exec(value.trim());
      return bare && headerStatesMl(header)
        ? {
            value: `${bare[1]}.${bare[2]}`,
            why: "decimal comma written as a point (the header gives the unit as mL)",
          }
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
      "the value is only numeric codes separated by punctuation; a trailing delimiter is dropped and & between codes is written as a comma",
    never:
      "rewrites a word between codes (AND, OR — a word may carry meaning; flagged instead), or changes, adds or reorders a code",
    apply: (value) => {
      const v = value.trim();
      if (!/^\d+(\s*(,|;|\/|&)\s*\d+)*\s*[,;/]?\s*$/.test(v)) return null;
      const out = v.replace(/\s*[,;/]\s*$/, "").replace(/\s*&\s*/g, ", ");
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

/** The header states the column's unit as millilitres ("Volume (mL)",
 *  "DOSE_VOL_ML"). Underscores and hyphens separate words here, exactly as
 *  spaces do; the column's name itself is never changed. */
export const HEADER_ML = /\b(ml|mls|millilit(?:re|er)s?)\b/i;
export function headerStatesMl(header: string): boolean {
  return HEADER_ML.test(header.replace(/[_-]+/g, " "));
}

/** The first rule that applies to this value in this field, if any.
 *  `header` is the column's header text (see NormalisationRule.apply). */
export function normalise(field: string, value: string, header = ""): Normalisation | null {
  if (!value.trim()) return null;
  for (const rule of NORMALISATION_RULES) {
    if (!rule.fields.includes(field)) continue;
    const r = rule.apply(value, field, header);
    if (r && r.value !== value) return { ...r, rule: rule.id, version: rule.version };
  }
  return null;
}

/** True when `after` only turns a decimal comma in `before` into a point
 *  in a dose, and the rule dose-decimal-comma would not: the unit is stated
 *  neither in the cell nor in the column header, so the comma may separate
 *  two values. Whatever proposes such a change (the AI) is refused — it may
 *  not do what the rule declines. The server runs the same check. */
export function unestablishedDecimalComma(
  field: string,
  before: string,
  after: string,
  header: string,
): boolean {
  if (field !== "dose") return false;
  const b = before.trim();
  const a = after.trim();
  if (!b.includes(",") || a !== b.replace(/,/g, ".")) return false;
  return normalise(field, b, header)?.value !== a;
}
