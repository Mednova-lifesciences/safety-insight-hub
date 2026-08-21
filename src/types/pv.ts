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
}

export interface ConcomitantMedicine {
  name: string;
  dose?: string | undefined;
  indication?: string | undefined;
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
  matchType: "EXACT" | "SYNONYM" | "FUZZY" | "LLM_RANKED_CANDIDATE";
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
}

export type LineListSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

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
   *  demo-seeded issues predating this distinction. */
  source?: "ai" | "rule";
  /** LOW means the finding depended on inferring an unfamiliar column's
   *  role or a judgment call rather than an exact rule — auto-fix skips
   *  these and leaves them for a human to decide either way. Rule-engine
   *  findings are always HIGH by construction. Absent on issues persisted
   *  before this distinction existed. */
  confidence?: "HIGH" | "LOW";
}

export interface PsurDocument {
  id: string;
  filename: string;
  product: string;
  reportingPeriod: string;
  uploadedAt: string;
  uploadedBy: string;
  stage: "UPLOADED" | "EXTRACTED" | "REVIEWED" | "FAILED";
  pages: number;
  /** PDF narrative report vs. a spreadsheet annex (e.g. a cumulative
   *  summary tabulation). Defaults to PDF for documents uploaded before
   *  this field existed. */
  sourceType?: "PDF" | "SPREADSHEET";
}

export interface PsurFinding {
  id: string;
  category: "MISSING_SECTION" | "CONSISTENCY" | "NUMERICAL" | "SIGNAL" | "BENEFIT_RISK";
  severity: "HIGH" | "MEDIUM" | "LOW";
  section: string;
  description: string;
  evidence: string;
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
