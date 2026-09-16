import { supabase } from "@/integrations/supabase/client";
import { toJson } from "./db";
import type { Notification, Role } from "@/types/pv";

/**
 * Is this notification for the person reading it?
 *
 * A notification with no audience is for everyone — that is how all of them
 * behaved before the assessment handoffs needed narrower ones, and how the
 * case-handling notifications still behave. An audience narrows it.
 *
 * Exported so the same rule governs the list page and the unread badge; a
 * badge counting notifications the page will not show is worse than no
 * badge at all.
 */
export function isForRole(n: Notification, role: Role | null | undefined): boolean {
  if (!n.audience || n.audience.length === 0) return true;
  if (!role) return false;
  return n.audience.includes(role);
}

export const notifications = {
  list: async (role?: Role | null): Promise<Notification[]> => {
    const { data, error } = await supabase
      .from("pv_notifications")
      .select("data")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r) => r.data as unknown as Notification)
      .filter((n) => (role === undefined ? true : isForRole(n, role)))
      .sort((a, b) => b.at.localeCompare(a.at));
  },
  markRead: async (id: string): Promise<Notification> => {
    const { data, error } = await supabase
      .from("pv_notifications")
      .select("data")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Notification not found");
    const next = { ...(data.data as unknown as Notification), read: true };
    const { error: upErr } = await supabase
      .from("pv_notifications")
      .update({ data: toJson(next) })
      .eq("id", id);
    if (upErr) throw new Error(upErr.message);
    return next;
  },
};
