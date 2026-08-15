import { apiRequest } from "./client";
import type { IntakeConversation, IntakeConversationDetail } from "@/types/pv";

export const intake = {
  conversations: (status?: string) =>
    apiRequest<IntakeConversation[]>("/api/intake/conversations", {
      query: status ? { status } : {},
    }),
  conversation: (id: string) =>
    apiRequest<IntakeConversationDetail>(`/api/intake/conversations/${encodeURIComponent(id)}`),
  requestInformation: (id: string, fields: string[], message: string) =>
    apiRequest<IntakeConversationDetail>(
      `/api/intake/conversations/${encodeURIComponent(id)}/request-information`,
      { method: "POST", body: { fields, message } },
    ),
  convertToIcsr: (id: string) =>
    apiRequest<{ caseId: string }>(
      `/api/intake/conversations/${encodeURIComponent(id)}/convert`,
      { method: "POST" },
    ),
};
