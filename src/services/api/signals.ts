import { apiRequest } from "./client";
import type { Signal } from "@/types/pv";

export const signals = {
  list: (status?: string) =>
    apiRequest<Signal[]>("/api/signals", { query: status ? { status } : {} }),
  get: (signalId: string) => apiRequest<Signal>(`/api/signals/${encodeURIComponent(signalId)}`),
  startReview: (signalId: string) =>
    apiRequest<Signal>(`/api/signals/${encodeURIComponent(signalId)}/review`, {
      method: "POST",
    }),
  decide: (signalId: string, decision: "CONFIRMED" | "REFUTED", rationale: string) =>
    apiRequest<Signal>(`/api/signals/${encodeURIComponent(signalId)}/decision`, {
      method: "POST",
      body: { decision, rationale },
    }),
};
