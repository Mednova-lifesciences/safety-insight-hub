import type { SourceCodebookEntry } from "./discovered-codebook";
import { extractRawMappings } from "./legend-parser";

/**
 * A code list a PERSON typed, pasted or uploaded for a line list — read
 * by rules. Kept apart from legend-parser.ts, which reads a legend found
 * inside an uploaded file and is strict on purpose (a spreadsheet is full
 * of text that only looks like "1 = something"). Here the person has said
 * "this is the code list", so the reader is forgiving about layout:
 *
 *   Reaction type: 1=Fever, 2=Rash          (one line per field)
 *   Outcome                                  (a heading, then one code per line)
 *   1. Recovered
 *   2 - Hospitalised
 *
 * A heading can be the field's ordinary name ("Sex", "Route") or the
 * file's own column header ("Designation of the reporting officer").
 * Lines it cannot place are returned, not guessed — the AI reads those,
 * and a person confirms the result either way.
 */

/** The codebook key each line-list field's codes are stored under. Three
 *  keep the names the existing decoders already use: the reaction code
 *  column decodes through "reaction", and the seriousness CRITERION code
 *  column through "seriousness" — so the yes/no seriousness column needs
 *  a different key. */
export function codebookKeyForField(field: string): string {
  if (field === "reaction_code") return "reaction";
  if (field === "serious_code") return "seriousness";
  if (field === "seriousness") return "seriousness_aggregate";
  return field;
}

/** The line-list field whose cell a codebook key decodes. */
export function fieldForCodebookKey(key: string): string {
  if (key === "seriousness") return "serious_code";
  if (key === "seriousness_aggregate") return "seriousness";
  return key;
}

/** Fields whose codes the specific decoders already handle (reaction
 *  decoding, the outcome and seriousness-criterion concept maps). Every
 *  other key is decoded generically, code → meaning, before any check. */
export const SPECIALLY_DECODED_KEYS = new Set(["reaction", "outcome", "seriousness"]);

/** Plain-language headings for each codebook key, most specific first.
 *  Matched against letters only, so "Age-unit" and "AGE UNIT" agree. */
const HEADINGS: [key: string, stems: string[]][] = [
  [
    "seriousness",
    [
      "seriousnesscriteri",
      "seriouscriteri",
      "ifserious",
      "seriouscase",
      "seriuoscase",
      "seriouscode",
    ],
  ],
  ["seriousness_aggregate", ["typeofaefi", "seriousness", "serious", "seri"]],
  ["age_unit", ["ageunit", "unitofage"]],
  ["age_group", ["agegroup", "ageband", "agecategory"]],
  ["dose_unit", ["doseunit", "unitofdose"]],
  ["reporter_designation", ["designation", "qualification", "cadre", "reportertype", "occupation"]],
  ["route", ["route"]],
  ["sex", ["sex", "gender"]],
  ["outcome", ["outcome"]],
  ["product", ["vaccine", "product", "drug", "medicine"]],
  ["reaction", ["reaction", "adverseevent", "aefitype", "symptom", "event"]],
];

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export interface CodeListColumn {
  header: string;
  /** The line-list field the column is mapped to. */
  field: string;
}

/** The codebook key a heading names, or null. The file's own column
 *  headers are tried first: they are what the person is looking at. */
export function keyForHeading(heading: string, columns: CodeListColumn[] = []): string | null {
  const h = letters(heading);
  if (h.length < 3) return null;
  for (const c of columns) {
    const ch = letters(c.header);
    if (ch.length >= 4 && (h === ch || h.includes(ch) || ch.includes(h)))
      return codebookKeyForField(c.field);
  }
  for (const [key, stems] of HEADINGS) {
    if (stems.some((s) => h.includes(s))) return key;
  }
  return null;
}

export interface ReadCodeListResult {
  entries: SourceCodebookEntry[];
  /** Lines that hold codes but could not be tied to a field — for the AI. */
  unplaced: string[];
}

/** First "code = meaning"-style anchor in a line (same separators the
 *  legend reader accepts), so text before it can be read as a heading. */
const FIRST_CODE = /(^|[\s,;(])(\d{1,3})\s*(?:[=:)-]|\.(?=\s))/;

export function readCodeListText(text: string, columns: CodeListColumn[] = []): ReadCodeListResult {
  const entries: SourceCodebookEntry[] = [];
  const unplaced: string[] = [];
  let currentKey: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const first = FIRST_CODE.exec(line);
    const headingPart = first ? line.slice(0, first.index + first[1]!.length) : line;
    const listPart = first ? line.slice(first.index + first[1]!.length) : "";

    // A leading enumeration ("1) REACTION TYPE : 1=…") is part of the
    // heading, not a code: there is text and then another code after it.
    const enumerated = /^\s*\d{1,2}\)\s*([A-Za-z].*)$/.exec(line);
    if (enumerated && FIRST_CODE.test(enumerated[1]!)) {
      const inner = enumerated[1]!;
      const m = FIRST_CODE.exec(inner)!;
      const key = keyForHeading(inner.slice(0, m.index + m[1]!.length), columns);
      if (key) currentKey = key;
      addAll(inner.slice(m.index + m[1]!.length));
      continue;
    }

    const headingKey =
      letters(headingPart).length >= 3 ? keyForHeading(headingPart, columns) : null;
    if (headingKey) currentKey = headingKey;
    else if (letters(headingPart).length >= 3 && !listPart) {
      // A heading-shaped line we cannot place: what follows is unplaceable
      // until a recognisable heading appears.
      currentKey = null;
      unplaced.push(line);
      continue;
    }
    if (listPart) addAll(listPart);
  }

  function addAll(part: string) {
    // "1)" is accepted as a separator in typed lists ("1) Fever").
    // A meaning must have a letter: "(codes 1-28)" in a heading is a range,
    // not code 1 meaning "28)".
    const mappings = extractRawMappings(part.replace(/(\d{1,3})\)\s*/g, "$1= ")).filter((m) =>
      /[A-Za-z]/.test(m.meaning),
    );
    if (mappings.length === 0) return;
    if (!currentKey) {
      unplaced.push(part.trim());
      return;
    }
    for (const { code, meaning } of mappings) {
      entries.push({ field: currentKey, sourceCode: code, meaning: meaning.trim() });
    }
  }

  return { entries, unplaced };
}

/**
 * Replaces a coded cell with its meaning, for every field the profile has
 * a code list for EXCEPT the three with decoders of their own (reaction,
 * outcome, seriousness criterion). Sex "1" becomes "Male" before the sex
 * check or mapping ever sees it, so the rest of the engine needs no
 * knowledge of code lists. A code the list does not define is left as it
 * is, and is flagged by the field's own check exactly as before. Pure.
 */
export function decodeCodedFields<R extends object>(
  row: R,
  fieldCodebooks: Record<string, { entries: Record<string, { meaning: string }> }> | undefined,
): R {
  if (!fieldCodebooks) return row;
  let out: R | null = null;
  for (const [key, codebook] of Object.entries(fieldCodebooks)) {
    if (SPECIALLY_DECODED_KEYS.has(key)) continue;
    const field = fieldForCodebookKey(key);
    const cell = (row as Record<string, unknown>)[field];
    const value = typeof cell === "string" ? cell.trim() : "";
    if (!value) continue;
    const hit = codebook.entries[value.toUpperCase()];
    if (!hit) continue;
    out = { ...(out ?? row), [field]: hit.meaning };
  }
  return out ?? row;
}

/** Problems a person must see before confirming: one code given two
 *  meanings within a field. Identical repeats are merged. */
export function findCodeListConflicts(entries: SourceCodebookEntry[]): {
  entries: SourceCodebookEntry[];
  conflicts: { field: string; sourceCode: string; meanings: string[] }[];
} {
  const byKey = new Map<string, SourceCodebookEntry[]>();
  for (const e of entries) {
    const k = `${e.field}\u0000${e.sourceCode.trim().toUpperCase()}`;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const out: SourceCodebookEntry[] = [];
  const conflicts: { field: string; sourceCode: string; meanings: string[] }[] = [];
  for (const group of byKey.values()) {
    const meanings = [...new Set(group.map((g) => g.meaning.trim()))];
    if (meanings.length > 1) {
      conflicts.push({ field: group[0]!.field, sourceCode: group[0]!.sourceCode, meanings });
    } else out.push(group[0]!);
  }
  return { entries: out, conflicts };
}
