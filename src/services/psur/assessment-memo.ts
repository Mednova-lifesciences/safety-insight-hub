import type { MemoCriterion, MemoCriterionId, PsurSubmissionDetails } from "@/types/pv";

/**
 * The memo's review-criteria table.
 *
 * Eleven rows, worded as the supplied NAFDAC memo words them. Criteria 1-6
 * are facts read off the submission; 7-10 are researched evidence; 11 is
 * the assessor's own enumeration.
 */
export const MEMO_CRITERIA: { id: MemoCriterionId; number: number; label: string }[] = [
  { id: "PRODUCT_IDENTITY", number: 1, label: "Product Identity" },
  { id: "REPORTING_INTERVAL", number: 2, label: "Reporting Interval" },
  { id: "THERAPEUTIC_CATEGORY", number: 3, label: "Therapeutic Category" },
  { id: "DATE_RECEIVED", number: 4, label: "Date Received by NAFDAC" },
  { id: "INTERNATIONAL_BIRTH_DATE", number: 5, label: "International Birth Date" },
  { id: "NIGERIA_BIRTH_DATE", number: 6, label: "Nigeria Birth Date (if available)" },
  {
    id: "RSI_CHANGES",
    number: 7,
    label:
      "Changes to reference safety information: (Yes/No), if yes give a brief highlight of changes made",
  },
  {
    id: "WORLDWIDE_ACTIONS",
    number: 8,
    label:
      "Worldwide regulatory authority or MAH actions taken for safety reasons: (Yes/No). If yes, outline.",
  },
  {
    id: "PATIENT_EXPOSURE",
    number: 9,
    label:
      "Data on patient exposure: Is there an African component? (Yes/No) Is there a Nigerian component? (Yes/No)",
  },
  {
    id: "RELEVANT_STUDIES",
    number: 10,
    label:
      "Studies containing relevant safety information (company-sponsored and published studies)",
  },
  {
    id: "OVERALL_SAFETY_EVALUATION",
    number: 11,
    label: "Overall safety evaluation (enumerate in order of seriousness)",
  },
];

/**
 * The fixed part of the memo reference, pre-filled so the assessor types
 * only the number. The number itself is NEVER generated: it belongs to
 * NAFDAC's registry sequence, and a system-invented reference on a signed
 * memo would be worse than an unfilled one.
 */
export const MEMO_REFERENCE_PREFIX = "NAFDAC/PV/GCIOMS/";

/** What a criterion reads when nothing established it. Never a blank
 *  cell: a blank reads as NAFDAC's omission rather than a finding. Same
 *  reasoning as orNotStated() in screening-directive.ts. */
const NOT_ESTABLISHED = "Not stated in the submission";

function criterion(id: MemoCriterionId, value: string): MemoCriterion {
  const def = MEMO_CRITERIA.find((c) => c.id === id)!;
  const trimmed = value.trim();
  return {
    id,
    number: def.number,
    label: def.label,
    remarks: trimmed || NOT_ESTABLISHED,
    citations: [],
    unestablished: !trimmed,
  };
}

/**
 * Criteria 1-6 — the facts.
 *
 * Read off the submission details the screening step already extracted.
 * No citations: these are not research, and attaching one would imply the
 * assessor went looking for something they read off page one.
 */
export function factualCriteria(
  details: PsurSubmissionDetails,
  therapeuticCategory: string,
): MemoCriterion[] {
  return [
    criterion("PRODUCT_IDENTITY", details.activeSubstance || details.productName),
    criterion("REPORTING_INTERVAL", details.intervalCovered),
    criterion("THERAPEUTIC_CATEGORY", therapeuticCategory),
    criterion("DATE_RECEIVED", details.dateReceived.slice(0, 10)),
    criterion("INTERNATIONAL_BIRTH_DATE", details.ibd),
    criterion("NIGERIA_BIRTH_DATE", details.firstNafdacRegistrationDate),
  ];
}
