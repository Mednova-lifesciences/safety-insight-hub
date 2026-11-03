import type { CaseDetail, CaseSummary } from "@/types/pv";
import { findClusterFlags, type ClusterCase, type ClusterFlag } from "./linelist-clusters";

/**
 * Batch and branch clusters over the organisation's own cases, using the
 * same rule as the line-list batch/facility flags: two or more cases sharing
 * a batch, or the same product at the same branch, within 30 days. The
 * branch stands in for the facility. A flag for review, never a signal.
 */

export type CaseForClusters = CaseSummary &
  Partial<Pick<CaseDetail, "suspectProducts" | "reactions">>;

export function isSeriousCase(c: Pick<CaseSummary, "seriousness" | "outcome">): boolean {
  return c.seriousness === "SERIOUS" || c.outcome === "FATAL";
}

export function toClusterCases(
  cases: CaseForClusters[],
  includeNonSerious: boolean,
): ClusterCase[] {
  return cases.map((c, i) => ({
    jobId: "cases",
    filename: "Cases",
    row: i + 1,
    caseId: c.id,
    product: c.product,
    batch: c.suspectProducts?.[0]?.batchNumber,
    facility: c.branch,
    onsetDate: c.reactions?.[0]?.onsetDate || c.receivedDate,
    serious: includeNonSerious || isSeriousCase(c),
    reactions: (c.reactions ?? [])
      .map((r) => r.reportedTerm)
      .concat(c.reaction ? [c.reaction] : []),
  }));
}

export function caseClusters(cases: CaseForClusters[], includeNonSerious: boolean): ClusterFlag[] {
  return findClusterFlags(toClusterCases(cases, includeNonSerious));
}

/** Plain-words reading of a flag's shape, worded for a pharmacy network. */
export function branchPatternNote(f: ClusterFlag): string {
  if (f.kind === "BATCH" && f.facilities.length > 1)
    return "The same batch at more than one branch: a possible product quality concern. Consider quarantining stock and referring the batch to the holder and NAFDAC for testing.";
  if (f.kind === "FACILITY" && f.batches.length > 1)
    return "One branch across more than one batch: possibly how the product is stored or dispensed at this branch, rather than one batch.";
  return "A small group of reports: could be the batch, or storage or dispensing at this branch. Reports from other branches would tell them apart.";
}
