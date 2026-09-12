import type {
  PsurFinding,
  PsurNigerianContext,
  PsurSectionStatus,
  PsurV4SectionId,
} from "@/types/pv";

/**
 * The Nigeria-specific parts of Sections 5 and 7, which the NAFDAC V4
 * template requires and which a holistic AI judgement was reliably missing.
 *
 * Measured behaviour before this module existed: given a submission whose
 * Section 5 carried only global patient-years and whose Section 7 carried
 * only worldwide case counts, the model returned "Adequately addressed" for
 * both — in two separate submissions, one of which had no section headings
 * at all. The general reasoning was sound; the failure was specific. Asking
 * a model for one overall verdict on a section lets a mostly-complete
 * section absorb a specific missing datum.
 *
 * The fix mirrors what this codebase already does for Sections 9-13: stop
 * asking for a coarse judgement and instead collect the FACTS, then derive
 * the status. The model is now asked three narrow, checkable questions
 * ("is a Nigerian exposure denominator stated?", "is a Nigerian case count
 * stated?", "is a reconciliation against the national ICSR data stated?")
 * and the status is computed here, where it can be tested.
 *
 * IMPORTANT — this application has NO live VigiFlow integration. It cannot
 * query the national ICSR database, so it can never report what VigiFlow
 * holds, only whether the SUBMISSION claims a reconciliation. The
 * distinction that must survive into every finding:
 *   - the submission states a Nigerian count / reconciliation, or
 *   - it does not, and the assessor must verify it against VigiFlow
 *     themselves.
 * Never "VigiFlow shows N cases" — this system has not looked.
 */

/** Set true only if a real, live VigiFlow query is ever wired up. Read by
 *  the wording below so no finding can imply a lookup that did not happen. */
export const HAS_LIVE_VIGIFLOW_INTEGRATION = false;

/**
 * Is Nigeria-specific exposure genuinely required for this submission?
 *
 * The V4 template's Section 5 asks for exposure broken down as global,
 * Nigerian and "another relevant region (if applicable)" — the Nigerian row
 * is not the optional one. A PSUR submitted to NAFDAC for a product
 * authorised in Nigeria therefore needs it, and global figures do not
 * substitute: a worldwide patient-year total cannot produce a Nigerian
 * reporting rate.
 *
 * The one honest exception is a submission the AI could not read as a
 * narrative PSUR at all (a spreadsheet annex), where Section 5 is not the
 * document's job. `applicable` carries that, rather than this module
 * assuming the requirement always binds.
 */
export function nigerianExposureRequired(sourceType: "PDF" | "SPREADSHEET" | undefined): boolean {
  return sourceType !== "SPREADSHEET";
}

/**
 * Section 5's status given what the model actually found. Global exposure
 * being present is exactly what makes this PRESENT_BUT_INCOMPLETE rather
 * than MISSING — there IS exposure content, it just isn't the Nigerian
 * content the assessment needs. A section with neither is MISSING.
 *
 * Returns `null` when this module has nothing to say, so the caller keeps
 * whatever the AI concluded rather than having a status invented for it.
 */
export function deriveExposureSectionStatus(
  ctx: PsurNigerianContext | undefined,
  aiStatus: PsurSectionStatus,
): PsurSectionStatus | null {
  if (!ctx || !ctx.exposureRequired) return null;
  if (ctx.nigerianExposureProvided) return null;
  // Never upgrade: if the AI already judged it MISSING or NOT_APPLICABLE,
  // that is a stronger statement than "incomplete" and is left alone.
  if (aiStatus === "MISSING" || aiStatus === "NOT_APPLICABLE") return null;
  return "PRESENT_BUT_INCOMPLETE";
}

/**
 * Section 7's status. Two separate requirements live here — the Nigerian
 * case count, and the reconciliation of that count against the national
 * ICSR data — and either being absent leaves the section incomplete.
 */
export function deriveAggregateSafetySectionStatus(
  ctx: PsurNigerianContext | undefined,
  aiStatus: PsurSectionStatus,
): PsurSectionStatus | null {
  if (!ctx) return null;
  if (ctx.nigerianCaseCountProvided && ctx.vigiflowReconciliationProvided) return null;
  if (aiStatus === "MISSING" || aiStatus === "NOT_APPLICABLE") return null;
  return "PRESENT_BUT_INCOMPLETE";
}

function newFindingId(): string {
  return `pf-${crypto.randomUUID()}`;
}

function has(findings: PsurFinding[], section: PsurV4SectionId, marker: string): boolean {
  return findings.some((f) => f.v4Section === section && f.description.includes(marker));
}

/**
 * The actionable findings for whichever Nigerian requirements are absent.
 * Each says what is missing, why it matters for a Nigerian assessment, and
 * what the MAH should supply — without inventing a denominator, estimating
 * one, or implying this system consulted VigiFlow.
 *
 * Idempotent on re-review: a marker phrase per requirement prevents a second
 * copy being synthesized for a document that already carries one.
 */
export function buildNigerianRequirementFindings(
  ctx: PsurNigerianContext | undefined,
  existing: PsurFinding[],
): PsurFinding[] {
  if (!ctx) return [];
  const out: PsurFinding[] = [];

  const EXPOSURE_MARKER = "Nigerian exposure denominator";
  if (ctx.exposureRequired && !ctx.nigerianExposureProvided) {
    if (!has(existing, "S5_EXPOSURE_ACTIONS", EXPOSURE_MARKER)) {
      out.push({
        id: newFindingId(),
        category: "MISSING_SECTION",
        severity: "HIGH",
        section: "5. Exposure & Actions Taken for Safety Reasons",
        description:
          `No ${EXPOSURE_MARKER} is stated for the reporting interval. Worldwide exposure ` +
          `does not substitute: without Nigerian patient-years, patients, prescriptions, units ` +
          `sold or defined daily doses, the Nigerian reporting rate for this product cannot be ` +
          `calculated and the safety data cannot be interpreted in the Nigerian context.`,
        evidence:
          ctx.nigerianExposureEvidence?.trim() ||
          "The submission's exposure section states worldwide figures only.",
        suggestedSource: {
          type: "REQUEST_FROM_MAH",
          note:
            "Ask the MAH to provide Nigerian exposure for the reporting interval and " +
            "cumulatively — patient-years, number of patients, prescriptions, units sold or " +
            "defined daily doses, stating which measure and denominator was used.",
        },
        v4Section: "S5_EXPOSURE_ACTIONS",
        deficiencyType: "INSUFFICIENT_LOCAL_EVIDENCE",
        assistGenerated: true,
        humanAssessment: null,
        source: "rule",
      });
    }
  }

  const COUNT_MARKER = "Nigerian case count";
  if (!ctx.nigerianCaseCountProvided) {
    if (!has(existing, "S7_AGGREGATE_SAFETY_DATA", COUNT_MARKER)) {
      out.push({
        id: newFindingId(),
        category: "MISSING_SECTION",
        severity: "HIGH",
        section: "7. Aggregate Safety Data Summary",
        description:
          `No ${COUNT_MARKER} is stated. The submission does not separate the Nigerian ` +
          `component of the safety data — reporting-interval and cumulative counts, including ` +
          `the number of serious cases — so the Nigerian experience with this product cannot ` +
          `be assessed or compared against the global data.`,
        evidence:
          ctx.nigerianCaseCountEvidence?.trim() ||
          "The submission's aggregate safety data is presented as worldwide totals only.",
        suggestedSource: {
          type: "REQUEST_FROM_MAH",
          note:
            "Ask the MAH for the Nigerian case count for the reporting interval and " +
            "cumulatively, including the number of serious cases, and for any material " +
            "differences between the Nigerian and global data.",
        },
        v4Section: "S7_AGGREGATE_SAFETY_DATA",
        deficiencyType: "INSUFFICIENT_LOCAL_EVIDENCE",
        assistGenerated: true,
        humanAssessment: null,
        source: "rule",
      });
    }
  }

  const RECON_MARKER = "not been reconciled against the Nigerian ICSR data";
  if (!ctx.vigiflowReconciliationProvided) {
    if (!has(existing, "S7_AGGREGATE_SAFETY_DATA", RECON_MARKER)) {
      out.push({
        id: newFindingId(),
        category: "NUMERICAL",
        severity: "MEDIUM",
        section: "7. Aggregate Safety Data Summary",
        description:
          `The Nigerian cases reported by the MAH have ${RECON_MARKER} held by NAFDAC. The ` +
          `V4 assessment requires the submitted Nigerian figures to be checked against ` +
          `VigiFlow for the same interval, with any discrepancy documented.`,
        evidence:
          ctx.vigiflowReconciliationEvidence?.trim() ||
          "The submission does not describe any reconciliation against national ICSR data.",
        suggestedSource: {
          // Deliberately the assessor-facing source: this is the one item on
          // the list the assessor can settle themselves, by looking it up.
          type: "VIGIFLOW_NIGERIA",
          note: HAS_LIVE_VIGIFLOW_INTEGRATION
            ? "Compare the submitted Nigerian figures against the VigiFlow counts retrieved for this interval."
            : "This tool has not queried VigiFlow and holds no national ICSR figures of its own. " +
              "Retrieve the Nigerian ICSR count for this substance and interval from VigiFlow, " +
              "including serious cases, compare it with the MAH's figures, and ask the MAH to " +
              "account for any discrepancy.",
        },
        v4Section: "S7_AGGREGATE_SAFETY_DATA",
        deficiencyType: "DATA_DISCREPANCY",
        assistGenerated: true,
        humanAssessment: null,
        source: "rule",
      });
    }
  }

  return out;
}
