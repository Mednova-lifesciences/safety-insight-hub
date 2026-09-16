import type {
  PsurScreeningCheckId,
  PsurScreeningCheckItem,
  PsurScreeningCheckStatus,
  PsurScreeningOutcomeDecision,
  PsurSubmissionDetails,
} from "@/types/pv";

/**
 * NAFDAC's PSUR Administrative Screening Checklist, as data.
 *
 * The paper form is the specification: 16 checks in three groups, completed
 * on receipt before a report is allocated for scientific assessment. This
 * module holds the form's own rules in one place so the UI, the AI mapping,
 * the outcome logic and the tests cannot drift apart from each other or
 * from the document.
 *
 * Nothing here is product-specific. The checks are about how a submission
 * is packaged, dated and structured, so the same 16 questions apply to any
 * PSUR from any MAH for any product — which is the point.
 */

export type PsurScreeningGroup =
  "SUBMISSION_PACKAGE" | "DATES_AND_TIMELINESS" | "REPORT_CONTENT_PRESENT";

export const SCREENING_GROUP_LABELS: Record<PsurScreeningGroup, string> = {
  SUBMISSION_PACKAGE: "Submission package",
  DATES_AND_TIMELINESS: "Dates and timeliness",
  REPORT_CONTENT_PRESENT: "Report content present",
};

export const SCREENING_GROUP_NOTES: Record<PsurScreeningGroup, string> = {
  SUBMISSION_PACKAGE: "A No here is a validation deficiency.",
  DATES_AND_TIMELINESS: "A No here is a validation deficiency.",
  REPORT_CONTENT_PRESENT:
    "Presence only — adequacy is for the assessor. A No is recorded for them and included in the compliance directive where necessary.",
};

export interface ScreeningCheckDefinition {
  id: PsurScreeningCheckId;
  /** 1-16, exactly as numbered on the form. The outcome's "items no."
   *  field cites these, so they must not be renumbered. */
  number: number;
  group: PsurScreeningGroup;
  /** The check's wording, close to the form's own. */
  label: string;
  /**
   * A record OUTSIDE the submitted document that the officer must consult
   * to answer this, if any.
   *
   * This is the most important field here. Four of the sixteen checks
   * cannot be settled from the PSUR alone — they ask whether something
   * MATCHES a NAFDAC record, or whether it follows on from a previous
   * submission. The system holds none of those records. A model asked such
   * a question with only the PDF in front of it has no truthful answer
   * available, so it will pick Yes or No and sound confident either way.
   *
   * Marking them here means the AI is instructed to return NOT_ASSESSABLE,
   * and the UI shows the officer exactly which record to go and check
   * rather than presenting a guess as a finding.
   */
  requiresExternalRecord?: string;
  /**
   * True where the answer is arithmetic rather than judgement, and is
   * computed rather than asked of a model. Only item 8 qualifies.
   */
  computed?: boolean;
}

/** The 16 checks, in the form's order. */
export const SCREENING_CHECKS: ScreeningCheckDefinition[] = [
  {
    id: "COVER_LETTER_COMPLETE",
    number: 1,
    group: "SUBMISSION_PACKAGE",
    label:
      "Cover letter on MAH letterhead, signed by the QPPV, stating product name, strength(s)/dosage form(s), NAFDAC Reg. No., renewal/application no. and the reporting interval.",
  },
  {
    id: "QPPV_DETAILS_STATED",
    number: 2,
    group: "SUBMISSION_PACKAGE",
    label:
      "QPPV and Deputy QPPV name, telephone and e-mail stated (cover letter and title page) and match NAFDAC's record.",
    requiresExternalRecord:
      "NAFDAC's QPPV register — the document can show the details are stated, but only your records show whether they match.",
  },
  {
    id: "ONE_PSUR_PER_ACTIVE_SUBSTANCE",
    number: 3,
    group: "SUBMISSION_PACKAGE",
    label:
      "One PSUR per active substance covering all registered strengths/dosage forms; product name and strength match the NAFDAC certificate exactly.",
    requiresExternalRecord:
      "The NAFDAC certificate — an exact match of name and strength cannot be confirmed from the submission alone.",
  },
  {
    id: "PDF_OPENS_AND_FOLLOWS_TEMPLATE",
    number: 4,
    group: "SUBMISSION_PACKAGE",
    label:
      "Submitted in PDF, file opens fully, and follows the NAFDAC PSUR Full Template (title page, executive summary, Sections 1–21, appendices).",
  },
  {
    id: "IBD_AND_FIRST_REGISTRATION_STATED",
    number: 5,
    group: "DATES_AND_TIMELINESS",
    label:
      "IBD and date of first NAFDAC registration both stated on the title page; reporting interval is calculated from the IBD, not the NAFDAC registration date.",
  },
  {
    id: "DLP_AND_INTERVAL_CONSISTENT",
    number: 6,
    group: "DATES_AND_TIMELINESS",
    label:
      "DLP and interval (from – to) stated and consistent across cover letter, title page and executive summary.",
  },
  {
    id: "INTERVAL_CONTIGUOUS",
    number: 7,
    group: "DATES_AND_TIMELINESS",
    label:
      "Interval is contiguous with the previous PSUR on file (no gap or overlap), or the report states it is a first submission.",
    requiresExternalRecord:
      "The previous PSUR on file — unless this report states it is a first submission, contiguity can only be checked against the last interval you hold.",
  },
  {
    id: "RECEIVED_WITHIN_TIMEFRAME",
    number: 8,
    group: "DATES_AND_TIMELINESS",
    label:
      "Received within 70 days of DLP (interval ≤ 12 months) or 90 days (> 12 months), and ≥ 6 months before renewal where applicable. If late, note days late and whether justified.",
    computed: true,
  },
  {
    id: "TITLE_PAGE_COMPLETE_AND_SIGNED",
    number: 9,
    group: "REPORT_CONTENT_PRESENT",
    label:
      "Title page complete and signed/dated by the Nigerian QPPV; MAH name and address and confidentiality statement included.",
  },
  {
    id: "EXECUTIVE_SUMMARY_COMPLETE",
    number: 10,
    group: "REPORT_CONTENT_PRESENT",
    label:
      "Executive summary addresses every element in the template (introduction through conclusions).",
  },
  {
    id: "SECTIONS_PRESENT_OR_JUSTIFIED",
    number: 11,
    group: "REPORT_CONTENT_PRESENT",
    label:
      "Sections 1–21 all present and populated or marked not applicable with a reason; table of contents and list of abbreviations included.",
  },
  {
    id: "LINE_LISTING_OR_NIL_STATEMENT",
    number: 12,
    group: "REPORT_CONTENT_PRESENT",
    label:
      "Line listing of serious adverse events/ICSRs included, even if only 1 or 2 cases; otherwise an explicit nil statement is documented.",
  },
  {
    id: "LITERATURE_IN_OWN_WORDS",
    number: 13,
    group: "REPORT_CONTENT_PRESENT",
    label:
      "Literature section summarised in the company's own words with a product-specific assessment paragraph.",
  },
  {
    id: "INTEGRATED_BENEFIT_RISK_ANALYSIS",
    number: 14,
    group: "REPORT_CONTENT_PRESENT",
    label:
      "Integrated benefit-risk analysis draws on data from across the PSUR; conclusion covers key findings, new risks, overall B-R balance and actions.",
  },
  {
    id: "APPENDIX_RSI_ATTACHED",
    number: 15,
    group: "REPORT_CONTENT_PRESENT",
    label: "Appendix I (RSI/SmPC) attached; RMP version referenced where an RMP exists.",
  },
  {
    id: "PREVIOUS_QUERIES_ADDRESSED",
    number: 16,
    group: "REPORT_CONTENT_PRESENT",
    label: "Queries or commitments from the previous NAFDAC assessment are addressed.",
    requiresExternalRecord:
      "The previous NAFDAC assessment — what was asked for last time is not in this document.",
  },
];

export const SCREENING_GROUPS: PsurScreeningGroup[] = [
  "SUBMISSION_PACKAGE",
  "DATES_AND_TIMELINESS",
  "REPORT_CONTENT_PRESENT",
];

const BY_ID = new Map(SCREENING_CHECKS.map((c) => [c.id, c]));

export function screeningCheck(id: PsurScreeningCheckId): ScreeningCheckDefinition {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown screening check: ${id}`);
  return found;
}

export function checksInGroup(group: PsurScreeningGroup): ScreeningCheckDefinition[] {
  return SCREENING_CHECKS.filter((c) => c.group === group);
}

/**
 * Items 1-8. The checklist's own rule: "Any No in items 1–8 = validation
 * deficiency (give a compliance directive or reject)."
 */
export function isValidationItem(id: PsurScreeningCheckId): boolean {
  return screeningCheck(id).number <= 8;
}

export const STATUS_LABELS: Record<PsurScreeningCheckStatus, string> = {
  YES: "Yes",
  NO: "No",
  NOT_APPLICABLE: "N/A",
  NOT_ASSESSABLE: "Cannot tell from the document",
};

/** A blank checklist, for a report nothing has run against yet. */
export function emptyChecks(): PsurScreeningCheckItem[] {
  return SCREENING_CHECKS.map((c) => ({
    id: c.id,
    status: "NOT_ASSESSABLE" as const,
    deficiency: "",
    assistGenerated: false,
  }));
}

export function emptySubmissionDetails(): PsurSubmissionDetails {
  return {
    productName: "",
    activeSubstance: "",
    nafdacRegNo: "",
    mah: "",
    qppv: "",
    qppvContact: "",
    ibd: "",
    firstNafdacRegistrationDate: "",
    dlp: "",
    intervalCovered: "",
    dateReceived: "",
  };
}

/**
 * Fills any missing rows and drops unknown ones, so a checklist stored
 * before a check was added still renders all 16 in the right order.
 */
export function normalizeChecks(stored: PsurScreeningCheckItem[]): PsurScreeningCheckItem[] {
  const byId = new Map(stored.map((c) => [c.id, c]));
  return SCREENING_CHECKS.map(
    (def) =>
      byId.get(def.id) ?? {
        id: def.id,
        status: "NOT_ASSESSABLE" as const,
        deficiency: "",
        assistGenerated: false,
      },
  );
}

// ---------------------------------------------------------------------------
// Item 8 — timeliness. Arithmetic, not judgement.
// ---------------------------------------------------------------------------

/**
 * NAFDAC's submission windows, in days from the Data Lock Point.
 *
 * Named constants rather than numbers buried in a prompt: these are policy,
 * they are the kind of thing that changes, and when it changes it must
 * change in exactly one place.
 */
export const SUBMISSION_WINDOW_DAYS = {
  /** Reporting interval of 12 months or less. */
  INTERVAL_UP_TO_12_MONTHS: 70,
  /** Reporting interval longer than 12 months. */
  INTERVAL_OVER_12_MONTHS: 90,
} as const;

export interface TimelinessAssessment {
  status: PsurScreeningCheckStatus;
  /** Whole days from DLP to receipt. Undefined when either date is
   *  missing or unparseable — never a zero standing in for "unknown". */
  daysToReceipt?: number | undefined;
  /** The window that applied, once known. */
  allowedDays?: number | undefined;
  daysLate?: number | undefined;
  /** Ready to drop into the "Deficiency noted" column. */
  note: string;
}

function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Roughly how many months an interval string covers, used only to pick
 * between the 70- and 90-day windows.
 *
 * Returns null rather than guessing when the string cannot be read as two
 * dates. Picking the wrong window silently would either excuse a late
 * submission or accuse a punctual one, so "cannot tell" has to be a real
 * outcome here.
 */
export function intervalMonths(intervalCovered: string): number | null {
  // Matches the shapes the form and real cover letters actually use:
  // "01 Jul 2025 – 30 Jun 2026", "2025-07-01 to 2026-06-30", "... - ...".
  const parts = intervalCovered.split(/\s(?:–|-|—|to)\s/i);
  if (parts.length < 2) return null;
  const from = parseDate(parts[0]!);
  const to = parseDate(parts[parts.length - 1]!);
  if (!from || !to || to < from) return null;
  const months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth()) +
    (to.getDate() >= from.getDate() ? 0 : -1);
  return months;
}

/**
 * Item 8, computed.
 *
 * Deliberately not asked of the model. It is date arithmetic against a
 * fixed policy, the inputs are already extracted, and a language model
 * doing sums is both slower and less trustworthy than doing them here —
 * and this particular answer decides whether a submission is late, which
 * an MAH may well dispute.
 */
export function assessTimeliness(
  details: Pick<PsurSubmissionDetails, "dlp" | "dateReceived" | "intervalCovered">,
): TimelinessAssessment {
  const dlp = parseDate(details.dlp);
  const received = parseDate(details.dateReceived);

  if (!dlp || !received) {
    return {
      status: "NOT_ASSESSABLE",
      note: !dlp
        ? "No Data Lock Point could be read from the submission, so timeliness cannot be calculated."
        : "No date of receipt is recorded, so timeliness cannot be calculated.",
    };
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysToReceipt = Math.round((received.getTime() - dlp.getTime()) / msPerDay);

  if (daysToReceipt < 0) {
    return {
      status: "NO",
      daysToReceipt,
      note: `Recorded as received ${Math.abs(daysToReceipt)} day(s) BEFORE the stated Data Lock Point, which cannot be right — check the DLP and the date of receipt.`,
    };
  }

  const months = intervalMonths(details.intervalCovered);
  if (months === null) {
    return {
      status: "NOT_ASSESSABLE",
      daysToReceipt,
      note: `Received ${daysToReceipt} day(s) after the Data Lock Point, but the reporting interval could not be read, so it is unclear whether the 70-day or 90-day window applies.`,
    };
  }

  const allowedDays =
    months > 12
      ? SUBMISSION_WINDOW_DAYS.INTERVAL_OVER_12_MONTHS
      : SUBMISSION_WINDOW_DAYS.INTERVAL_UP_TO_12_MONTHS;

  if (daysToReceipt <= allowedDays) {
    return {
      status: "YES",
      daysToReceipt,
      allowedDays,
      note: `Received ${daysToReceipt} day(s) after the Data Lock Point, within the ${allowedDays}-day window for an interval of ${months} month(s).`,
    };
  }

  const daysLate = daysToReceipt - allowedDays;
  return {
    status: "NO",
    daysToReceipt,
    allowedDays,
    daysLate,
    note: `Received ${daysToReceipt} day(s) after the Data Lock Point — ${daysLate} day(s) beyond the ${allowedDays}-day window for an interval of ${months} month(s). Record whether the delay is justified.`,
  };
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

export interface OutcomeRecommendation {
  decision: PsurScreeningOutcomeDecision;
  /** Item numbers that failed, for the form's "items no." field. */
  citedItems: number[];
  /** Item numbers nobody could answer — not failures, but not answered
   *  either, and the officer has to settle them before deciding. */
  unresolvedItems: number[];
  reason: string;
}

/**
 * What the answers imply — a RECOMMENDATION, never the decision itself.
 *
 * The officer decides; this only reads the form back to them. The same
 * separation the scientific review keeps between the AI's suggestion and
 * the assessor's own regulatory decision.
 *
 * The rule is the checklist's: a No in items 1-8 is a validation
 * deficiency, so the report does not go forward. A No in 9-16 is recorded
 * for the assessor and cited in the directive, but does not by itself stop
 * the report — the form says those are presence checks only.
 */
export function recommendOutcome(checks: PsurScreeningCheckItem[]): OutcomeRecommendation {
  const failed = checks.filter((c) => c.status === "NO").map((c) => screeningCheck(c.id).number);
  const validationFailures = failed.filter((n) => n <= 8);
  const contentFailures = failed.filter((n) => n > 8);
  const unresolvedItems = checks
    .filter((c) => c.status === "NOT_ASSESSABLE")
    .map((c) => screeningCheck(c.id).number)
    .sort((a, b) => a - b);

  const citedItems = [...failed].sort((a, b) => a - b);

  if (validationFailures.length > 0) {
    return {
      decision: "COMPLIANCE_DIRECTIVE",
      citedItems,
      unresolvedItems,
      reason: `Item(s) ${validationFailures.sort((a, b) => a - b).join(", ")} failed. A No in items 1-8 is a validation deficiency, so this submission needs a compliance directive or rejection rather than allocation for assessment.`,
    };
  }

  if (contentFailures.length > 0) {
    return {
      decision: "COMPLIANCE_DIRECTIVE",
      citedItems,
      unresolvedItems,
      reason: `Items 1-8 all pass, but item(s) ${contentFailures.sort((a, b) => a - b).join(", ")} are missing content. Those are presence checks, so they are recorded for the assessor and cited in the compliance directive.`,
    };
  }

  return {
    decision: "ACCEPTED_FOR_ASSESSMENT",
    citedItems: [],
    unresolvedItems,
    reason:
      unresolvedItems.length > 0
        ? `Nothing has failed, but item(s) ${unresolvedItems.join(", ")} could not be answered from the submission. Settle those before accepting.`
        : "All 16 checks pass. The submission can be allocated for scientific assessment.",
  };
}

export const OUTCOME_LABELS: Record<PsurScreeningOutcomeDecision, string> = {
  ACCEPTED_FOR_ASSESSMENT: "Accepted for assessment",
  COMPLIANCE_DIRECTIVE: "Compliance directive",
  NOT_ACCEPTED_RESUBMIT: "Not accepted — resubmit",
};
