import { batchKey, dayNumber, facilityKey, productKey } from "./linelist-cross-duplicates";

/**
 * Batch and facility flags FOR REVIEW.
 *
 * Two or more serious cases that share a real vaccine batch, or the same
 * vaccine at the same reporting facility, within 30 days, are put in front
 * of an evaluator. This is a flag for review, not a signal and not a
 * conclusion: a shared batch is also what a busy clinic using one vial lot
 * looks like. It is counting, not a model, and it never changes a case.
 *
 * Seriousness is decided by the caller with the rule engine's own test
 * (serious text, a serious-criterion code, or a fatal outcome) so this
 * card and the line-list checks can never disagree about which cases are
 * serious. Callers pass only kept cases: dropped (including confirmed
 * duplicates) and held rows are left out before they reach here.
 */

export interface ClusterCase {
  jobId: string;
  filename: string;
  row: number;
  caseId?: string | undefined;
  product?: string | undefined;
  batch?: string | undefined;
  facility?: string | undefined;
  vaccinationDate?: string | undefined;
  /** Used when the vaccination date is missing or unreadable. */
  onsetDate?: string | undefined;
  serious: boolean;
  /** The case's reactions, for the quality warning signs. */
  reactions?: string[] | undefined;
}

export type ClusterKind = "BATCH" | "FACILITY";

/**
 * What a flag's shape suggests, for a person to weigh — never a finding.
 * A batch seen at several facilities points at the product itself; one
 * facility across several batches points at how vaccines are stored or
 * given there. Neither is a conclusion: the wording is "possible", and the
 * product question is for laboratory testing to answer.
 */
export type ClusterPattern =
  "PRODUCT_QUALITY" | "STORAGE_OR_ADMINISTRATION" | "ONE_BATCH_ONE_FACILITY";

export const PATTERN_NOTES: Record<ClusterPattern, string> = {
  PRODUCT_QUALITY:
    "The same batch at more than one facility: a possible product quality concern. Consider referring the batch to post-market surveillance for laboratory testing.",
  STORAGE_OR_ADMINISTRATION:
    "One facility across more than one batch: a possible storage (cold chain) or administration error at this site, rather than a problem with any one batch.",
  ONE_BATCH_ONE_FACILITY:
    "One batch at one facility: this could be the batch or how it was stored or given here. Cases from other facilities using the same batch would tell them apart.",
};

/** Signs in the cases that a product may be substandard, for review. */
export type QualitySign =
  "LACK_OF_EFFECT" | "INJECTION_SITE_ABSCESS" | "UNUSUAL_PRODUCT" | "MISSING_OR_ODD_BATCH";

export const QUALITY_SIGN_LABELS: Record<QualitySign, string> = {
  LACK_OF_EFFECT: "Lack of effect / vaccine failure",
  INJECTION_SITE_ABSCESS: "Injection-site abscess",
  UNUSUAL_PRODUCT: "Unusual or unexpected reaction / product appearance",
  MISSING_OR_ODD_BATCH: "Missing or odd batch number",
};

const SIGN_PATTERNS: [QualitySign, RegExp][] = [
  [
    "LACK_OF_EFFECT",
    /lack of (effect|efficacy)|vaccine failure|(drug|vaccine|product) ineffective|no effect|breakthrough/i,
  ],
  ["INJECTION_SITE_ABSCESS", /abscess/i],
  [
    "UNUSUAL_PRODUCT",
    /unusual|unexpected|discolou?r|particle|precipitat|cloudy|turbid|foreign (body|matter)|leak/i,
  ],
];

/** A batch number that exists but does not look like one: under three
 *  characters, or no digit in it. Placeholders ("-", NIL) count as missing. */
function oddBatch(raw: string | undefined): boolean {
  const key = batchKey(raw);
  if (!key) return true;
  return key.length < 3 || !/\d/.test(key);
}

export interface QualitySignFound {
  sign: QualitySign;
  /** caseId, or "file row N", of each case showing it. */
  cases: string[];
}

export function qualitySigns(cases: ClusterCase[]): QualitySignFound[] {
  const found = new Map<QualitySign, string[]>();
  const note = (sign: QualitySign, c: ClusterCase) => {
    const list = found.get(sign) ?? [];
    const id = c.caseId ?? `${c.filename} row ${c.row}`;
    if (!list.includes(id)) list.push(id);
    found.set(sign, list);
  };
  for (const c of cases) {
    const text = (c.reactions ?? []).join(" | ");
    for (const [sign, re] of SIGN_PATTERNS) if (re.test(text)) note(sign, c);
    if (oddBatch(c.batch)) note("MISSING_OR_ODD_BATCH", c);
  }
  return (Object.keys(QUALITY_SIGN_LABELS) as QualitySign[])
    .filter((s) => found.has(s))
    .map((sign) => ({ sign, cases: found.get(sign)! }));
}

function distinctShown(values: (string | undefined)[], keyOf: (v: string) => string | null) {
  const out = new Map<string, string>();
  for (const v of values) {
    const k = v ? keyOf(v) : null;
    if (k && !out.has(k)) out.set(k, v!.trim());
  }
  return [...out.values()];
}

function patternOf(kind: ClusterKind, facilities: string[], batches: string[]): ClusterPattern {
  if (kind === "BATCH")
    return facilities.length >= 2 ? "PRODUCT_QUALITY" : "ONE_BATCH_ONE_FACILITY";
  return batches.length >= 2 ? "STORAGE_OR_ADMINISTRATION" : "ONE_BATCH_ONE_FACILITY";
}

export interface ClusterFlag {
  key: string;
  kind: ClusterKind;
  /** The batch number, or "<vaccine> at <facility>", as the source wrote it. */
  label: string;
  cases: ClusterCase[];
  /** ISO dates of the first and last case in the group. */
  from: string;
  to: string;
  /** The facilities and batches among the cases, as the files wrote them. */
  facilities: string[];
  batches: string[];
  /** Products among the cases, as the files wrote them. */
  products: string[];
  pattern: ClusterPattern;
  warningSigns: QualitySignFound[];
}

export const CLUSTER_WINDOW_DAYS = 30;
export const CLUSTER_MIN_CASES = 2;

const isoOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

function caseDay(c: ClusterCase): number | null {
  return dayNumber(c.vaccinationDate) ?? dayNumber(c.onsetDate);
}

/** Splits one group's cases (sorted by day) into runs that each fit in the
 *  window, measured from the run's first case. */
function windows(cases: { day: number; c: ClusterCase }[]): { day: number; c: ClusterCase }[][] {
  const out: { day: number; c: ClusterCase }[][] = [];
  let run: { day: number; c: ClusterCase }[] = [];
  for (const item of cases) {
    if (run.length && item.day - run[0]!.day > CLUSTER_WINDOW_DAYS) {
      out.push(run);
      run = [];
    }
    run.push(item);
  }
  if (run.length) out.push(run);
  return out;
}

const caseKey = (c: ClusterCase) => `${c.jobId}#${c.row}`;

export function findClusterFlags(cases: ClusterCase[]): ClusterFlag[] {
  const serious = cases
    .filter((c) => c.serious)
    .map((c) => ({ day: caseDay(c), c }))
    .filter((x): x is { day: number; c: ClusterCase } => x.day !== null);

  const groups = new Map<
    string,
    { kind: ClusterKind; labels: Map<string, number>; items: { day: number; c: ClusterCase }[] }
  >();
  const add = (
    key: string,
    kind: ClusterKind,
    label: string,
    item: { day: number; c: ClusterCase },
  ) => {
    const g = groups.get(key) ?? { kind, labels: new Map<string, number>(), items: [] };
    g.labels.set(label, (g.labels.get(label) ?? 0) + 1);
    g.items.push(item);
    groups.set(key, g);
  };
  /** The spelling most of the group's cases use (alphabetical on a tie), so
   *  the label does not depend on which file happened to be read first:
   *  "PCV-7781" in three files, not "PCV 7781" because one file was first. */
  const labelOf = (labels: Map<string, number>) =>
    [...labels.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]![0];
  for (const item of serious) {
    const batch = batchKey(item.c.batch);
    if (batch) add(`BATCH:${batch}`, "BATCH", item.c.batch!.trim(), item);
    const product = productKey(item.c.product);
    const facility = facilityKey(item.c.facility);
    if (product && facility) {
      add(
        `FACILITY:${product}@${facility}`,
        "FACILITY",
        `${item.c.product!.trim()} at ${item.c.facility!.trim()}`,
        item,
      );
    }
  }

  const flags: ClusterFlag[] = [];
  for (const [key, g] of groups) {
    const sorted = [...g.items].sort((x, y) => x.day - y.day);
    for (const run of windows(sorted)) {
      if (run.length < CLUSTER_MIN_CASES) continue;
      const runCases = run.map((r) => r.c);
      const facilities = distinctShown(
        runCases.map((c) => c.facility),
        facilityKey,
      );
      const batches = distinctShown(
        runCases.map((c) => c.batch),
        batchKey,
      );
      flags.push({
        key: `${key}:${run[0]!.day}`,
        kind: g.kind,
        label: labelOf(g.labels),
        cases: runCases,
        from: isoOf(run[0]!.day),
        to: isoOf(run[run.length - 1]!.day),
        facilities,
        batches,
        products: distinctShown(
          runCases.map((c) => c.product),
          (v) => productKey(v) || null,
        ),
        pattern: patternOf(g.kind, facilities, batches),
        warningSigns: qualitySigns(runCases),
      });
    }
  }

  // A facility group holding exactly the cases of a batch group says the
  // same thing twice; the batch flag is the more specific one.
  const batchSets = new Set(
    flags.filter((f) => f.kind === "BATCH").map((f) => f.cases.map(caseKey).sort().join(",")),
  );
  return flags
    .filter((f) => f.kind === "BATCH" || !batchSets.has(f.cases.map(caseKey).sort().join(",")))
    .sort((a, b) => b.cases.length - a.cases.length || b.to.localeCompare(a.to));
}

/** A flag explained in plain words, from its own facts: why its cases were
 *  grouped, what the pattern could mean, what the quality warning signs
 *  are (and what it means when there are none), and what a person can do. */
export interface FlagExplanation {
  why: string;
  meaning: string;
  signs: string;
  next: string;
}

const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const list = (values: string[]) =>
  values.length <= 2
    ? values.join(" and ")
    : `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;

export function explainFlag(f: ClusterFlag): FlagExplanation {
  const span = Math.round(dayOf(f.to) - dayOf(f.from)) + 1;
  const within = span <= 1 ? "on the same day" : `within ${span} days`;
  const product = f.products.length ? list(f.products) : "the same vaccine";
  const why =
    f.kind === "BATCH"
      ? `${n(f.cases.length, "serious case was", "serious cases were")} reported after ${product} from the same batch (${f.label}), ${within} (${f.from} to ${f.to}), at ${n(f.facilities.length, "facility", "different facilities")}${f.facilities.length <= 3 ? ` — ${list(f.facilities)}` : ""}. One serious case now and then is expected; two or more close together that share a batch are worth a second look.`
      : `${n(f.cases.length, "serious case was", "serious cases were")} reported after ${product} given at ${f.facilities[0] ?? f.label}, ${within} (${f.from} to ${f.to}), from ${n(f.batches.length, "batch", "different batches")}. One serious case now and then is expected; two or more close together at the same place are worth a second look.`;

  const meaning: Record<ClusterPattern, string> = {
    PRODUCT_QUALITY:
      "The same batch is linked to serious cases at more than one facility. A problem that follows a batch from place to place points at the product itself — for example the wrong strength, contamination, or a substandard or falsified batch. This is a possible quality concern to check, not a finding.",
    STORAGE_OR_ADMINISTRATION:
      "Serious cases happened at the same facility with more than one batch. A problem that stays in one place while the batch changes points at that site rather than the product — how vaccines are kept cold, prepared or given there.",
    ONE_BATCH_ONE_FACILITY:
      "All of these cases come from one batch used at one facility, so the two possible causes cannot be told apart yet: it could be the batch, or how it was stored or given at this site. It can also be chance. If the same batch causes serious cases at another facility, that points at the batch; if other batches cause cases here, that points at the site — the flag will then say so.",
  };

  const signs = f.warningSigns.length
    ? `Warning signs are words in the cases that point specifically to a defective product. Found here: ${list(
        f.warningSigns.map(
          (w) =>
            `${QUALITY_SIGN_LABELS[w.sign].toLowerCase()} (${n(w.cases.length, "case", "cases")})`,
        ),
      )}.`
    : "Warning signs are words in the cases that point specifically to a defective product: lack of effect or vaccine failure, an injection-site abscess, an unusual reaction or product appearance, or a missing or odd batch number. None of these cases mention any of them, so the flag rests only on the cases being close together and sharing a batch or place — it is not, on its own, evidence of a bad product.";

  const next: Record<ClusterPattern, string> = {
    PRODUCT_QUALITY:
      "Look through the cases below. If the concern stands, refer the batch to post-market surveillance for laboratory testing. If it is already explained (for example the batch was tested), dismiss the flag with the reason.",
    STORAGE_OR_ADMINISTRATION:
      "Look through the cases below and follow up with the facility on its cold chain and on how the vaccines are prepared and given. Dismiss the flag with the reason once it is explained.",
    ONE_BATCH_ONE_FACILITY:
      "Look through the cases below for anything else they share, and ask whether the batch was used elsewhere without problems. Refer it to post-market surveillance if warning signs appear, or dismiss it with the reason if it is explained. It comes back if another case joins it.",
  };

  return { why, meaning: meaning[f.pattern], signs, next: next[f.pattern] };
}

/** "How flags work", for the card. */
export const FLAGS_HOW_THEY_WORK = [
  "A flag groups two or more serious cases that were reported within 30 days and share either a vaccine batch or the same vaccine at the same facility. Dropped and held cases are left out.",
  "Possible product quality concern — the same batch at more than one facility: points at the product.",
  "Possible storage or administration error — one facility with more than one batch: points at the site.",
  "Batch or site — not yet clear — one batch at one facility: either is possible, and more cases will tell.",
  "A flag is a prompt to look, not a signal and not a conclusion. Refer it to post-market surveillance, follow it up, or dismiss it with a reason.",
];
