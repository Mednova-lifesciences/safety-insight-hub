import {
  deriveAdministrativeStatus,
  describeAdministrativeStatus,
} from "./administrative-screening";
import {
  deriveAggregateSafetySectionStatus,
  deriveExposureSectionStatus,
} from "./nigeria-requirements";
import {
  PSUR_V4_TEMPLATE_SECTIONS,
  type PsurBenefitRiskAssessment,
  type PsurNigerianContext,
  type PsurFinding,
  type PsurRegulatoryDecision,
  type PsurScreeningResult,
  type PsurSectionCoverage,
  type PsurSectionStatus,
  type PsurSignOff,
  type PsurSpecialPopulationItem,
  type PsurUncertainty,
  type PsurV4SectionId,
} from "@/types/pv";

/**
 * THE single place the "is this section actually okay" question gets
 * answered consistently across the whole PSUR assessment page — Section
 * Coverage panel, Review Findings, the Executive Summary, and the
 * Compliance Directive all read through buildAuthoritativeSectionCoverage
 * (or reconcileSectionFindings, built on top of it) rather than each
 * re-deriving their own notion of "missing" from a different signal.
 *
 * Root problem this file fixes: the AI (and, before this, the app) used
 * to make TWO independent judgements about the same submission — a
 * coarse per-section boolean ("present") and a separate, unconstrained
 * findings list — with nothing requiring them to agree. A submission
 * could show "Section 9 — absent" with zero findings mentioning Section
 * 9 at all, because nothing ever checked that the two agreed. Two
 * structural fixes close this:
 *  1. For every section with a richer structured sub-model this app
 *     already collects (S9 special populations, S10 benefit-risk, S11
 *     uncertainties, S12 regulatory decision, S13 sign-off), the coarse
 *     status is DERIVED from that real data, never independently
 *     asserted by a second AI judgement that could disagree with the
 *     first.
 *  2. For every OTHER section (S1-S8, and S9/S10 before their structured
 *     data exists), reconcileSectionFindings deterministically guarantees
 *     a corresponding actionable finding exists whenever the coverage
 *     status says MISSING or PRESENT_BUT_INCOMPLETE — synthesizing one,
 *     idempotently, if the AI's findings list doesn't already have one.
 */

const sectionName = new Map(PSUR_V4_TEMPLATE_SECTIONS.map((s) => [s.id, s.name]));

/** Kept dependency-free from services/api/db.ts's newId (which pulls in
 *  the Supabase client at module scope) so this stays a pure, DB-free
 *  module — same convention as services/e2b-r3/regulatory-config.ts. */
function newFindingId(): string {
  return `pf-${crypto.randomUUID()}`;
}

/** Sections whose completion is inherently an assessor ACT, not a claim
 *  about the submitted document's own content — S12/S13 are the
 *  assessor's own regulatory decision and sign-off, and ADMIN_SCREENING
 *  already has its own dedicated administrative-checks display. Never
 *  synthesize a "missing section" finding for these — there is nothing
 *  in the submission that could be missing; what's outstanding is an
 *  assessor task, already visible via that section's own panel. */
export const RECONCILIATION_EXCLUDED_SECTIONS = new Set<PsurV4SectionId>([
  "ADMIN_SCREENING",
  "S12_REGULATORY_DECISION",
  "S13_CONCLUSION_SIGNOFF",
]);

/** Statuses that represent a genuine, actionable deficiency — the only
 *  ones that ever trigger finding synthesis. NOT_APPLICABLE and
 *  ADEQUATELY_ADDRESSED are resolved states; ASSESSOR_PENDING means
 *  "not yet assessed," which is an honest unknown, not a claimed defect —
 *  synthesizing a "this is missing" finding for it would be exactly the
 *  kind of fabricated certainty this system exists to avoid. */
const DEFICIENT_STATUSES = new Set<PsurSectionStatus>(["MISSING", "PRESENT_BUT_INCOMPLETE"]);

/** Reads a section-coverage entry from either the current `status` shape
 *  or the retired `present: boolean` shape (documents saved before this
 *  change) — never assumes storage was migrated. A legacy `present:true`
 *  downgrades to PRESENT_BUT_INCOMPLETE, not ADEQUATELY_ADDRESSED: the
 *  old boolean never actually verified adequacy (that's the exact bug
 *  this whole change fixes), so treating it as "good enough" would carry
 *  the bug forward. A legacy `present:false` maps to MISSING, preserving
 *  the claim the old data actually made. */
export function normalizeSectionCoverage(
  raw: ReadonlyArray<Record<string, unknown>> | undefined,
): PsurSectionCoverage[] {
  if (!raw) return [];
  return raw.map((r) => {
    const section = r["section"] as PsurV4SectionId;
    const comment = (r["comment"] as string | undefined) ?? "";
    if (typeof r["status"] === "string") {
      return {
        section,
        status: r["status"] as PsurSectionStatus,
        comment,
        notApplicableJustification: r["notApplicableJustification"] as string | undefined,
        source: (r["source"] as PsurSectionCoverage["source"] | undefined) ?? "ai",
      };
    }
    const legacyPresent = r["present"] as boolean | undefined;
    return {
      section,
      status: legacyPresent ? "PRESENT_BUT_INCOMPLETE" : "MISSING",
      comment,
      source: "ai",
    } satisfies PsurSectionCoverage;
  });
}

/** Generic aggregator for a fixed-item sub-model (Section 9's 8 areas,
 *  Section 11's uncertainty rows once each carries its own status) —
 *  MISSING/PRESENT_BUT_INCOMPLETE bubble up, an empty list is honestly
 *  "not yet assessed," and only a fully NOT_APPLICABLE-or-adequate list
 *  reads as adequately addressed. */
export function deriveStatusFromItems(items: { status: PsurSectionStatus }[]): PsurSectionStatus {
  if (items.length === 0) return "ASSESSOR_PENDING";
  if (items.some((i) => i.status === "MISSING")) return "MISSING";
  if (items.some((i) => i.status === "PRESENT_BUT_INCOMPLETE")) return "PRESENT_BUT_INCOMPLETE";
  if (items.every((i) => i.status === "ADEQUATELY_ADDRESSED" || i.status === "NOT_APPLICABLE")) {
    return "ADEQUATELY_ADDRESSED";
  }
  // Any remaining case (e.g. an item still ASSESSOR_PENDING among
  // otherwise-resolved ones) means the section isn't fully resolved yet,
  // but nothing about it is a confirmed defect either.
  return "ASSESSOR_PENDING";
}

/** Section 11 has no per-item status field (an uncertainty is either
 *  recorded or it isn't) — its section-level status instead depends on
 *  whether the assessor has explicitly confirmed none apply. Never treat
 *  an empty, never-touched list as equivalent to "confirmed none." */
export function deriveUncertaintiesSectionStatus(
  uncertainties: PsurUncertainty[] | undefined,
  noneConfirmed: unknown,
): PsurSectionStatus {
  const items = uncertainties ?? [];
  if (items.length === 0) {
    return noneConfirmed ? "ADEQUATELY_ADDRESSED" : "ASSESSOR_PENDING";
  }
  // Recorded uncertainties without a rationale are structurally
  // incomplete per the V4 template's mandatory-rationale requirement.
  const allHaveRationale = items.every((u) => u.rationale.trim().length > 0);
  return allHaveRationale ? "ADEQUATELY_ADDRESSED" : "PRESENT_BUT_INCOMPLETE";
}

/** Sections 12/13 are pure assessor output — their "coverage" question is
 *  really "has the assessor done this yet," never a claim about the
 *  submitted document. */
export function deriveAssessorActionStatus(hasRecord: boolean): PsurSectionStatus {
  return hasRecord ? "ADEQUATELY_ADDRESSED" : "ASSESSOR_PENDING";
}

/** Section 10's coverage should reflect what's actually in the working
 *  benefit-risk table, not a second, independent AI guess that could
 *  disagree with it. No table at all defers to whatever coarse judgement
 *  the AI made (it may not have been a PDF, or extraction may have
 *  failed); once a table exists, "adequately addressed" requires the
 *  core sub-tables (benefits, risks, integrated effects) to actually have
 *  entries — an empty AI extraction (the source text supported nothing)
 *  reads as MISSING, not silently upgraded. */
export function deriveBenefitRiskSectionStatus(
  benefitRisk: PsurBenefitRiskAssessment | undefined,
  fallback: PsurSectionStatus,
): PsurSectionStatus {
  if (!benefitRisk) return fallback;
  const hasCore =
    benefitRisk.keyBenefits.length > 0 &&
    benefitRisk.keyRisks.length > 0 &&
    benefitRisk.integratedEffectsTable.length > 0;
  if (hasCore) return "ADEQUATELY_ADDRESSED";
  const hasAnything =
    benefitRisk.keyBenefits.length > 0 ||
    benefitRisk.keyRisks.length > 0 ||
    benefitRisk.integratedEffectsTable.length > 0 ||
    benefitRisk.missingInformation.length > 0;
  return hasAnything ? "PRESENT_BUT_INCOMPLETE" : "MISSING";
}

export interface AuthoritativeCoverageInput {
  screening?:
    | (Pick<PsurScreeningResult, "sectionCoverage"> &
        Partial<Pick<PsurScreeningResult, "administrativeChecks">>)
    | undefined;
  /** PDF vs spreadsheet — decides whether Section 5's Nigerian exposure
   *  requirement binds at all (see nigerianExposureRequired). */
  sourceType?: "PDF" | "SPREADSHEET" | undefined;
  nigerianContext?: PsurNigerianContext | undefined;
  specialPopulations?: PsurSpecialPopulationItem[] | undefined;
  benefitRisk?: PsurBenefitRiskAssessment | undefined;
  uncertainties?: PsurUncertainty[] | undefined;
  uncertaintiesNoneConfirmed?: unknown;
  regulatoryDecision?: PsurRegulatoryDecision | undefined;
  signOff?: PsurSignOff | undefined;
}

/**
 * THE authoritative per-section status for all 14 V4 sections — what
 * every part of the UI (and the executive summary / compliance
 * directive) should render, instead of each computing its own view.
 * Starts from the AI/rule-asserted coarse coverage (normalized for
 * legacy documents), then OVERRIDES S9/S10/S11/S12/S13 with statuses
 * derived from their own real structured data — see each derive*
 * function's doc comment for why each override is correct. A section
 * with no coarse entry at all (never assessed — e.g. AI unavailable)
 * defaults to ASSESSOR_PENDING, never MISSING.
 */
export function buildAuthoritativeSectionCoverage(
  doc: AuthoritativeCoverageInput,
): PsurSectionCoverage[] {
  const base = new Map(
    normalizeSectionCoverage(
      doc.screening?.sectionCoverage as unknown as Record<string, unknown>[] | undefined,
    ).map((c) => [c.section, c]),
  );

  const result: PsurSectionCoverage[] = PSUR_V4_TEMPLATE_SECTIONS.map((s) => {
    const existing = base.get(s.id);
    const fallback: PsurSectionCoverage = existing ?? {
      section: s.id,
      status: "ASSESSOR_PENDING",
      comment: "Not yet assessed.",
      source: "ai",
    };

    switch (s.id) {
      case "ADMIN_SCREENING": {
        // Derived from the four checks themselves — the parent row used to
        // read "Not yet assessed" directly above its own completed results.
        const checks = doc.screening?.administrativeChecks;
        if (!checks || checks.length === 0) return fallback;
        return {
          section: s.id,
          status: deriveAdministrativeStatus(checks),
          comment: describeAdministrativeStatus(checks),
          source: "rule",
        };
      }
      case "S5_EXPOSURE_ACTIONS": {
        // Global exposure does not satisfy a Nigerian requirement — see
        // nigeria-requirements.ts for the measured failure this fixes.
        const derived = deriveExposureSectionStatus(doc.nigerianContext, fallback.status);
        if (derived === null) return fallback;
        return {
          section: s.id,
          status: derived,
          comment:
            "Exposure is reported, but no Nigeria-specific exposure denominator is stated for the reporting interval.",
          source: "rule",
        };
      }
      case "S7_AGGREGATE_SAFETY_DATA": {
        const derived = deriveAggregateSafetySectionStatus(doc.nigerianContext, fallback.status);
        if (derived === null) return fallback;
        const ctx = doc.nigerianContext!;
        const gaps = [
          ctx.nigerianCaseCountProvided ? null : "the Nigerian case count",
          ctx.vigiflowReconciliationProvided
            ? null
            : "reconciliation against the Nigerian ICSR data",
        ].filter(Boolean);
        return {
          section: s.id,
          status: derived,
          comment: `Aggregate safety data is reported, but ${gaps.join(" and ")} ${gaps.length > 1 ? "are" : "is"} not provided.`,
          source: "rule",
        };
      }
      case "S9_SPECIAL_POPULATIONS": {
        if (!doc.specialPopulations || doc.specialPopulations.length === 0) return fallback;
        return {
          section: s.id,
          status: deriveStatusFromItems(doc.specialPopulations),
          comment: "Derived from the special-population/special-situation area assessments below.",
          source: doc.specialPopulations.some((i) => i.source === "assessor") ? "assessor" : "ai",
        };
      }
      case "S10_BENEFIT_RISK": {
        const status = deriveBenefitRiskSectionStatus(doc.benefitRisk, fallback.status);
        return {
          section: s.id,
          status,
          comment: doc.benefitRisk
            ? "Derived from the Section 10 benefit-risk sub-tables below."
            : fallback.comment,
          source:
            doc.benefitRisk && !doc.benefitRisk.assistGenerated ? "assessor" : fallback.source,
        };
      }
      case "S11_UNCERTAINTIES": {
        return {
          section: s.id,
          status: deriveUncertaintiesSectionStatus(
            doc.uncertainties,
            doc.uncertaintiesNoneConfirmed,
          ),
          comment: doc.uncertaintiesNoneConfirmed
            ? "Assessor confirmed no uncertainties apply this interval."
            : "Derived from the Section 11 uncertainties recorded below.",
          source: doc.uncertaintiesNoneConfirmed ? "assessor" : fallback.source,
        };
      }
      case "S12_REGULATORY_DECISION": {
        return {
          section: s.id,
          status: deriveAssessorActionStatus(!!doc.regulatoryDecision),
          comment: doc.regulatoryDecision
            ? `Regulatory decision recorded by ${doc.regulatoryDecision.decidedBy}.`
            : "The assessor has not yet recorded a regulatory decision.",
          source: "assessor",
        };
      }
      case "S13_CONCLUSION_SIGNOFF": {
        return {
          section: s.id,
          status: deriveAssessorActionStatus(!!doc.signOff?.conclusion?.trim()),
          comment: doc.signOff?.conclusion?.trim()
            ? "Conclusion and sign-off recorded by the assessor."
            : "The assessor has not yet recorded a conclusion/sign-off.",
          source: "assessor",
        };
      }
      default:
        return fallback;
    }
  });

  return result;
}

/** A section already has a corresponding finding when some finding names
 *  it via v4Section — the exact link the Section Coverage panel and
 *  Review Findings panel both render, so this is the same test a human
 *  reading both panels side by side would apply. */
function sectionHasFinding(section: PsurV4SectionId, findings: PsurFinding[]): boolean {
  return findings.some((f) => f.v4Section === section);
}

/**
 * Synthesizes the MISSING finding(s) the task's whole request is about:
 * for every section whose authoritative status is MISSING or
 * PRESENT_BUT_INCOMPLETE (excluding RECONCILIATION_EXCLUDED_SECTIONS),
 * guarantee at least one actionable finding tagged with that section
 * exists. Returns ONLY the newly-synthesized findings — the caller
 * appends them to the existing list. Idempotent: re-running against a
 * findings list that already has a matching finding for a section
 * produces nothing new for that section, so this is always safe to call
 * again after a re-review or an assessor edit.
 */
export function reconcileSectionFindings(
  coverage: PsurSectionCoverage[],
  existingFindings: PsurFinding[],
): PsurFinding[] {
  const synthesized: PsurFinding[] = [];
  for (const c of coverage) {
    if (RECONCILIATION_EXCLUDED_SECTIONS.has(c.section)) continue;
    if (!DEFICIENT_STATUSES.has(c.status)) continue;
    if (
      sectionHasFinding(c.section, existingFindings) ||
      sectionHasFinding(c.section, synthesized)
    ) {
      continue;
    }
    const name = sectionName.get(c.section) ?? c.section;
    const isMissing = c.status === "MISSING";
    synthesized.push({
      id: newFindingId(),
      category: "MISSING_SECTION",
      severity: isMissing ? "HIGH" : "MEDIUM",
      section: name,
      description: isMissing
        ? `"${name}" was assessed as missing from this submission.`
        : `"${name}" is present but assessed as incomplete.`,
      evidence: c.comment,
      suggestedSource: {
        type: "REQUEST_FROM_MAH",
        note: `Ask the MAH to supply or complete "${name}".`,
      },
      v4Section: c.section,
      deficiencyType: isMissing ? "MISSING_REQUIRED_SECTION" : "INCOMPLETE_INFORMATION",
      assistGenerated: true,
      humanAssessment: null,
      source: "rule",
    });
  }
  return synthesized;
}
