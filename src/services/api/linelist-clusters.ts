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
}

export type ClusterKind = "BATCH" | "FACILITY";

export interface ClusterFlag {
  key: string;
  kind: ClusterKind;
  /** The batch number, or "<vaccine> at <facility>", as the source wrote it. */
  label: string;
  cases: ClusterCase[];
  /** ISO dates of the first and last case in the group. */
  from: string;
  to: string;
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
    { kind: ClusterKind; label: string; items: { day: number; c: ClusterCase }[] }
  >();
  const add = (
    key: string,
    kind: ClusterKind,
    label: string,
    item: { day: number; c: ClusterCase },
  ) => {
    const g = groups.get(key) ?? { kind, label, items: [] };
    g.items.push(item);
    groups.set(key, g);
  };
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
      flags.push({
        key: `${key}:${run[0]!.day}`,
        kind: g.kind,
        label: g.label,
        cases: run.map((r) => r.c),
        from: isoOf(run[0]!.day),
        to: isoOf(run[run.length - 1]!.day),
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
