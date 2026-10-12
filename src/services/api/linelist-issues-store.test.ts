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
/** Runs once, right after the next read of a job — "another tab" saving
 *  in between this tab's read and its save. */
let afterJobRead: (() => void) | null = null;

function query(table: string) {
  const filters: { key: string; kind: "eq" | "in" | "is"; value: unknown }[] = [];
  let op: "select" | "delete" | "update" = "select";
  let patch: Partial<Row> = {};
  // Plain columns, and the JSON paths the versioned save filters on:
  // data->>version (text) and data->version (raw, for "is null").
  const field = (r: Row, key: string) => {
    const path = /^data->>?(\w+)$/.exec(key);
    if (!path) return (r as Record<string, unknown>)[key];
    const v = (r.data as Record<string, unknown> | undefined)?.[path[1]!];
    return key.includes("->>") ? (v === undefined || v === null ? null : String(v)) : (v ?? null);
  };
  const matches = (r: Row) =>
    filters.every((f) =>
      f.kind === "eq"
        ? field(r, f.key) === f.value
        : f.kind === "is"
          ? (field(r, f.key) ?? null) === f.value
          : (f.value as unknown[]).includes(field(r, f.key)),
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
      const hit = rows.filter(matches);
      hit.forEach((r) => Object.assign(r, patch));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    const out = rows.filter(matches).map((r) => ({ ...r, data: structuredClone(r.data) }));
    if (table === "pv_linelist_jobs" && afterJobRead && out.length) {
      const hook = afterJobRead;
      afterJobRead = null;
      hook();
    }
    return { data: out, error: null };
  };
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => (filters.push({ key, kind: "eq", value }), builder),
    in: (key: string, value: unknown[]) => (filters.push({ key, kind: "in", value }), builder),
    is: (key: string, value: unknown) => (filters.push({ key, kind: "is", value }), builder),
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
const { routeFinding } = await import("./linelist-fix-routing");
const { saveJobVersioned, StaleJobError } = await import("./linelist-job-store");

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
  afterJobRead = null;
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

describe("rule findings Fix may try to settle (routed by linelist-fix-routing)", () => {
  const ctx = {
    keptRows: new Set([0, 3]),
    changeLog: [],
    recoveryCells: new Set<string>(),
    mapping: {},
  };
  const f = (code: string, value: string | null, row = 3): LineListIssue => ({
    code,
    value,
    row,
    column: "C",
    severity: "HIGH",
    message: code,
    source: "rule",
    fixable: false,
  });

  it("offers values that are badly written or in the wrong column", () => {
    for (const code of [
      "FIELD_CONTENT_MISMATCH",
      "INVALID_DATE_FORMAT",
      "INVALID_REACTION_CODE",
      "E2B-REACTION-DELIMITER-QUARANTINED",
    ])
      expect(routeFinding(f(code, "x"), ctx)).toBe("sent_to_ai");
  });

  it("codes no rule produces are not offered by name — a rule's suggestion or the AI's category routes them", () => {
    for (const code of ["DATE_FORMAT_INVALID", "INTERVAL_UNIT_TYPO", "DOSE_TYPO"])
      expect(routeFinding(f(code, "x"), ctx)).toBe("not_correctable");
    expect(
      routeFinding(
        { ...f("INTERVAL_UNIT_TYPO", "x"), suggestion: { value: "y", rule: "r", version: "1" } },
        ctx,
      ),
    ).toBe("deterministic");
  });

  it("leaves judgement calls, IDs and Settings decisions to a person", () => {
    for (const code of [
      "CASE_ID_FORMAT_INCONSISTENT",
      "SERIOUSNESS_CONTRADICTION",
      "OUTCOME_SERIOUSNESS_CONTRADICTION",
      "DATE_CHRONOLOGY_ERROR",
      "DATE_YEAR_INCONSISTENT",
      "INVALID_REPORTER_PHONE",
      "PHONE_LEADING_ZERO_MISSING",
      "DOSE_IMPLAUSIBLE",
      "E2B-REPORTER-QUALIFICATION-UNRESOLVED",
      "VIGIFLOW-MEDDRA-MISSING",
      "MISSING_OUTCOME",
    ])
      expect(routeFinding(f(code, "x"), ctx)).toBe("not_correctable");
  });

  it("never offers an empty cell or a whole-file finding", () => {
    expect(routeFinding(f("INVALID_DATE_FORMAT", null), ctx)).toBe("not_correctable");
    expect(routeFinding(f("INVALID_DATE_FORMAT", "  "), ctx)).toBe("not_correctable");
    expect(routeFinding(f("INVALID_DATE_FORMAT", "x", 0), ctx)).toBe("file_level");
  });
});

describe("a stale save never overwrites a newer one", () => {
  const stored = () => tables["pv_linelist_jobs"]![0]!.data as Record<string, unknown>;

  it("refuses the second of two saves made from the same version", async () => {
    (stored() as { version?: number }).version = 4;
    const tabA = { ...structuredClone(stored()), id: JOB, warnings: 11 } as {
      id: string;
      version?: number;
    };
    const tabB = { ...structuredClone(stored()), id: JOB, warnings: 22 } as {
      id: string;
      version?: number;
    };
    await saveJobVersioned(tabA);
    await expect(saveJobVersioned(tabB)).rejects.toBeInstanceOf(StaleJobError);
    expect(stored()).toMatchObject({ warnings: 11, version: 5 });
  });

  it("does the same for a job saved before versions existed", async () => {
    delete (stored() as { version?: number }).version;
    const tabA = { ...structuredClone(stored()), id: JOB, warnings: 11 } as {
      id: string;
      version?: number;
    };
    const tabB = { ...structuredClone(stored()), id: JOB, warnings: 22 } as {
      id: string;
      version?: number;
    };
    await saveJobVersioned(tabA);
    await expect(saveJobVersioned(tabB)).rejects.toThrow(/changed elsewhere/);
    expect(stored()).toMatchObject({ warnings: 11, version: 1 });
  });

  it("lets one operation save twice in a row", async () => {
    (stored() as { version?: number }).version = 1;
    const job = { ...structuredClone(stored()), id: JOB } as { id: string; version?: number };
    await saveJobVersioned(job);
    await saveJobVersioned(job);
    expect(stored()).toMatchObject({ version: 3 });
  });

  it("refuses a decision when someone else saved in between, keeping their change and writing no issues", async () => {
    (stored() as { version?: number }).version = 7;
    const theirDecision = {
      row: 3,
      decision: "DROP",
      reason: "DUPLICATE",
      by: "other tab",
      at: "x",
    };
    afterJobRead = () => {
      const s = stored() as { version: number; decisions: unknown[] };
      s.version = 8;
      s.decisions = [theirDecision];
    };
    writes.length = 0;
    await expect(
      linelist.decideCase(JOB, { row: 1, decision: "STEP_DOWN" }),
    ).rejects.toBeInstanceOf(StaleJobError);
    expect(stored()).toMatchObject({ version: 8, decisions: [theirDecision] });
    expect(writes.filter((w) => w.table === "pv_linelist_issues")).toEqual([]);
  });
});
