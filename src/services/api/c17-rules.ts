import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { DEFAULT_C17_RULE, type C17Rule } from "@/services/e2b-r3/c17-rule";

/**
 * The organization's C.1.7 rule and its history (pv_e2b_c17_rules).
 *
 * Reading is open to everyone in the organization — people are entitled to
 * see the rule their cases are judged by. Writing goes through
 * save_e2b_c17_rule, which only the qualified assessor roles may call and
 * which keeps every previous version. The UI additionally asks for the
 * assessor's password before calling it, so a rule change is a deliberate,
 * attributable act.
 */

export interface C17RuleVersionRecord {
  id: string;
  rule: C17Rule;
  status: "ACTIVE" | "SUPERSEDED";
  changedBy: string;
  changedByRole: string;
  note?: string | undefined;
  createdAt: string;
  supersedesId?: string | undefined;
}

interface RuleRow {
  id: string;
  rule: unknown;
  status: string;
  changed_by: string;
  changed_by_role: string;
  note: string | null;
  created_at: string;
  supersedes_id: string | null;
}

const COLUMNS = "id,rule,status,changed_by,changed_by_role,note,created_at,supersedes_id";

function fromRow(row: RuleRow): C17RuleVersionRecord {
  return {
    id: row.id,
    rule: row.rule as C17Rule,
    status: row.status as C17RuleVersionRecord["status"],
    changedBy: row.changed_by,
    changedByRole: row.changed_by_role,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    supersedesId: row.supersedes_id ?? undefined,
  };
}

export const c17Rules = {
  /** The rule in force. Falls back to the agreed default until an
   *  organization saves its own, so assessment never runs ruleless. */
  active: async (): Promise<{ rule: C17Rule; record?: C17RuleVersionRecord }> => {
    const { data, error } = await supabase
      .from("pv_e2b_c17_rules")
      .select(COLUMNS)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { rule: DEFAULT_C17_RULE };
    const record = fromRow(data as RuleRow);
    return { rule: record.rule, record };
  },

  /** Every version, newest first — what the rule said when each decision
   *  was taken. */
  history: async (limit = 20): Promise<C17RuleVersionRecord[]> => {
    const { data, error } = await supabase
      .from("pv_e2b_c17_rules")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return ((data ?? []) as RuleRow[]).map(fromRow);
  },

  /** Saves a new version and makes it the one in force. The server checks
   *  the caller's role; call this only after confirming their password. */
  save: async (rule: C17Rule, note?: string): Promise<C17RuleVersionRecord> => {
    const { data, error } = await supabase.rpc("save_e2b_c17_rule", {
      p_rule: rule as unknown as Json,
      p_note: note ?? null,
    });
    if (error) throw new Error(error.message);
    const saved = data as unknown as {
      id: string;
      status: string;
      rule: C17Rule;
      changedBy: string;
      changedByRole: string;
      createdAt: string;
      supersedesId: string | null;
    };
    return {
      id: saved.id,
      rule: saved.rule,
      status: saved.status as C17RuleVersionRecord["status"],
      changedBy: saved.changedBy,
      changedByRole: saved.changedByRole,
      createdAt: saved.createdAt,
      supersedesId: saved.supersedesId ?? undefined,
      ...(note ? { note } : {}),
    };
  },
};
