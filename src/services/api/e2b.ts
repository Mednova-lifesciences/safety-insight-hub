import { API_BASE_URL, apiRequest } from "./client";

export interface E2bReadiness {
  jobId: string;
  caseCount: number;
  validCases: number;
  invalidCases: number;
  warnings: number;
  readyForExport: boolean;
  blockingIssues: string[];
  schema: string;
}

export interface E2bArtifact {
  jobId: string;
  artifactId: string;
  filename: string;
  generatedAt: string;
  caseCount: number;
  /** Prepared file only. Regulatory transmission requires a separate,
   *  validated gateway integration that this product does not perform. */
  transmitted: false;
}

export const e2b = {
  readiness: (jobId: string) =>
    apiRequest<E2bReadiness>(`/api/e2b/readiness/${encodeURIComponent(jobId)}`),
  generate: (jobId: string) =>
    apiRequest<E2bArtifact>(`/api/e2b/generate/${encodeURIComponent(jobId)}`, {
      method: "POST",
    }),
  downloadUrl: (artifactId: string) =>
    `${API_BASE_URL}/api/e2b/download/${encodeURIComponent(artifactId)}`,
};
