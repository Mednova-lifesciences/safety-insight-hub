import type { PsurDocument, PsurScreeningCheckId, PsurScreeningCheckItem } from "@/types/pv";
import {
  OUTCOME_LABELS,
  STATUS_LABELS,
  assessTimeliness,
  normalizeChecks,
  screeningCheck,
} from "./screening-checklist";

/**
 * The letter the Review Officer actually sends.
 *
 * When screening ends in a compliance directive or a rejection, the officer
 * has to tell the MAH what was wrong. Until this existed, the app recorded
 * the decision and returned the report with nothing to post — a decision
 * they could not act on.
 *
 * Deliberately NOT the same document as the Compliance Directive built from
 * the scientific review's findings. That one is written after the whole
 * assessment, by a different person, about the report's safety content.
 * This one is written on receipt, about the submission's packaging, and is
 * the only thing an MAH receives when a report never got as far as being
 * assessed. Sharing a generator between them would have meant one document
 * pretending to be two things.
 *
 * Every row here comes from the officer's completed checklist. Nothing is
 * inferred and nothing is added: an MAH may dispute this letter, so it must
 * say exactly what the officer recorded and no more.
 */

export interface ScreeningDirectiveRow {
  number: number;
  /** The checklist requirement, as the MAH's own copy of the form words it. */
  label: string;
  status: string;
  /** Why it failed — the officer's or the AI's evidence, verbatim. */
  deficiency: string;
  /** What the MAH has to DO about it. Derived from the requirement itself,
   *  so a directive never lists a deficiency without saying what would fix
   *  it — "Section 13 is missing" leaves an MAH guessing; "Provide the
   *  literature review section, summarised in the company's own words"
   *  does not. */
  action: string;
}

export interface ScreeningDirectiveModel {
  /** Header block — the submission this letter is about. */
  productName: string;
  activeSubstance: string;
  nafdacRegNo: string;
  mah: string;
  reportingInterval: string;
  dlp: string;
  dateReceived: string;
  daysToReceipt: string;
  filename: string;

  outcomeLabel: string;
  /** The form's "CD — items no." field. */
  citedItems: number[];
  conclusions: string;
  deficiencies: string;
  /** Blank when the submission was accepted — there is nothing to answer. */
  mahResponseDeadline: string;
  nextPsurDueDate: string;

  /** Only the items the MAH has to act on — a No. A directive listing the
   *  checks that PASSED would bury the ones that did not. */
  failedRows: ScreeningDirectiveRow[];
  /** Items the officer could not settle from the submission. Included
   *  because "we could not tell" is often itself a request for
   *  information, and the MAH should know which. */
  unresolvedRows: ScreeningDirectiveRow[];

  officerName: string;
  signedAt: string;
  generatedAtLabel: string;
}

/**
 * What the MAH must do about each failed check.
 *
 * Written per requirement rather than generated, because a directive is
 * acted on: "item 12 failed" is not something an MAH can comply with, and
 * an instruction invented per-submission would vary between letters for the
 * same defect. These are fixed, so the same failure always asks for the
 * same remedy.
 */
const REQUIRED_ACTION: Record<PsurScreeningCheckId, string> = {
  COVER_LETTER_COMPLETE:
    "Submit a cover letter on MAH letterhead, signed by the QPPV, stating the product name, strength(s) and dosage form(s), NAFDAC Registration Number, renewal/application number and the reporting interval.",
  QPPV_DETAILS_STATED:
    "State the QPPV and Deputy QPPV name, telephone number and e-mail on both the cover letter and the title page, and confirm they match the details held on NAFDAC's record.",
  ONE_PSUR_PER_ACTIVE_SUBSTANCE:
    "Submit one PSUR per active substance covering all registered strengths and dosage forms, with the product name and strength written exactly as they appear on the NAFDAC certificate.",
  PDF_OPENS_AND_FOLLOWS_TEMPLATE:
    "Resubmit as a single PDF that opens fully and follows the NAFDAC PSUR Full Template — title page, executive summary, Sections 1-21 and appendices.",
  IBD_AND_FIRST_REGISTRATION_STATED:
    "State both the International Birth Date and the date of first NAFDAC registration on the title page, and calculate the reporting interval from the IBD.",
  DLP_AND_INTERVAL_CONSISTENT:
    "State the Data Lock Point and the reporting interval, and make them consistent across the cover letter, the title page and the executive summary.",
  INTERVAL_CONTIGUOUS:
    "Confirm the reporting interval follows on from the previous PSUR with no gap or overlap, or state explicitly that this is a first submission.",
  RECEIVED_WITHIN_TIMEFRAME:
    "Submit within 70 days of the Data Lock Point for an interval of 12 months or less, or 90 days for a longer interval. Where this submission was late, provide a written justification for the delay.",
  TITLE_PAGE_COMPLETE_AND_SIGNED:
    "Provide a complete title page signed and dated by the Nigerian QPPV, including the MAH name and address and a confidentiality statement.",
  EXECUTIVE_SUMMARY_COMPLETE:
    "Provide an executive summary addressing every element of the template, from the introduction through to the conclusions.",
  SECTIONS_PRESENT_OR_JUSTIFIED:
    "Provide Sections 1-21, each populated or marked not applicable with a stated reason, together with a table of contents and a list of abbreviations.",
  LINE_LISTING_OR_NIL_STATEMENT:
    "Provide a line listing of serious adverse events and ICSRs for the interval, however few, or an explicit statement that none were received.",
  LITERATURE_IN_OWN_WORDS:
    "Provide a literature section summarised in the company's own words, including a product-specific assessment paragraph rather than reproduced abstracts.",
  INTEGRATED_BENEFIT_RISK_ANALYSIS:
    "Provide an integrated benefit-risk analysis drawing on data from across the report, concluding on key findings, any new risks, the overall benefit-risk balance and the actions proposed.",
  APPENDIX_RSI_ATTACHED:
    "Attach Appendix I (the Reference Safety Information / SmPC), and reference the current RMP version where an RMP exists.",
  PREVIOUS_QUERIES_ADDRESSED:
    "Address each query and commitment raised in NAFDAC's previous assessment of this product, stating where in the report the response appears.",
};

function rowsFor(
  checks: PsurScreeningCheckItem[],
  status: PsurScreeningCheckItem["status"],
): ScreeningDirectiveRow[] {
  return checks
    .filter((c) => c.status === status)
    .map((c) => {
      const def = screeningCheck(c.id);
      return {
        number: def.number,
        label: def.label,
        status: STATUS_LABELS[c.status],
        deficiency: c.deficiency,
        action: REQUIRED_ACTION[c.id],
      };
    })
    .sort((a, b) => a.number - b.number);
}

/** Renders "not stated" rather than an empty gap, so a blank field in the
 *  letter reads as a finding instead of an omission by NAFDAC. */
function orNotStated(value: string): string {
  return value.trim() || "Not stated in the submission";
}

export function buildScreeningDirectiveModel(doc: PsurDocument): ScreeningDirectiveModel | null {
  const screening = doc.administrativeScreening;
  if (!screening) return null;

  const checks = normalizeChecks(screening.checks);
  const details = screening.submissionDetails;
  const timeliness = assessTimeliness(details);
  const outcome = screening.outcome;

  return {
    productName: orNotStated(details.productName || doc.product),
    activeSubstance: orNotStated(details.activeSubstance),
    nafdacRegNo: orNotStated(details.nafdacRegNo),
    mah: orNotStated(details.mah || doc.mah || ""),
    reportingInterval: orNotStated(details.intervalCovered || doc.reportingPeriod),
    dlp: orNotStated(details.dlp),
    dateReceived: orNotStated(details.dateReceived.slice(0, 10)),
    daysToReceipt:
      timeliness.daysToReceipt === undefined ? "Not calculable" : String(timeliness.daysToReceipt),
    filename: doc.filename,

    outcomeLabel: outcome ? OUTCOME_LABELS[outcome.decision] : "Not yet decided",
    citedItems: outcome?.citedItems ?? [],
    conclusions: outcome?.conclusions ?? "",
    deficiencies: outcome?.deficiencies ?? "",
    mahResponseDeadline: outcome?.mahResponseDeadline ?? "",
    nextPsurDueDate: outcome?.nextPsurDueDate ?? "",

    failedRows: rowsFor(checks, "NO"),
    unresolvedRows: rowsFor(checks, "NOT_ASSESSABLE"),

    officerName: outcome?.officerName || outcome?.by || "",
    signedAt: outcome?.at ?? "",
    generatedAtLabel: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
}
