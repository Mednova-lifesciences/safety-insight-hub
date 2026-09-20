import type { PVCase } from "./types";
import { DEFAULT_C17_RULE, evaluateC17, type C17Rule } from "./c17-rule";
import {
  E2B_C17_ASSESSMENT_TYPE,
  E2B_C17_RULE_ID,
  type E2bAssessmentEvidence,
  type E2bRegulatoryAssessment,
  type E2bRegulatoryRuleVersion,
} from "./assessment-types";

/** The rule as E2B assessment metadata: what judged the case, which
 *  version, and where it came from. Built from the organization's own rule
 *  so every assessment can be traced to the text in force at the time. */
export function c17RuleVersion(rule: C17Rule): E2bRegulatoryRuleVersion {
  return {
    ruleSetId: "e2b-c17-expedited",
    ruleId: E2B_C17_RULE_ID,
    version: rule.version,
    jurisdiction: rule.jurisdiction,
    name: rule.name,
    description: rule.notes,
    status: "ACTIVE",
    sourceReference:
      "ICH E2D; EU GVP VI; NAFDAC Good Pharmacovigilance Practice Guidelines (2021) §5.72; WHO/Nigeria AEFI surveillance",
  };
}

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

/**
 * Applies the organization's C.1.7 rule to one case and records what it
 * found. The recommendation is never the decision: the assessment is saved
 * as NEEDS_REVIEW and only a qualified assessor can finalize it.
 */
export function evaluateC17Assessment(
  pvCase: PVCase,
  context: { jobId: string; jurisdiction?: string; rule?: C17Rule },
): E2bRegulatoryAssessment {
  const rule = context.rule ?? DEFAULT_C17_RULE;
  const evaluation = evaluateC17(pvCase, rule);
  const evidence: E2bAssessmentEvidence[] = evaluation.matched.map((m) => ({
    field: m.key,
    value: m.label,
    source: "PVCase",
    explanation: m.detail,
  }));
  return {
    jobId: context.jobId,
    caseId: pvCase.internalCaseId,
    assessmentType: E2B_C17_ASSESSMENT_TYPE,
    jurisdiction: context.jurisdiction ?? rule.jurisdiction,
    rule: c17RuleVersion(rule),
    sourceSnapshot: {
      caseId: pvCase.internalCaseId,
      caseHash: c17SourceHash(pvCase),
      snapshot: c17SourceSnapshot(pvCase),
    },
    assessmentVersion: 1,
    status: "NEEDS_REVIEW",
    recommendation: evaluation.recommendation,
    matchedCriteria: evaluation.matched.map((m) => m.label),
    unmetCriteria: evaluation.unmet,
    missingFacts: evaluation.missingFacts,
    evidence,
    rationale: evaluation.rationale,
  };
}
