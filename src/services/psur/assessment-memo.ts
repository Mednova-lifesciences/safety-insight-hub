import type {
  AssessmentMemoModel,
  AssessmentSection,
  CiomsMatrix,
  CiomsRubric,
  MemoCriterion,
  MemoCriterionId,
  PsurSubmissionDetails,
  PsurV4SectionId,
} from "@/types/pv";
import { matrixTotals, PROVISIONAL_CIOMS_RUBRIC } from "./cioms";
import { renderableEvidence } from "./evidence";

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

/**
 * Which working sections feed which memo criterion.
 *
 * This mapping IS the projection the spec's section 4 describes: the 14
 * PsurV4SectionId sections remain the surface where evidence is gathered,
 * and the memo's narrower table is rendered from them. A criterion may
 * draw on more than one section.
 *
 * ADMIN_SCREENING appears nowhere: it is the screening step's own record,
 * not assessment evidence, and the memo must not quote a screening note
 * as though an assessor had researched it.
 */
export const CRITERION_SECTIONS: Record<MemoCriterionId, PsurV4SectionId[]> = {
  PRODUCT_IDENTITY: [],
  REPORTING_INTERVAL: [],
  THERAPEUTIC_CATEGORY: [],
  DATE_RECEIVED: [],
  INTERNATIONAL_BIRTH_DATE: [],
  NIGERIA_BIRTH_DATE: [],
  RSI_CHANGES: ["S4_RSI"],
  WORLDWIDE_ACTIONS: ["S2_WORLDWIDE_STATUS", "S5_EXPOSURE_ACTIONS"],
  PATIENT_EXPOSURE: ["S5_EXPOSURE_ACTIONS", "S7_AGGREGATE_SAFETY_DATA"],
  RELEVANT_STUDIES: ["S6_LITERATURE", "S3_THERAPEUTIC_CONTEXT"],
  OVERALL_SAFETY_EVALUATION: ["S8_SIGNAL_EVALUATION", "S10_BENEFIT_RISK", "S11_UNCERTAINTIES"],
};

const EVIDENCE_CRITERIA: MemoCriterionId[] = [
  "RSI_CHANGES",
  "WORLDWIDE_ACTIONS",
  "PATIENT_EXPOSURE",
  "RELEVANT_STUDIES",
  "OVERALL_SAFETY_EVALUATION",
];

/**
 * Criteria 7-11, projected from the evidence accepted under their
 * sections.
 *
 * Only accepted, cited entries contribute (renderableEvidence). An entry
 * that passes those gates but carries no actual text contributes nothing
 * either — a row reading as established while saying nothing is worse
 * than one that admits it is empty.
 */
export function evidenceCriteria(sections: AssessmentSection[]): MemoCriterion[] {
  const byId = new Map(sections.map((s) => [s.section, s]));
  return EVIDENCE_CRITERIA.map((id) => {
    const entries = CRITERION_SECTIONS[id]
      .flatMap((sectionId) => renderableEvidence(byId.get(sectionId)?.evidence ?? []))
      .filter((e) => e.content.trim().length > 0);
    const remarks = entries.map((e) => e.content.trim()).join("\n\n");
    const def = MEMO_CRITERIA.find((c) => c.id === id)!;
    return {
      id,
      number: def.number,
      label: def.label,
      remarks: remarks || NOT_ESTABLISHED,
      citations: entries.map((e) => e.citation.trim()),
      unestablished: entries.length === 0,
    };
  });
}

export interface AssessmentMemoInput {
  referenceNumber: string;
  memoDate: string;
  to: string;
  from: string;
  signatory: string;
  productNameAndStrength: string;
  therapeuticCategory: string;
  details: PsurSubmissionDetails;
  sections: AssessmentSection[];
  matrix: CiomsMatrix;
  /** The band the assessor confirmed. Empty until they do. */
  confirmedBandLabel: string;
  /** The verdict the assessor confirmed. Empty until they do. */
  confirmedVerdict: string;
  analysisOfMatrix: string;
  conclusion: string;
  rubric?: CiomsRubric | undefined;
}

/**
 * The whole memo, ready to render.
 *
 * Returns null when the matrix cannot be totalled: the memo compares the
 * three totals to reach a benefit-risk conclusion, so a document missing
 * one of them invites a comparison against a blank.
 *
 * `bandLabel` and `benefitRiskVerdict` are the assessor's CONFIRMED
 * values and nothing else. The rubric's proposals (bandFor, proposeVerdict)
 * are offered in the UI; they never reach the document on their own. See
 * the spec's section 6.
 */
export function buildAssessmentMemoModel(
  input: AssessmentMemoInput,
): AssessmentMemoModel | null {
  const totals = matrixTotals(input.matrix);
  if (!totals) return null;
  const rubric = input.rubric ?? PROVISIONAL_CIOMS_RUBRIC;
  return {
    referenceNumber: input.referenceNumber,
    memoDate: input.memoDate,
    to: input.to,
    from: input.from,
    subject:
      "Submission of Periodic Safety Update Report (PSUR) for " +
      input.productNameAndStrength,
    productNameAndStrength: input.productNameAndStrength,
    signatory: input.signatory,
    criteria: [
      ...factualCriteria(input.details, input.therapeuticCategory),
      ...evidenceCriteria(input.sections),
    ],
    matrix: input.matrix,
    totals,
    bandLabel: input.confirmedBandLabel.trim(),
    benefitRiskVerdict: input.confirmedVerdict.trim(),
    analysisOfMatrix: input.analysisOfMatrix,
    conclusion: input.conclusion,
    provisionalRubricUsed: rubric.provisional,
  };
}
