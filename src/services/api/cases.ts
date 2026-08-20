import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, pushNotification, recordAudit, stepStates, toJson } from "./db";
import { linelist, type ParsedRow } from "./linelist";
import type {
  CaseDetail,
  CaseSummary,
  FollowUpRequest,
  LineListJob,
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

export const cases = {
  list: async (filters: CaseFilters = {}): Promise<CaseSummary[]> => {
    const rows = await allCases();
    const q = filters.q?.toLowerCase().trim();
    return rows.filter((c) => {
      if (
        q &&
        !`${c.id} ${c.product} ${c.reaction} ${c.patientIdentifier}`.toLowerCase().includes(q)
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
    const { count } = await supabase.from("pv_cases").select("id", { count: "exact", head: true });
    const caseId = `MN-${new Date().getFullYear()}-${String(900000 + (count ?? 0) + 1).slice(0, 6)}`;
    const seriousness = (payload.reportedSeriousness as Seriousness) ?? "UNASSESSED";
    const product = str(payload.product["reportedName"], "Unspecified product");
    const reaction = str(payload.reaction["reportedTerm"], "Unspecified reaction");

    const detail: CaseDetail = {
      id: caseId,
      patientIdentifier: str(payload.patient["identifier"], "Unknown"),
      product,
      reaction,
      seriousness,
      outcome: (str(payload.reaction["outcome"], "UNKNOWN") as CaseDetail["outcome"]) ?? "UNKNOWN",
      workflowStep: "INTAKE",
      assignedTo: actor.name,
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
        },
      ],
      reactions: [
        {
          reportedTerm: reaction,
          onsetDate: str(payload.reaction["onsetDate"]),
          outcome:
            (str(payload.reaction["outcome"], "UNKNOWN") as CaseDetail["outcome"]) ?? "UNKNOWN",
          codedTerm: null,
        },
      ],
      narrative: payload.narrative,
      reportedSeriousnessCriteria: payload.seriousnessCriteria,
      followUpRequests: [],
      workflowState: stepStates("INTAKE"),
    };

    const { error } = await supabase.from("pv_cases").insert({ id: caseId, data: toJson(detail) });
    if (error) throw new Error(error.message);

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
};
