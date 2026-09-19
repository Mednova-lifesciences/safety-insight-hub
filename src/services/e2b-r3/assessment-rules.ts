import type { PVCase } from "./types";
import {
  E2B_C17_ASSESSMENT_TYPE,
  E2B_C17_RULE_ID,
  E2B_C17_RULE_VERSION,
  type E2bAssessmentEvidence,
  type E2bRegulatoryAssessment,
  type E2bRegulatoryRuleVersion,
} from "./assessment-types";

export const PROVISIONAL_NIGERIAN_C17_RULE: E2bRegulatoryRuleVersion = {
  ruleSetId: "nigeria-e2b-regulatory",
  ruleId: E2B_C17_RULE_ID,
  version: E2B_C17_RULE_VERSION,
  jurisdiction: "NG",
  name: "Nigeria C.1.7 expedited reporting assessment",
  description:
    "Provisional assessment scaffold. Nigerian expedited-reporting criteria require regulatory confirmation; the system does not infer a YES or NO from seriousness, hospitalization, causality, or MedDRA alone.",
  status: "PROVISIONAL",
  sourceReference: "Regulatory confirmation pending",
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function c17SourceSnapshot(pvCase: PVCase): PVCase {
  return JSON.parse(JSON.stringify(pvCase)) as PVCase;
}

/** Stamped with the time each preflight maps the line list (C.1.2, C.1.4,
 *  C.1.5 come from processedAt), so they change on every run without the
 *  case itself changing. Left in, they gave every run a new fingerprint and
 *  a finalized C.1.7 decision was superseded the moment preflight re-ran. */
const PER_RUN_FIELDS = ["dateOfCreation", "dateFirstReceived", "dateMostRecentInfo"] as const;

export function c17SourceHash(pvCase: PVCase): string {
  const content: Record<string, unknown> = { ...c17SourceSnapshot(pvCase) };
  for (const field of PER_RUN_FIELDS) delete content[field];
  const source = JSON.stringify(canonicalize(content));
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function evaluateProvisionalC17(
  pvCase: PVCase,
  context: { jobId: string; jurisdiction?: string; configurationRevision?: string },
): E2bRegulatoryAssessment {
  const evidence: E2bAssessmentEvidence[] = [];
  if (pvCase.aggregateSeriousnessAsReported) {
    evidence.push({
      field: "aggregateSeriousnessAsReported",
      value: pvCase.aggregateSeriousnessAsReported,
      source: "PVCase",
      explanation: "Source seriousness text is available but is not sufficient to decide C.1.7.",
    });
  }
  const missingFacts = [
    "authoritative jurisdiction-specific expedited-reporting criteria",
    "case facts required by the confirmed Nigerian reporting category",
  ];
  return {
    jobId: context.jobId,
    caseId: pvCase.internalCaseId,
    assessmentType: E2B_C17_ASSESSMENT_TYPE,
    jurisdiction: context.jurisdiction ?? "NG",
    rule: PROVISIONAL_NIGERIAN_C17_RULE,
    sourceSnapshot: {
      caseId: pvCase.internalCaseId,
      caseHash: c17SourceHash(pvCase),
      snapshot: c17SourceSnapshot(pvCase),
    },
    assessmentVersion: 1,
    status: "NEEDS_REVIEW",
    recommendation: "NEEDS_REVIEW",
    matchedCriteria: [],
    unmetCriteria: [],
    missingFacts,
    evidence,
    rationale:
      "Automatic determination is disabled because the Nigerian C.1.7 rule is provisional and required regulatory facts are not available. A qualified reviewer must decide YES or NO.",
  };
}
