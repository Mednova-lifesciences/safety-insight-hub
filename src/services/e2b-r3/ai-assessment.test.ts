import { describe, expect, it } from "vitest";
import { assessC17 } from "./assessment";
import {
  aiAssessmentCanApplyTo,
  buildC17AiInput,
  needsReviewAiProvider,
  parseStructuredAiAssessment,
  runC17AiAssessment,
} from "./ai-assessment";
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

const rule = {
  id: "NG-C1.7-EXPEDITED-PROVISIONAL",
  jurisdiction: "NG",
  version: "0.1",
  status: "PROVISIONAL" as const,
  authoritativeSource: null,
  criteria: [],
  title: "Provisional assessment",
  description: "No authoritative criteria supplied.",
};

describe("generic C.1.7 AI assessment contract", () => {
  it("creates a canonical, hashed input and safe NEEDS_REVIEW result", async () => {
    const result = await runC17AiAssessment(baseCase(), rule, needsReviewAiProvider);
    expect(result.input.inputVersion).toBe("1");
    expect(result.input.snapshotHash).toBeTruthy();
    expect(result.record.recommendation).toBe("NEEDS_REVIEW");
    expect(result.record.status).toBe("COMPLETED");
    expect(result.record).not.toHaveProperty("finalDecision");
    expect(result.record.inputSnapshotHash).toBe(result.input.snapshotHash);
  });

  it("rejects malformed structured output", () => {
    expect(() => parseStructuredAiAssessment({}, buildC17AiInput(baseCase(), rule))).toThrow();
  });

  it("rejects missing evidence arrays and mismatched rule metadata", () => {
    const input = buildC17AiInput(baseCase(), rule);
    expect(() =>
      parseStructuredAiAssessment(
        {
          recommendation: "POTENTIALLY_EXPEDITED",
          confidence: 0.8,
          supportingEvidence: [],
          contradictingEvidence: [],
          missingInformation: [],
          assumptions: [],
          relevantCaseFields: [],
          reasoningSummary: "summary",
          ruleId: "OTHER-RULE",
          ruleVersion: "1.0",
          inputSnapshotHash: input.snapshotHash,
        },
        input,
      ),
    ).toThrow(/rule metadata/i);
  });

  it("rejects unsafe AI finalDecision fields", () => {
    const input = buildC17AiInput(baseCase(), rule);
    expect(() =>
      parseStructuredAiAssessment(
        {
          recommendation: "POTENTIALLY_NOT_EXPEDITED",
          confidence: 0.4,
          supportingEvidence: [],
          contradictingEvidence: [],
          missingInformation: [],
          assumptions: [],
          relevantCaseFields: [],
          reasoningSummary: "Human review remains required.",
          ruleId: input.rule.id,
          ruleVersion: input.rule.version,
          inputSnapshotHash: input.snapshotHash,
          finalDecision: "YES",
        },
        input,
      ),
    ).toThrow(/unsupported fields.*finalDecision/i);
  });

  it("returns an unavailable needs-review record when the provider fails", async () => {
    const result = await runC17AiAssessment(baseCase(), rule, {
      providerId: "failing-provider",
      assess: async () => {
        throw new Error("timeout");
      },
    });
    expect(result.record.status).toBe("UNAVAILABLE");
    expect(result.record.recommendation).toBe("NEEDS_REVIEW");
  });

  it("rejects stale AI output after the canonical case changes", async () => {
    const result = await runC17AiAssessment(baseCase(), rule, needsReviewAiProvider);
    const changed = { ...baseCase(), narrative: "changed" };
    expect(aiAssessmentCanApplyTo(result.record, changed)).toBe(false);
  });

  it("keeps the provisional regulatory assessment NEEDS_REVIEW", () => {
    const assessment = assessC17(baseCase(), { jobId: "job-1" });
    expect(assessment.status).toBe("NEEDS_REVIEW");
    expect(assessment.recommendation).toBe("NEEDS_REVIEW");
    expect(assessment.rule.ruleId).toBe("NG-C1.7-EXPEDITED-PROVISIONAL");
    expect(assessment.rule.version).toBe("1.0");
  });
});
