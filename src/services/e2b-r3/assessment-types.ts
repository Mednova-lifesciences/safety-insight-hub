import type { PVCase } from "./types";

export const E2B_C17_ASSESSMENT_TYPE = "C1.7_EXPEDITED_REPORTING" as const;
export const E2B_C17_RULE_ID = "NG-C1.7-EXPEDITED-PROVISIONAL" as const;
export const E2B_C17_RULE_VERSION = "0.1" as const;

export type E2bAssessmentStatus = "UNASSESSED" | "NEEDS_REVIEW" | "FINALIZED";
export type E2bAssessmentDecision = "YES" | "NO";

export interface E2bRegulatoryRuleVersion {
  ruleSetId: string;
  ruleId: string;
  version: string;
  jurisdiction: string;
  name: string;
  description: string;
  status: "DRAFT" | "PROVISIONAL" | "ACTIVE" | "RETIRED";
  sourceReference: string;
  sourceDocument?: string;
  sourceDocumentVersion?: string;
}

export interface E2bAssessmentEvidence {
  field: string;
  value: string;
  source: "PVCase" | "configuration" | "rule";
  explanation: string;
}

export interface E2bRegulatoryAssessment {
  id?: string;
  organizationId?: string;
  jobId: string;
  caseId: string;
  assessmentType: typeof E2B_C17_ASSESSMENT_TYPE;
  jurisdiction: string;
  rule: E2bRegulatoryRuleVersion;
  sourceSnapshot: {
    caseId: string;
    caseHash: string;
    /** Complete canonical PVCase snapshot used by the assessment lifecycle. */
    snapshot?: PVCase;
  };
  assessmentVersion?: number;
  supersedesAssessmentId?: string;
  status: E2bAssessmentStatus;
  recommendation?: E2bAssessmentDecision | "NEEDS_REVIEW";
  finalDecision?: E2bAssessmentDecision;
  matchedCriteria: string[];
  unmetCriteria: string[];
  missingFacts: string[];
  evidence: E2bAssessmentEvidence[];
  rationale: string;
  reviewerId?: string;
  /** Recorded by the finalization function alongside reviewerId. */
  reviewerName?: string;
  reviewedAt?: string;
  overrideReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface E2bAssessmentContext {
  jobId: string;
  jurisdiction?: string;
  configurationRevision?: string;
}

export interface E2bFinalizedCase extends PVCase {
  assessment?: E2bRegulatoryAssessment;
}
