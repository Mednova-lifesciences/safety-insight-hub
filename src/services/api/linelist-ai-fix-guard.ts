/**
 * What Fix accepts from the AI.
 *
 * The AI is told never to invent a value, but an instruction is not a
 * control: an audit applied an invented date, an invented age and a
 * changed patient record number, emptied a cell whose move had been
 * refused, and applied both of two conflicting answers for one cell. This
 * module is the control. It runs in the app on every AI answer, whatever
 * the answer claims.
 */

/** Columns no automated fix may write to, or move a value out of. */
const PROTECTED_FIELDS = new Set(["case_id", "patient_id", "previous_case_id"]);

const trimmed = (v: unknown) => String(v ?? "").trim();
const alnum = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const digits = (v: string) => v.replace(/\D/g, "");
const letters = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** True when `small`'s characters appear in `big` in order (deletions only). */
function isSubsequence(small: string, big: string): boolean {
  let i = 0;
  for (const ch of big) if (ch === small[i]) i++;
  return i === small.length;
}

/** A day-first date (d/m/yy or d/m/yyyy) rewritten as yyyy-mm-dd with the
 *  same day, month and year — the app reads numeric dates day-first. */
function sameDateAsIso(from: string, to: string): boolean {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(to.trim());
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(from.trim());
  if (!iso || !dmy) return false;
  const [, y, m, d] = iso.map(Number) as number[];
  const [, dd, mm, yy] = dmy as unknown as [string, string, string, string];
  return d === Number(dd) && m === Number(mm) && String(y).endsWith(yy);
}

/**
 * Whether `to` can be written over `from` without inventing anything:
 *  - the same letters and digits, only formatting changed (separators,
 *    stray characters, spaces, case): "02/02/2026'" → "02/02/2026";
 *  - the leading part of the cell, whole words: "28 PAIN AT…" → "28";
 *  - a small typo in the letters, digits only ever dropped, never added or
 *    changed: "MINITES" → "MINUTES", "1at" → "1st", "20226" → "2026";
 *  - a day-first date written as ISO with the same day, month and year;
 *  - a value another cell of the same row holds (a swap or relocation).
 * Never: a changed digit (a different year, day or count), day and month
 * swapped, or anything new.
 */
export function isDerivedValue(from: string, to: string, rowValues: string[]): boolean {
  const a = trimmed(from);
  const b = trimmed(to);
  if (!b) return false;
  if (rowValues.some((v) => trimmed(v) !== "" && trimmed(v) === b && trimmed(v) !== a)) return true;
  if (alnum(a) === alnum(b)) return true;
  const words = a.toLowerCase().split(/\s+/);
  const keep = b.toLowerCase().split(/\s+/);
  if (keep.length < words.length && keep.every((w, i) => w === words[i])) return true;
  if (sameDateAsIso(a, b)) return true;
  const da = digits(a);
  const db = digits(b);
  const digitsOk =
    da === db || (db.length >= da.length - 1 && db.length > 0 && isSubsequence(db, da));
  const la = letters(a);
  const lb = letters(b);
  // One letter edit in a short word, at most two in a longer one.
  const lettersOk =
    la === lb || (la.length >= 2 && editDistance(la, lb) <= (la.length <= 3 ? 1 : 2));
  return digitsOk && lettersOk && editDistance(alnum(a), alnum(b)) <= 2 && alnum(b).length >= 2;
}

export interface AiCorrection {
  row: number;
  column: string;
  new_value: string;
  reason: string;
}

/**
 * The AI corrections Fix applies, and the ones it refuses with a reason.
 *
 * A correction is applied when it is for a cell Fix asked about, is not a
 * protected identifier, the AI gave one answer for that cell, and the new
 * value is derived (isDerivedValue). Or when it is half of a MOVE: a
 * flagged value relocated, exactly as written, into a cell of the same row
 * that is empty, together with the flagged cell's own correction. Both
 * halves get one `group` so a single Undo returns both. A cell is emptied
 * only as the source of an applied move — never on its own, and never when
 * its move is refused.
 */
export function acceptedAiCorrections(
  corrections: AiCorrection[],
  requested: { row: number; column: string }[],
  rows: Record<string, string | undefined>[],
  mapping: Record<string, string>,
  groupPrefix = "ai-move",
): {
  accepted: (AiCorrection & { group?: string })[];
  rejected: { row: number; column: string; reason: string }[];
} {
  const key = (r: number, c: string) => `${r}:${c}`;
  const asked = new Set(requested.map((r) => key(r.row, r.column)));
  const rejected: { row: number; column: string; reason: string }[] = [];
  const reject = (c: { row: number; column: string }, reason: string) => {
    if (!rejected.some((x) => x.row === c.row && x.column === c.column))
      rejected.push({ row: c.row, column: c.column, reason });
  };

  // One answer per cell: identical repeats collapse; different answers
  // mean the AI is unsure, so the cell is left alone.
  const byCell = new Map<string, AiCorrection>();
  const conflicted = new Set<string>();
  for (const c of corrections) {
    const k = key(c.row, c.column);
    const seen = byCell.get(k);
    if (seen && trimmed(seen.new_value) !== trimmed(c.new_value)) conflicted.add(k);
    else if (!seen) byCell.set(k, c);
  }
  for (const k of conflicted) {
    const c = byCell.get(k)!;
    byCell.delete(k);
    reject(c, "The AI gave conflicting answers for this cell, so it was left as it is.");
  }

  const cellValue = (row: number, column: string) => trimmed(rows[row - 1]?.[column]);
  const isProtected = (column: string) => PROTECTED_FIELDS.has(mapping[column] ?? "");

  // Moves: an unasked, empty cell receiving exactly a flagged cell's value,
  // that flagged cell being corrected in the same answer.
  const moveOf = new Map<string, { target: AiCorrection; source: AiCorrection }>();
  for (const c of byCell.values()) {
    if (asked.has(key(c.row, c.column))) continue;
    if (isProtected(c.column) || !rows[c.row - 1] || cellValue(c.row, c.column) !== "") continue;
    const value = trimmed(c.new_value);
    if (!value) continue;
    const source = [...byCell.values()].find(
      (s) =>
        s.row === c.row &&
        asked.has(key(s.row, s.column)) &&
        !isProtected(s.column) &&
        cellValue(s.row, s.column) === value,
    );
    if (source) moveOf.set(key(c.row, c.column), { target: c, source });
  }
  const sourcesOfMoves = new Set(
    [...moveOf.values()].map((m) => key(m.source.row, m.source.column)),
  );

  const accepted: (AiCorrection & { group?: string })[] = [];
  for (const c of byCell.values()) {
    const k = key(c.row, c.column);
    if (isProtected(c.column)) {
      reject(c, "Identifiers (case ID, patient record number) are never changed by Fix.");
      continue;
    }
    const move = moveOf.get(k);
    if (move) {
      const group = `${groupPrefix}-${c.row}-${move.source.column}`;
      accepted.push({ ...c, group });
      continue;
    }
    if (!asked.has(k)) {
      reject(c, "Fix did not ask about this cell, and it is not a move into an empty cell.");
      continue;
    }
    if (trimmed(c.new_value) === "") {
      if (sourcesOfMoves.has(k)) {
        const m = [...moveOf.values()].find((x) => key(x.source.row, x.source.column) === k)!;
        accepted.push({ ...c, group: `${groupPrefix}-${c.row}-${m.source.column}` });
      } else {
        reject(
          c,
          "The AI would have emptied this cell without putting its value anywhere, so it was left as it is.",
        );
      }
      continue;
    }
    const others = Object.values(rows[c.row - 1] ?? {}).map(trimmed);
    if (!isDerivedValue(cellValue(c.row, c.column), c.new_value, others)) {
      reject(
        c,
        "The AI proposed a value that is not in this cell or this row — Fix never invents a value.",
      );
      continue;
    }
    accepted.push(c);
  }
  // A refused move's destination is reported too, so nothing is silent.
  for (const c of corrections) {
    if (
      !asked.has(key(c.row, c.column)) &&
      !moveOf.has(key(c.row, c.column)) &&
      !isProtected(c.column)
    )
      reject(c, "Fix did not ask about this cell, and it is not a valid move into an empty cell.");
  }
  return { accepted, rejected };
}
