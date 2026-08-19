import { supabase } from "@/integrations/supabase/client";
import { toJson } from "./db";
import type { Notification } from "@/types/pv";

export const notifications = {
  list: async (): Promise<Notification[]> => {
    const { data, error } = await supabase
      .from("pv_notifications")
      .select("data")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r) => r.data as unknown as Notification)
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
