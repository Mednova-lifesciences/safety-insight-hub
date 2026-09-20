import { ai, type AiC17Evidence } from "./ai";
import { C17_CRITERION_LABELS, type C17Criterion, type C17Rule } from "@/services/e2b-r3/c17-rule";
import type {
  AiAssessmentRecommendation,
  C17AiAssessmentProvider,
} from "@/services/e2b-r3/ai-assessment-types";

/**
 * The model, asked about ONE case the rule could not settle — a row whose
 * line list never says whether it is serious. It answers with a suggestion
 * and its reasons; it cannot finalize anything (the database refuses), and
 * the E2B page shows it as a suggestion for a qualified assessor.
 *
 * Nothing about a source form reaches it: it sees the case's own words,
 * so it works for any line list.
 */
/** The model answers YES/NO about the rule; the assessment layer only ever
 *  records a suggestion, so an answer is carried across as "potentially".
 *  Anything unrecognised stays NEEDS_REVIEW. */
function asSuggestion(recommendation: string): AiAssessmentRecommendation {
  if (recommendation === "YES") return "POTENTIALLY_EXPEDITED";
  if (recommendation === "NO") return "POTENTIALLY_NOT_EXPEDITED";
  return "NEEDS_REVIEW";
}

/** Everything the model reports is a quote from the case, so it is recorded
 *  as a FACT with the fields it was read from. */
function asEvidence(items: AiC17Evidence[] | undefined) {
  return (items ?? []).map((item) => ({
    statement: item.statement,
    sourceFields: item.sourceFields ?? [],
    evidenceType: "FACT" as const,
  }));
}

export const backendC17AiProvider: C17AiAssessmentProvider = {
  providerId: "backend-openai",
  async assess(input) {
    const pvCase = input.caseData;
    const criteria = (Object.keys(C17_CRITERION_LABELS) as C17Criterion[]).map(
      (key) => C17_CRITERION_LABELS[key],
    );
    const response = await ai.e2b.c17({
      caseId: input.caseId,
      reactions: pvCase.reactions.map(
        (r) => r.reaction.sourceValue || r.sourceDecoding.sourceTerm || "",
      ),
      outcomes: pvCase.reactions.map((r) => r.outcome ?? "").filter(Boolean),
      seriousnessAsReported: pvCase.aggregateSeriousnessAsReported ?? null,
      narrative: pvCase.narrative ?? null,
      ruleName: input.rule.title,
      ruleVersion: input.rule.version,
      criteria,
    });
    // Shaped for parseStructuredAiAssessment, which rejects anything else.
    return {
      recommendation: asSuggestion(response.recommendation),
      confidence: response.confidence,
      supportingEvidence: asEvidence(response.supportingEvidence),
      contradictingEvidence: asEvidence(response.contradictingEvidence),
      missingInformation: response.missingInformation ?? [],
      assumptions: [],
      relevantCaseFields: ["reaction", "outcome", "seriousness", "narrative"],
      reasoningSummary: response.reasoningSummary ?? "",
      ruleId: input.rule.id,
      ruleVersion: input.rule.version,
      inputSnapshotHash: input.snapshotHash,
      // Recorded with the suggestion, so an assessor can see what answered.
      ...(response.model ? { model: response.model } : {}),
    };
  },
};

/** Whether the rule asks for AI help at all. */
export function aiAssistEnabled(rule: C17Rule | undefined): boolean {
  return rule?.aiAssistWhenUnclear !== false;
}
