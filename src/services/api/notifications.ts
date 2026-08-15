import { apiRequest } from "./client";
import type { Notification } from "@/types/pv";

export const notifications = {
  list: () => apiRequest<Notification[]>("/api/notifications"),
  markRead: (id: string) =>
    apiRequest<Notification>(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
    }),
};
