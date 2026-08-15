/** Domain types mirroring the payloads the FastAPI layer will return. */

export type WorkflowStep =
  | "INTAKE"
  | "TRIAGE"
  | "CODING"
  | "REVIEW"
  | "QC"
  | "REGULATORY_READY"
  | "CLOSED";

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
  | "RECOVERED"
  | "RECOVERING"
  | "NOT_RECOVERED"
  | "RECOVERED_WITH_SEQUELAE"
  | "FATAL"
  | "UNKNOWN";

export interface PatientInfo {
  identifier: string;
  age?: string;
  sex?: "MALE" | "FEMALE" | "UNKNOWN";
  weightKg?: string;
  medicalHistory?: string;
}

export interface ReporterInfo {
  name: string;
  qualification: string;
  country: string;
  contact?: string;
  consentToContact?: boolean;
}

export interface SuspectProduct {
  reportedName: string;
  activeIngredient?: string;
  dose?: string;
  route?: string;
  indication?: string;
  therapyStart?: string;
  therapyEnd?: string;
  action?: string;
}

export interface ReactionEvent {
  reportedTerm: string;
  onsetDate?: string;
  endDate?: string;
  outcome: CaseOutcome;
  codedTerm?: CodedTerm | null;
}

export interface CodedTerm {
  term: string;
  code: string;
  dictionary: "MedDRA" | "WHODrug";
  dictionaryVersion: string;
  level?: string;
  acceptedBy?: string;
  acceptedAt?: string;
}

export interface CaseSummary {
  id: string;
  patientIdentifier: string;
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
  reviewedBy?: string;
  reviewDecision?: "ACCEPT_REPORTED" | "MARK_SERIOUS" | "REQUEST_INFO";
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
  previousValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
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
  linkedCaseId?: string;
}

export interface IntakeMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  at: string;
  body: string;
}

export interface IntakeConversationDetail extends IntakeConversation {
  messages: IntakeMessage[];
  extracted: { field: string; value: string | null; sourceMessageId?: string }[];
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
}

export interface LineListIssue {
  row: number;
  column: string;
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
  value: string | null;
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
}

export interface PsurFinding {
  id: string;
  category:
    | "MISSING_SECTION"
    | "CONSISTENCY"
    | "NUMERICAL"
    | "SIGNAL"
    | "BENEFIT_RISK";
  severity: "HIGH" | "MEDIUM" | "LOW";
  section: string;
  description: string;
  evidence: string;
  assistGenerated: boolean;
  humanAssessment?: "ACCEPTED" | "DISMISSED" | null;
}

export interface Signal {
  id: string;
  reference: string;
  product: string;
  reaction: string;
  detectionMethod: string;
  detectionPeriod: string;
  caseCount: number;
  statistic: { name: string; value: string; ci?: string }[];
  supportingCaseIds: string[];
  status: "POTENTIAL" | "UNDER_REVIEW" | "CONFIRMED" | "REFUTED";
  reviewer?: string | null;
  rationale?: string | null;
  decidedAt?: string | null;
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
  link?: string;
}
