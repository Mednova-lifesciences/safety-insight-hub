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
  // Decide what is renderable FIRST, then let only those entries supersede.
  //
  // Doing it the other way round loses evidence: a draft correction nobody
  // accepted (or one left uncited, or since withdrawn) would retire the
  // figure the assessor actually accepted, while being unrenderable itself
  // — so the criterion would read "not assessed" when NAFDAC holds
  // accepted, cited evidence for it. The memo would deny its own record.
  const live = entries.filter((e) => !e.withdrawnBy && isCited(e) && isAccepted(e));
  const superseded = new Set(
    live
      // An entry pointing at itself supersedes nothing; honouring it would
      // delete the entry on the strength of its own pointer.
      .filter((e) => e.supersedes !== e.id)
      .map((e) => e.supersedes)
      .filter((id): id is string => !!id),
  );
  return live.filter((e) => !superseded.has(e.id));
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
