import { apiRequest } from "./client";
import type { SeriousnessAssessment } from "@/types/pv";

/** Wraps pv_assist.seriousness. The engine is assistive only: the official
 *  case value is never changed by an analysis result. */
export const seriousness = {
  analyzeCase: (caseId: string) =>
    apiRequest<SeriousnessAssessment>(
      `/api/seriousness/analyze/${encodeURIComponent(caseId)}`,
      { method: "POST" },
    ),
  get: (caseId: string) =>
    apiRequest<SeriousnessAssessment>(`/api/seriousness/${encodeURIComponent(caseId)}`),
  recordDecision: (
    caseId: string,
    decision: "ACCEPT_REPORTED" | "MARK_SERIOUS" | "REQUEST_INFO",
    rationale: string,
  ) =>
    apiRequest<SeriousnessAssessment>(
      `/api/seriousness/${encodeURIComponent(caseId)}/decision`,
      { method: "POST", body: { decision, rationale } },
    ),
};
