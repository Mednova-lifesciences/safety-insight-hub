import { apiRequest } from "./client";
import type { CaseDetail, CaseSummary, FollowUpRequest, WorkflowStep } from "@/types/pv";

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

export const cases = {
  list: (filters: CaseFilters = {}) =>
    apiRequest<CaseSummary[]>("/api/cases", { query: filters as Record<string, string> }),
  get: (caseId: string) => apiRequest<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}`),
  create: (payload: NewIcsrPayload) =>
    apiRequest<{ caseId: string; workflowStep: WorkflowStep }>("/api/cases", {
      method: "POST",
      body: payload,
    }),
  advanceWorkflow: (caseId: string, step: WorkflowStep, reason: string) =>
    apiRequest<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}/workflow`, {
      method: "POST",
      body: { step, reason },
    }),
  followUps: (caseId?: string) =>
    apiRequest<FollowUpRequest[]>("/api/follow-ups", {
      query: caseId ? { case_id: caseId } : {},
    }),
  requestFollowUp: (caseId: string, requestedInformation: string, channel: string) =>
    apiRequest<FollowUpRequest>(`/api/follow-ups/${encodeURIComponent(caseId)}`, {
      method: "POST",
      body: { requestedInformation, channel },
    }),
};
