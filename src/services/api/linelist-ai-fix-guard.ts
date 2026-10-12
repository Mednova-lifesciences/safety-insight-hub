/**
 * What Fix accepts from the AI.
 *
 * The AI is told never to invent a value, but an instruction is not a
 * control: an audit applied an invented date, an invented age and a
 * changed patient record number, emptied a cell whose move had been
 * refused, and applied both of two conflicting answers for one cell. This
 * module is the control. It runs in the app on every AI answer, and the
 * same rules run on the backend (src/server/ai/fix_guard.py) before an
 * answer leaves the server. Both are tested against fix-guard-vectors.json
 * so they cannot drift apart.
 */

/** Columns no automated fix may write to, or move a value out of. */
const PROTECTED_FIELDS = new Set(["case_id", "patient_id", "previous_case_id"]);

/** The kind of value a field holds, where it has a recognisable shape. */
const FIELD_KIND: Record<string, "date" | "age" | "sex" | "phone"> = {
  vaccination_date: "date",
  report_date: "date",
  onset_date: "date",
  date_of_birth: "date",
  state_received_date: "date",
  national_received_date: "date",
  age: "age",
  sex: "sex",
  reporter_phone: "phone",
};

/** The evidence that settles an ambiguous move: the destination is filled
 *  in at least this share of the whole file's rows… */
export const MOVE_FILL_DESTINATION = 0.9;
/** …and every other open column of the same kind in at most this share. */
export const MOVE_FILL_OTHERS = 0.5;

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const alnum = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const digits = (v: string) => v.replace(/\D/g, "");
const letters = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");

/** The kind of a value, or null when it has no recognisable shape. */
export function valueKind(value: string): "date" | "age" | "sex" | "phone" | null {
  const v = value.trim();
  if (/^\d{1,2}[/.-]\d{1,2}[/.-](\d{2}|\d{4})$/.test(v) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(v))
    return "date";
  if (/^(m|f|male|female)$/i.test(v)) return "sex";
  if (/^\+?\d{10,14}$/.test(v.replace(/[\s-]/g, ""))) return "phone";
  if (/^\d{1,3}(\.\d+)?$/.test(v) && Number(v) <= 130) return "age";
  return null;
}

/** `small` is `big` with one character removed that repeats the one next
 *  to it ("2026" from "20226") — a doubled keystroke, not a new value. */
function dropsOneRepeat(big: string, small: string): boolean {
  if (big.length !== small.length + 1) return false;
  for (let k = 0; k < big.length; k++) {
    const repeats = big[k] === big[k - 1] || big[k] === big[k + 1];
    if (repeats && big.slice(0, k) + big.slice(k + 1) === small) return true;
  }
  return false;
}

/** A letter typo: the same length with at most `max` letters substituted,
 *  or one doubled letter added or removed ("vacine" ↔ "vaccine"). Never
 *  deleting or adding letters that change the word ("FEMALE" → "MALE"). */
function letterTypo(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === b.length) {
    let diff = 0;
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff++;
    return a.length >= 2 && diff <= (a.length <= 3 ? 1 : 2);
  }
  return dropsOneRepeat(a, b) || dropsOneRepeat(b, a);
}

/** A day-first date (d/m/yy or d/m/yyyy) rewritten as yyyy-mm-dd with the
 *  same day, month and year — the app reads numeric dates day-first. */
function sameDateAsIso(from: string, to: string): boolean {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(to.trim());
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(from.trim());
  if (!iso || !dmy) return false;
  return (
    Number(iso[3]) === Number(dmy[1]) &&
    Number(iso[2]) === Number(dmy[2]) &&
    iso[1]!.endsWith(dmy[3]!)
  );
}

/**
 * Whether `to` can be written over `from` without inventing anything:
 *  - the same letters and digits, only formatting changed (separators,
 *    stray characters, spaces, case): "02/02/2026'" → "02/02/2026";
 *  - a letter typo (see letterTypo) with the digits unchanged, or one
 *    doubled digit dropped with the letters unchanged: "MINITES" →
 *    "MINUTES", "1at" → "1st", "20226" → "2026";
 *  - a day-first date written as ISO with the same day, month and year;
 *  - a value another cell of the same row holds (a swap or relocation).
 * Never: a changed or reordered digit, a different word, a dropped word,
 * an unfamiliar format converted, an empty value, or anything new. A
 * dropped word is information lost: "28 PAIN AT…" → "28" deletes the
 * specification an "Others (specify)" code requires.
 */
export function isDerivedValue(from: string, to: string, rowValues: string[]): boolean {
  const a = trimmed(from);
  const b = trimmed(to);
  if (!b) return false;
  if (rowValues.some((v) => trimmed(v) !== "" && trimmed(v) === b && trimmed(v) !== a)) return true;
  if (alnum(a) === alnum(b)) return true;
  if (sameDateAsIso(a, b)) return true;
  const sameDigits = digits(a) === digits(b);
  const sameLetters = letters(a) === letters(b);
  if (sameDigits && !sameLetters && letters(a).length >= 2)
    return letterTypo(letters(a), letters(b));
  if (sameLetters && !sameDigits && digits(b).length > 0)
    return dropsOneRepeat(digits(a), digits(b));
  return false;
}

export interface AiCorrection {
  row: number;
  column: string;
  new_value: string;
  reason: string;
}

/** A refused answer keeps what the AI proposed, so a person (and the audit
 *  evidence) can see whether the AI was wrong or the rule too strict. */
type Refusal = { row: number; column: string; reason: string; proposed?: string };

const isWellFormed = (c: unknown): c is AiCorrection =>
  !!c &&
  typeof c === "object" &&
  Number.isInteger((c as AiCorrection).row) &&
  typeof (c as AiCorrection).column === "string" &&
  typeof (c as AiCorrection).new_value === "string";

/**
 * The AI corrections Fix applies, and the ones it refuses with a reason.
 *
 * Applied: a well-formed answer for a cell Fix asked about, not an
 * identifier, the AI's only answer for that cell, with a derived value.
 * Or both halves of a MOVE: a flagged value relocated, exactly as
 * written, into an empty cell of the same row, the flagged cell changed
 * in the same answer — and only when the destination is unambiguous: the
 * value has a recognisable kind (date, age, sex, phone) and the
 * destination is the only empty column of that kind in the row, or the
 * file-wide fill rates single it out. Both halves share a `group` so one
 * Undo returns both. A cell is emptied only as the source of an applied
 * move. Everything else is refused and reported.
 */
export function acceptedAiCorrections(
  corrections: unknown[],
  requested: { row: number; column: string }[],
  rows: Record<string, string | undefined>[],
  mapping: Record<string, string>,
  groupPrefix = "ai-move",
  columnFill: Record<string, number> = {},
): { accepted: (AiCorrection & { group?: string })[]; rejected: Refusal[] } {
  const key = (r: number, c: string) => `${r}:${c}`;
  const asked = new Set(requested.map((r) => key(r.row, r.column)));
  const rejected: Refusal[] = [];
  const reject = (c: { row: number; column: string; new_value?: unknown }, reason: string) => {
    if (!rejected.some((x) => x.row === c.row && x.column === c.column))
      rejected.push({
        row: c.row,
        column: c.column,
        reason,
        ...(typeof c.new_value === "string" ? { proposed: c.new_value } : {}),
      });
  };

  // Malformed answers are refused, never guessed at.
  const formed: AiCorrection[] = [];
  for (const c of corrections) {
    if (isWellFormed(c))
      formed.push({ ...c, reason: typeof c.reason === "string" ? c.reason : "" });
    else if (
      c &&
      typeof c === "object" &&
      Number.isInteger((c as AiCorrection).row) &&
      typeof (c as AiCorrection).column === "string"
    )
      reject(
        c as AiCorrection,
        "The AI's answer for this cell was malformed, so it was left as it is.",
      );
  }

  // One answer per cell: identical repeats collapse; different answers
  // mean the AI is unsure, so the cell is left alone.
  const byCell = new Map<string, AiCorrection>();
  const conflicted = new Set<string>();
  for (const c of formed) {
    const k = key(c.row, c.column);
    const seen = byCell.get(k);
    if (seen && trimmed(seen.new_value) !== trimmed(c.new_value)) conflicted.add(k);
    else if (!seen) byCell.set(k, c);
  }
  for (const k of conflicted) {
    reject(
      byCell.get(k)!,
      "The AI gave conflicting answers for this cell, so it was left as it is.",
    );
    byCell.delete(k);
  }

  const cellValue = (row: number, column: string) => trimmed(rows[row - 1]?.[column]);
  const isProtected = (column: string) => PROTECTED_FIELDS.has(mapping[column] ?? "");
  const known = (column: string) => column in mapping;

  // Moves.
  const moveOf = new Map<string, { target: AiCorrection; source: AiCorrection }>();
  const ambiguous = new Set<string>();
  for (const c of byCell.values()) {
    if (asked.has(key(c.row, c.column)) || !known(c.column) || isProtected(c.column)) continue;
    const row = rows[c.row - 1];
    if (!row || cellValue(c.row, c.column) !== "") continue;
    const value = trimmed(c.new_value);
    if (!value) continue;
    const source = [...byCell.values()].find(
      (s) =>
        s.row === c.row &&
        asked.has(key(s.row, s.column)) &&
        !isProtected(s.column) &&
        cellValue(s.row, s.column) === value,
    );
    if (!source) continue;
    const kind = valueKind(value);
    if (!kind || FIELD_KIND[mapping[c.column] ?? ""] !== kind) {
      ambiguous.add(key(c.row, c.column));
      continue;
    }
    const candidates = Object.keys(row).filter(
      (h) => h !== source.column && FIELD_KIND[mapping[h] ?? ""] === kind && trimmed(row[h]) === "",
    );
    const settled =
      candidates.length === 1 ||
      ((columnFill[c.column] ?? 0) >= MOVE_FILL_DESTINATION &&
        candidates.every((h) => h === c.column || (columnFill[h] ?? 1) <= MOVE_FILL_OTHERS));
    if (settled) moveOf.set(key(c.row, c.column), { target: c, source });
    else ambiguous.add(key(c.row, c.column));
  }
  const groupFor = (row: number, sourceColumn: string) => `${groupPrefix}-${row}-${sourceColumn}`;
  const sourceMove = new Map(
    [...moveOf.values()].map((m) => [key(m.source.row, m.source.column), m]),
  );

  const accepted: (AiCorrection & { group?: string })[] = [];
  for (const c of byCell.values()) {
    const k = key(c.row, c.column);
    if (!known(c.column) || !rows[c.row - 1]) {
      reject(c, "The AI named a row or column that does not exist, so nothing was changed.");
      continue;
    }
    if (isProtected(c.column)) {
      reject(c, "Identifiers (case ID, patient record number) are never changed by Fix.");
      continue;
    }
    const move = moveOf.get(k);
    if (move) {
      accepted.push({ ...c, group: groupFor(c.row, move.source.column) });
      continue;
    }
    if (!asked.has(k)) {
      reject(
        c,
        ambiguous.has(k)
          ? "Ambiguous destination: more than one empty column could hold this value, so it was left for a person."
          : "Fix did not ask about this cell, and it is not a valid move into an empty cell.",
      );
      continue;
    }
    if (trimmed(c.new_value) === "") {
      const m = sourceMove.get(k);
      if (m) accepted.push({ ...c, group: groupFor(c.row, m.source.column) });
      else
        reject(
          c,
          "The AI would have emptied this cell without putting its value anywhere, so it was left as it is.",
        );
      continue;
    }
    // A value may come from another cell of the row only when that cell is
    // itself changed by this answer (a swap or a move). A value copied from
    // a cell that keeps it is an inference — "12-Feb" given the year of the
    // vaccination date — not a correction.
    const others = Object.entries(rows[c.row - 1] ?? {})
      .filter(([column, value]) => {
        const answer = byCell.get(key(c.row, column));
        return column !== c.column && !!answer && trimmed(answer.new_value) !== trimmed(value);
      })
      .map(([, value]) => trimmed(value));
    if (!isDerivedValue(cellValue(c.row, c.column), c.new_value, others)) {
      reject(
        c,
        "The AI proposed a value that is not in this cell or this row — Fix never invents a value.",
      );
      continue;
    }
    accepted.push(c);
  }
  return { accepted, rejected };
}
