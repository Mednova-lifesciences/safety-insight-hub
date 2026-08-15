import { apiRequest, apiUpload } from "./client";
import type { LineListIssue, LineListJob } from "@/types/pv";

export interface ColumnInspection {
  jobId: string;
  detectedColumns: { name: string; sample: string[]; suggestedField: string | null }[];
  targetFields: string[];
}

/** Wraps pv_assist.linelist. */
export const linelist = {
  jobs: () => apiRequest<LineListJob[]>("/api/linelist/jobs"),
  upload: (file: File) => apiUpload<LineListJob>("/api/linelist/upload", file),
  inspect: (jobId: string) =>
    apiRequest<ColumnInspection>(`/api/linelist/${encodeURIComponent(jobId)}/inspect`),
  map: (jobId: string, mapping: Record<string, string>) =>
    apiRequest<LineListJob>(`/api/linelist/${encodeURIComponent(jobId)}/map`, {
      method: "POST",
      body: { mapping },
    }),
  normalize: (jobId: string) =>
    apiRequest<LineListJob>(`/api/linelist/${encodeURIComponent(jobId)}/normalize`, {
      method: "POST",
    }),
  validate: (jobId: string) =>
    apiRequest<{ job: LineListJob; issues: LineListIssue[] }>(
      `/api/linelist/validate/${encodeURIComponent(jobId)}`,
      { method: "POST" },
    ),
  issues: (jobId: string) =>
    apiRequest<LineListIssue[]>(`/api/linelist/${encodeURIComponent(jobId)}/issues`),
};
