import { newId } from "@/services/api/db";
import { c17SourceHash, c17SourceSnapshot } from "./assessment-rules";
import type { E2bRegulatoryAssessment } from "./assessment-types";
import type { PVCase } from "./types";
import {
  C17_AI_ASSESSMENT_INPUT_VERSION,
  C17_AI_PROMPT_VERSION,
  type AssessmentRule,
  type AiAssessmentRecommendation,
  type AiEvidenceItem,
  type C17AiAssessmentInput,
  type C17AiAssessmentProvider,
  type C17AiAssessmentRecord,
  type C17AiAssessmentResult,
  type StructuredAiAssessmentOutput,
} from "./ai-assessment-types";

const RECOMMENDATIONS = new Set<AiAssessmentRecommendation>([
  "NEEDS_REVIEW",
  "POTENTIALLY_EXPEDITED",
  "POTENTIALLY_NOT_EXPEDITED",
]);
const EVIDENCE_TYPES = new Set<AiEvidenceItem["evidenceType"]>([
  "FACT",
  "MISSING",
  "ASSUMPTION",
  "CONCLUSION",
]);
const ALLOWED_OUTPUT_FIELDS = new Set([
  "recommendation",
  "confidence",
  "supportingEvidence",
  "contradictingEvidence",
  "missingInformation",
  "assumptions",
  "relevantCaseFields",
  "reasoningSummary",
  "ruleId",
  "ruleVersion",
  "inputSnapshotHash",
  // Provenance of the answer, not part of it: which model replied.
  "model",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`AI assessment field ${field} must be an array of strings.`);
  }
  return value;
}

function parseEvidence(value: unknown, field: string): AiEvidenceItem[] {
  if (!Array.isArray(value)) throw new Error(`AI assessment field ${field} must be an array.`);
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`AI assessment ${field}[${index}] is invalid.`);
    const statement = item["statement"];
    const sourceFields = item["sourceFields"];
    const evidenceType = item["evidenceType"];
    if (
      typeof statement !== "string" ||
      !Array.isArray(sourceFields) ||
      sourceFields.some((sourceField) => typeof sourceField !== "string") ||
      typeof evidenceType !== "string" ||
      !EVIDENCE_TYPES.has(evidenceType as AiEvidenceItem["evidenceType"])
    ) {
      throw new Error(`AI assessment ${field}[${index}] is invalid.`);
    }
    return {
      statement,
      sourceFields,
      evidenceType: evidenceType as AiEvidenceItem["evidenceType"],
    };
  });
}

export function buildC17AiInput(pvCase: PVCase, rule: AssessmentRule): C17AiAssessmentInput {
  return {
    inputVersion: C17_AI_ASSESSMENT_INPUT_VERSION,
    caseId: pvCase.internalCaseId,
    snapshotHash: c17SourceHash(pvCase),
    caseData: c17SourceSnapshot(pvCase),
    rule,
  };
}

export function parseStructuredAiAssessment(
  raw: unknown,
  input: C17AiAssessmentInput,
): StructuredAiAssessmentOutput {
  if (!isRecord(raw)) throw new Error("AI assessment output must be a JSON object.");
  const unsafeFields = Object.keys(raw).filter((key) => !ALLOWED_OUTPUT_FIELDS.has(key));
  if (unsafeFields.length > 0) {
    throw new Error(
      `AI assessment output contains unsupported fields: ${unsafeFields.join(", ")}.`,
    );
  }
  const recommendation = raw["recommendation"];
  const confidence = raw["confidence"];
  const ruleId = raw["ruleId"];
  const ruleVersion = raw["ruleVersion"];
  const reasoningSummary = raw["reasoningSummary"];
  const inputSnapshotHash = raw["inputSnapshotHash"];
  if (
    typeof recommendation !== "string" ||
    !RECOMMENDATIONS.has(recommendation as AiAssessmentRecommendation) ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    typeof ruleId !== "string" ||
    typeof ruleVersion !== "string" ||
    typeof reasoningSummary !== "string" ||
    typeof inputSnapshotHash !== "string"
  ) {
    throw new Error("AI assessment output has invalid required fields.");
  }
  if (ruleId !== input.rule.id || ruleVersion !== input.rule.version) {
    throw new Error("AI assessment rule metadata does not match the supplied rule.");
  }
  if (inputSnapshotHash !== input.snapshotHash) {
    throw new Error("AI assessment snapshot hash does not match the supplied case snapshot.");
  }
  return {
    recommendation: recommendation as AiAssessmentRecommendation,
    confidence,
    supportingEvidence: parseEvidence(raw["supportingEvidence"], "supportingEvidence"),
    contradictingEvidence: parseEvidence(raw["contradictingEvidence"], "contradictingEvidence"),
    missingInformation: stringArray(raw["missingInformation"], "missingInformation"),
    assumptions: stringArray(raw["assumptions"], "assumptions"),
    relevantCaseFields: stringArray(raw["relevantCaseFields"], "relevantCaseFields"),
    reasoningSummary,
    ruleId,
    ruleVersion,
    inputSnapshotHash,
  };
}

export function createC17AiAssessmentRecord(
  input: C17AiAssessmentInput,
  output: StructuredAiAssessmentOutput,
  provider: string,
  metadata: { model?: string; modelVersion?: string; promptVersion?: string } = {},
): C17AiAssessmentRecord {
  return {
    id: newId("e2b-c17-ai"),
    caseId: input.caseId,
    inputVersion: input.inputVersion,
    rule: input.rule,
    provider,
    ...(metadata.model ? { model: metadata.model } : {}),
    ...(metadata.modelVersion ? { modelVersion: metadata.modelVersion } : {}),
    promptVersion: metadata.promptVersion ?? C17_AI_PROMPT_VERSION,
    status: "COMPLETED",
    createdAt: new Date().toISOString(),
    ...output,
  };
}

export async function runC17AiAssessment(
  pvCase: PVCase,
  rule: AssessmentRule,
  provider: C17AiAssessmentProvider,
): Promise<C17AiAssessmentResult> {
  const input = buildC17AiInput(pvCase, rule);
  let raw: unknown;
  try {
    raw = await provider.assess(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "AI assessment unavailable.";
    return {
      input,
      record: {
        id: newId("e2b-c17-ai"),
        caseId: input.caseId,
        inputVersion: input.inputVersion,
        inputSnapshotHash: input.snapshotHash,
        rule: input.rule,
        provider: provider.providerId,
        promptVersion: C17_AI_PROMPT_VERSION,
        status: "UNAVAILABLE",
        createdAt: new Date().toISOString(),
        recommendation: "NEEDS_REVIEW",
        confidence: 0,
        supportingEvidence: [],
        contradictingEvidence: [],
        missingInformation: [reason],
        assumptions: [],
        relevantCaseFields: [],
        reasoningSummary: "The AI provider was unavailable; human review is required.",
        ruleId: input.rule.id,
        ruleVersion: input.rule.version,
      },
    };
  }
  try {
    const output = parseStructuredAiAssessment(raw, input);
    const model = isRecord(raw) && typeof raw["model"] === "string" ? raw["model"] : undefined;
    return {
      input,
      record: createC17AiAssessmentRecord(
        input,
        output,
        provider.providerId,
        model ? { model } : {},
      ),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "AI assessment unavailable.";
    return {
      input,
      record: {
        id: newId("e2b-c17-ai"),
        caseId: input.caseId,
        inputVersion: input.inputVersion,
        inputSnapshotHash: input.snapshotHash,
        rule: input.rule,
        provider: provider.providerId,
        promptVersion: C17_AI_PROMPT_VERSION,
        status: "INVALID_OUTPUT",
        createdAt: new Date().toISOString(),
        recommendation: "NEEDS_REVIEW",
        confidence: 0,
        supportingEvidence: [],
        contradictingEvidence: [],
        missingInformation: [reason],
        assumptions: [],
        relevantCaseFields: [],
        reasoningSummary: "No usable AI assessment was produced; human review is required.",
        ruleId: input.rule.id,
        ruleVersion: input.rule.version,
      },
    };
  }
}

/** Safe provider for local development and tests. It never infers a result. */
export const needsReviewAiProvider: C17AiAssessmentProvider = {
  providerId: "none",
  async assess(input) {
    return {
      recommendation: "NEEDS_REVIEW",
      confidence: 0,
      supportingEvidence: [],
      contradictingEvidence: [],
      missingInformation: [
        "No AI provider is configured.",
        "An authoritative jurisdiction-specific rule is required before interpretation.",
      ],
      assumptions: [],
      relevantCaseFields: [],
      reasoningSummary: "No automated assessment was performed.",
      ruleId: input.rule.id,
      ruleVersion: input.rule.version,
      inputSnapshotHash: input.snapshotHash,
    };
  },
};

export function aiAssessmentCanApplyTo(record: C17AiAssessmentRecord, pvCase: PVCase): boolean {
  return record.status === "COMPLETED" && record.inputSnapshotHash === c17SourceHash(pvCase);
}

export function aiAssessmentFromRegulatoryAssessment(
  assessment: E2bRegulatoryAssessment,
): AssessmentRule {
  return {
    id: assessment.rule.ruleId,
    jurisdiction: assessment.rule.jurisdiction,
    title: assessment.rule.name,
    description: assessment.rule.description,
    version: assessment.rule.version,
    status: assessment.rule.status === "DRAFT" ? "PROVISIONAL" : assessment.rule.status,
    authoritativeSource:
      assessment.rule.sourceReference === "Regulatory confirmation pending"
        ? null
        : assessment.rule.sourceReference,
    criteria: [],
  };
}
