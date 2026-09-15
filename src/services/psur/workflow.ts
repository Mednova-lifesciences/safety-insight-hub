import type { PsurDocument, PsurWorkflowStage } from "@/types/pv";

/**
 * Whose desk a periodic report is on.
 *
 * NAFDAC runs a report past three people in sequence — a Review Officer
 * screens it and decides whether it goes forward or back to the MAH, an
 * Evaluator performs the scientific review against the V4 template, and a
 * Peer Reviewer checks that review and signs off. Queues are SHARED: any
 * evaluator may pick up anything awaiting evaluation. There is deliberately
 * no named assignment, so there is no assignee field and no staff directory
 * to keep current — the stage alone decides who sees what.
 *
 * Everything here is a pure function of a document. No I/O, so the same
 * rules can be used by the queue pages, the dashboards and the tests
 * without any of them going near the network.
 */

export const WORKFLOW_STAGE_LABELS: Record<PsurWorkflowStage, string> = {
  SCREENING: "Awaiting screening",
  RETURNED_TO_MAH: "Returned to MAH",
  AWAITING_EVALUATION: "Awaiting scientific review",
  AWAITING_PEER_REVIEW: "Awaiting peer review",
  PEER_REVIEWED: "Peer reviewed",
};

/**
 * The stage a document is actually at.
 *
 * `doc.workflowStage` is optional: every document uploaded before the
 * three-role split predates the field. Those documents are NOT all sitting
 * at SCREENING — many were fully reviewed and signed off — so defaulting
 * them to the officer's queue would dump historical work back on the first
 * person in the chain. Instead the stage is recovered from the evidence
 * those documents already carry, newest signal first:
 *
 *   a peer signature      -> PEER_REVIEWED
 *   an evaluator signature-> AWAITING_PEER_REVIEW
 *   a screening decision  -> whichever way that decision went
 *   nothing at all        -> SCREENING
 *
 * The stored field always wins when present; this is a fallback, not an
 * override. Read stages through here rather than off the document, the way
 * section coverage is read through buildAuthoritativeSectionCoverage.
 */
export function deriveWorkflowStage(doc: PsurDocument): PsurWorkflowStage {
  if (doc.workflowStage) return doc.workflowStage;

  const signOff = doc.signOff;
  if (signOff?.peerReviewedAt) return "PEER_REVIEWED";
  if (signOff?.evaluatorSignedAt) return "AWAITING_PEER_REVIEW";

  // The officer's decision, if one was recorded. A human override is the
  // decision; the AI's `recommendation` on its own is only advice and has
  // NOT moved the document anywhere, so it is never read here.
  const decision = doc.screening?.humanOverride?.decision;
  if (decision === "RETURN_TO_MAH_FIRST") return "RETURNED_TO_MAH";
  if (decision === "PROCEED_TO_SCIENTIFIC_REVIEW") return "AWAITING_EVALUATION";

  return "SCREENING";
}

/** Documents on the Review Officer's desk, waiting to be triaged. */
export function isAwaitingScreening(doc: PsurDocument): boolean {
  return deriveWorkflowStage(doc) === "SCREENING";
}

/** Sent back to the MAH at screening — it never reached scientific review. */
export function isReturnedToMah(doc: PsurDocument): boolean {
  return deriveWorkflowStage(doc) === "RETURNED_TO_MAH";
}

/** In any Evaluator's queue. */
export function isAwaitingEvaluation(doc: PsurDocument): boolean {
  return deriveWorkflowStage(doc) === "AWAITING_EVALUATION";
}

/** In any Peer Reviewer's queue. */
export function isAwaitingPeerReview(doc: PsurDocument): boolean {
  return deriveWorkflowStage(doc) === "AWAITING_PEER_REVIEW";
}

/** Signed off by a peer reviewer. */
export function isPeerReviewed(doc: PsurDocument): boolean {
  return deriveWorkflowStage(doc) === "PEER_REVIEWED";
}

/**
 * Has this report been pushed past screening at all — i.e. is it somewhere
 * in the scientific-review half of the process? True for everything from
 * AWAITING_EVALUATION onwards, and deliberately false for RETURNED_TO_MAH,
 * which left the process rather than progressing through it.
 */
export function isInScientificReview(doc: PsurDocument): boolean {
  const stage = deriveWorkflowStage(doc);
  return (
    stage === "AWAITING_EVALUATION" || stage === "AWAITING_PEER_REVIEW" || stage === "PEER_REVIEWED"
  );
}

/** Convenience for the dashboards: counts by stage over a document list. */
export function countByStage(docs: PsurDocument[]): Record<PsurWorkflowStage, number> {
  const counts: Record<PsurWorkflowStage, number> = {
    SCREENING: 0,
    RETURNED_TO_MAH: 0,
    AWAITING_EVALUATION: 0,
    AWAITING_PEER_REVIEW: 0,
    PEER_REVIEWED: 0,
  };
  for (const doc of docs) counts[deriveWorkflowStage(doc)] += 1;
  return counts;
}
