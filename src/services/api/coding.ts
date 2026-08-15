import { apiRequest } from "./client";
import type { CodingHistoryEntry, CodingSuggestion } from "@/types/pv";

/** Wraps pv_assist.coding. Candidate terms and codes always originate from the
 *  dictionary services behind the API — the client never generates codes. */
export const coding = {
  getSuggestions: (caseId: string) =>
    apiRequest<CodingSuggestion[]>(`/api/coding/suggest/${encodeURIComponent(caseId)}`),
  searchDictionary: (dictionary: "MedDRA" | "WHODrug", query: string) =>
    apiRequest<CodingSuggestion[]>("/api/coding/dictionary/search", {
      query: { dictionary, q: query },
    }),
  accept: (caseId: string, suggestionId: string, rationale?: string) =>
    apiRequest<CodingSuggestion>(`/api/coding/${encodeURIComponent(caseId)}/accept`, {
      method: "POST",
      body: { suggestionId, rationale },
    }),
  reject: (caseId: string, suggestionId: string, rationale: string) =>
    apiRequest<CodingSuggestion>(`/api/coding/${encodeURIComponent(caseId)}/reject`, {
      method: "POST",
      body: { suggestionId, rationale },
    }),
  history: (caseId: string) =>
    apiRequest<CodingHistoryEntry[]>(`/api/coding/${encodeURIComponent(caseId)}/history`),
};
