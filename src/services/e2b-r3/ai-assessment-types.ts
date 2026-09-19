import type { PVCase } from "./types";

export const C17_AI_ASSESSMENT_INPUT_VERSION = "1" as const;
export const C17_AI_PROMPT_VERSION = "c17-generic-v1" as const;

export type AiAssessmentRecommendation =
  "NEEDS_REVIEW" | "POTENTIALLY_EXPEDITED" | "POTENTIALLY_NOT_EXPEDITED";

export type AiAssessmentStatus = "COMPLETED" | "INVALID_OUTPUT" | "UNAVAILABLE" | "STALE";

export interface AssessmentRule {
  id: string;
  jurisdiction?: string;
  version: string;
  title: string;
  description: string;
  status: "PROVISIONAL" | "ACTIVE" | "RETIRED";
  effectiveFrom?: string | undefined;
  effectiveTo?: string | undefined;
  authoritativeSource?: string | null | undefined;
  criteria: unknown;
}

export interface C17AiAssessmentInput {
  inputVersion: typeof C17_AI_ASSESSMENT_INPUT_VERSION;
  caseId: string;
  snapshotHash: string;
  caseData: PVCase;
  rule: AssessmentRule;
}

export interface AiEvidenceItem {
  statement: string;
  sourceFields: string[];
  evidenceType: "FACT" | "MISSING" | "ASSUMPTION" | "CONCLUSION";
}

export interface StructuredAiAssessmentOutput {
  recommendation: AiAssessmentRecommendation;
  confidence: number;
  supportingEvidence: AiEvidenceItem[];
  contradictingEvidence: AiEvidenceItem[];
  missingInformation: string[];
  assumptions: string[];
  relevantCaseFields: string[];
  reasoningSummary: string;
  ruleId: string;
  ruleVersion: string;
  inputSnapshotHash: string;
}

export interface C17AiAssessmentRecord extends StructuredAiAssessmentOutput {
  id: string;
  caseId: string;
  inputVersion: typeof C17_AI_ASSESSMENT_INPUT_VERSION;
  inputSnapshotHash: string;
  rule: AssessmentRule;
  provider: string;
  model?: string | undefined;
  modelVersion?: string | undefined;
  promptVersion: string;
  status: AiAssessmentStatus;
  createdAt: string;
}

export interface C17AiAssessmentProvider {
  readonly providerId: string;
  assess(input: C17AiAssessmentInput): Promise<unknown>;
}

export interface C17AiAssessmentResult {
  input: C17AiAssessmentInput;
  record: C17AiAssessmentRecord;
}
