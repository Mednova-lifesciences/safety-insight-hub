import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineListIssue, LineListJob } from "@/types/pv";

/**
 * A job's issues must never be lost by a save that fails part-way, and a
 * Keep / Drop / Step down decision must not rewrite them at all. Seen live:
 * a decision deleted every issue of a job, then the write-back never
 * finished, and the job showed no issues and every case valid.
 */

type Row = { id: string; job_id?: string; data?: unknown };
const tables: Record<string, Row[]> = {};
const writes: { table: string; op: string }[] = [];
let failInsertOn: string | null = null;

function query(table: string) {
  const filters: { key: string; kind: "eq" | "in"; value: unknown }[] = [];
  let op: "select" | "delete" | "update" = "select";
  let patch: Partial<Row> = {};
  const matches = (r: Row) =>
    filters.every((f) =>
      f.kind === "eq"
        ? (r as Record<string, unknown>)[f.key] === f.value
        : (f.value as unknown[]).includes((r as Record<string, unknown>)[f.key]),
    );
  const run = () => {
    const rows = tables[table] ?? [];
    if (op === "delete") {
      writes.push({ table, op: "delete" });
      tables[table] = rows.filter((r) => !matches(r));
      return { data: null, error: null };
    }
    if (op === "update") {
      writes.push({ table, op: "update" });
      rows.filter(matches).forEach((r) => Object.assign(r, patch));
      return { data: null, error: null };
    }
    return { data: rows.filter(matches).map((r) => ({ ...r })), error: null };
  };
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => (filters.push({ key, kind: "eq", value }), builder),
    in: (key: string, value: unknown[]) => (filters.push({ key, kind: "in", value }), builder),
    delete: () => ((op = "delete"), builder),
    update: (p: Partial<Row>) => ((op = "update"), (patch = p), builder),
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    insert: async (rows: Row | Row[]) => {
      writes.push({ table, op: "insert" });
      if (failInsertOn === table) return { error: { message: "connection lost" } };
      (tables[table] ??= []).push(...([] as Row[]).concat(rows));
      return { error: null };
    },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => query(t) },
}));

const { linelist, replaceIssues, isStaleForTermChoices } = await import("./linelist");

const issue = (row: number, severity: LineListIssue["severity"] = "HIGH"): LineListIssue => ({
  row,
  column: "SEX",
  severity,
  code: "MISSING",
  message: "Missing",
  value: null,
});

const JOB = "ll-test";

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  writes.length = 0;
  failInsertOn = null;
  tables["pv_linelist_jobs"] = [
    {
      id: JOB,
      data: {
        id: JOB,
        filename: "test.csv",
        uploadedAt: "2026-10-11T00:00:00Z",
        uploadedBy: "admin",
        rows: 3,
        stage: "VALIDATED",
        validCases: 0,
        invalidCases: 3,
        warnings: 0,
        decisions: [{ row: 2, decision: "DROP", reason: "DUPLICATE", by: "admin", at: "x" }],
      },
    },
  ];
  tables["pv_linelist_issues"] = [1, 2, 3].map((row) => ({
    id: `old-${row}`,
    job_id: JOB,
    data: issue(row),
  }));
});

describe("a job's issues are never lost", () => {
  it("Keep updates the counts and leaves the issues untouched", async () => {
    const job = await linelist.keepCase(JOB, 2);
    expect(job.decisions ?? []).toHaveLength(0);
    expect(job.invalidCases).toBe(3);
    expect(tables["pv_linelist_issues"]!.map((r) => r.id)).toEqual(["old-1", "old-2", "old-3"]);
    expect(writes.filter((w) => w.table === "pv_linelist_issues")).toEqual([]);
  });

  it("Step down updates the counts and leaves the issues untouched", async () => {
    const job = await linelist.decideCase(JOB, { row: 1, decision: "STEP_DOWN" });
    expect(job.invalidCases).toBe(1);
    expect(tables["pv_linelist_issues"]).toHaveLength(3);
    expect(writes.filter((w) => w.table === "pv_linelist_issues")).toEqual([]);
  });

  it("replacing issues writes only what changed, new ones before removing the old", async () => {
    await replaceIssues(JOB, [issue(1), issue(3, "LOW")]);
    const rows = tables["pv_linelist_issues"]!;
    expect(rows).toHaveLength(2);
    // Row 1's issue is unchanged, so its stored copy is kept as it was.
    expect(rows.map((r) => r.id)).toContain("old-1");
    expect(rows.map((r) => r.id)).not.toContain("old-2");
    expect(rows.map((r) => r.id)).not.toContain("old-3");
    const ops = writes.filter((w) => w.table === "pv_linelist_issues").map((w) => w.op);
    expect(ops.indexOf("insert")).toBeLessThan(ops.indexOf("delete"));
  });

  it("a recheck that finds the same issues writes nothing to them", async () => {
    await replaceIssues(JOB, [issue(3), issue(1), issue(2)]);
    expect(tables["pv_linelist_issues"]!.map((r) => r.id)).toEqual(["old-1", "old-2", "old-3"]);
    expect(writes.filter((w) => w.table === "pv_linelist_issues")).toEqual([]);
  });

  it("if writing the new issues fails, the old ones are still there", async () => {
    failInsertOn = "pv_linelist_issues";
    await expect(replaceIssues(JOB, [issue(4)])).rejects.toThrow("connection lost");
    expect(tables["pv_linelist_issues"]!.map((r) => r.id)).toEqual(["old-1", "old-2", "old-3"]);
  });
});

describe("line lists behind the latest term choice", () => {
  const job = (checkedAt: string | undefined, openFixIn: LineListJob["openFixIn"]) => ({
    checkedAt,
    openFixIn,
  });

  it("is behind when checked before the choice and still has a problem it clears", () => {
    expect(
      isStaleForTermChoices(
        job("2026-10-11T10:00:00.000Z", ["REACTION_TERMS"]),
        "2026-10-11T11:00:00+00:00",
      ),
    ).toBe(true);
  });

  it("is up to date when checked after it, whatever the date format", () => {
    expect(
      isStaleForTermChoices(
        job("2026-10-11T12:00:00.000Z", ["REPORTER_DESIGNATIONS"]),
        "2026-10-11T11:00:00+00:00",
      ),
    ).toBe(false);
  });

  it("is never rechecked for a choice that cannot affect it", () => {
    expect(isStaleForTermChoices(job(undefined, ["FILE"]), "2026-10-11T11:00:00+00:00")).toBe(
      false,
    );
    expect(isStaleForTermChoices(job(undefined, ["OUTCOME_TERMS"]), undefined)).toBe(false);
  });
});
