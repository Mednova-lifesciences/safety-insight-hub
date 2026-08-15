import { apiRequest, apiUpload } from "./client";
import type { PsurDocument, PsurFinding } from "@/types/pv";

/** Wraps pv_assist.psur. Findings are review assistance only — the regulatory
 *  assessment is always recorded by a human reviewer. */
export const psur = {
  documents: () => apiRequest<PsurDocument[]>("/api/psur/documents"),
  upload: (file: File) => apiUpload<PsurDocument>("/api/psur/upload", file),
  extract: (documentId: string) =>
    apiRequest<PsurDocument & { sections: { name: string; present: boolean; page?: number }[] }>(
      `/api/psur/${encodeURIComponent(documentId)}/extract`,
      { method: "POST" },
    ),
  review: (documentId: string) =>
    apiRequest<{ document: PsurDocument; findings: PsurFinding[] }>(
      `/api/psur/review/${encodeURIComponent(documentId)}`,
      { method: "POST" },
    ),
  recordAssessment: (
    documentId: string,
    findingId: string,
    assessment: "ACCEPTED" | "DISMISSED",
    rationale: string,
  ) =>
    apiRequest<PsurFinding>(`/api/psur/${encodeURIComponent(documentId)}/assessment`, {
      method: "POST",
      body: { findingId, assessment, rationale },
    }),
};
