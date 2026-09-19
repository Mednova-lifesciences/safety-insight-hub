import { describe, expect, it } from "vitest";
import {
  assessC17,
  applyFinalizedC17,
  assertC17FinalizationPreconditions,
  canFinalizeC17Assessment,
  latestC17AssessmentsByCase,
  pendingC17AssessmentIds,
} from "./assessment";
import type { PVCase } from "./types";

function baseCase(): PVCase {
  return {
    internalCaseId: "job-1-1",
    sendersCaseId: "NG-TEST-1",
    worldwideUniqueId: "NG-TEST-1",
    firstSenderOfCase: "2",
    reportType: { present: true, value: "4" },
    dateOfCreation: "2026-01-01T00:00:00.000Z",
    dateFirstReceived: "2026-01-01T00:00:00.000Z",
    dateMostRecentInfo: "2026-01-01T00:00:00.000Z",
    additionalDocumentsAvailable: false,
    fulfilsExpeditedCriteria: { present: false, nullFlavor: "NASK" },
    otherCaseIdentifiersInPreviousTransmissions: { present: false, nullFlavor: "NI" },
    followUp: { isFollowUp: false },
    patient: { identity: { present: true, value: { kind: "INITIALS", initials: "P1" } } },
    reporter: { name: { present: false, nullFlavor: "NASK" } },
    reactions: [],
    products: [],
    sourceInformation: {
      sourceFile: "test.csv",
      sourceRow: 1,
      jobId: "job-1",
      sourceProfileId: "test",
    },
  };
}

describe("E2B C.1.7 assessment foundation", () => {
  it("does not invent a Nigerian expedited result", () => {
    const assessment = assessC17(baseCase(), { jobId: "job-1" });
    expect(assessment.status).toBe("NEEDS_REVIEW");
    expect(assessment.recommendation).toBe("NEEDS_REVIEW");
    expect(assessment.rule.status).toBe("PROVISIONAL");
    expect(assessment.missingFacts.length).toBeGreaterThan(0);
  });

  it("does not apply a recommendation as the final PVCase value", () => {
    const assessment = assessC17(baseCase(), { jobId: "job-1" });
    expect(applyFinalizedC17(baseCase(), assessment).fulfilsExpeditedCriteria.present).toBe(false);
  });

  it("applies only a finalized YES or NO decision", () => {
    const assessment = {
      ...assessC17(baseCase(), { jobId: "job-1" }),
      status: "FINALIZED" as const,
      finalDecision: "YES" as const,
    };
    expect(applyFinalizedC17(baseCase(), assessment).fulfilsExpeditedCriteria).toEqual({
      present: true,
      value: true,
    });
  });

  it("keeps a finalized decision when the same line list is simply mapped again", () => {
    // Each preflight re-maps the line list and stamps C.1.2/C.1.4/C.1.5 with
    // the time of that run; the case itself has not changed.
    const assessment = {
      ...assessC17(baseCase(), { jobId: "job-1" }),
      status: "FINALIZED" as const,
      finalDecision: "NO" as const,
    };
    const remapped = {
      ...baseCase(),
      dateOfCreation: "2026-02-02T09:30:00.000Z",
      dateFirstReceived: "2026-02-02T09:30:00.000Z",
      dateMostRecentInfo: "2026-02-02T09:30:00.000Z",
    };
    expect(applyFinalizedC17(remapped, assessment).fulfilsExpeditedCriteria).toEqual({
      present: true,
      value: false,
    });
  });

  it("does not reuse a finalized decision after a snapshotted case value changes", () => {
    const assessment = {
      ...assessC17(baseCase(), { jobId: "job-1" }),
      status: "FINALIZED" as const,
      finalDecision: "YES" as const,
    };
    const changedCase = { ...baseCase(), narrative: "A changed source narrative" };
    expect(applyFinalizedC17(changedCase, assessment).fulfilsExpeditedCriteria.present).toBe(false);
  });

  it("allows only authorized NAFDAC assessors to finalize the C.1.7 decision", () => {
    expect(canFinalizeC17Assessment({ role: "REVIEW_OFFICER" })).toBe(true);
    expect(canFinalizeC17Assessment({ role: "EVALUATOR" })).toBe(true);
    expect(canFinalizeC17Assessment({ role: "PEER_REVIEWER" })).toBe(true);
    expect(canFinalizeC17Assessment({ role: "PV_MANAGER" })).toBe(false);
    expect(canFinalizeC17Assessment({ role: "FIELD_ASSOCIATE" })).toBe(false);
  });

  it("rejects overwriting an already finalized decision", () => {
    const finalized = {
      ...assessC17(baseCase(), { jobId: "job-1" }),
      status: "FINALIZED" as const,
      finalDecision: "NO" as const,
    };

    expect(() =>
      assertC17FinalizationPreconditions(finalized, { role: "REVIEW_OFFICER" }, "YES"),
    ).toThrow(/finalized.*cannot be overwritten/i);
  });
});

describe("C.1.7 latest-version selection across a line list", () => {
  const withCase = (caseId: string, extra: object) => ({
    ...assessC17({ ...baseCase(), internalCaseId: caseId }, { jobId: "job-1" }),
    ...extra,
  });

  it("keeps only the newest version of each case, never a superseded one", () => {
    const v1 = withCase("job-1-1", { id: "a-v1", assessmentVersion: 1 });
    const v2 = withCase("job-1-1", {
      id: "a-v2",
      assessmentVersion: 2,
      supersedesAssessmentId: "a-v1",
    });
    const other = withCase("job-1-2", { id: "b-v1", assessmentVersion: 1 });

    const latest = latestC17AssessmentsByCase([v2, v1, other]);
    expect(latest.map((a) => a.id).sort()).toEqual(["a-v2", "b-v1"]);
  });

  it("lists as pending only unfinalized, persisted latest versions", () => {
    const finalizedOld = withCase("job-1-1", {
      id: "a-v1",
      assessmentVersion: 1,
      status: "FINALIZED",
      finalDecision: "YES",
    });
    const pendingNew = withCase("job-1-1", { id: "a-v2", assessmentVersion: 2 });
    const finalized = withCase("job-1-2", {
      id: "b-v1",
      assessmentVersion: 1,
      status: "FINALIZED",
      finalDecision: "NO",
    });
    const unsaved = withCase("job-1-3", {});

    expect(pendingC17AssessmentIds([finalizedOld, pendingNew, finalized, unsaved])).toEqual([
      "a-v2",
    ]);
  });
});
