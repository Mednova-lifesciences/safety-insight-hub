import type { PsurDocument, PsurScreeningCheckItem } from "@/types/pv";
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
  label: string;
  status: string;
  deficiency: string;
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

    failedRows: rowsFor(checks, "NO"),
    unresolvedRows: rowsFor(checks, "NOT_ASSESSABLE"),

    officerName: outcome?.officerName || outcome?.by || "",
    signedAt: outcome?.at ?? "",
    generatedAtLabel: new Date().toISOString().slice(0, 16).replace("T", " "),
  };
}
