import type { EvidenceEntry } from "@/types/pv";

/**
 * Evidence rules for the assessment memo.
 *
 * Three properties the memo depends on, kept here rather than in the
 * renderer so the renderer cannot accidentally relax one:
 *
 *  - an assertion nobody can check never renders (isCited)
 *  - a candidate nobody accepted never renders (isAccepted)
 *  - a corrected figure replaces the old one WITHOUT deleting it, so the
 *    record of what an assessor relied on at sign-off survives
 */

/** True when the entry carries a citation a reader could follow. */
export function isCited(e: EvidenceEntry): boolean {
  return e.citation.trim().length > 0;
}

/** True when a person actually accepted this entry. */
export function isAccepted(e: EvidenceEntry): boolean {
  return (e.acceptedBy ?? "").trim().length > 0;
}

/**
 * The entries that may appear in the memo, in input order.
 *
 * Pure: the input array is never modified, because it is the append-only
 * record. A superseded entry is filtered from the output and kept in the
 * store.
 */
export function renderableEvidence(entries: EvidenceEntry[]): EvidenceEntry[] {
  const superseded = new Set(
    entries.map((e) => e.supersedes).filter((id): id is string => !!id),
  );
  return entries.filter(
    (e) => !superseded.has(e.id) && !e.withdrawnBy && isCited(e) && isAccepted(e),
  );
}

/**
 * Builds the replacement for an entry whose content was wrong.
 *
 * Returns a new entry pointing at the old one. The old entry is returned
 * untouched by design — the caller appends, never overwrites.
 */
export function supersede(
  previous: EvidenceEntry,
  next: Omit<EvidenceEntry, "supersedes">,
): EvidenceEntry {
  return { ...next, supersedes: previous.id };
}
