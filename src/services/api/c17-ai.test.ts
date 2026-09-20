import { describe, expect, it, vi } from "vitest";
import { runC17AiAssessment } from "@/services/e2b-r3/ai-assessment";
import type { PVCase } from "@/services/e2b-r3/types";

// The backend's own answer shape. If the two sides ever drift apart again,
// the assessment is stored as INVALID_OUTPUT and the assessor sees no
// suggestion at all — so the mapping is tested against a real response.
const backendResponse = {
  recommendation: "YES",
  confidence: 0.8,
  supportingEvidence: [
    { statement: 'The outcome column reads "Died".', sourceFields: ["outcome"] },
    { statement: "Admitted to hospital overnight.", sourceFields: ["narrative", "invented"] },
  ],
  contradictingEvidence: [],
  missingInformation: ["The file does not record a seriousness column."],
  reasoningSummary: "The case's own words record a fatal outcome.",
  ai_used: true,
  prompt_version: "c17-generic-v1",
  model: "test-model",
};

vi.mock("./ai", () => ({ ai: { e2b: { c17: async () => backendResponse } } }));

const { backendC17AiProvider } = await import("./c17-ai");

const rule = {
  id: "NG-C1.7-EXPEDITED-PROVISIONAL",
  jurisdiction: "NG",
  version: "1.0",
  status: "ACTIVE" as const,
  authoritativeSource: null,
  criteria: [],
  title: "Seriousness-based expedited reporting",
  description: "",
};

function pvCase(): PVCase {
  return {
    internalCaseId: "job-1-1",
    sendersCaseId: "NG-1",
    caseSafetyReportId: "NG-1",
    worldwideUniqueId: "NG-1",
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
      sourceFile: "t.csv",
      sourceRow: 1,
      jobId: "job-1",
      sourceProfileId: "test",
    },
  };
}

describe("the backend's C.1.7 answer reaches the assessor", () => {
  it("is accepted by the assessment contract, evidence and all", async () => {
    const { record } = await runC17AiAssessment(pvCase(), rule, backendC17AiProvider);
    expect(record.status).toBe("COMPLETED");
    expect(record.recommendation).toBe("POTENTIALLY_EXPEDITED");
    expect(record.supportingEvidence).toHaveLength(2);
    expect(record.supportingEvidence[0]).toMatchObject({
      statement: 'The outcome column reads "Died".',
      sourceFields: ["outcome"],
      evidenceType: "FACT",
    });
    expect(record.missingInformation).toEqual(["The file does not record a seriousness column."]);
  });

  it("never carries the model's YES through as a decision", async () => {
    const { record } = await runC17AiAssessment(pvCase(), rule, backendC17AiProvider);
    // The stored vocabulary is deliberately hedged: the assessor decides.
    expect(record.recommendation).not.toBe("YES");
  });

  it("is still only a suggestion", async () => {
    const { record } = await runC17AiAssessment(pvCase(), rule, backendC17AiProvider);
    expect(record).not.toHaveProperty("finalDecision");
    expect(record.provider).toBe("backend-openai");
    expect(record.model).toBe("test-model");
  });
});
