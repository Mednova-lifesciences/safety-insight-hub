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

const { linelist, replaceIssues, isStaleForTermChoices, isCorrectableRuleFinding, aiMoves } =
  await import("./linelist");

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

describe("rule findings Fix may try to settle", () => {
  const f = (code: string, value: string | null, row = 3) => ({ code, value, row });

  it("offers values that are badly written or in the wrong column", () => {
    for (const code of [
      "FIELD_CONTENT_MISMATCH",
      "INVALID_DATE_FORMAT",
      "DATE_FORMAT_INVALID",
      "INTERVAL_UNIT_TYPO",
      "INVALID_REACTION_CODE",
      "E2B-REACTION-DELIMITER-QUARANTINED",
      "DOSE_TYPO",
    ])
      expect(isCorrectableRuleFinding(f(code, "x"))).toBe(true);
  });

  it("leaves judgement calls, IDs and Settings decisions to a person", () => {
    for (const code of [
      "CASE_ID_FORMAT_INCONSISTENT",
      "SERIOUSNESS_CONTRADICTION",
      "DATE_CHRONOLOGY_ERROR",
      "DATE_YEAR_INCONSISTENT",
      "INVALID_REPORTER_PHONE",
      "E2B-REPORTER-QUALIFICATION-UNRESOLVED",
      "VIGIFLOW-MEDDRA-MISSING",
      "MISSING_OUTCOME",
    ])
      expect(isCorrectableRuleFinding(f(code, "x"))).toBe(false);
  });

  it("never offers an empty cell or a whole-file finding", () => {
    expect(isCorrectableRuleFinding(f("INVALID_DATE_FORMAT", null))).toBe(false);
    expect(isCorrectableRuleFinding(f("INVALID_DATE_FORMAT", "  "))).toBe(false);
    expect(isCorrectableRuleFinding(f("INVALID_DATE_FORMAT", "x", 0))).toBe(false);
  });
});

describe("the AI moving a value into an empty cell", () => {
  const mapping = {
    ID: "case_id",
    Age: "age",
    "Vaccination date": "vaccination_date",
    "Report date": "report_date",
  };
  const rows = [{ ID: "C-1", Age: "4/2/26", "Vaccination date": "", "Report date": "5/2/26" }];
  const asked = [{ row: 1, column: "Age" }];

  it("is allowed when it relocates the flagged value into an empty cell", () => {
    const moves = aiMoves(
      [
        { row: 1, column: "Vaccination date", new_value: "4/2/26" },
        { row: 1, column: "Age", new_value: "" },
      ],
      asked,
      rows,
      mapping,
    );
    expect(moves).toEqual([{ row: 1, column: "Vaccination date", from: "Age" }]);
  });

  it("is refused when the destination already holds a value", () => {
    expect(
      aiMoves(
        [
          { row: 1, column: "Report date", new_value: "4/2/26" },
          { row: 1, column: "Age", new_value: "" },
        ],
        asked,
        rows,
        mapping,
      ),
    ).toEqual([]);
  });

  it("is refused when the value is not one the row already holds", () => {
    expect(
      aiMoves(
        [
          { row: 1, column: "Vaccination date", new_value: "04/02/2026" },
          { row: 1, column: "Age", new_value: "" },
        ],
        asked,
        rows,
        mapping,
      ),
    ).toEqual([]);
  });

  it("is refused when the value would stay where it was too (a copy)", () => {
    expect(
      aiMoves([{ row: 1, column: "Vaccination date", new_value: "4/2/26" }], asked, rows, mapping),
    ).toEqual([]);
  });

  it("never touches the case ID", () => {
    const r = [{ ID: "", Age: "C-9", "Vaccination date": "", "Report date": "5/2/26" }];
    expect(
      aiMoves(
        [
          { row: 1, column: "ID", new_value: "C-9" },
          { row: 1, column: "Age", new_value: "" },
        ],
        asked,
        r,
        mapping,
      ),
    ).toEqual([]);
  });
});
