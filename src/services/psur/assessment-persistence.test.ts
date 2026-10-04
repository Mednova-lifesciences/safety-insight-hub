import { describe, expect, it } from "vitest";
import { canEditAssessmentMemo, canEditCiomsMatrix } from "./workflow";
import type { PsurDocument, PsurWorkflowStage } from "@/types/pv";

describe("who may change a CIOMS score", () => {
  it("lets the Evaluator, who authors the assessment", () => {
    expect(canEditCiomsMatrix("EVALUATOR")).toBe(true);
  });

  it("lets the Peer Reviewer, who may change it on review", () => {
    // Confirmed with NAFDAC: the Evaluator enters the scores and the Peer
    // Reviewer may also change them. This is a widening of the Peer
    // Reviewer's role, which was previously check-and-countersign only.
    expect(canEditCiomsMatrix("PEER_REVIEWER")).toBe(true);
  });

  it("does not let the Review Officer, whose step ended at screening", () => {
    expect(canEditCiomsMatrix("REVIEW_OFFICER")).toBe(false);
  });

  it("does not let MAH-side staff anywhere near it", () => {
    for (const role of ["FIELD_ASSOCIATE", "PV_COORDINATOR", "PV_MANAGER"] as const) {
      expect(canEditCiomsMatrix(role)).toBe(false);
    }
  });
});

describe("who may change the assessment memo, and when", () => {
  const at = (stage: PsurWorkflowStage) => ({ workflowStage: stage }) as PsurDocument;
  const evaluator = { canEvaluate: true, canPeerReview: false };
  const peer = { canEvaluate: true, canPeerReview: true };
  const officer = { canEvaluate: false, canPeerReview: false };

  it("is the Evaluator's while the review is with them", () => {
    expect(canEditAssessmentMemo(at("AWAITING_EVALUATION"), evaluator)).toBe(true);
    expect(canEditAssessmentMemo(at("AWAITING_EVALUATION"), peer)).toBe(false);
  });

  it("locks for the Evaluator once they sign off, and opens for the Peer Reviewer", () => {
    expect(canEditAssessmentMemo(at("AWAITING_PEER_REVIEW"), evaluator)).toBe(false);
    expect(canEditAssessmentMemo(at("AWAITING_PEER_REVIEW"), peer)).toBe(true);
  });

  it("is nobody's to change after the countersign", () => {
    expect(canEditAssessmentMemo(at("PEER_REVIEWED"), evaluator)).toBe(false);
    expect(canEditAssessmentMemo(at("PEER_REVIEWED"), peer)).toBe(false);
  });

  it("is never the Review Officer's", () => {
    for (const s of ["AWAITING_EVALUATION", "AWAITING_PEER_REVIEW"] as const) {
      expect(canEditAssessmentMemo(at(s), officer)).toBe(false);
    }
  });
});
