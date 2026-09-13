import type {
  PsurEvidenceQuality,
  PsurOverallBenefitRiskOutcome,
  PsurRiskMinimisationAction,
  PsurUncertaintyCategory,
} from "@/types/pv";

/**
 * THE one place a stored enum becomes words a person reads.
 *
 * These maps previously lived only in routes/_app/psur.tsx, so the screen
 * showed "Uncertain — requires follow-up" while the generated documents
 * printed the raw constant `UNCERTAIN_REQUIRES_FOLLOWUP` — a database value
 * in a letter addressed to a Marketing Authorisation Holder. Keeping them
 * here means the page and both documents cannot drift apart, which is the
 * same failure a duplicated suggested-source label map caused earlier in
 * this module's history.
 */

export const OVERALL_OUTCOME_LABEL: Record<PsurOverallBenefitRiskOutcome, string> = {
  FAVOURABLE: "Favourable",
  FAVOURABLE_WITH_CONDITIONS: "Favourable with conditions",
  UNCERTAIN_REQUIRES_FOLLOWUP: "Uncertain — requires follow-up",
  UNFAVOURABLE: "Unfavourable",
};

export const RISK_MINIMISATION_ACTION_LABEL: Record<PsurRiskMinimisationAction, string> = {
  NO_ACTION_REQUIRED: "No action required",
  CONTINUE_ROUTINE_PV: "Continue routine pharmacovigilance",
  REQUEST_ADDITIONAL_INFO_FROM_MAH: "Request additional information from MAH",
  REQUEST_MAH_CLARIFICATION: "Request MAH clarification",
  TARGETED_COMMUNICATION_SAFETY_LETTER: "Targeted communication / safety letter",
  SUBMIT_UPDATE_RMP: "Submit or update Risk Management Plan (RMP)",
  PROPOSAL_FOR_PASS: "Proposal for Post-Authorisation Safety Study (PASS)",
  UPDATE_SMPC_PIL_LABEL: "Update to SmPC / PIL / label (variation)",
  REFER_TO_EXPERT_ADVISORY_COMMITTEE: "Refer to Expert Advisory Committee",
  RECOMMEND_SUSPENSION_WITHDRAWAL: "Recommend suspension/withdrawal",
};

export const UNCERTAINTY_CATEGORY_LABEL: Record<PsurUncertaintyCategory, string> = {
  DATA_LIMITATIONS_UNDERREPORTING: "Data limitations or under-reporting",
  LIMITED_NIGERIAN_EXPOSURE: "Limited data on local (Nigerian) exposure",
  MISSING_SUBPOPULATION_DATA: "Missing subpopulation data",
  SHORT_FOLLOWUP_DURATION: "Short follow-up duration",
  STUDY_DESIGN_LIMITATIONS: "Study design limitations",
  LIMITED_GENERALISABILITY: "Limited generalisability of the studied population",
  OTHER: "Other",
};

export const EVIDENCE_QUALITY_LABEL: Record<PsurEvidenceQuality, string> = {
  HIGH: "High",
  MODERATE: "Moderate",
  LOW: "Low",
  VERY_LOW: "Very low",
  NOT_ASSESSABLE: "Not assessable",
};

/** Renders an enum for a reader, falling back to the raw value rather than
 *  throwing — a document must still generate if a value predates its label. */
export function label<T extends string>(map: Record<T, string>, value: T | undefined): string {
  if (!value) return "not set";
  return map[value] ?? String(value);
}
