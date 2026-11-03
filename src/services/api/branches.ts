import { supabase } from "@/integrations/supabase/client";
import type { CaseSummary } from "@/types/pv";
import { newId, recordAudit, toJson } from "./db";
import { addDaysIso } from "./regulatory-clock";
import { cleanBranch } from "./intake-channel";

/**
 * The organisation's branch register (pv_branches). Reports are linked to a
 * branch by its NAME, which the branch's reporting link and QR code carry
 * (/r/<org>?branch=<name>), so renaming a branch means printing a new QR.
 */

export interface Branch {
  id: string;
  name: string;
  code?: string | undefined;
  area?: string | undefined;
  focalPerson?: string | undefined;
  focalPhone?: string | undefined;
  active: boolean;
}

export type BranchInput = Omit<Branch, "id">;

/** The register table has not been created on this database yet. */
export class BranchesNotSetUpError extends Error {
  constructor() {
    super("The branch register has not been set up on this database yet.");
  }
}

/** PostgREST / Postgres answers for a missing table. */
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /could not find the table|does not exist/i.test(error.message ?? "")
  );
}

function fromRow(row: { id: string; data: unknown }): Branch {
  const d = row.data as Partial<Branch>;
  return { ...d, id: row.id, name: d.name ?? "", active: d.active !== false };
}

export const branches = {
  list: async (): Promise<Branch[]> => {
    const { data, error } = await supabase.from("pv_branches").select("id,data");
    if (isMissingTable(error)) throw new BranchesNotSetUpError();
    if (error) throw new Error(error.message);
    return (data ?? []).map(fromRow).sort((a, b) => a.name.localeCompare(b.name));
  },

  create: async (input: BranchInput): Promise<Branch> => {
    const branch: Branch = { ...input, id: newId("br") };
    const { id: _id, ...data } = branch;
    const { error } = await supabase
      .from("pv_branches")
      .insert({ id: branch.id, data: toJson(data) });
    if (isMissingTable(error)) throw new BranchesNotSetUpError();
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "BRANCH_CREATED",
      entity: "Branch",
      entityId: branch.id,
      newValue: branch.name,
      reason: "Branch added to the register",
    });
    return branch;
  },

  update: async (id: string, before: Branch, input: BranchInput): Promise<Branch> => {
    const { error } = await supabase
      .from("pv_branches")
      .update({ data: toJson(input) })
      .eq("id", id);
    if (isMissingTable(error)) throw new BranchesNotSetUpError();
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "BRANCH_UPDATED",
      entity: "Branch",
      entityId: id,
      previousValue: `${before.name}${before.active ? "" : " (inactive)"}`,
      newValue: `${input.name}${input.active ? "" : " (inactive)"}`,
      reason: "Branch register entry edited",
    });
    return { ...input, id };
  },
};

/** Problems with a branch before it is saved; empty when it can be saved. */
export function validateBranch(input: BranchInput, others: Branch[]): string[] {
  const name = cleanBranch(input.name);
  if (!name) return ["Enter the branch name."];
  if (others.some((b) => b.name.trim().toLowerCase() === name.toLowerCase()))
    return ["Another branch already has that name."];
  return [];
}

/** The public reporting link for a branch. */
export function branchLink(origin: string, orgSlug: string, branchName: string): string {
  return `${origin}/r/${encodeURIComponent(orgSlug)}?branch=${encodeURIComponent(branchName)}`;
}

export interface BranchActivity {
  name: string;
  branch?: Branch | undefined;
  /** Reports in each of the last `months` calendar months, oldest first. */
  monthly: number[];
  last30Days: number;
  total: number;
  lastReport?: string | undefined;
  /** In the register and active, but nothing in the last 30 days. */
  silent: boolean;
}

/** YYYY-MM for the month `back` months before `today`'s month. */
export function monthKey(today: string, back: number): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 - back;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

/**
 * Report activity per branch, from the cases. Every register branch appears
 * (with zeros when it has no reports); a branch name found on cases but not
 * in the register is listed too, so typed-in names are not lost.
 */
export function branchActivity(
  register: Branch[],
  cases: Pick<CaseSummary, "branch" | "receivedDate">[],
  today: string,
  months = 6,
): BranchActivity[] {
  const keys = Array.from({ length: months }, (_, i) => monthKey(today, months - 1 - i));
  const since = addDaysIso(today, -30) ?? today;
  const byName = new Map<string, BranchActivity>();
  const entry = (name: string, branch?: Branch) => {
    const k = name.trim().toLowerCase();
    let a = byName.get(k);
    if (!a) {
      a = { name, branch, monthly: keys.map(() => 0), last30Days: 0, total: 0, silent: false };
      byName.set(k, a);
    }
    return a;
  };
  register.forEach((b) => entry(b.name, b));
  for (const c of cases) {
    const name = cleanBranch(c.branch);
    if (!name) continue;
    const a = entry(name);
    a.total++;
    const idx = keys.indexOf(c.receivedDate.slice(0, 7));
    if (idx >= 0) a.monthly[idx]!++;
    if (c.receivedDate > since && c.receivedDate <= today) a.last30Days++;
    if (!a.lastReport || c.receivedDate > a.lastReport) a.lastReport = c.receivedDate;
  }
  const out = [...byName.values()];
  out.forEach((a) => {
    a.silent = !!a.branch?.active && a.last30Days === 0;
  });
  return out.sort(
    (a, b) =>
      Number(b.silent) - Number(a.silent) ||
      b.last30Days - a.last30Days ||
      a.name.localeCompare(b.name),
  );
}
