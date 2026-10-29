import { deriveInitials, parseSourceDate } from "@/services/e2b-r3/mapping";

/**
 * Possible duplicates ACROSS line-list files.
 *
 * The same AEFI is often reported twice — once by the facility and again
 * by the LGA or state — and the two reports arrive in different files. This
 * finds pairs that look like the same case so a person can decide. It is a
 * rule, not a model: the same two rows always score the same, and every
 * pair lists the fields that matched so the reviewer can see why it was
 * shown. Nothing here drops or changes anything; "Drop as duplicate" is a
 * decision a person makes through the ordinary decideCase path.
 *
 * Candidates are first BLOCKED on the same product and a vaccination date
 * within 3 days — two reports of one case can disagree on a date by a day
 * or two, but never on the vaccine. Only pairs inside a block are scored.
 */

/** One case row, from a stored job — the fields this check reads. */
export interface CrossFileCase {
  jobId: string;
  filename: string;
  /** 1-based data row — the numbering decisions and issues use. */
  row: number;
  caseId?: string | undefined;
  product?: string | undefined;
  vaccinationDate?: string | undefined;
  sex?: string | undefined;
  age?: string | undefined;
  ageUnit?: string | undefined;
  /** Patient name or initials (the D.1 field). */
  patientIdentifier?: string | undefined;
  batch?: string | undefined;
  reaction?: string | undefined;
  onsetDate?: string | undefined;
  facility?: string | undefined;
}

export type DuplicateField =
  "sex" | "age" | "initials" | "batch" | "reaction" | "onset" | "facility";

export const DUPLICATE_FIELD_LABELS: Record<DuplicateField, string> = {
  sex: "Sex",
  age: "Age (±1)",
  initials: "Patient initials",
  batch: "Vaccine batch",
  reaction: "Reaction",
  onset: "Onset date (±2 days)",
  facility: "Reporting facility",
};

/** What one field contributes when both rows have it and it agrees. */
export const MATCH_WEIGHTS: Record<DuplicateField, number> = {
  initials: 3,
  batch: 3,
  age: 2,
  reaction: 2,
  onset: 2,
  facility: 2,
  sex: 1,
};

/** What a clear disagreement costs. Two children of different sexes
 *  vaccinated at the same clinic on the same day are not one case, however
 *  much else they share. */
export const CONFLICT_PENALTIES: Partial<Record<DuplicateField, number>> = {
  sex: 4,
  initials: 3,
  age: 3,
};

/** Pairs at or above this score are shown. Same product and date alone
 *  never reach it: it takes, for example, initials + batch + sex, or age +
 *  reaction + onset + sex, with nothing clearly disagreeing. */
export const DUPLICATE_SCORE_THRESHOLD = 7;

export const VACCINATION_WINDOW_DAYS = 3;
export const ONSET_WINDOW_DAYS = 2;
export const AGE_TOLERANCE = 1;

export interface DuplicatePair {
  /** Stable for a pair whichever side is "this" file. */
  key: string;
  a: CrossFileCase;
  b: CrossFileCase;
  score: number;
  matched: DuplicateField[];
  conflicting: DuplicateField[];
  vaccinationDaysApart: number;
}

/** Placeholders reporters write for "no batch". */
const BATCH_PLACEHOLDERS = new Set([
  "",
  "-",
  "0",
  "NAN",
  "NIL",
  "NILL",
  "NA",
  "N/A",
  "NONE",
  "UNKNOWN",
]);

const PRODUCT_NOISE = new Set(["vaccine", "vaccines", "vacc", "vac", "dose", "the"]);

/** The routine-immunisation abbreviations line lists use for the same
 *  antigen, keyed by the normalised (sorted-token) spelling. Deliberately a
 *  short, explicit list: two names are only the same product here when
 *  someone wrote it down. */
const PRODUCT_ALIASES: Record<string, string> = {
  mr: "measles rubella",
  "measles rubella": "measles rubella",
  penta: "pentavalent",
  pentavalent: "pentavalent",
  "dtp hepb hib": "pentavalent",
  pcv: "pcv",
  pcv10: "pcv",
  pcv13: "pcv",
  pneumococcal: "pcv",
  "conjugate pneumococcal": "pcv",
  yf: "yellow fever",
  "fever yellow": "yellow fever",
  rota: "rotavirus",
  rotavirus: "rotavirus",
  hpv: "hpv",
  "human papillomavirus": "hpv",
  opv: "opv",
  bopv: "opv",
  "oral polio": "opv",
  ipv: "ipv",
  bcg: "bcg",
};

export function productKey(raw: string | undefined): string {
  const key = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !PRODUCT_NOISE.has(t))
    .sort()
    .join(" ");
  return PRODUCT_ALIASES[key] ?? key;
}

/** A real batch number, compared without spaces or punctuation — or null
 *  for a placeholder. Shared with the batch/facility flag. */
export function batchKey(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (BATCH_PLACEHOLDERS.has(v) || BATCH_PLACEHOLDERS.has(v.replace(/[^A-Z0-9/]/g, "")))
    return null;
  const key = v.replace(/[^A-Z0-9]/g, "");
  return key && !BATCH_PLACEHOLDERS.has(key) ? key : null;
}

export function facilityKey(raw: string | undefined): string | null {
  const key = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return key || null;
}

function sexKey(raw: string | undefined): "M" | "F" | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "M" || v === "MALE" || v === "BOY") return "M";
  if (v === "F" || v === "FEMALE" || v === "GIRL") return "F";
  return null;
}

function ageUnitKey(raw: string | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "y";
  if (v.startsWith("mo") || v === "m") return "m";
  if (v.startsWith("w")) return "w";
  if (v.startsWith("d")) return "d";
  if (v.startsWith("h")) return "h";
  return "y";
}

function ageValue(raw: string | undefined): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)/.exec(raw ?? "");
  return m ? Number(m[1]!.replace(",", ".")) : null;
}

/** Initials as letters only ("A.E." -> "AE"). */
function initialsKey(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const key = deriveInitials(v)
    .replace(/[^A-Z]/gi, "")
    .toUpperCase();
  return key || null;
}

function reactionTerms(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .toLowerCase()
      .split(/[,;/+]|\band\b|\n/)
      .map((t) =>
        t
          .replace(/[^a-z0-9 ]+/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((t) => t.length > 1),
  );
}

/** Whole days since the epoch for a source date, or null. */
export function dayNumber(raw: string | undefined): number | null {
  const iso = parseSourceDate(stripTime(raw));
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function stripTime(raw: string | undefined): string | undefined {
  return raw
    ?.trim()
    .replace(/^'+|'+$/g, "")
    .split(/[ ,T]/)[0];
}

export function pairKey(
  a: Pick<CrossFileCase, "jobId" | "row">,
  b: Pick<CrossFileCase, "jobId" | "row">,
): string {
  const x = `${a.jobId}#${a.row}`;
  const y = `${b.jobId}#${b.row}`;
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

/** Scores one pair already inside a block. */
export function scorePair(
  a: CrossFileCase,
  b: CrossFileCase,
): { score: number; matched: DuplicateField[]; conflicting: DuplicateField[] } {
  const matched: DuplicateField[] = [];
  const conflicting: DuplicateField[] = [];
  const compare = (field: DuplicateField, agree: boolean | null) => {
    if (agree === null) return;
    if (agree) matched.push(field);
    else if (CONFLICT_PENALTIES[field]) conflicting.push(field);
  };

  const [sa, sb] = [sexKey(a.sex), sexKey(b.sex)];
  compare("sex", sa && sb ? sa === sb : null);

  const [aa, ab] = [ageValue(a.age), ageValue(b.age)];
  const sameUnit = ageUnitKey(a.ageUnit) === ageUnitKey(b.ageUnit);
  compare(
    "age",
    aa !== null && ab !== null && sameUnit ? Math.abs(aa - ab) <= AGE_TOLERANCE : null,
  );

  const [ia, ib] = [initialsKey(a.patientIdentifier), initialsKey(b.patientIdentifier)];
  compare("initials", ia && ib ? ia === ib : null);

  const [ba, bb] = [batchKey(a.batch), batchKey(b.batch)];
  compare("batch", ba && bb ? ba === bb : null);

  const [ra, rb] = [reactionTerms(a.reaction), reactionTerms(b.reaction)];
  compare("reaction", ra.size && rb.size ? [...ra].some((t) => rb.has(t)) : null);

  const [oa, ob] = [dayNumber(a.onsetDate), dayNumber(b.onsetDate)];
  compare("onset", oa !== null && ob !== null ? Math.abs(oa - ob) <= ONSET_WINDOW_DAYS : null);

  const [fa, fb] = [facilityKey(a.facility), facilityKey(b.facility)];
  compare("facility", fa && fb ? fa === fb : null);

  const score =
    matched.reduce((s, f) => s + MATCH_WEIGHTS[f], 0) -
    conflicting.reduce((s, f) => s + (CONFLICT_PENALTIES[f] ?? 0), 0);
  return { score, matched, conflicting };
}

/**
 * Pairs between the open file's cases and every other file's, above the
 * threshold, best first. `dismissed` holds pairKeys a person has marked
 * "Not a duplicate" — those are never shown again.
 *
 * Callers pass only kept cases: a row already dropped or held is out of
 * the counts and is not offered again.
 */
export function findCrossFileDuplicates(
  openCases: CrossFileCase[],
  otherCases: CrossFileCase[],
  dismissed: ReadonlySet<string> = new Set(),
  threshold = DUPLICATE_SCORE_THRESHOLD,
): DuplicatePair[] {
  // Block: product -> cases sorted by vaccination day.
  const blocks = new Map<string, { day: number; c: CrossFileCase }[]>();
  for (const c of otherCases) {
    const p = productKey(c.product);
    const day = dayNumber(c.vaccinationDate);
    if (!p || day === null) continue;
    const list = blocks.get(p) ?? [];
    list.push({ day, c });
    blocks.set(p, list);
  }
  for (const list of blocks.values()) list.sort((x, y) => x.day - y.day);

  const pairs: DuplicatePair[] = [];
  for (const a of openCases) {
    const p = productKey(a.product);
    const day = dayNumber(a.vaccinationDate);
    if (!p || day === null) continue;
    const list = blocks.get(p);
    if (!list) continue;
    let i = lowerBound(list, day - VACCINATION_WINDOW_DAYS);
    for (; i < list.length && list[i]!.day <= day + VACCINATION_WINDOW_DAYS; i++) {
      const b = list[i]!.c;
      if (b.jobId === a.jobId) continue;
      const key = pairKey(a, b);
      if (dismissed.has(key)) continue;
      const s = scorePair(a, b);
      if (s.score < threshold) continue;
      pairs.push({ key, a, b, ...s, vaccinationDaysApart: Math.abs(list[i]!.day - day) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || x.a.row - y.a.row);
}

function lowerBound(list: { day: number }[], day: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.day < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The note recorded with "Drop as duplicate", naming the other report. */
export function duplicateDropNote(other: CrossFileCase): string {
  const id = other.caseId ? ` (case ${other.caseId})` : "";
  return `Duplicate of row ${other.row}${id} in "${other.filename}".`;
}
