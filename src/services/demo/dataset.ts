/**
 * Seeded demonstration dataset.
 *
 * Used ONLY when the FastAPI backend is not connected, so the interface can be
 * evaluated end-to-end. It is never mixed with live responses: the data-source
 * banner and the `source` field on every query make the provenance explicit.
 * No value here is a real patient record, a real MedDRA/WHODrug code
 * assignment, or an actual engine output.
 */
import type {
  AuditEvent,
  CaseDetail,
  CaseSummary,
  CodingHistoryEntry,
  CodingSuggestion,
  FollowUpRequest,
  IntakeConversation,
  IntakeConversationDetail,
  LineListIssue,
  LineListJob,
  Notification,
  PsurDocument,
  PsurFinding,
  SeriousnessAssessment,
  Signal,
  WorkflowStep,
  WorkflowStepState,
} from "@/types/pv";

const stepState = (
  current: WorkflowStep,
  overrides: Partial<Record<WorkflowStep, WorkflowStepState>> = {},
) => {
  const order: WorkflowStep[] = [
    "INTAKE",
    "TRIAGE",
    "CODING",
    "REVIEW",
    "QC",
    "REGULATORY_READY",
    "CLOSED",
  ];
  const idx = order.indexOf(current);
  const out = {} as Record<WorkflowStep, WorkflowStepState>;
  order.forEach((s, i) => {
    out[s] = i < idx ? "COMPLETED" : i === idx ? "CURRENT" : "PENDING";
  });
  return { ...out, ...overrides };
};

export const demoProducts: import("@/services/api/products").CatalogDrug[] = [
  { id: "drug-demo-1", name: "Amoxicillin", activeIngredient: "Amoxicillin", strength: "500mg", route: "Oral" },
  { id: "drug-demo-2", name: "Artemether/Lumefantrine", activeIngredient: "Artemether, Lumefantrine", strength: "20/120mg", route: "Oral" },
  { id: "drug-demo-3", name: "Oxytocin Injection", activeIngredient: "Oxytocin", strength: "10IU/mL", route: "Intramuscular" },
];

export const demoCases: CaseSummary[] = [
  {
    id: "MN-2026-000841",
    patientIdentifier: "PT-4471",
    product: "Amlodipine besilate 10 mg",
    reaction: "Peripheral oedema",
    seriousness: "NON_SERIOUS",
    outcome: "RECOVERING",
    workflowStep: "TRIAGE",
    assignedTo: "A. Okafor",
    receivedDate: "2026-08-12",
    dueDate: "2026-08-26",
    priority: "MEDIUM",
    flags: ["SERIOUSNESS_MISMATCH"],
    source: "WHATSAPP",
  },
  {
    id: "MN-2026-000838",
    patientIdentifier: "PT-4468",
    product: "Metformin HCl 850 mg",
    reaction: "Lactic acidosis",
    seriousness: "SERIOUS",
    outcome: "NOT_RECOVERED",
    workflowStep: "CODING",
    assignedTo: "A. Okafor",
    receivedDate: "2026-08-11",
    dueDate: "2026-08-18",
    priority: "HIGH",
    flags: ["EXPEDITED"],
    source: "MANUAL",
  },
  {
    id: "MN-2026-000835",
    patientIdentifier: "PT-4460",
    product: "Rivaroxaban 20 mg",
    reaction: "Gastrointestinal haemorrhage",
    seriousness: "SERIOUS",
    outcome: "RECOVERED",
    workflowStep: "REVIEW",
    assignedTo: "L. Mensah",
    receivedDate: "2026-08-09",
    dueDate: "2026-08-16",
    priority: "HIGH",
    flags: [],
    source: "EMAIL",
  },
  {
    id: "MN-2026-000829",
    patientIdentifier: "PT-4451",
    product: "Sertraline 50 mg",
    reaction: "Insomnia",
    seriousness: "NON_SERIOUS",
    outcome: "RECOVERED",
    workflowStep: "QC",
    assignedTo: "A. Okafor",
    receivedDate: "2026-08-05",
    dueDate: "2026-08-19",
    priority: "LOW",
    flags: [],
    source: "LINELIST",
  },
  {
    id: "MN-2026-000822",
    patientIdentifier: "PT-4433",
    product: "Ceftriaxone 1 g",
    reaction: "Anaphylactic reaction",
    seriousness: "SERIOUS",
    outcome: "RECOVERED_WITH_SEQUELAE",
    workflowStep: "REGULATORY_READY",
    assignedTo: "L. Mensah",
    receivedDate: "2026-07-30",
    dueDate: "2026-08-06",
    priority: "HIGH",
    flags: ["OVERDUE"],
    source: "MANUAL",
  },
  {
    id: "MN-2026-000817",
    patientIdentifier: "PT-4419",
    product: "Isoniazid 300 mg",
    reaction: "Drug-induced liver injury",
    seriousness: "SERIOUS",
    outcome: "RECOVERING",
    workflowStep: "INTAKE",
    assignedTo: "Unassigned",
    receivedDate: "2026-08-14",
    dueDate: "2026-08-21",
    priority: "HIGH",
    flags: ["INCOMPLETE"],
    source: "WHATSAPP",
  },
  {
    id: "MN-2026-000812",
    patientIdentifier: "PT-4402",
    product: "Artemether/Lumefantrine",
    reaction: "Pruritus",
    seriousness: "NON_SERIOUS",
    outcome: "RECOVERED",
    workflowStep: "CLOSED",
    assignedTo: "A. Okafor",
    receivedDate: "2026-07-22",
    dueDate: "2026-08-05",
    priority: "LOW",
    flags: [],
    source: "LINELIST",
  },
];

export const demoCaseDetails: Record<string, CaseDetail> = Object.fromEntries(
  demoCases.map((c) => [
    c.id,
    {
      ...c,
      reporter: {
        name: c.source === "WHATSAPP" ? "Nurse F. Adeyemi" : "Dr. S. Bello",
        qualification: c.source === "WHATSAPP" ? "Nurse" : "Physician",
        country: "Nigeria",
        contact: "+234 ••• ••• 4412",
        consentToContact: true,
      },
      patient: {
        identifier: c.patientIdentifier,
        age: "57 years",
        sex: "FEMALE",
        weightKg: "68",
        medicalHistory: "Hypertension, type 2 diabetes mellitus",
      },
      suspectProducts: [
        {
          reportedName: c.product,
          activeIngredient: c.product.split(" ")[0],
          dose: "as reported",
          route: "Oral",
          indication: "As per prescriber",
          therapyStart: "2026-07-02",
          action: "Drug withdrawn",
        },
      ],
      reactions: [
        {
          reportedTerm: c.reaction,
          onsetDate: c.receivedDate,
          outcome: c.outcome,
          codedTerm:
            c.workflowStep === "CLOSED" || c.workflowStep === "REGULATORY_READY"
              ? {
                  term: c.reaction,
                  code: "—",
                  dictionary: "MedDRA",
                  dictionaryVersion: "provided by backend",
                  level: "PT",
                  acceptedBy: "L. Mensah",
                  acceptedAt: "2026-08-06T10:12:00Z",
                }
              : null,
        },
      ],
      narrative:
        c.id === "MN-2026-000841"
          ? "Patient commenced amlodipine 10 mg daily for hypertension. Ten days later she developed bilateral ankle swelling. She was admitted to hospital for observation overnight and discharged the following morning. Reporter classified the event as non-serious."
          : `Patient receiving ${c.product} developed ${c.reaction.toLowerCase()}. Treating clinician documented the event and the product was withdrawn. Further clinical detail awaited from the reporter.`,
      reportedSeriousnessCriteria: c.seriousness === "SERIOUS" ? ["Hospitalisation"] : [],
      followUpRequests: [],
      workflowState: stepState(
        c.workflowStep,
        c.flags.includes("SERIOUSNESS_MISMATCH") ? { TRIAGE: "ACTION_REQUIRED" } : {},
      ),
    } satisfies CaseDetail,
  ]),
);

export const demoSeriousness: Record<string, SeriousnessAssessment> = {
  "MN-2026-000841": {
    caseId: "MN-2026-000841",
    reportedSeriousness: "NON_SERIOUS",
    narrativeAssessment: "SERIOUS",
    mismatch: true,
    criteria: [
      {
        criterion: "Requires inpatient hospitalisation or prolongation of existing hospitalisation",
        detected: true,
        evidence: ["She was admitted to hospital for observation overnight"],
      },
      { criterion: "Results in death", detected: false, evidence: [] },
      { criterion: "Life-threatening", detected: false, evidence: [] },
      {
        criterion: "Persistent or significant disability/incapacity",
        detected: false,
        evidence: [],
      },
      { criterion: "Congenital anomaly/birth defect", detected: false, evidence: [] },
      { criterion: "Other medically important condition", detected: false, evidence: [] },
    ],
    rationale:
      "Narrative contains evidence consistent with hospitalisation, which meets an ICH E2A seriousness criterion. Reported classification is non-serious.",
    engineVersion: "pv_assist.seriousness (backend)",
    reviewState: "PENDING_REVIEW",
  },
};

export const demoCodingSuggestions: Record<string, CodingSuggestion[]> = {
  "MN-2026-000838": [
    {
      id: "cs-1",
      sourceText: "Metformin HCl 850 mg",
      kind: "DRUG",
      term: "METFORMIN HYDROCHLORIDE",
      code: "—",
      dictionary: "WHODrug",
      dictionaryVersion: "supplied by backend",
      matchType: "EXACT",
      confidence: 0.97,
      evidence: "Reported product name matched a preferred name in the dictionary lookup.",
      status: "PENDING",
    },
    {
      id: "cs-2",
      sourceText: "Lactic acidosis",
      kind: "REACTION",
      term: "Lactic acidosis",
      code: "—",
      dictionary: "MedDRA",
      dictionaryVersion: "supplied by backend",
      matchType: "EXACT",
      confidence: 0.99,
      evidence: "Verbatim term matched a Preferred Term in the dictionary lookup.",
      status: "PENDING",
    },
    {
      id: "cs-3",
      sourceText: "felt very weak and short of breath",
      kind: "REACTION",
      term: "Dyspnoea",
      code: "—",
      dictionary: "MedDRA",
      dictionaryVersion: "supplied by backend",
      matchType: "LLM_RANKED_CANDIDATE",
      confidence: 0.62,
      evidence:
        "Candidate list retrieved from the dictionary; ranking assisted by the language model. Requires human confirmation.",
      status: "PENDING",
    },
  ],
};

export const demoCodingHistory: CodingHistoryEntry[] = [
  {
    id: "ch-1",
    at: "2026-08-12T09:40:00Z",
    user: "A. Okafor",
    action: "Coding session opened",
    detail: "Candidates requested from dictionary service",
  },
];

export const demoFollowUps: FollowUpRequest[] = [
  {
    id: "fu-1",
    caseId: "MN-2026-000817",
    requestedInformation: "Patient age, concomitant medication, liver function test values",
    requestedBy: "A. Okafor",
    requestedAt: "2026-08-14T08:20:00Z",
    dueAt: "2026-08-17T08:20:00Z",
    status: "OVERDUE",
    channel: "WHATSAPP",
  },
  {
    id: "fu-2",
    caseId: "MN-2026-000841",
    requestedInformation: "Discharge summary confirming duration of hospitalisation",
    requestedBy: "A. Okafor",
    requestedAt: "2026-08-13T14:05:00Z",
    dueAt: "2026-08-18T14:05:00Z",
    status: "OPEN",
    channel: "WHATSAPP",
  },
  {
    id: "fu-3",
    caseId: "MN-2026-000835",
    requestedInformation: "Haemoglobin values at presentation",
    requestedBy: "L. Mensah",
    requestedAt: "2026-08-10T11:00:00Z",
    dueAt: "2026-08-15T11:00:00Z",
    status: "RESPONDED",
    channel: "EMAIL",
  },
];

export const demoConversations: IntakeConversation[] = [
  {
    id: "wa-1201",
    channel: "WHATSAPP",
    reporterName: "Nurse F. Adeyemi",
    reporterNumberMasked: "+234 ••• ••• 4412",
    lastMessage: "She was admitted overnight for observation, discharged this morning.",
    lastMessageAt: "2026-08-15T07:41:00Z",
    consent: "GRANTED",
    criteria: { reporter: true, patient: true, product: true, event: true },
    status: "NEW",
  },
  {
    id: "wa-1198",
    channel: "WHATSAPP",
    reporterName: "Mr. K. Danjuma",
    reporterNumberMasked: "+234 ••• ••• 9075",
    lastMessage: "The rash started after the injection but I don't know the drug name.",
    lastMessageAt: "2026-08-14T19:12:00Z",
    consent: "PENDING",
    criteria: { reporter: true, patient: true, product: false, event: true },
    status: "IN_REVIEW",
  },
  {
    id: "wa-1190",
    channel: "WHATSAPP",
    reporterName: "Pharm. C. Eze",
    reporterNumberMasked: "+234 ••• ••• 3320",
    lastMessage: "Converted to case MN-2026-000838.",
    lastMessageAt: "2026-08-11T10:02:00Z",
    consent: "GRANTED",
    criteria: { reporter: true, patient: true, product: true, event: true },
    status: "CONVERTED",
    linkedCaseId: "MN-2026-000838",
  },
];

export const demoConversationDetails: Record<string, IntakeConversationDetail> = {
  "wa-1201": {
    ...demoConversations[0]!,
    messages: [
      {
        id: "m1",
        direction: "INBOUND",
        at: "2026-08-15T07:10:00Z",
        body: "Good morning, I want to report a reaction for one of our patients.",
      },
      {
        id: "m2",
        direction: "OUTBOUND",
        at: "2026-08-15T07:12:00Z",
        body: "Thank you. Do you consent to us contacting you for follow-up on this report?",
      },
      { id: "m3", direction: "INBOUND", at: "2026-08-15T07:14:00Z", body: "Yes I consent." },
      {
        id: "m4",
        direction: "INBOUND",
        at: "2026-08-15T07:30:00Z",
        body: "57 year old woman on amlodipine 10mg for BP. Both ankles swollen since last week.",
      },
      {
        id: "m5",
        direction: "INBOUND",
        at: "2026-08-15T07:41:00Z",
        body: "She was admitted overnight for observation, discharged this morning.",
      },
    ],
    extracted: [
      { field: "Reporter", value: "Nurse F. Adeyemi (Nurse)", sourceMessageId: "m1" },
      { field: "Consent", value: "Granted", sourceMessageId: "m3" },
      { field: "Patient", value: "Female, 57 years", sourceMessageId: "m4" },
      { field: "Suspect product", value: "Amlodipine 10 mg", sourceMessageId: "m4" },
      { field: "Adverse event", value: "Bilateral ankle swelling", sourceMessageId: "m4" },
      { field: "Onset date", value: null },
      { field: "Outcome", value: null },
    ],
    missing: ["Onset date", "Outcome", "Concomitant medication"],
  },
  "wa-1198": {
    ...demoConversations[1]!,
    messages: [
      {
        id: "m1",
        direction: "INBOUND",
        at: "2026-08-14T18:50:00Z",
        body: "My son got an injection at the clinic and now he has a rash.",
      },
      {
        id: "m2",
        direction: "OUTBOUND",
        at: "2026-08-14T18:55:00Z",
        body: "Sorry to hear that. Do you know the name of the medicine given?",
      },
      {
        id: "m3",
        direction: "INBOUND",
        at: "2026-08-14T19:12:00Z",
        body: "The rash started after the injection but I don't know the drug name.",
      },
    ],
    extracted: [
      { field: "Reporter", value: "Mr. K. Danjuma (Consumer/parent)", sourceMessageId: "m1" },
      { field: "Patient", value: "Male child, age not stated", sourceMessageId: "m1" },
      { field: "Suspect product", value: null },
      { field: "Adverse event", value: "Rash", sourceMessageId: "m1" },
      { field: "Consent", value: null },
    ],
    missing: ["Suspect product", "Patient age", "Consent to contact"],
  },
};

export const demoLineListJobs: LineListJob[] = [
  {
    id: "ll-2026-014",
    filename: "site_linelist_july_2026.xlsx",
    uploadedAt: "2026-08-14T15:20:00Z",
    uploadedBy: "L. Mensah",
    rows: 412,
    stage: "VALIDATED",
    validCases: 388,
    invalidCases: 24,
    warnings: 61,
  },
  {
    id: "ll-2026-013",
    filename: "partner_export_q2.csv",
    uploadedAt: "2026-08-08T09:02:00Z",
    uploadedBy: "L. Mensah",
    rows: 1180,
    stage: "E2B_GENERATED",
    validCases: 1156,
    invalidCases: 24,
    warnings: 39,
  },
];

export const demoLineListIssues: LineListIssue[] = [
  {
    row: 17,
    column: "onset_date",
    severity: "ERROR",
    code: "E_DATE_FORMAT",
    message: "Invalid date — could not be parsed as a valid date",
    value: "31/02/2026",
  },
  {
    row: 23,
    column: "patient_id",
    severity: "ERROR",
    code: "E_MISSING_PATIENT",
    message: "Missing patient identifier",
    value: null,
  },
  {
    row: 58,
    column: "reaction",
    severity: "ERROR",
    code: "E_UNRECOGNISED_REACTION",
    message: "Unrecognised reaction term — no dictionary candidate returned",
    value: "feeling somehow",
  },
  {
    row: 74,
    column: "product",
    severity: "ERROR",
    code: "E_INVALID_PRODUCT",
    message: "Invalid product — not found in product dictionary",
    value: "ORS sachet??",
  },
  {
    row: 91,
    column: "sex",
    severity: "WARNING",
    code: "W_VALUE_NORMALISED",
    message: "Value normalised during processing",
    value: "f",
  },
  {
    row: 104,
    column: "dose",
    severity: "WARNING",
    code: "W_MISSING_OPTIONAL",
    message: "Missing recommended value",
    value: null,
  },
];

export const demoPsurDocuments: PsurDocument[] = [
  {
    id: "psur-2026-004",
    filename: "PBRER_amlodipine_2025-2026.pdf",
    product: "Amlodipine besilate",
    reportingPeriod: "01 Jul 2025 – 30 Jun 2026",
    uploadedAt: "2026-08-13T12:00:00Z",
    uploadedBy: "L. Mensah",
    stage: "EXTRACTED",
    pages: 148,
  },
];

export const demoPsurFindings: PsurFinding[] = [
  {
    id: "pf-1",
    category: "MISSING_SECTION",
    severity: "HIGH",
    section: "16.3 Characterisation of risks",
    description: "Expected PBRER section was not detected in the extracted document structure.",
    evidence: "No heading matching section 16.3 found between sections 16.2 and 16.4.",
    assistGenerated: true,
  },
  {
    id: "pf-2",
    category: "NUMERICAL",
    severity: "HIGH",
    section: "6.2 Cumulative summary tabulations",
    description:
      "Cumulative serious case count differs between the narrative text and the summary tabulation.",
    evidence: "Narrative states 412 cumulative serious cases; tabulation totals 407.",
    assistGenerated: true,
  },
  {
    id: "pf-3",
    category: "CONSISTENCY",
    severity: "MEDIUM",
    section: "5 Estimated exposure",
    description:
      "Reporting period stated in the cover page differs from the period used in the exposure calculation.",
    evidence: "Cover page: 01 Jul 2025 – 30 Jun 2026. Section 5: 01 Jan 2025 – 31 Dec 2025.",
    assistGenerated: true,
  },
  {
    id: "pf-4",
    category: "SIGNAL",
    severity: "MEDIUM",
    section: "15 Signal evaluation",
    description: "A signal listed as closed in this period has no documented evaluation outcome.",
    evidence: "Signal 'peripheral oedema' listed in table 15.1 with an empty outcome column.",
    assistGenerated: true,
  },
  {
    id: "pf-5",
    category: "BENEFIT_RISK",
    severity: "LOW",
    section: "18 Integrated benefit-risk analysis",
    description: "Benefit-risk conclusion does not reference the new risk described in section 16.",
    evidence: "Section 18 conclusion text does not mention hepatic events discussed earlier.",
    assistGenerated: true,
  },
];

export const demoSignals: Signal[] = [
  {
    id: "sig-1",
    reference: "SIG-2026-0031",
    product: "Amlodipine besilate",
    reaction: "Peripheral oedema",
    detectionMethod: "Disproportionality (PRR)",
    detectionPeriod: "Q2 2026",
    caseCount: 34,
    statistic: [
      { name: "PRR", value: "2.81", ci: "95% CI 1.92–4.11" },
      { name: "Chi-square", value: "18.4" },
    ],
    supportingCaseIds: ["MN-2026-000841", "MN-2026-000829"],
    status: "POTENTIAL",
  },
  {
    id: "sig-2",
    reference: "SIG-2026-0029",
    product: "Isoniazid",
    reaction: "Drug-induced liver injury",
    detectionMethod: "Disproportionality (EBGM)",
    detectionPeriod: "Q2 2026",
    caseCount: 12,
    statistic: [{ name: "EB05", value: "2.10" }],
    supportingCaseIds: ["MN-2026-000817"],
    status: "UNDER_REVIEW",
    reviewer: "Administrator",
  },
  {
    id: "sig-3",
    reference: "SIG-2026-0018",
    product: "Ceftriaxone",
    reaction: "Anaphylactic reaction",
    detectionMethod: "Case series review",
    detectionPeriod: "Q1 2026",
    caseCount: 7,
    statistic: [{ name: "PRR", value: "3.42", ci: "95% CI 2.01–5.80" }],
    supportingCaseIds: ["MN-2026-000822"],
    status: "CONFIRMED",
    reviewer: "Administrator",
    rationale:
      "Consistent case series with positive dechallenge in five of seven cases and biologically plausible mechanism. Label update requested.",
    decidedAt: "2026-07-18T09:00:00Z",
  },
  {
    id: "sig-4",
    reference: "SIG-2026-0011",
    product: "Sertraline",
    reaction: "Insomnia",
    detectionMethod: "Disproportionality (PRR)",
    detectionPeriod: "Q1 2026",
    caseCount: 21,
    statistic: [{ name: "PRR", value: "1.31" }],
    supportingCaseIds: ["MN-2026-000829"],
    status: "REFUTED",
    reviewer: "Administrator",
    rationale:
      "Event already listed in the reference safety information; no change in reporting pattern.",
    decidedAt: "2026-06-30T15:30:00Z",
  },
];

export const demoAudit: AuditEvent[] = [
  {
    id: "au-1",
    timestamp: "2026-08-15T07:45:00Z",
    user: "A. Okafor",
    role: "PV Field Associate",
    action: "SERIOUSNESS_ASSIST_RUN",
    entity: "Case",
    entityId: "MN-2026-000841",
    previousValue: null,
    newValue: "Potential mismatch flagged (assistive)",
    reason: "Triage review",
  },
  {
    id: "au-2",
    timestamp: "2026-08-14T16:02:00Z",
    user: "L. Mensah",
    role: "PV Coordinator",
    action: "LINELIST_VALIDATED",
    entity: "LineListJob",
    entityId: "ll-2026-014",
    previousValue: "NORMALISED",
    newValue: "VALIDATED",
  },
  {
    id: "au-3",
    timestamp: "2026-08-14T08:20:00Z",
    user: "A. Okafor",
    role: "PV Field Associate",
    action: "FOLLOW_UP_REQUESTED",
    entity: "Case",
    entityId: "MN-2026-000817",
    newValue: "Follow-up requested via WhatsApp",
    reason: "Incomplete minimum criteria",
  },
  {
    id: "au-4",
    timestamp: "2026-08-13T10:11:00Z",
    user: "L. Mensah",
    role: "PV Coordinator",
    action: "CODING_ACCEPTED",
    entity: "Case",
    entityId: "MN-2026-000835",
    previousValue: "Uncoded",
    newValue: "Coded reaction accepted",
    reason: "Exact dictionary match confirmed",
  },
  {
    id: "au-5",
    timestamp: "2026-07-18T09:00:00Z",
    user: "Administrator",
    role: "Administrator",
    action: "SIGNAL_CONFIRMED",
    entity: "Signal",
    entityId: "SIG-2026-0018",
    previousValue: "UNDER_REVIEW",
    newValue: "CONFIRMED",
    reason: "Consistent case series with positive dechallenge",
  },
  {
    id: "au-6",
    timestamp: "2026-07-15T13:22:00Z",
    user: "L. Mensah",
    role: "PV Coordinator",
    action: "E2B_GENERATED",
    entity: "LineListJob",
    entityId: "ll-2026-013",
    newValue: "1156 E2B(R3) case files prepared",
  },
];

export const demoNotifications: Notification[] = [
  {
    id: "n1",
    type: "SERIOUSNESS_MISMATCH",
    title: "Potential seriousness mismatch",
    body: "MN-2026-000841 — narrative evidence suggests hospitalisation.",
    at: "2026-08-15T07:45:00Z",
    read: false,
    link: "/cases/MN-2026-000841",
  },
  {
    id: "n2",
    type: "CASE_ASSIGNED",
    title: "New case assigned",
    body: "MN-2026-000817 assigned for intake completion.",
    at: "2026-08-14T09:00:00Z",
    read: false,
    link: "/cases/MN-2026-000817",
  },
  {
    id: "n3",
    type: "FOLLOW_UP_DUE",
    title: "Follow-up overdue",
    body: "Follow-up for MN-2026-000817 passed its due date.",
    at: "2026-08-17T08:20:00Z",
    read: false,
    link: "/follow-ups",
  },
  {
    id: "n4",
    type: "CODING_REQUIRED",
    title: "Coding required",
    body: "MN-2026-000838 is awaiting reaction and product coding.",
    at: "2026-08-12T09:40:00Z",
    read: true,
    link: "/cases/MN-2026-000838",
  },
  {
    id: "n5",
    type: "SIGNAL_REVIEW",
    title: "Signal requires review",
    body: "SIG-2026-0031 (Amlodipine / peripheral oedema) is pending administrator review.",
    at: "2026-08-11T10:00:00Z",
    read: true,
    link: "/signals",
  },
  {
    id: "n6",
    type: "LINELIST_FAILED",
    title: "Line-list validation errors",
    body: "24 of 412 rows failed validation in site_linelist_july_2026.xlsx.",
    at: "2026-08-14T15:40:00Z",
    read: true,
    link: "/line-list",
  },
];
