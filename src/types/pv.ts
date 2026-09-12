/** Domain types mirroring the payloads the FastAPI layer will return. */

export type WorkflowStep =
  "INTAKE" | "TRIAGE" | "CODING" | "REVIEW" | "QC" | "REGULATORY_READY" | "CLOSED";

export const WORKFLOW_STEPS: WorkflowStep[] = [
  "INTAKE",
  "TRIAGE",
  "CODING",
  "REVIEW",
  "QC",
  "REGULATORY_READY",
  "CLOSED",
];

export const WORKFLOW_LABELS: Record<WorkflowStep, string> = {
  INTAKE: "Intake",
  TRIAGE: "Triage",
  CODING: "Coding",
  REVIEW: "Review",
  QC: "QC",
  REGULATORY_READY: "Regulatory ready",
  CLOSED: "Closed",
};

export type Seriousness = "SERIOUS" | "NON_SERIOUS" | "UNASSESSED";
export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type CaseOutcome =
  "RECOVERED" | "RECOVERING" | "NOT_RECOVERED" | "RECOVERED_WITH_SEQUELAE" | "FATAL" | "UNKNOWN";

export interface PatientInfo {
  identifier: string;
  age?: string | undefined;
  sex?: "MALE" | "FEMALE" | "UNKNOWN" | undefined;
  weightKg?: string | undefined;
  medicalHistory?: string | undefined;
}

export interface ReporterInfo {
  name: string;
  qualification: string;
  country: string;
  contact?: string | undefined;
  consentToContact?: boolean | undefined;
}

export interface SuspectProduct {
  reportedName: string;
  activeIngredient?: string | undefined;
  dose?: string | undefined;
  route?: string | undefined;
  indication?: string | undefined;
  therapyStart?: string | undefined;
  therapyEnd?: string | undefined;
  action?: string | undefined;
  /** Additive fields for multi-drug ICSR capture — absent on cases created
   *  before per-drug batch/expiry tracking existed. */
  batchNumber?: string | undefined;
  expiryDate?: string | undefined;
  /** Set once a coding suggestion for this product has been accepted in
   *  the coding workspace — mirrors ReactionEvent.codedTerm. Only ever
   *  written by coding.accept(), never guessed or pre-filled. */
  codedTerm?: CodedTerm | null | undefined;
}

export interface ConcomitantMedicine {
  name: string;
  dose?: string | undefined;
  indication?: string | undefined;
}

/**
 * Case-specific information detected on a source document (image/form)
 * that doesn't map to any canonical ICSR field above — e.g. a facility
 * LGA, a hospital department, a country-specific reporting code. The
 * canonical fields above stay the single source of truth for validation,
 * E2B mapping, and workflow logic; dynamic fields exist purely so that
 * real-world source-document information is never silently discarded
 * just because this app's fixed schema doesn't have a slot for it yet.
 */
export interface DynamicField {
  id: string;
  label: string;
  value: string;
  /** The label exactly as it appeared on the source document, before any
   *  user rename — absent for a field the user added manually. */
  originalLabel?: string | undefined;
  /** 0–1, only meaningful for source === "ai_extraction". */
  confidence?: number | undefined;
  source: "ai_extraction" | "user_added";
  /** "detected" = as extracted, untouched. "edited" = a user has changed
   *  the label or value — a later extraction pass must never overwrite an
   *  "edited" field silently. "confirmed" = a user reviewed it as-is
   *  without changing it. */
  status: "detected" | "confirmed" | "edited";
  createdAt: string;
  updatedAt: string;
}

/** The AI's raw structured-extraction result, kept alongside the
 *  normalized canonical+dynamic fields for audit/traceability — never
 *  read by any business logic, purely a record of what the model
 *  actually returned before the user reviewed/edited anything. */
export interface RawExtractionRecord {
  fields: Record<string, unknown>;
  model?: string | undefined;
  promptVersion?: string | undefined;
  extractedAt: string;
}

export interface ReactionEvent {
  reportedTerm: string;
  onsetDate?: string | undefined;
  endDate?: string | undefined;
  outcome: CaseOutcome;
  codedTerm?: CodedTerm | null | undefined;
}

export interface CodedTerm {
  term: string;
  code: string;
  dictionary: "MedDRA" | "WHODrug";
  dictionaryVersion: string;
  level?: string | undefined;
  acceptedBy?: string | undefined;
  acceptedAt?: string | undefined;
}

export interface CaseSummary {
  id: string;
  patientIdentifier: string;
  /** The primary suspect product (suspectProducts[0]'s name) — deliberately
   *  the single product this app aggregates and filters cases-list/
   *  dashboard/signal views by, even on a case with multiple suspect
   *  drugs. That's an intentional simplification, not an oversight: a
   *  case with several suspect drugs is still one case for workflow and
   *  triage purposes, and its full drug list is always visible on the
   *  case detail page (CaseDetail.suspectProducts). Revisit only if
   *  per-drug (rather than per-case) aggregation is explicitly wanted. */
  product: string;
  reaction: string;
  seriousness: Seriousness;
  outcome: CaseOutcome;
  workflowStep: WorkflowStep;
  assignedTo: string;
  receivedDate: string;
  dueDate: string;
  priority: Priority;
  flags: string[];
  source: "MANUAL" | "WHATSAPP" | "LINELIST" | "EMAIL";
  /** Precomputed from CaseDetail.dynamicFields for the cases list page —
   *  count only, so the list view can show "N additional fields" without
   *  fetching every case's full detail. Absent/0 when there are none. */
  dynamicFieldsCount?: number | undefined;
  /** Precomputed "label value" join of every dynamic field, lower-cased,
   *  so the list page's existing free-text search can match against
   *  dynamic-field content without changing how that search works. */
  dynamicFieldsSearchText?: string | undefined;
}

export interface CaseDetail extends CaseSummary {
  reporter: ReporterInfo;
  patient: PatientInfo;
  suspectProducts: SuspectProduct[];
  reactions: ReactionEvent[];
  /** Non-suspect medication the patient was also taking, distinct from
   *  suspectProducts. Additive — absent/empty on cases created before
   *  concomitant-medicine capture existed. */
  concomitantMedicines?: ConcomitantMedicine[] | undefined;
  /** Additive — absent/[] on every case created before this feature
   *  existed, and never required for canonical ICSR validation, E2B
   *  generation, or workflow logic. See DynamicField's own doc comment. */
  dynamicFields?: DynamicField[] | undefined;
  /** The AI's original extraction output, if this case was created via
   *  image extraction — kept for audit only, separate from the
   *  normalized fields above. Absent for manually-typed cases. */
  rawExtraction?: RawExtractionRecord | undefined;
  narrative: string;
  reportedSeriousnessCriteria: string[];
  followUpRequests: FollowUpRequest[];
  workflowState: Record<WorkflowStep, WorkflowStepState>;
}

export type WorkflowStepState = "COMPLETED" | "CURRENT" | "BLOCKED" | "ACTION_REQUIRED" | "PENDING";

export interface FollowUpRequest {
  id: string;
  caseId: string;
  requestedInformation: string;
  requestedBy: string;
  requestedAt: string;
  dueAt: string;
  status: "OPEN" | "RESPONDED" | "OVERDUE" | "CLOSED";
  channel: "WHATSAPP" | "EMAIL" | "PHONE";
  /** Set once someone marks the request responded — the note they left
   *  alongside it. Absent on requests that predate this field. */
  responseNote?: string | undefined;
  respondedBy?: string | undefined;
  respondedAt?: string | undefined;
}

export interface SeriousnessAssessment {
  caseId: string;
  reportedSeriousness: Seriousness;
  narrativeAssessment: Seriousness;
  mismatch: boolean;
  criteria: {
    criterion: string;
    detected: boolean;
    evidence: string[];
  }[];
  rationale: string;
  engineVersion: string;
  reviewState: "PENDING_REVIEW" | "REVIEWED";
  reviewedBy?: string | undefined;
  reviewDecision?: "ACCEPT_REPORTED" | "MARK_SERIOUS" | "REQUEST_INFO" | undefined;
}

export interface CodingSuggestion {
  id: string;
  sourceText: string;
  kind: "DRUG" | "REACTION";
  term: string;
  code: string;
  dictionary: "MedDRA" | "WHODrug";
  dictionaryVersion: string;
  matchType: "EXACT" | "SYNONYM" | "FUZZY" | "LLM_RANKED_CANDIDATE" | "AI_SUGGESTED";
  confidence: number;
  evidence: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
}

export interface CodingHistoryEntry {
  id: string;
  at: string;
  user: string;
  action: string;
  detail: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  user: string;
  role: string;
  action: string;
  entity: string;
  entityId: string;
  previousValue?: string | null | undefined;
  newValue?: string | null | undefined;
  reason?: string | null | undefined;
}

export interface IntakeConversation {
  id: string;
  channel: "WHATSAPP";
  reporterName: string;
  reporterNumberMasked: string;
  lastMessage: string;
  lastMessageAt: string;
  consent: "GRANTED" | "PENDING" | "DECLINED";
  criteria: { reporter: boolean; patient: boolean; product: boolean; event: boolean };
  status: "NEW" | "IN_REVIEW" | "CONVERTED" | "NOT_A_CASE";
  linkedCaseId?: string | undefined;
}

export interface IntakeMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  at: string;
  body: string;
}

export interface IntakeConversationDetail extends IntakeConversation {
  messages: IntakeMessage[];
  extracted: { field: string; value: string | null; sourceMessageId?: string | undefined }[];
  missing: string[];
}

export interface LineListJob {
  id: string;
  filename: string;
  uploadedAt: string;
  uploadedBy: string;
  rows: number;
  stage: "UPLOADED" | "MAPPED" | "NORMALISED" | "VALIDATED" | "E2B_GENERATED" | "FAILED";
  validCases: number;
  invalidCases: number;
  warnings: number;
  /** Set once AI-assisted "Fix Issues" has actually applied at least one
   *  correction to this job's data. Absent until then — gates whether a
   *  "Download Fixed CSV" download has anything genuinely fixed to offer. */
  fixedAt?: string | undefined;
  /** Per-tier breakdown of the current issue list, additive alongside the
   *  three counters above (validCases/invalidCases/warnings stay
   *  CRITICAL|HIGH vs MEDIUM|LOW buckets for backward compatibility).
   *  Absent on jobs validated before four-tier severity existed. */
  criticalCount?: number | undefined;
  highCount?: number | undefined;
  mediumCount?: number | undefined;
  lowCount?: number | undefined;
  /** Set when a reviewer has explicitly overridden the "no outstanding
   *  errors" gate on E2B(R3) generation for this job — for cases where the
   *  line-list validator's remaining findings are judged intentional or
   *  incorrect for this dataset. Never clears invalidCases or the issues
   *  themselves (still real, still shown on the line-list page); only
   *  bypasses this job's export gate. Recorded for the audit trail like
   *  every other consequential decision in this app. */
  e2bOverride?: { by: string; at: string; reason?: string } | undefined;
  /** Set when an assessor has explicitly, auditedly chosen to force-export
   *  the REAL, schema-validated E2B(R3) pipeline (src/services/e2b-r3/)
   *  despite outstanding BLOCKING issues — structurally separate from
   *  e2bOverride above, which only ever affects the legacy draft
   *  generator and has no effect here. This override can rescue a case
   *  blocked only on administrative/mapping-judgment issues (e.g.
   *  unresolved outcome mapping, unconfirmed report type); it can NEVER
   *  rescue a case failing the ICH structural minimum (no identifiable
   *  patient/reporter, zero reactions, zero suspect products) or missing
   *  its own case-identity fields (C.1.1/C.1.5/C.1.8) — see
   *  E2B_NON_OVERRIDABLE_CODES in src/services/e2b-r3/validation.ts. A
   *  reason is mandatory, exactly like e2bOverride. */
  validatedE2bOverride?: { by: string; at: string; reason: string } | undefined;
}

export type LineListSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

/** A normalized, engine-agnostic classification of *what kind* of problem
 *  a finding represents — the stable identity dedup keys off, instead of
 *  a rule's fixed code string or the AI's freeform one (which will never
 *  reliably match each other verbatim). Only classifications that
 *  actually correspond to existing validation behaviour are defined. */
export type LineListIssueType =
  | "FIELD_MISSING"
  | "FIELD_VALUE_INVALID"
  | "FIELD_FORMAT_INVALID"
  | "FIELD_CONTENT_MISMATCH"
  | "CROSS_FIELD_CONTRADICTION"
  | "DATE_CHRONOLOGY"
  | "STRUCTURAL_COLUMN_SHIFT"
  | "DUPLICATE_RECORD";

export interface LineListIssue {
  row: number;
  column: string;
  severity: LineListSeverity;
  code: string;
  message: string;
  value: string | null;
  /** Whether an automatic correction is plausible via "Fix Issues".
   *  Absent on older/demo-seeded issues — treated as non-fixable. */
  fixable?: boolean;
  /** Which engine found this — shown in the UI so AI and deterministic
   *  findings are never presented as the same thing. Absent on
   *  demo-seeded issues predating this distinction. When a finding was
   *  independently identified by both engines and merged, this is the
   *  primary/authoritative one (rule, when both agree) — see `sources`
   *  for the complete provenance. */
  source?: "ai" | "rule";
  /** Complete provenance — ["rule"], ["ai"], or ["rule","ai"] when both
   *  engines independently identified the same underlying issue and were
   *  merged into one finding. Absent on issues predating this field;
   *  callers should fall back to treating `source` as the only origin. */
  sources?: ("ai" | "rule")[];
  /** The normalized issue classification used for semantic deduplication
   *  (see mergeFindings). Absent on findings that predate this field, or
   *  on ones no classification was assigned to (e.g. the file-level
   *  NO_COLUMNS_MAPPED finding) — those are never merged across engines,
   *  which is the safe default. */
  issueType?: LineListIssueType;
  /** Canonical field name(s) this finding is actually about — more than
   *  one for a cross-field finding (e.g. ["vaccination_date","onset_date"]
   *  for a chronology conflict). A field-level finding on just
   *  ["seriousness"] must never be treated as equivalent to a cross-field
   *  finding on ["seriousness","outcome"], even on the same row. */
  affectedFields?: string[];
  /** LOW means the finding depended on inferring an unfamiliar column's
   *  role or a judgment call rather than an exact rule — auto-fix skips
   *  these and leaves them for a human to decide either way. Rule-engine
   *  findings are always HIGH by construction. Absent on issues persisted
   *  before this distinction existed. */
  confidence?: "HIGH" | "LOW";
}

/** The 13 sections of the NAFDAC PSUR/PBRER Evaluation Form V4
 *  (docs/NAFDAC_PSUR_Template_V4_Proposed.docx) — the authoritative
 *  structure every screening/review pass checks a submission against.
 *  This is the single source of truth on the frontend for rendering
 *  section-coverage and labelling a finding's v4Section; prompts.py
 *  mirrors the same section list/order for the AI side (two runtimes,
 *  duplicated deliberately, kept in sync by cross-referencing comments). */
export type PsurV4SectionId =
  | "ADMIN_SCREENING"
  | "S1_PRODUCT_REGULATORY"
  | "S2_WORLDWIDE_STATUS"
  | "S3_THERAPEUTIC_CONTEXT"
  | "S4_RSI"
  | "S5_EXPOSURE_ACTIONS"
  | "S6_LITERATURE"
  | "S7_AGGREGATE_SAFETY_DATA"
  | "S8_SIGNAL_EVALUATION"
  | "S9_SPECIAL_POPULATIONS"
  | "S10_BENEFIT_RISK"
  | "S11_UNCERTAINTIES"
  | "S12_REGULATORY_DECISION"
  | "S13_CONCLUSION_SIGNOFF";

export interface PsurV4Section {
  id: PsurV4SectionId;
  name: string;
  subItems: string[];
}

export const PSUR_V4_TEMPLATE_SECTIONS: PsurV4Section[] = [
  {
    id: "ADMIN_SCREENING",
    name: "Administrative Completeness Check",
    subItems: [
      "Follows the NAFDAC/ICH E2C(R2) recommended template",
      "Reporting interval / Data Lock Point (DLP) correctly stated/calculated",
      "All mandatory ICH E2C(R2) sections present, or absence explicitly justified",
      "Submission received within the required regulatory timeframe",
    ],
  },
  {
    id: "S1_PRODUCT_REGULATORY",
    name: "1. Product & Regulatory Information",
    subItems: [
      "Date of Review",
      "Name of Product / Strength / Dosage Form",
      "Marketing Authorisation Holder (MAH)",
      "NAFDAC Registration Number",
      "Reporting Period",
      "International Birth Date (IBD)",
      "Nigerian Birth Date (NBD)",
      "Therapeutic Indication(s)",
    ],
  },
  {
    id: "S2_WORLDWIDE_STATUS",
    name: "2. Worldwide Regulatory & Marketing Status",
    subItems: [
      "Regulatory actions this interval (approvals, refusals, suspensions, withdrawals, variations)",
      "Any action inconsistent with, or not yet reflected in, NAFDAC's current position",
    ],
  },
  {
    id: "S3_THERAPEUTIC_CONTEXT",
    name: "3. Therapeutic Context",
    subItems: [
      "Incidence and prevalence of disease",
      "Disease duration",
      "Mortality and severity of the disease",
      "Current treatment options",
      "Quality-of-life impact given current treatment options",
    ],
  },
  {
    id: "S4_RSI",
    name: "4. Reference Safety Information (RSI)",
    subItems: [
      "RSI type (SmPC/CDS/CCDS) and version",
      "Changes made this interval",
      "Rationale for the changes",
    ],
  },
  {
    id: "S5_EXPOSURE_ACTIONS",
    name: "5. Exposure & Actions Taken for Safety Reasons",
    subItems: [
      "Reporting-interval exposure (global, Nigerian, other region)",
      "Cumulative exposure",
      "Actions taken for safety reasons during the reporting interval",
    ],
  },
  {
    id: "S6_LITERATURE",
    name: "6. Literature",
    subItems: ["Studies containing relevant safety information (company-sponsored and published)"],
  },
  {
    id: "S7_AGGREGATE_SAFETY_DATA",
    name: "7. Aggregate Safety Data Summary",
    subItems: [
      "MAH summary tabulation of ADRs / SOCs requiring specific regulatory assessment",
      "Differences between Nigeria-specific and global data",
      "VigiFlow's Nigerian ICSR count (reporting-interval and cumulative, including serious cases) vs. MAH-reported Nigerian cases",
    ],
  },
  {
    id: "S8_SIGNAL_EVALUATION",
    name: "8. Signal Evaluation Log",
    subItems: [
      "Every signal new, ongoing, or closed this interval — or an explicit 'no signals under evaluation' statement",
    ],
  },
  {
    id: "S9_SPECIAL_POPULATIONS",
    name: "9. Special Populations, Special Situations & Missing Information",
    subItems: [
      "Pregnancy & lactation",
      "Paediatric population",
      "Geriatric population",
      "Hepatic impairment",
      "Renal impairment",
      "Overdose/misuse/abuse potential/medication error",
      "Off-label use",
      "Other missing information",
    ],
  },
  {
    id: "S10_BENEFIT_RISK",
    name: "10. Benefit-Risk Assessment",
    subItems: [
      "10.1 Key Benefits",
      "10.2 Key Risks (identified, potential, missing information)",
      "10.3 Integrated Benefit-Risk Effects Table",
      "10.4 Patient/HCP Perspective",
      "10.5 Risk Minimisation Measures — Effectiveness",
    ],
  },
  {
    id: "S11_UNCERTAINTIES",
    name: "11. Uncertainties Affecting the Benefit-Risk Assessment",
    subItems: [
      "Categorised uncertainties, impact on conclusion, whether the MAH addressed them, mandatory rationale",
    ],
  },
  {
    id: "S12_REGULATORY_DECISION",
    name: "12. Regulatory Decision & Recommended Actions",
    subItems: [
      "Risk minimisation considerations",
      "Overall benefit-risk outcome",
      "Next PSUR/PBRER due date",
      "Follow-up required",
    ],
  },
  {
    id: "S13_CONCLUSION_SIGNOFF",
    name: "13. Conclusion, Sign-off & Document Control",
    subItems: [
      "Overall conclusion",
      "Reviewer confidence",
      "References",
      "Evaluator sign-off",
      "Peer review sign-off",
    ],
  },
];

export interface PsurDocument {
  id: string;
  filename: string;
  product: string;
  /** Marketing Authorisation Holder — Section 1 (Product & Regulatory
   *  Information) requires this, but it is only ever populated from what
   *  the AI could actually read off the submitted document's own text
   *  (mirrors `product`/`reportingPeriod`'s extraction — see
   *  AiPsurReview.mah). Undefined when never extracted; the Executive
   *  Summary and Compliance Directive both render "Not extracted from
   *  the submitted document" rather than inventing one. */
  mah?: string | undefined;
  reportingPeriod: string;
  uploadedAt: string;
  uploadedBy: string;
  stage: "UPLOADED" | "EXTRACTED" | "REVIEWED" | "FAILED";
  pages: number;
  /** True while `pages` is only a file-size-derived guess made before
   *  anything opened the PDF. Cleared once the backend reports the real
   *  pdfplumber page count. The UI must never present an estimate as a
   *  measured figure — see the "~N pages (estimated)" rendering. */
  pagesEstimated?: boolean | undefined;
  /** PDF narrative report vs. a spreadsheet annex (e.g. a cumulative
   *  summary tabulation). Defaults to PDF for documents uploaded before
   *  this field existed. */
  sourceType?: "PDF" | "SPREADSHEET";
  /** Administrative Completeness Check — runs immediately at upload,
   *  before detailed scientific review. Distinct pass, distinct data;
   *  never collapsed into the findings list. Absent on documents
   *  reviewed before this existed. */
  screening?: PsurScreeningResult | undefined;
  /** Structured Section 10 (Benefit-Risk Assessment) sub-tables — PDF
   *  narrative reports only (a spreadsheet tabulation has no benefit-risk
   *  narrative to extract from). Every field the AI could not support
   *  from the actual text is marked accordingly, never fabricated. */
  benefitRisk?: PsurBenefitRiskAssessment | undefined;
  /** Section 9 — one item per fixed special-population/special-situation
   *  area (see PsurSpecialPopulationArea). Assessor-editable, same
   *  ownership pattern as `benefitRisk`. */
  specialPopulations?: PsurSpecialPopulationItem[] | undefined;
  /** The Nigeria-specific facts Sections 5 and 7 turn on — see
   *  PsurNigerianContext. Absent on documents reviewed before this existed. */
  nigerianContext?: PsurNigerianContext | undefined;
  /** Section 11 — one row per identified uncertainty. */
  uncertainties?: PsurUncertainty[] | undefined;
  /** Section 11's closing free-text field, "Evaluator's comments
   *  (critically assess the MAH's benefit-risk profile)" — the assessor's
   *  own critical appraisal, distinct from the per-uncertainty rationales
   *  above it. Pure assessor input; never AI-generated. */
  evaluatorComments?: string | undefined;
  /** Explicit assessor confirmation that NO uncertainties apply this
   *  interval — structurally distinct from an empty/never-touched
   *  `uncertainties` array, which only means "not yet assessed." The V4
   *  template requires Section 11 to be addressed either way; an empty
   *  list must never silently read as "confirmed none." Cleared
   *  automatically the moment an assessor adds an uncertainty (see
   *  services/api/psur.ts's updateUncertainties). */
  uncertaintiesNoneConfirmed?: { by: string; at: string; rationale: string } | undefined;
  /** The AI's non-binding starting point for Section 12 — kept
   *  structurally separate from `regulatoryDecision` (the assessor's own,
   *  actual decision) so an AI suggestion can never be mistaken for, or
   *  silently become, the regulatory conclusion. */
  aiRecommendation?: PsurAiRecommendation | undefined;
  /** Section 12 — the assessor's own decision. Undefined until an
   *  assessor actually sets it; never defaulted from aiRecommendation. */
  regulatoryDecision?: PsurRegulatoryDecision | undefined;
  /** Section 13 — pure assessor input, never AI-generated. */
  signOff?: PsurSignOff | undefined;
}

/** One item in the Administrative Completeness Check (template section
 *  "Administrative Completeness Check", checked before scientific
 *  review begins). */
export interface PsurAdministrativeCheck {
  id:
    | "FOLLOWS_E2C_R2_TEMPLATE"
    | "DLP_CORRECTLY_STATED"
    | "MANDATORY_SECTIONS_PRESENT_OR_JUSTIFIED"
    | "RECEIVED_WITHIN_TIMEFRAME";
  label: string;
  status: "YES" | "NO" | "NOT_ASSESSABLE";
  comment: string;
}

/**
 * The one authoritative status vocabulary for "how well is this V4
 * section addressed" — used for the coarse per-section coverage check
 * AND for every richer sub-item breakdown (Section 9's special-population
 * areas, derived statuses for Sections 10-13). Deliberately five states,
 * not a boolean: a section existing (some text was found under it) is a
 * completely different claim from that content being SUFFICIENT — see
 * PsurSectionCoverage's own doc comment for why "present" was retired.
 *   - ADEQUATELY_ADDRESSED: the required content is sufficiently covered.
 *   - PRESENT_BUT_INCOMPLETE: the section/topic exists and has some
 *     relevant content, but material required information is missing or
 *     insufficient — NOT the same as ADEQUATELY_ADDRESSED, and NOT the
 *     same as MISSING.
 *   - MISSING: the required section/content is genuinely absent.
 *   - NOT_APPLICABLE: the requirement genuinely does not apply to this
 *     product/submission — always paired with an explicit justification
 *     (see notApplicableJustification); never used as a silent way to
 *     avoid assessing something.
 *   - ASSESSOR_PENDING: not yet assessed at all (AI review didn't run for
 *     this section, or it's a section — like 12/13 — whose completion is
 *     inherently the assessor's own act, not something the submission
 *     itself can satisfy). Never conflated with MISSING: MISSING is a
 *     claim that content is absent; ASSESSOR_PENDING is honestly "unknown
 *     until a human looks."
 */
export type PsurSectionStatus =
  | "ADEQUATELY_ADDRESSED"
  | "PRESENT_BUT_INCOMPLETE"
  | "MISSING"
  | "NOT_APPLICABLE"
  | "ASSESSOR_PENDING";

/**
 * Coarse "how well is this V4 section addressed" check — distinct from
 * the deep per-field scientific review in `AiPsurReview.findings`, but no
 * longer independently guessable: build this via
 * services/psur/section-consistency.ts's buildAuthoritativeSectionCoverage,
 * which derives Sections 9-13's status from their own richer structured
 * data (specialPopulations, benefitRisk, uncertainties, regulatoryDecision,
 * signOff) rather than trusting a second, separate AI judgement that could
 * silently disagree with the detailed findings — this is the fix for the
 * "Section 9 = Missing, but no way to see what's missing" inconsistency
 * class. `status` replaced the old `present: boolean` field (which could
 * not distinguish "adequately addressed" from "present but incomplete") —
 * see normalizeSectionCoverage for reading documents stored before this
 * change.
 */
export interface PsurSectionCoverage {
  section: PsurV4SectionId;
  status: PsurSectionStatus;
  comment: string;
  /** Required (by convention, not enforced at the type level) whenever
   *  status is NOT_APPLICABLE — the specific reason this V4 requirement
   *  genuinely doesn't apply to this product/submission. */
  notApplicableJustification?: string | undefined;
  /** Who/what most recently set this section's status — never let an
   *  AI-asserted or rule-derived status silently read as if an assessor
   *  personally judged it. */
  source: "ai" | "rule" | "assessor";
}

/**
 * The Nigeria-specific facts Sections 5 and 7 turn on, collected as narrow
 * yes/no questions rather than folded into one holistic per-section verdict
 * — see services/psur/nigeria-requirements.ts for why (a mostly-complete
 * section was absorbing a specifically-missing Nigerian datum, measured in
 * two separate live submissions).
 *
 * `vigiflowReconciliationProvided` means "the SUBMISSION states that a
 * reconciliation was performed". It never means this application queried
 * VigiFlow — there is no such integration.
 */
export interface PsurNigerianContext {
  /** Whether Section 5 must carry Nigeria-specific exposure at all. False
   *  for sources with no exposure narrative to assess (spreadsheet annexes). */
  exposureRequired: boolean;
  nigerianExposureProvided: boolean;
  nigerianExposureEvidence?: string | undefined;
  nigerianCaseCountProvided: boolean;
  nigerianCaseCountEvidence?: string | undefined;
  vigiflowReconciliationProvided: boolean;
  vigiflowReconciliationEvidence?: string | undefined;
}

export interface PsurScreeningResult {
  performedAt: string;
  administrativeChecks: PsurAdministrativeCheck[];
  /** Coarse "does this section appear to be addressed at all" check —
   *  distinct from the deep per-field scientific review that follows. */
  sectionCoverage: PsurSectionCoverage[];
  /** A recommendation for the assessor, never an automatic decision —
   *  see recordScreeningOverride in psur.ts. */
  recommendation: "PROCEED_TO_SCIENTIFIC_REVIEW" | "RETURN_TO_MAH_FIRST";
  assistGenerated: boolean;
  humanOverride?:
    | {
        decision: "PROCEED_TO_SCIENTIFIC_REVIEW" | "RETURN_TO_MAH_FIRST";
        by: string;
        at: string;
        rationale: string;
      }
    | undefined;
}

/** The 10 deficiency categories from the product-owner spec — a richer
 *  classification layered ON TOP OF (not replacing) PsurFinding.category,
 *  which stays for backward compatibility with findings stored before
 *  this existed. Never force every finding into one of these if the
 *  evidence doesn't actually support that categorisation — optional. */
export type PsurDeficiencyType =
  | "MISSING_INFORMATION"
  | "INCOMPLETE_INFORMATION"
  | "INADEQUATE_EVIDENCE"
  | "INCONSISTENCY"
  | "UNCLEAR_AMBIGUOUS_INFORMATION"
  | "UNSUPPORTED_CLAIM"
  | "MISSING_REQUIRED_SECTION"
  | "INSUFFICIENT_LOCAL_EVIDENCE"
  | "ADDITIONAL_LITERATURE_REQUIRED"
  | "DATA_DISCREPANCY";

export type PsurEvidenceQuality = "HIGH" | "MODERATE" | "LOW" | "VERY_LOW" | "NOT_ASSESSABLE";

export interface PsurKeyBenefit {
  id: string;
  benefit: string;
  evidenceSource: string;
  magnitude: string;
  evidenceQuality: PsurEvidenceQuality;
}

export interface PsurKeyRisk {
  id: string;
  kind: "IDENTIFIED" | "POTENTIAL";
  risk: string;
  severity: string;
  frequency: string;
  /** The template requires an appropriate denominator/category AND the
   *  data source for any frequency estimate — never a bare number with
   *  no provenance. */
  frequencyDataSource: string;
  reversibility: string;
  duration: string;
  preventabilityRiskManagement: string;
  comment: string;
}

export interface PsurMissingInformationItem {
  id: string;
  missingInformation: string;
  riskMinimisationImplication: string;
}

export interface PsurIntegratedEffectsRow {
  dimension:
    "CONDITION_UNMET_NEED" | "CURRENT_TREATMENT_OPTIONS" | "BENEFIT" | "RISK" | "RISK_MANAGEMENT";
  evidenceAndUncertainty: string;
  reviewerConclusion: string;
}

export interface PsurBenefitRiskAssessment {
  keyBenefits: PsurKeyBenefit[];
  keyRisks: PsurKeyRisk[];
  missingInformation: PsurMissingInformationItem[];
  /** Synthesised BEFORE the overall conclusion — the template requires
   *  evidence and uncertainty for each dimension to be shown, not skipped
   *  in favour of jumping straight to a verdict. */
  integratedEffectsTable: PsurIntegratedEffectsRow[];
  patientHcpPerspective: { available: boolean; summary: string };
  riskMinimisationEffectiveness: {
    outcome:
      "NOT_APPLICABLE" | "EFFECTIVE" | "PARTIALLY_EFFECTIVE" | "NOT_EFFECTIVE" | "NOT_ASSESSABLE";
    comment: string;
  };
  assistGenerated: boolean;
}

export type PsurUncertaintyCategory =
  | "DATA_LIMITATIONS_UNDERREPORTING"
  | "LIMITED_NIGERIAN_EXPOSURE"
  | "MISSING_SUBPOPULATION_DATA"
  | "SHORT_FOLLOWUP_DURATION"
  | "STUDY_DESIGN_LIMITATIONS"
  | "LIMITED_GENERALISABILITY"
  | "OTHER";

export interface PsurUncertainty {
  id: string;
  category: PsurUncertaintyCategory;
  description: string;
  impactOnConclusion: "LOW" | "MODERATE" | "HIGH";
  /** Whether the MAH satisfactorily addressed this uncertainty — the
   *  template requires this judgement to be tied to a specific
   *  uncertainty, never a blanket statement. */
  addressedByMah: "YES" | "PARTIALLY" | "NO";
  rationale: string;
}

/** The 8 areas Section 9 (Special Populations, Special Situations &
 *  Missing Information) requires — mirrors the sub-items list on
 *  PSUR_V4_TEMPLATE_SECTIONS's S9 entry and prompts.py's
 *  PSUR_V4_SECTION_CHECKLIST. Fixed, not free-form: every submission is
 *  judged against the SAME 8 areas, so a genuinely not-applicable area
 *  (e.g. a product with no paediatric indication) is recorded as such
 *  explicitly rather than simply never appearing. */
export type PsurSpecialPopulationArea =
  | "PREGNANCY_LACTATION"
  | "PAEDIATRIC"
  | "GERIATRIC"
  | "HEPATIC_IMPAIRMENT"
  | "RENAL_IMPAIRMENT"
  | "OVERDOSE_MISUSE_ABUSE_MEDICATION_ERROR"
  | "OFF_LABEL_USE"
  | "OTHER_MISSING_INFORMATION";

/** One area's assessment within Section 9. Reusing PsurSectionStatus
 *  (rather than a bespoke enum) is deliberate: "adequately addressed /
 *  present but incomplete / missing / not applicable / assessor pending"
 *  means exactly the same thing at this granularity as it does for a
 *  whole section — see PsurSectionStatus's doc comment. The overall S9
 *  section-coverage status is DERIVED from these 8 items (see
 *  section-consistency.ts's deriveStatusFromItems) rather than judged
 *  independently, so the coarse coverage view and this detail can never
 *  silently disagree. */
export interface PsurSpecialPopulationItem {
  area: PsurSpecialPopulationArea;
  status: PsurSectionStatus;
  comment: string;
  notApplicableJustification?: string | undefined;
  source: "ai" | "rule" | "assessor";
}

export type PsurRiskMinimisationAction =
  | "NO_ACTION_REQUIRED"
  | "CONTINUE_ROUTINE_PV"
  | "REQUEST_ADDITIONAL_INFO_FROM_MAH"
  | "REQUEST_MAH_CLARIFICATION"
  | "TARGETED_COMMUNICATION_SAFETY_LETTER"
  | "SUBMIT_UPDATE_RMP"
  | "PROPOSAL_FOR_PASS"
  | "UPDATE_SMPC_PIL_LABEL"
  | "REFER_TO_EXPERT_ADVISORY_COMMITTEE"
  | "RECOMMEND_SUSPENSION_WITHDRAWAL";

export type PsurOverallBenefitRiskOutcome =
  "FAVOURABLE" | "FAVOURABLE_WITH_CONDITIONS" | "UNCERTAIN_REQUIRES_FOLLOWUP" | "UNFAVOURABLE";

/** AI's non-binding starting point for section 12 — see PsurDocument.aiRecommendation. */
export interface PsurAiRecommendation {
  actions: PsurRiskMinimisationAction[];
  overallOutcome: PsurOverallBenefitRiskOutcome | undefined;
  basis: string;
}

/** The assessor's own decision — see PsurDocument.regulatoryDecision. */
export interface PsurRegulatoryDecision {
  actions: PsurRiskMinimisationAction[];
  overallOutcome: PsurOverallBenefitRiskOutcome | undefined;
  basis: string;
  /** The V4 template's separate "Specific safety/benefit–risk finding
   *  supporting the recommendation" field — the concrete finding the
   *  recommendation rests on, deliberately distinct from `basis` (the
   *  reasoning). Kept apart so a recommendation can never be justified by
   *  reasoning alone with no identified finding behind it. */
  supportingFinding?: string | undefined;
  /** When the NEXT periodic report is due — a reporting-cycle date. Never
   *  the deadline for answering this directive; the two were previously
   *  liable to be read as one. */
  nextPsurDueDate?: string | undefined;
  /** The date by which the MAH must respond to this assessment's requests.
   *  Distinct from nextPsurDueDate and rendered separately in the
   *  Compliance Directive. */
  mahResponseDeadline?: string | undefined;
  /** What the MAH must supply, in the assessor's words — the substance of
   *  the follow-up, as opposed to its date. */
  followUpRequired?: string | undefined;
  decidedBy: string;
  decidedAt: string;
}

/** Section 13 — pure assessor input, never AI-generated. */
export interface PsurSignOff {
  conclusion: string;
  reviewerConfidence: "HIGH" | "MEDIUM" | "LOW" | undefined;
  references: string;
  evaluatorName?: string | undefined;
  evaluatorSignedAt?: string | undefined;
  peerReviewerName?: string | undefined;
  peerReviewedAt?: string | undefined;
}

/** A pointer to WHERE an assessor can go look for evidence a finding says
 *  is missing/weak — never a specific document title, URL, or citation
 *  (that would be an invented authoritative fact in a regulatory tool).
 *  Every category is one the NAFDAC PSUR/PBRER assessor template itself
 *  already names as a place to check (VigiFlow, the MAH, literature
 *  review, RSI/SmPC, other regulators' actions, patient/HCP feedback,
 *  RMP/PASS) — never invented. `note` is general guidance ("search for
 *  X-type studies", "ask the MAH for Y"), not a fabricated source name. */
export interface PsurSuggestedSource {
  type:
    | "VIGIFLOW_NIGERIA"
    | "REQUEST_FROM_MAH"
    | "PUBLISHED_LITERATURE"
    | "REFERENCE_SAFETY_INFORMATION"
    | "WORLDWIDE_REGULATORY_ACTIONS"
    | "PATIENT_HCP_FEEDBACK"
    | "RISK_MANAGEMENT_PLAN"
    | "OTHER";
  note: string;
}

export interface PsurFinding {
  id: string;
  category: "MISSING_SECTION" | "CONSISTENCY" | "NUMERICAL" | "SIGNAL" | "BENEFIT_RISK";
  severity: "HIGH" | "MEDIUM" | "LOW";
  section: string;
  description: string;
  evidence: string;
  /** Only ever populated for MISSING_SECTION / SIGNAL / BENEFIT_RISK —
   *  see PsurSuggestedSource. CONSISTENCY/NUMERICAL findings are about an
   *  internal contradiction to resolve, not missing external evidence, so
   *  they never carry one. */
  suggestedSource?: PsurSuggestedSource | undefined;
  /** Which of the 14 NAFDAC V4 template sections this finding belongs to
   *  — see PsurV4SectionId. Undefined when the model/rule engine couldn't
   *  confidently place it; never forced. */
  v4Section?: PsurV4SectionId | undefined;
  /** A richer, OPTIONAL classification layered on top of `category` —
   *  see PsurDeficiencyType. Never forced onto a finding the evidence
   *  doesn't clearly support. */
  deficiencyType?: PsurDeficiencyType | undefined;
  assistGenerated: boolean;
  humanAssessment?: "ACCEPTED" | "DISMISSED" | null | undefined;
  /** Which engine produced this finding. Absent on findings generated
   *  before this distinction existed — treated as "rule". */
  source?: "ai" | "rule" | undefined;
  respondedBy?: string | undefined;
  respondedAt?: string | undefined;
  rationale?: string | undefined;
  /** Set once "Run Full Fix" has proposed a resolution for this finding. */
  resolution?: string | undefined;
  resolved?: boolean | undefined;
  /** The assessor's own decision on WHO must act on this finding,
   *  overriding the deterministic derivation in
   *  services/psur/finding-ownership.ts. The derivation is a defensible
   *  default, not a judgement the tool is entitled to make on the
   *  assessor's behalf: a reviewer may know, for instance, that a
   *  particular "incomplete information" gap is one they can close from
   *  VigiFlow without troubling the MAH, or conversely that a data
   *  discrepancy really does need the MAH to answer for it. Structurally
   *  separate from the derived value (never written back over it) and
   *  always attributed, so the exported documents can show that a human
   *  — not the rule — made this call. Same shape and intent as
   *  PsurScreeningResult.humanOverride. */
  actionOwnerOverride?:
    | {
        owner: "MAH" | "ASSESSOR";
        by: string;
        at: string;
        rationale: string;
      }
    | undefined;
}

export interface Signal {
  id: string;
  reference: string;
  product: string;
  reaction: string;
  detectionMethod: string;
  detectionPeriod: string;
  caseCount: number;
  statistic: { name: string; value: string; ci?: string | undefined }[];
  supportingCaseIds: string[];
  status: "POTENTIAL" | "UNDER_REVIEW" | "CONFIRMED" | "REFUTED";
  reviewer?: string | null | undefined;
  rationale?: string | null | undefined;
  decidedAt?: string | null | undefined;
  /** Present when this signal was raised from local literature screening
   *  (the weekly NAFDAC GVP surveillance duty) rather than from case-data
   *  disproportionality — the flagged article's provenance, so triage can
   *  happen without hunting down the original publication. */
  literature?:
    | {
        articleId: string;
        publication: string;
        headline: string;
        publicationDate: string;
        author: string;
        keywords: string[];
        contextSnippet: string;
        riskLevel: "HIGH" | "MODERATE" | "LOW";
      }
    | undefined;
}

export interface Notification {
  id: string;
  type:
    | "CASE_ASSIGNED"
    | "SERIOUSNESS_MISMATCH"
    | "FOLLOW_UP_DUE"
    | "CASE_OVERDUE"
    | "CODING_REQUIRED"
    | "MANAGER_REVIEW"
    | "SIGNAL_REVIEW"
    | "PSUR_COMPLETE"
    | "LINELIST_FAILED";
  title: string;
  body: string;
  at: string;
  read: boolean;
  link?: string | undefined;
}
