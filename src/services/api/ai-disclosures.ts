import { supabase } from "@/integrations/supabase/client";

/** One row of the AI data log (pv_ai_disclosures) — written by the backend
 *  after de-identifying a request; field names and counts only. */
export interface AiDisclosure {
  id: string;
  at: string;
  endpoint?: string | undefined;
  role?: string | undefined;
  model: string;
  kind: "text" | "image";
  /** Token kind → how many distinct values were replaced. */
  replaced: Record<string, number>;
  /** Field (or text pattern) → how many cells were replaced. */
  fields: Record<string, number>;
  total: number;
}

export const aiDisclosures = {
  /** The organisation's most recent entries. Row-level security limits
   *  this to administrators of the caller's own organisation. */
  list: async (limit = 200): Promise<AiDisclosure[]> => {
    const { data, error } = await supabase
      .from("pv_ai_disclosures" as never)
      .select("id,created_at,data")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (
      (data ?? []) as unknown as { id: string; created_at: string; data: Partial<AiDisclosure> }[]
    ).map((r) => ({
      id: r.id,
      at: r.data.at ?? r.created_at,
      endpoint: r.data.endpoint,
      role: r.data.role,
      model: r.data.model ?? "",
      kind: r.data.kind === "image" ? "image" : "text",
      replaced: r.data.replaced ?? {},
      fields: r.data.fields ?? {},
      total: r.data.total ?? 0,
    }));
  },
};
