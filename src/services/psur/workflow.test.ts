import { describe, expect, it } from "vitest";
import {
  WORKFLOW_STAGE_LABELS,
  countByStage,
  deriveWorkflowStage,
  isAwaitingEvaluation,
  isAwaitingPeerReview,
  isAwaitingScreening,
  isInScientificReview,
  isPeerReviewed,
  isReturnedToMah,
} from "./workflow";
import type { PsurDocument, PsurScreeningResult, PsurWorkflowStage } from "@/types/pv";

function doc(overrides: Partial<PsurDocument> = {}): PsurDocument {
  return {
    id: "psur-1",
    filename: "report.pdf",
    product: "Atorvastatin",
    reportingPeriod: "Q2 2026",
    uploadedAt: "2026-09-01T09:00:00Z",
    uploadedBy: "Demo Review Officer",
    stage: "UPLOADED",
    pages: 42,
    ...overrides,
  };
}

function screening(overrides: Partial<PsurScreeningResult> = {}): PsurScreeningResult {
  return {
    performedAt: "2026-09-01T09:05:00Z",
    administrativeChecks: [],
    sectionCoverage: [],
    recommendation: "PROCEED_TO_SCIENTIFIC_REVIEW",
    assistGenerated: true,
    ...overrides,
  };
}

describe("deriveWorkflowStage — the stored field", () => {
  it("uses the stored stage whenever there is one", () => {
    expect(deriveWorkflowStage(doc({ workflowStage: "AWAITING_PEER_REVIEW" }))).toBe(
      "AWAITING_PEER_REVIEW",
    );
  });

  it("lets the stored stage win over what the data would otherwise imply", () => {
    // The fallback below is a recovery path for old documents, not a
    // second opinion that can overrule a stage actually written down.
    const d = doc({
      workflowStage: "RETURNED_TO_MAH",
      signOff: { conclusion: "x", reviewerConfidence: "HIGH", references: "", peerReviewedAt: "t" },
    });
    expect(deriveWorkflowStage(d)).toBe("RETURNED_TO_MAH");
  });
});

describe("deriveWorkflowStage — documents that predate the field", () => {
  // This is the part most likely to be wrong, and the part with real
  // consequences: getting it wrong dumps historical, fully-reviewed work
  // back onto the first person in the chain.

  it("a never-touched document sits with the Review Officer", () => {
    expect(deriveWorkflowStage(doc())).toBe("SCREENING");
  });

  it("a peer signature means the review is finished", () => {
    const d = doc({
      signOff: {
        conclusion: "Favourable",
        reviewerConfidence: "HIGH",
        references: "",
        evaluatorName: "Dr A",
        evaluatorSignedAt: "2026-09-05T10:00:00Z",
        peerReviewerName: "Dr B",
        peerReviewedAt: "2026-09-06T10:00:00Z",
      },
    });
    expect(deriveWorkflowStage(d)).toBe("PEER_REVIEWED");
  });

  it("an evaluator signature alone means it is waiting on a peer reviewer", () => {
    const d = doc({
      signOff: {
        conclusion: "Favourable",
        reviewerConfidence: "MEDIUM",
        references: "",
        evaluatorName: "Dr A",
        evaluatorSignedAt: "2026-09-05T10:00:00Z",
      },
    });
    expect(deriveWorkflowStage(d)).toBe("AWAITING_PEER_REVIEW");
  });

  it("a typed name with no timestamp is not a signature", () => {
    // updateSignOff stamps the time when a name is first saved, so a name
    // without one is a half-filled form, not a completed step.
    const d = doc({
      signOff: { conclusion: "", reviewerConfidence: undefined, references: "", evaluatorName: "" },
    });
    expect(deriveWorkflowStage(d)).toBe("SCREENING");
  });

  it("the officer's decision to proceed puts it in the evaluators' queue", () => {
    const d = doc({
      screening: screening({
        humanOverride: {
          decision: "PROCEED_TO_SCIENTIFIC_REVIEW",
          by: "Officer",
          at: "2026-09-02T10:00:00Z",
          rationale: "Complete.",
        },
      }),
    });
    expect(deriveWorkflowStage(d)).toBe("AWAITING_EVALUATION");
  });

  it("the officer's decision to return takes it out of the process", () => {
    const d = doc({
      screening: screening({
        humanOverride: {
          decision: "RETURN_TO_MAH_FIRST",
          by: "Officer",
          at: "2026-09-02T10:00:00Z",
          rationale: "DLP missing.",
        },
      }),
    });
    expect(deriveWorkflowStage(d)).toBe("RETURNED_TO_MAH");
  });

  it("the AI's recommendation alone moves nothing", () => {
    // The AI recommending scientific review is advice. Only the officer's
    // own decision is a handoff, so a document the officer has not acted on
    // must still be sitting on their desk however confident the AI was.
    const d = doc({ screening: screening({ recommendation: "PROCEED_TO_SCIENTIFIC_REVIEW" }) });
    expect(deriveWorkflowStage(d)).toBe("SCREENING");
  });

  it("a signature outranks an older screening decision", () => {
    // Both are present on any document that got as far as being reviewed.
    // Reading the screening decision first would pin every reviewed report
    // at AWAITING_EVALUATION forever.
    const d = doc({
      screening: screening({
        humanOverride: {
          decision: "PROCEED_TO_SCIENTIFIC_REVIEW",
          by: "Officer",
          at: "2026-09-02T10:00:00Z",
          rationale: "Complete.",
        },
      }),
      signOff: {
        conclusion: "Favourable",
        reviewerConfidence: "HIGH",
        references: "",
        evaluatorName: "Dr A",
        evaluatorSignedAt: "2026-09-05T10:00:00Z",
      },
    });
    expect(deriveWorkflowStage(d)).toBe("AWAITING_PEER_REVIEW");
  });

  it("a failed upload stays with the officer rather than reaching an evaluator", () => {
    expect(deriveWorkflowStage(doc({ stage: "FAILED" }))).toBe("SCREENING");
  });
});

describe("queue predicates", () => {
  const cases: [PsurWorkflowStage, (d: PsurDocument) => boolean][] = [
    ["SCREENING", isAwaitingScreening],
    ["RETURNED_TO_MAH", isReturnedToMah],
    ["AWAITING_EVALUATION", isAwaitingEvaluation],
    ["AWAITING_PEER_REVIEW", isAwaitingPeerReview],
    ["PEER_REVIEWED", isPeerReviewed],
  ];

  it.each(cases)("%s matches exactly one predicate", (stage, predicate) => {
    const d = doc({ workflowStage: stage });
    expect(predicate(d)).toBe(true);
    for (const [otherStage, otherPredicate] of cases) {
      if (otherStage !== stage) expect(otherPredicate(d)).toBe(false);
    }
  });

  it("isInScientificReview covers everything past screening", () => {
    expect(isInScientificReview(doc({ workflowStage: "AWAITING_EVALUATION" }))).toBe(true);
    expect(isInScientificReview(doc({ workflowStage: "AWAITING_PEER_REVIEW" }))).toBe(true);
    expect(isInScientificReview(doc({ workflowStage: "PEER_REVIEWED" }))).toBe(true);
  });

  it("a returned report is NOT in scientific review — it left the process", () => {
    expect(isInScientificReview(doc({ workflowStage: "RETURNED_TO_MAH" }))).toBe(false);
    expect(isInScientificReview(doc({ workflowStage: "SCREENING" }))).toBe(false);
  });
});

describe("countByStage", () => {
  it("counts every stage, reporting zero rather than omitting empty ones", () => {
    // The dashboards render these directly, so a missing key would show as
    // a blank tile instead of a zero.
    const counts = countByStage([]);
    for (const stage of Object.keys(WORKFLOW_STAGE_LABELS) as PsurWorkflowStage[]) {
      expect(counts[stage]).toBe(0);
    }
  });

  it("buckets a mixed list, including documents with no stored stage", () => {
    const counts = countByStage([
      doc({ workflowStage: "SCREENING" }),
      doc({ workflowStage: "AWAITING_EVALUATION" }),
      doc({ workflowStage: "AWAITING_EVALUATION" }),
      doc(), // derives to SCREENING
      doc({
        signOff: {
          conclusion: "",
          reviewerConfidence: undefined,
          references: "",
          peerReviewerName: "Dr B",
          peerReviewedAt: "2026-09-06T10:00:00Z",
        },
      }), // derives to PEER_REVIEWED
    ]);
    expect(counts).toEqual({
      SCREENING: 2,
      RETURNED_TO_MAH: 0,
      AWAITING_EVALUATION: 2,
      AWAITING_PEER_REVIEW: 0,
      PEER_REVIEWED: 1,
    });
  });
});

describe("WORKFLOW_STAGE_LABELS", () => {
  it("names every stage, so no queue can render a raw enum value", () => {
    const stages: PsurWorkflowStage[] = [
      "SCREENING",
      "RETURNED_TO_MAH",
      "AWAITING_EVALUATION",
      "AWAITING_PEER_REVIEW",
      "PEER_REVIEWED",
    ];
    for (const stage of stages) expect(WORKFLOW_STAGE_LABELS[stage]).toBeTruthy();
  });
});
