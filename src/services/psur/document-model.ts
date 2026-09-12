import {
  PSUR_V4_TEMPLATE_SECTIONS,
  type PsurAdministrativeCheck,
  type PsurAiRecommendation,
  type PsurBenefitRiskAssessment,
  type PsurDocument,
  type PsurFinding,
  type PsurRegulatoryDecision,
  type PsurRiskMinimisationAction,
  type PsurScreeningResult,
  type PsurSectionCoverage,
  type PsurSignOff,
  type PsurSuggestedSource,
  type PsurUncertainty,
  type PsurV4SectionId,
} from "@/types/pv";
import { isActionOwnerOverridden, requiresMahAction } from "./finding-ownership";
import { buildAuthoritativeSectionCoverage } from "./section-consistency";

/**
 * THE single, pure model both the Executive Summary and the Compliance
 * Directive render from — plain-text and DOCX renderers in
 * services/api/psur.ts consume these, never re-deriving their own
 * interpretation of "what's outstanding" or "what the assessor decided."
 * Both documents therefore always reflect the same saved state, and a
 * change (accept/dismiss a finding, save Section 9-13 data, re-run
 * review) that's visible on the assessment page is guaranteed visible in
 * both documents on next generation.
 *
 * The two documents serve different audiences and must not be confused:
 *  - ExecutiveSummaryModel: "what did the assessment find and where does
 *    it stand" — INTERNAL/assessor-facing, broad.
 *  - ComplianceDirectiveModel: "what does the MAH need to address" —
 *    EXTERNAL-facing (drafted for the MAH), narrow and action-oriented.
 *    Never a copy of the executive summary; only genuinely MAH-facing,
 *    OUTSTANDING (accepted, not yet resolved) deficiencies appear in its
 *    action table.
 */

export const SUGGESTED_SOURCE_LABEL: Record<PsurSuggestedSource["type"], string> = {
  VIGIFLOW_NIGERIA: "Check VigiFlow (Nigerian data)",
  REQUEST_FROM_MAH: "Request from the MAH",
  PUBLISHED_LITERATURE: "Published literature",
  REFERENCE_SAFETY_INFORMATION: "Reference Safety Information (RSI/SmPC)",
  WORLDWIDE_REGULATORY_ACTIONS: "Worldwide regulatory actions",
  PATIENT_HCP_FEEDBACK: "Patient/HCP feedback",
  RISK_MANAGEMENT_PLAN: "Risk Management Plan / PASS",
  OTHER: "Other source",
};

/** Risk-minimisation actions that require the MAH to actually do or
 *  submit something — distinct from purely NAFDAC-internal regulatory
 *  outcomes (e.g. referring to an internal expert committee). Only these
 *  ever surface in the Compliance Directive's regulatory-context section;
 *  the directive is drafted for the MAH, so an internal-only decision has
 *  nothing to tell them. */
const MAH_FACING_ACTIONS = new Set<PsurRiskMinimisationAction>([
  "REQUEST_ADDITIONAL_INFO_FROM_MAH",
  "REQUEST_MAH_CLARIFICATION",
  "TARGETED_COMMUNICATION_SAFETY_LETTER",
  "SUBMIT_UPDATE_RMP",
  "PROPOSAL_FOR_PASS",
  "UPDATE_SMPC_PIL_LABEL",
]);

const sectionById = new Map(PSUR_V4_TEMPLATE_SECTIONS.map((s) => [s.id, s]));

function fmtDate(iso: string | undefined): string {
  if (!iso) return "not recorded";
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

export interface DocumentMeta {
  filename: string;
  documentId: string;
  product: string;
  /** Marketing Authorisation Holder — "Not extracted" when the submitted
   *  document didn't yield one; never invented. */
  mah: string;
  reportingPeriod: string;
  uploadedBy: string;
  uploadedAtLabel: string;
  stage: PsurDocument["stage"];
  sourceType: PsurDocument["sourceType"];
  generatedAtLabel: string;
}

function buildMeta(doc: PsurDocument): DocumentMeta {
  return {
    filename: doc.filename,
    documentId: doc.id,
    product: doc.product,
    mah: doc.mah?.trim() || "Not extracted from the submitted document",
    reportingPeriod: doc.reportingPeriod,
    uploadedBy: doc.uploadedBy,
    uploadedAtLabel: fmtDate(doc.uploadedAt),
    stage: doc.stage,
    sourceType: doc.sourceType,
    generatedAtLabel: fmtDate(new Date().toISOString()),
  };
}

export interface ExecutiveSummaryModel {
  meta: DocumentMeta;
  administrative: {
    checks: PsurAdministrativeCheck[];
    aiRecommendation: PsurScreeningResult["recommendation"];
    assessorDecision: PsurScreeningResult["humanOverride"] | null;
  } | null;
  sectionCoverage: PsurSectionCoverage[];
  findings: {
    total: number;
    accepted: number;
    dismissed: number;
    pending: number;
    acceptedBySeverity: Record<"HIGH" | "MEDIUM" | "LOW", number>;
    mahActionCount: number;
    assessorInternalCount: number;
    resolvedCount: number;
    outstandingCount: number;
    acceptedFindings: PsurFinding[];
  };
  benefitRisk: {
    recorded: boolean;
    assessorOwned: boolean;
    data: PsurBenefitRiskAssessment | null;
  };
  uncertainties: {
    status: "CONFIRMED_NONE" | "RECORDED" | "PENDING";
    items: PsurUncertainty[];
    noneConfirmed: PsurDocument["uncertaintiesNoneConfirmed"] | null;
    /** Section 11's "Evaluator's comments" free-text appraisal. */
    evaluatorComments: string | null;
  };
  aiRecommendation: PsurAiRecommendation | null;
  regulatoryDecision: PsurRegulatoryDecision | null;
  signOff: PsurSignOff | null;
}

export function buildExecutiveSummaryModel(
  doc: PsurDocument,
  allFindings: PsurFinding[],
): ExecutiveSummaryModel {
  const accepted = allFindings.filter((f) => f.humanAssessment === "ACCEPTED");
  const dismissed = allFindings.filter((f) => f.humanAssessment === "DISMISSED");
  const pending = allFindings.filter((f) => !f.humanAssessment);
  const mahAction = accepted.filter(requiresMahAction);
  const resolved = accepted.filter((f) => f.resolved);

  return {
    meta: buildMeta(doc),
    administrative: doc.screening
      ? {
          checks: doc.screening.administrativeChecks,
          aiRecommendation: doc.screening.recommendation,
          assessorDecision: doc.screening.humanOverride ?? null,
        }
      : null,
    sectionCoverage: buildAuthoritativeSectionCoverage(doc),
    findings: {
      total: allFindings.length,
      accepted: accepted.length,
      dismissed: dismissed.length,
      pending: pending.length,
      acceptedBySeverity: {
        HIGH: accepted.filter((f) => f.severity === "HIGH").length,
        MEDIUM: accepted.filter((f) => f.severity === "MEDIUM").length,
        LOW: accepted.filter((f) => f.severity === "LOW").length,
      },
      mahActionCount: mahAction.length,
      assessorInternalCount: accepted.length - mahAction.length,
      resolvedCount: resolved.length,
      outstandingCount: accepted.length - resolved.length,
      acceptedFindings: [...accepted].sort(
        (a, b) => severityRank(b.severity) - severityRank(a.severity),
      ),
    },
    benefitRisk: {
      recorded: !!doc.benefitRisk,
      assessorOwned: !!doc.benefitRisk && !doc.benefitRisk.assistGenerated,
      data: doc.benefitRisk ?? null,
    },
    uncertainties: {
      status: doc.uncertaintiesNoneConfirmed
        ? "CONFIRMED_NONE"
        : (doc.uncertainties?.length ?? 0) > 0
          ? "RECORDED"
          : "PENDING",
      items: doc.uncertainties ?? [],
      noneConfirmed: doc.uncertaintiesNoneConfirmed ?? null,
      evaluatorComments: doc.evaluatorComments?.trim() || null,
    },
    aiRecommendation: doc.aiRecommendation ?? null,
    regulatoryDecision: doc.regulatoryDecision ?? null,
    signOff: doc.signOff?.conclusion?.trim() ? doc.signOff : null,
  };
}

function severityRank(s: PsurFinding["severity"]): number {
  return s === "HIGH" ? 3 : s === "MEDIUM" ? 2 : 1;
}

export interface ComplianceDeficiencyRow {
  referenceNo: string;
  v4SectionLabel: string;
  deficiencyType: string | null;
  severity: PsurFinding["severity"];
  whatWasIdentified: string;
  whyMaterial: string;
  requiredAction: string;
  assessorObservation: string | null;
  suggestedSource: { label: string; note: string } | null;
  /** Present only when an assessor deliberately reassigned this finding to
   *  the MAH against the derivation — recorded so the directive shows a
   *  human made that call, never presenting it as a system classification. */
  ownershipOverride: { by: string; atLabel: string; rationale: string } | null;
  status: "OUTSTANDING";
}

/**
 * A specific, grounded instruction for what the MAH must supply/correct —
 * never invented regulatory wording. For a MISSING/INCOMPLETE section
 * finding, reuses that V4 section's own real sub-item checklist (already
 * sourced from the NAFDAC template, see types/pv.ts's
 * PSUR_V4_TEMPLATE_SECTIONS) as the concrete list of what to provide —
 * e.g. Section 4 (RSI) becomes "Provide '4. Reference Safety Information
 * (RSI)', addressing: RSI type (SmPC/CDS/CCDS) and version; changes made
 * this interval; rationale for the changes." For any other finding with
 * an explicit REQUEST_FROM_MAH suggested source, reuses that source's own
 * (already-vetted, non-fabricated) guidance note. Otherwise falls back to
 * the finding's own description — never fabricates specifics beyond what
 * the finding itself already states.
 */
export function buildRequiredAction(f: PsurFinding): string {
  const isSectionDeficiency =
    f.deficiencyType === "MISSING_REQUIRED_SECTION" ||
    f.deficiencyType === "INCOMPLETE_INFORMATION";
  if (isSectionDeficiency && f.v4Section) {
    const section = sectionById.get(f.v4Section as PsurV4SectionId);
    if (section) {
      const verb = f.deficiencyType === "MISSING_REQUIRED_SECTION" ? "Provide" : "Complete";
      return `${verb} "${section.name}", addressing: ${section.subItems.join("; ")}.`;
    }
  }
  // When an assessor has deliberately referred a finding to the MAH, their
  // own rationale is the most specific statement of what the MAH must
  // account for — and is usually the only place it is stated at all, since
  // a finding the rules called assessor-resolvable carries no MAH-facing
  // guidance. Preferred over the bare description, which merely restates
  // the observation without asking for anything.
  if (f.actionOwnerOverride?.owner === "MAH" && f.actionOwnerOverride.rationale.trim()) {
    return f.actionOwnerOverride.rationale.trim();
  }
  if (f.suggestedSource?.type === "REQUEST_FROM_MAH") {
    return f.suggestedSource.note;
  }
  return f.description;
}

export interface ComplianceDirectiveModel {
  meta: DocumentMeta;
  introduction: string;
  deficiencies: ComplianceDeficiencyRow[];
  regulatoryContext: {
    overallOutcome: string;
    mahFacingActions: string[];
    basis: string;
    decidedBy: string;
    decidedAtLabel: string;
  } | null;
  resolvedCount: number;
  dismissedCount: number;
}

/**
 * Builds the MAH-facing directive from the assessor's FINALIZED state —
 * never raw AI output. Only findings the assessor has ACCEPTED, that
 * genuinely require MAH action (see requiresMahAction in
 * finding-ownership.ts — NOT the suggestedSource category, which answers
 * the unrelated "where could I go look for this evidence" question),
 * and that are NOT YET resolved appear in the action table — accepting a
 * finding records it as a valid deficiency, it does not by itself mean
 * it's been fixed, and a resolved deficiency has nothing left for the
 * MAH to do. Assessor-internal observations (no MAH-facing source) never
 * appear here even if accepted — see this module's own doc comment above:
 * those belong in the Executive Summary, not the directive.
 */
export function buildComplianceDirectiveModel(
  doc: PsurDocument,
  allFindings: PsurFinding[],
): ComplianceDirectiveModel {
  const accepted = allFindings.filter((f) => f.humanAssessment === "ACCEPTED");
  const dismissed = allFindings.filter((f) => f.humanAssessment === "DISMISSED");
  const outstandingMahAction = accepted.filter((f) => requiresMahAction(f) && !f.resolved);
  const resolved = accepted.filter((f) => f.resolved);

  const deficiencies: ComplianceDeficiencyRow[] = outstandingMahAction
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .map((f, i) => ({
      referenceNo: `DEF-${i + 1}`,
      v4SectionLabel: f.v4Section
        ? (sectionById.get(f.v4Section as PsurV4SectionId)?.name ?? f.v4Section)
        : f.section,
      deficiencyType: f.deficiencyType ?? null,
      severity: f.severity,
      whatWasIdentified: f.description,
      whyMaterial: f.evidence,
      requiredAction: buildRequiredAction(f),
      assessorObservation: f.rationale?.trim() || null,
      suggestedSource: f.suggestedSource
        ? { label: SUGGESTED_SOURCE_LABEL[f.suggestedSource.type], note: f.suggestedSource.note }
        : null,
      ownershipOverride:
        isActionOwnerOverridden(f) && f.actionOwnerOverride
          ? {
              by: f.actionOwnerOverride.by,
              atLabel: fmtDate(f.actionOwnerOverride.at),
              rationale: f.actionOwnerOverride.rationale,
            }
          : null,
      status: "OUTSTANDING",
    }));

  const mahFacingActions = (doc.regulatoryDecision?.actions ?? []).filter((a) =>
    MAH_FACING_ACTIONS.has(a),
  );

  return {
    meta: buildMeta(doc),
    introduction:
      `This PSUR/PBRER submission (${doc.product}, reporting period ${doc.reportingPeriod}) has been ` +
      `assessed by NAFDAC pharmacovigilance. The item(s) below require clarification, correction, ` +
      `additional information, or supporting evidence from the Marketing Authorisation Holder (MAH) ` +
      `before this assessment can be finalized.`,
    deficiencies,
    regulatoryContext:
      doc.regulatoryDecision && mahFacingActions.length > 0
        ? {
            overallOutcome: doc.regulatoryDecision.overallOutcome ?? "Not yet determined",
            mahFacingActions,
            basis: doc.regulatoryDecision.basis,
            decidedBy: doc.regulatoryDecision.decidedBy,
            decidedAtLabel: fmtDate(doc.regulatoryDecision.decidedAt),
          }
        : null,
    resolvedCount: resolved.length,
    dismissedCount: dismissed.length,
  };
}
