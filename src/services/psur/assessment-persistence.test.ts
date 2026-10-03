import { describe, expect, it } from "vitest";
import { canEditCiomsMatrix } from "./workflow";

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
