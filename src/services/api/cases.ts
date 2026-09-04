import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, pushNotification, recordAudit, stepStates, toJson } from "./db";
import { linelist, type ParsedRow } from "./linelist";
import type {
  CaseDetail,
  CaseSummary,
  CodedTerm,
  DynamicField,
  FollowUpRequest,
  LineListJob,
  RawExtractionRecord,
  Seriousness,
  WorkflowStep,
} from "@/types/pv";

export interface CaseFilters {
  q?: string;
  status?: string;
  seriousness?: string;
  assignee?: string;
  from?: string;
  to?: string;
}

export interface NewIcsrPayload {
  reporter: Record<string, unknown>;
  patient: Record<string, unknown>;
  product: Record<string, unknown>;
  reaction: Record<string, unknown>;
  narrative: string;
  reportedSeriousness: string;
  seriousnessCriteria: string[];
  additionalInformation?: string;
  /** Extra suspect drugs beyond the primary `product` above, from the
   *  repeatable drug-row editor. Absent/empty behaves exactly as before
   *  this field existed — `product` alone still becomes suspectProducts[0]. */
  additionalProducts?: Record<string, unknown>[];
  concomitantMedicines?: Record<string, unknown>[];
  /** Case-specific information detected on the source document that
   *  doesn't map to any canonical field — see DynamicField's own doc
   *  comment in types/pv.ts. Absent/empty behaves exactly as before this
   *  field existed. */
  dynamicFields?: Array<{
    id?: string;
    label: string;
    value?: string;
    originalLabel?: string;
    confidence?: number;
    source?: "ai_extraction" | "user_added";
    status?: "detected" | "confirmed" | "edited";
  }>;
  rawExtraction?: RawExtractionRecord;
}

const str = (v: unknown, fallback = "") =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;

async function allCases(): Promise<CaseDetail[]> {
  const { data, error } = await supabase
    .from("pv_cases")
    .select("data")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.data as unknown as CaseDetail);
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pure mapping from the intake form's payload to a stored CaseDetail —
 *  shared by the authenticated `/icsr/new` flow and the unauthenticated
 *  public field-associate flow (`src/services/api/public-intake.ts`), so
 *  the two never drift apart on how a case gets built. */
export function buildCaseDetail(
  caseId: string,
  payload: NewIcsrPayload,
  assignedTo: string,
): CaseDetail {
  const seriousness = (payload.reportedSeriousness as Seriousness) ?? "UNASSESSED";
  const product = str(payload.product["reportedName"], "Unspecified product");
  const reaction = str(payload.reaction["reportedTerm"], "Unspecified reaction");

  return {
    id: caseId,
    patientIdentifier: str(payload.patient["identifier"], "Unknown"),
    product,
    reaction,
    seriousness,
    outcome: (str(payload.reaction["outcome"], "UNKNOWN") as CaseDetail["outcome"]) ?? "UNKNOWN",
    workflowStep: "INTAKE",
    assignedTo,
    receivedDate: new Date().toISOString().slice(0, 10),
    dueDate: addDays(seriousness === "SERIOUS" ? 7 : 14),
    priority: seriousness === "SERIOUS" ? "HIGH" : "MEDIUM",
    flags: seriousness === "SERIOUS" ? ["EXPEDITED"] : [],
    source: "MANUAL",
    reporter: {
      name: str(payload.reporter["name"], "Unknown reporter"),
      qualification: str(payload.reporter["qualification"], "Not stated"),
      country: str(payload.reporter["country"], "Not stated"),
      contact: str(payload.reporter["contact"]),
      consentToContact: true,
    },
    patient: {
      identifier: str(payload.patient["identifier"], "Unknown"),
      age: str(payload.patient["age"]),
      sex: (str(payload.patient["sex"], "UNKNOWN") as "MALE" | "FEMALE" | "UNKNOWN") ?? "UNKNOWN",
      weightKg: str(payload.patient["weightKg"]),
      medicalHistory: str(payload.patient["medicalHistory"]),
    },
    suspectProducts: [
      {
        reportedName: product,
        dose: str(payload.product["dose"]),
        route: str(payload.product["route"]),
        indication: str(payload.product["indication"]),
        therapyStart: str(payload.product["therapyStart"]),
        action: str(payload.product["action"]),
        batchNumber: str(payload.product["batchNumber"]),
        expiryDate: str(payload.product["expiryDate"]),
      },
      ...(payload.additionalProducts ?? [])
        .filter((p) => str(p["reportedName"]).length > 0)
        .map((p) => ({
          reportedName: str(p["reportedName"]),
          dose: str(p["dose"]),
          route: str(p["route"]),
          indication: str(p["indication"]),
          therapyStart: str(p["therapyStart"]),
          action: str(p["action"]),
          batchNumber: str(p["batchNumber"]),
          expiryDate: str(p["expiryDate"]),
        })),
    ],
    concomitantMedicines: (payload.concomitantMedicines ?? [])
      .filter((m) => str(m["name"]).length > 0)
      .map((m) => ({
        name: str(m["name"]),
        dose: str(m["dose"]),
        indication: str(m["indication"]),
      })),
    reactions: [
      {
        reportedTerm: reaction,
        onsetDate: str(payload.reaction["onsetDate"]),
        outcome: (str(payload.reaction["outcome"], "UNKNOWN") as CaseDetail["outcome"]) ?? "UNKNOWN",
        codedTerm: null,
      },
    ],
    narrative: payload.narrative,
    reportedSeriousnessCriteria: payload.seriousnessCriteria,
    dynamicFields: (payload.dynamicFields ?? [])
      .filter((f) => f.label.trim().length > 0)
      .map((f) => ({
        id: f.id ?? newId("dyn"),
        label: f.label.trim(),
        value: str(f.value),
        originalLabel: f.originalLabel ?? f.label.trim(),
        confidence: typeof f.confidence === "number" ? f.confidence : undefined,
        source: f.source ?? "ai_extraction",
        status: f.status ?? "detected",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    rawExtraction: payload.rawExtraction,
    followUpRequests: [],
    workflowState: stepStates("INTAKE"),
  };
}

export const cases = {
  list: async (filters: CaseFilters = {}): Promise<CaseSummary[]> => {
    const rows = await allCases();
    const q = filters.q?.toLowerCase().trim();
    const withDynamicSummary: CaseSummary[] = rows.map((c) => ({
      ...c,
      dynamicFieldsCount: c.dynamicFields?.length ?? 0,
      dynamicFieldsSearchText: (c.dynamicFields ?? [])
        .map((f) => `${f.label} ${f.value}`)
        .join(" ")
        .toLowerCase(),
    }));
    return withDynamicSummary.filter((c) => {
      if (
        q &&
        !`${c.id} ${c.product} ${c.reaction} ${c.patientIdentifier} ${c.dynamicFieldsSearchText ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      if (filters.status && filters.status !== "ALL" && c.workflowStep !== filters.status)
        return false;
      if (
        filters.seriousness &&
        filters.seriousness !== "ALL" &&
        c.seriousness !== filters.seriousness
      )
        return false;
      if (filters.assignee && filters.assignee !== "ALL" && c.assignedTo !== filters.assignee)
        return false;
      return true;
    });
  },

  get: async (caseId: string): Promise<CaseDetail> => {
    const { data, error } = await supabase
      .from("pv_cases")
      .select("data")
      .eq("id", caseId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Case ${caseId} was not found.`);
    const detail = data.data as unknown as CaseDetail;
    const { data: fus } = await supabase.from("pv_follow_ups").select("data").eq("case_id", caseId);
    return {
      ...detail,
      followUpRequests: (fus ?? []).map((r) => r.data as unknown as FollowUpRequest),
    };
  },

  create: async (
    payload: NewIcsrPayload,
  ): Promise<{ caseId: string; workflowStep: WorkflowStep }> => {
    const actor = currentActor();

    // `count` is RLS-scoped to the caller's own organization, but
    // `pv_cases.id` is a single global primary key — two different
    // organizations each creating their first case both compute count=0
    // and would otherwise generate the exact same id (MN-2026-900001),
    // colliding on insert (surfaced once real multi-org data existed).
    // Retrying with a random jitter on a 23505 unique-violation makes the
    // scheme collision-safe without changing the visible id format.
    let detail: CaseDetail | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { count } = await supabase.from("pv_cases").select("id", { count: "exact", head: true });
      const jitter = attempt === 0 ? 0 : Math.floor(Math.random() * 900) + 1;
      const caseId = `MN-${new Date().getFullYear()}-${String(900000 + (count ?? 0) + 1 + jitter).slice(0, 6)}`;
      const candidate = buildCaseDetail(caseId, payload, actor.name);
      const { error } = await supabase.from("pv_cases").insert({ id: caseId, data: toJson(candidate) });
      if (!error) {
        detail = candidate;
        break;
      }
      if (error.code !== "23505" || attempt === 4) throw new Error(error.message);
    }
    if (!detail) throw new Error("Could not allocate a unique case id.");
    const caseId = detail.id;
    const product = detail.product;
    const reaction = detail.reaction;

    await recordAudit({
      action: "CASE_CREATED",
      entity: "Case",
      entityId: caseId,
      newValue: `${product} / ${reaction}`,
      reason: "ICSR captured through the intake form",
    });
    await pushNotification({
      type: "CASE_ASSIGNED",
      title: `Case ${caseId} created`,
      body: `${product} — ${reaction}. Assigned to ${actor.name}.`,
      link: `/cases/${caseId}`,
    });

    return { caseId, workflowStep: "INTAKE" };
  },

  advanceWorkflow: async (
    caseId: string,
    step: WorkflowStep,
    reason: string,
  ): Promise<CaseDetail> => {
    const detail = await cases.get(caseId);
    const next: CaseDetail = {
      ...detail,
      workflowStep: step,
      workflowState: stepStates(step),
    };
    const { error } = await supabase
      .from("pv_cases")
      .update({ data: toJson(next), updated_at: new Date().toISOString() })
      .eq("id", caseId);
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "WORKFLOW_ADVANCED",
      entity: "Case",
      entityId: caseId,
      previousValue: detail.workflowStep,
      newValue: step,
      reason,
    });
    return next;
  },

  /**
   * Exports a set of cases (typically whatever the Case workbench's
   * filters currently show) as a line-list: creates a matching job in
   * Line-list processing so it shows up there ready to be
   * reviewed/validated, then triggers a browser CSV download. The job is
   * created *before* the download fires deliberately — if the browser
   * shows a native "save file" prompt, that can stall the page, and the
   * job record is the side effect that matters; the CSV is a convenience
   * copy of the same data. Onset date isn't on CaseSummary, so each
   * case's full detail is fetched to get the real value rather than
   * substituting receivedDate — with the case counts this app deals
   * with, that's a handful of parallel requests, not a real cost.
   */
  exportToLineList: async (rows: CaseSummary[]): Promise<LineListJob> => {
    if (rows.length === 0) throw new Error("No cases to export.");

    const details = await Promise.all(rows.map((r) => cases.get(r.id)));
    const parsedRows: ParsedRow[] = details.map((d) => ({
      case_id: d.id,
      patient_identifier: d.patientIdentifier,
      product: d.product,
      reaction: d.reaction,
      onset_date: d.reactions[0]?.onsetDate ?? "",
      seriousness: d.seriousness,
      outcome: d.outcome,
    }));

    const filename = `case-line-list-${new Date().toISOString().slice(0, 10)}.csv`;
    const job = await linelist.createFromCases(parsedRows, filename);

    const columns = [
      "Case ID",
      "Patient Identifier",
      "Product",
      "Reaction",
      "Onset Date",
      "Seriousness",
      "Outcome",
    ] as const;
    const escapeCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [
      columns.join(","),
      ...parsedRows.map((r) =>
        [
          r.case_id,
          r.patient_identifier,
          r.product,
          r.reaction,
          r.onset_date,
          r.seriousness,
          r.outcome,
        ]
          .map((v) => escapeCell(v ?? ""))
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }

    return job;
  },

  followUps: async (caseId?: string): Promise<FollowUpRequest[]> => {
    const query = supabase.from("pv_follow_ups").select("data");
    const { data, error } = caseId ? await query.eq("case_id", caseId) : await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.data as unknown as FollowUpRequest);
  },

  requestFollowUp: async (
    caseId: string,
    requestedInformation: string,
    channel: string,
  ): Promise<FollowUpRequest> => {
    const actor = currentActor();
    const due = new Date();
    due.setDate(due.getDate() + 7);
    const row: FollowUpRequest = {
      id: newId("fu"),
      caseId,
      requestedInformation,
      requestedBy: actor.name,
      requestedAt: new Date().toISOString(),
      dueAt: due.toISOString(),
      status: "OPEN",
      channel: (channel as FollowUpRequest["channel"]) ?? "EMAIL",
    };
    const { error } = await supabase
      .from("pv_follow_ups")
      .insert({ id: row.id, case_id: caseId, data: toJson(row) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "FOLLOW_UP_REQUESTED",
      entity: "Case",
      entityId: caseId,
      newValue: requestedInformation,
    });
    return row;
  },

  respondToFollowUp: async (requestId: string, note: string): Promise<FollowUpRequest> => {
    const { data, error } = await supabase
      .from("pv_follow_ups")
      .select("data")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Follow-up request not found");
    const current = data.data as unknown as FollowUpRequest;
    const actor = currentActor();
    const next: FollowUpRequest = {
      ...current,
      status: "RESPONDED",
      responseNote: note,
      respondedBy: actor.name,
      respondedAt: new Date().toISOString(),
    };
    const { error: updateError } = await supabase
      .from("pv_follow_ups")
      .update({ data: toJson(next) })
      .eq("id", requestId);
    if (updateError) throw new Error(updateError.message);
    await recordAudit({
      action: "FOLLOW_UP_RESPONDED",
      entity: "FollowUpRequest",
      entityId: requestId,
      previousValue: current.status,
      newValue: "RESPONDED",
      reason: note,
    });
    return next;
  },

  /**
   * Lets a field associate act on follow-up feedback: update the case's
   * own submitted details and send it back through the workflow from the
   * start, rather than leaving it stuck wherever it was (Triage/Coding)
   * with now-stale data. Only the fields a field associate would
   * realistically need to correct are covered here — coding and
   * seriousness stay on their own dedicated tabs/workflows.
   */
  updateAndResubmit: async (
    caseId: string,
    patch: {
      patient: Partial<
        Pick<CaseDetail["patient"], "identifier" | "age" | "sex" | "weightKg" | "medicalHistory">
      >;
      reporter: Partial<
        Pick<CaseDetail["reporter"], "name" | "qualification" | "country" | "contact">
      >;
      product: Partial<
        Pick<
          CaseDetail["suspectProducts"][number],
          "reportedName" | "dose" | "route" | "indication" | "therapyStart" | "action"
        >
      >;
      reaction: Partial<
        Pick<CaseDetail["reactions"][number], "reportedTerm" | "onsetDate" | "outcome">
      >;
      narrative: string;
    },
    reason: string,
  ): Promise<CaseDetail> => {
    const detail = await cases.get(caseId);
    const updatedProduct = {
      ...(detail.suspectProducts[0] ?? { reportedName: "" }),
      ...patch.product,
    };
    const updatedReaction = {
      ...(detail.reactions[0] ?? { reportedTerm: "", outcome: "UNKNOWN" as const }),
      ...patch.reaction,
    };
    const next: CaseDetail = {
      ...detail,
      patient: { ...detail.patient, ...patch.patient },
      reporter: { ...detail.reporter, ...patch.reporter },
      suspectProducts: [updatedProduct, ...detail.suspectProducts.slice(1)],
      reactions: [updatedReaction, ...detail.reactions.slice(1)],
      product: updatedProduct.reportedName,
      reaction: updatedReaction.reportedTerm,
      narrative: patch.narrative,
      workflowStep: "INTAKE",
      workflowState: stepStates("INTAKE"),
    };
    const { error } = await supabase
      .from("pv_cases")
      .update({ data: toJson(next), updated_at: new Date().toISOString() })
      .eq("id", caseId);
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "CASE_UPDATED_RESUBMITTED",
      entity: "Case",
      entityId: caseId,
      previousValue: detail.workflowStep,
      newValue: "INTAKE",
      reason,
    });
    return next;
  },

  /**
   * Writes an accepted coding decision onto the case itself — called by
   * coding.accept() so "accepted" actually means something beyond the
   * suggestion row's own status. Attaches to index 0 of reactions/
   * suspectProducts (the case's primary reaction/product), matching the
   * same primary-item simplification already used for
   * CaseSummary.product/reaction elsewhere in this file: a case's coding
   * workspace only ever generates/accepts suggestions against the
   * case-level verbatim text, not a specific one of several reactions or
   * products, so there is no more specific target to attach to yet.
   */
  applyCodedTerm: async (
    caseId: string,
    kind: "DRUG" | "REACTION",
    codedTerm: CodedTerm,
  ): Promise<CaseDetail> => {
    const detail = await cases.get(caseId);
    const next: CaseDetail =
      kind === "REACTION"
        ? {
            ...detail,
            reactions: detail.reactions.map((r, i) => (i === 0 ? { ...r, codedTerm } : r)),
          }
        : {
            ...detail,
            suspectProducts: detail.suspectProducts.map((p, i) =>
              i === 0 ? { ...p, codedTerm } : p,
            ),
          };
    const { error } = await supabase
      .from("pv_cases")
      .update({ data: toJson(next), updated_at: new Date().toISOString() })
      .eq("id", caseId);
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "CODED_TERM_ATTACHED",
      entity: "Case",
      entityId: caseId,
      newValue: `${codedTerm.dictionary} ${codedTerm.code} — ${codedTerm.term}`,
    });
    return next;
  },

  /**
   * Replaces a case's dynamic (non-canonical) field list wholesale — the
   * caller sends the full, already-edited array (added/edited/removed),
   * since editing happens client-side before one save. Deliberately
   * independent of updateAndResubmit/canEditThisCase: dynamic fields are
   * supplementary case metadata, not core clinical data, so they don't
   * require the stricter resubmit-to-Intake workflow reset that editing
   * patient/reporter/product/reaction does.
   */
  updateDynamicFields: async (
    caseId: string,
    dynamicFields: DynamicField[],
  ): Promise<CaseDetail> => {
    const detail = await cases.get(caseId);
    const next: CaseDetail = { ...detail, dynamicFields };
    const { error } = await supabase
      .from("pv_cases")
      .update({ data: toJson(next), updated_at: new Date().toISOString() })
      .eq("id", caseId);
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "CASE_DYNAMIC_FIELDS_UPDATED",
      entity: "Case",
      entityId: caseId,
      previousValue: `${detail.dynamicFields?.length ?? 0} field(s)`,
      newValue: `${dynamicFields.length} field(s)`,
    });
    return next;
  },
};
