import type { EvidenceEntry, MemoCriterionId, PsurV4SectionId } from "@/types/pv";

/**
 * The answer fields of the NAFDAC PSUR/PBRER Evaluation Form (V4) that
 * research can be written into.
 *
 * The V4 report keeps the template's structure exactly, so research does
 * not get a section of its own: it goes into the field it answers ("4.
 * Changes made to the RSI during this reporting interval"), with a numbered
 * citation, and the sources are listed under Section 13 "References".
 *
 * Every section also has a FURTHER field, printed only when used, for
 * research that answers none of the template's fields — a review finding
 * about Section 1, for instance.
 */
export type V4FieldId =
  | "S1_FURTHER"
  | "S2_ACTIONS"
  | "S2_INCONSISTENT"
  | "S2_FURTHER"
  | "S3_INCIDENCE"
  | "S3_DURATION"
  | "S3_MORTALITY"
  | "S3_TREATMENTS"
  | "S3_QOL"
  | "S3_FURTHER"
  | "S4_TYPE_VERSION"
  | "S4_CHANGES"
  | "S4_RATIONALE"
  | "S4_FURTHER"
  | "S5_EXPOSURE"
  | "S5_ACTIONS"
  | "S5_FURTHER"
  | "S6_STUDIES"
  | "S6_FURTHER"
  | "S7_DIFFERENCES"
  | "S7_VIGIFLOW"
  | "S7_FURTHER"
  | "S8_SIGNALS"
  | "S8_FURTHER"
  | "S9_FURTHER"
  | "S10_KEY_RISKS"
  | "S10_FURTHER"
  | "S11_COMMENTS"
  | "S11_FURTHER"
  | "S12_FURTHER"
  | "S13_FURTHER";

export interface V4Field {
  id: V4FieldId;
  section: number;
  /** The template's own wording for the field. */
  label: string;
}

export const V4_FIELDS: V4Field[] = [
  { id: "S1_FURTHER", section: 1, label: "Further assessment" },
  {
    id: "S2_ACTIONS",
    section: 2,
    label:
      "Summarise regulatory actions taken by any authority or the MAH for safety reasons this interval, worldwide (approvals, refusals, suspensions, withdrawals, variations)",
  },
  { id: "S2_INCONSISTENT", section: 2, label: "If yes, explain" },
  { id: "S2_FURTHER", section: 2, label: "Further assessment" },
  { id: "S3_INCIDENCE", section: 3, label: "Incidence and prevalence of disease" },
  { id: "S3_DURATION", section: 3, label: "Disease duration (acute / chronic / progressive)" },
  { id: "S3_MORTALITY", section: 3, label: "Mortality and severity of the disease" },
  { id: "S3_TREATMENTS", section: 3, label: "Current treatment options" },
  {
    id: "S3_QOL",
    section: 3,
    label: "Quality-of-life impact of the disease/condition given current treatment options",
  },
  { id: "S3_FURTHER", section: 3, label: "Further assessment" },
  { id: "S4_TYPE_VERSION", section: 4, label: "RSI type (SmPC / CDS / CCDS) and version number" },
  { id: "S4_CHANGES", section: 4, label: "Changes made to the RSI during this reporting interval" },
  { id: "S4_RATIONALE", section: 4, label: "Rationale for the changes (if any)" },
  { id: "S4_FURTHER", section: 4, label: "Further assessment" },
  {
    id: "S5_EXPOSURE",
    section: 5,
    label:
      "Provide patient years, number of patients, prescriptions, units sold, and defined daily doses, if available",
  },
  { id: "S5_ACTIONS", section: 5, label: "Actions taken for safety reasons during the reporting interval" },
  { id: "S5_FURTHER", section: 5, label: "Further assessment" },
  {
    id: "S6_STUDIES",
    section: 6,
    label:
      "Briefly highlight studies containing relevant safety information (company-sponsored and published studies)",
  },
  { id: "S6_FURTHER", section: 6, label: "Further assessment" },
  {
    id: "S7_DIFFERENCES",
    section: 7,
    label: "Note any differences between Nigeria-specific and global data, if relevant",
  },
  {
    id: "S7_VIGIFLOW",
    section: 7,
    label:
      "VigiFlow: number of ICSRs received during the reporting interval and cumulatively, including serious cases, compared with the Nigerian cases reported by the MAH",
  },
  { id: "S7_FURTHER", section: 7, label: "Further assessment" },
  { id: "S8_SIGNALS", section: 8, label: "Signals new, ongoing or closed during this reporting interval" },
  { id: "S8_FURTHER", section: 8, label: "Further assessment" },
  { id: "S9_FURTHER", section: 9, label: "Further assessment" },
  { id: "S10_KEY_RISKS", section: 10, label: "Key risks — further evidence" },
  { id: "S10_FURTHER", section: 10, label: "Further assessment" },
  {
    id: "S11_COMMENTS",
    section: 11,
    label: "Evaluator's comments (critically assess the MAH's benefit-risk profile)",
  },
  { id: "S11_FURTHER", section: 11, label: "Further assessment" },
  { id: "S12_FURTHER", section: 12, label: "Further assessment" },
  { id: "S13_FURTHER", section: 13, label: "Further assessment" },
];

const BY_ID = new Map(V4_FIELDS.map((f) => [f.id, f]));

export function v4Field(id: V4FieldId): V4Field {
  return BY_ID.get(id)!;
}

/** "4. Changes made to the RSI…" — for pickers. */
export function v4FieldLabel(id: V4FieldId): string {
  const f = v4Field(id);
  return `${f.section}. ${f.label}`;
}

/** Where research filed under a memo criterion goes in the V4 report. */
const CRITERION_FIELD: Record<MemoCriterionId, V4FieldId | undefined> = {
  PRODUCT_IDENTITY: undefined,
  REPORTING_INTERVAL: undefined,
  THERAPEUTIC_CATEGORY: undefined,
  DATE_RECEIVED: undefined,
  INTERNATIONAL_BIRTH_DATE: undefined,
  NIGERIA_BIRTH_DATE: undefined,
  RSI_CHANGES: "S4_CHANGES",
  WORLDWIDE_ACTIONS: "S2_ACTIONS",
  PATIENT_EXPOSURE: "S7_VIGIFLOW",
  RELEVANT_STUDIES: "S6_STUDIES",
  OVERALL_SAFETY_EVALUATION: "S10_KEY_RISKS",
};

/** The default V4 field for research about a working section. */
const SECTION_FIELD: Record<PsurV4SectionId, V4FieldId> = {
  ADMIN_SCREENING: "S1_FURTHER",
  S1_PRODUCT_REGULATORY: "S1_FURTHER",
  S2_WORLDWIDE_STATUS: "S2_ACTIONS",
  S3_THERAPEUTIC_CONTEXT: "S3_FURTHER",
  S4_RSI: "S4_CHANGES",
  S5_EXPOSURE_ACTIONS: "S5_ACTIONS",
  S6_LITERATURE: "S6_STUDIES",
  S7_AGGREGATE_SAFETY_DATA: "S7_VIGIFLOW",
  S8_SIGNAL_EVALUATION: "S8_SIGNALS",
  S9_SPECIAL_POPULATIONS: "S9_FURTHER",
  S10_BENEFIT_RISK: "S10_KEY_RISKS",
  S11_UNCERTAINTIES: "S11_COMMENTS",
  S12_REGULATORY_DECISION: "S12_FURTHER",
  S13_CONCLUSION_SIGNOFF: "S13_FURTHER",
};

export function defaultFieldForCriterion(id: MemoCriterionId | undefined): V4FieldId | undefined {
  return id ? CRITERION_FIELD[id] : undefined;
}

export function defaultFieldForSection(id: PsurV4SectionId | undefined): V4FieldId | undefined {
  return id ? SECTION_FIELD[id] : undefined;
}

/**
 * The V4 field an evidence entry prints in: the field chosen for it, else
 * the one its memo criterion implies, else its working section's default.
 * Entries recorded before V4 fields existed still land somewhere sensible.
 */
export function fieldForEvidence(e: EvidenceEntry): V4FieldId {
  return (
    e.v4Field ??
    defaultFieldForCriterion(e.criterion) ??
    defaultFieldForSection(e.section) ??
    "S13_FURTHER"
  );
}
