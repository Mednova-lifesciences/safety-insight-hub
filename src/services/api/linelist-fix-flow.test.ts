/**
 * Fix, end to end: the real fixIssues against an in-memory database and a
 * scripted AI, including hostile and sloppy answers. From an audit of the
 * fixer: whatever the AI says, only what the data supports is applied,
 * nothing is lost, identifiers are never touched, and every refusal is
 * reported.
 */
import { describe, expect, it, vi } from "vitest";
import type { LineListIssue } from "@/types/pv";

type Row = { id: string; job_id?: string; data?: unknown; [k: string]: unknown };
const tables: Record<string, Row[]> = {};
function query(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "delete" | "update" = "select";
  let patch: Partial<Row> = {};
  let single = false;
  const get = (r: Row, k: string) => {
    // The JSON paths the versioned save filters on.
    const path = /^data->>?(\w+)$/.exec(k);
    if (path) {
      const v = (r.data as Record<string, unknown> | undefined)?.[path[1]!];
      return k.includes("->>") ? (v === undefined || v === null ? null : String(v)) : (v ?? null);
    }
    return k in r ? r[k] : (r.data as Record<string, unknown> | undefined)?.[k];
  };
  const run = () => {
    const rows = tables[table] ?? [];
    const m = (r: Row) => filters.every((f) => f(r));
    if (op === "delete") {
      tables[table] = rows.filter((r) => !m(r));
      return { data: null, error: null };
    }
    if (op === "update") {
      const hit = rows.filter(m);
      hit.forEach((r) => Object.assign(r, patch));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    const out = rows.filter(m).map((r) => ({ ...r }));
    return { data: single ? (out[0] ?? null) : out, error: null, count: out.length };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    order: () => b,
    limit: () => b,
    range: () => b,
    ilike: () => b,
    or: () => b,
    not: () => b,
    contains: () => b,
    neq: () => b,
    filter: () => b,
    eq: (k: string, v: unknown) => (filters.push((r) => get(r, k) === v), b),
    is: (k: string, v: unknown) => (filters.push((r) => (get(r, k) ?? null) === v), b),
    in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(get(r, k))), b),
    delete: () => ((op = "delete"), b),
    update: (p: Partial<Row>) => ((op = "update"), (patch = p), b),
    maybeSingle: async () => ((single = true), run()),
    single: async () => ((single = true), run()),
    insert: async (rows: Row | Row[]) => {
      (tables[table] ??= []).push(...([] as Row[]).concat(rows));
      return { error: null };
    },
    upsert: async (rows: Row | Row[]) => {
      (tables[table] ??= []).push(...([] as Row[]).concat(rows));
      return { data: [], error: null };
    },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(res, rej),
  };
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => query(t),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
const aiFix = vi.fn();
vi.mock("./ai", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const ai = real["ai"] as Record<string, Record<string, unknown>>;
  return {
    ...real,
    ai: { ...ai, linelist: { ...ai["linelist"], fix: (...a: unknown[]) => aiFix(...a) } },
  };
});

const { linelist } = await import("./linelist");

// The first run loads the whole line-list module; on a slow machine that
// alone can pass the 5 s default.
vi.setConfig({ testTimeout: 30000 });

const JOB = "ll-flow";
const MAP: Record<string, string> = {
  ID: "case_id",
  "Hospital No": "patient_id",
  Name: "patient_identifier",
  Sex: "sex",
  Age: "age",
  "Vacc date": "vaccination_date",
  "Report date": "report_date",
  Reaction: "reaction_code",
  Outcome: "outcome",
  Remarks: "remarks",
};
const COLS = Object.keys(MAP);
const base = (i: number, over: Record<string, string> = {}) => ({
  ID: `T-${100 + i}`,
  "Hospital No": `HN${5000 + i}`,
  Name: "ADA OBI",
  Sex: "FEMALE",
  Age: "4",
  "Vacc date": "3/2/26",
  "Report date": "5/2/26",
  Reaction: "19",
  Outcome: "1",
  Remarks: "fine",
  ...over,
});
const parsedOf = (r: Record<string, string>) =>
  Object.fromEntries(Object.entries(MAP).map(([h, f]) => [f, r[h] ?? ""]));
const jobData = () =>
  tables["pv_linelist_jobs"]![0]!.data as {
    rawRows: Record<string, string>[];
    changeLog?: { id: string; source: string; group?: string }[];
    lastFixRouting?: { row: number; column: string; route: string; outcome?: string }[];
  };

async function runFix(
  raw: Record<string, string>[],
  issues: LineListIssue[],
  aiReply: unknown,
  extra: Record<string, unknown> = {},
) {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["pv_linelist_jobs"] = [
    {
      id: JOB,
      data: {
        id: JOB,
        filename: "flow.csv",
        uploadedAt: "2026-10-12T00:00:00Z",
        uploadedBy: "a",
        rows: raw.length,
        stage: "VALIDATED",
        validCases: 0,
        invalidCases: 0,
        warnings: 0,
        columns: COLS,
        mapping: MAP,
        rawRows: raw.map((r) => ({ ...r })),
        parsedRows: raw.map(parsedOf),
        sourceProfileId: "generic-verbatim",
        ...extra,
      },
    },
  ];
  tables["pv_linelist_issues"] = issues.map((d, i) => ({ id: `i${i}`, job_id: JOB, data: d }));
  aiFix.mockReset();
  if (aiReply instanceof Error) aiFix.mockRejectedValue(aiReply);
  else aiFix.mockResolvedValue(aiReply);
  let result: Awaited<ReturnType<typeof linelist.fixIssues>> | undefined;
  let error = "";
  try {
    result = await linelist.fixIssues(JOB);
  } catch (e) {
    error = (e as Error).message;
  }
  const changed: string[] = [];
  jobData().rawRows.forEach((r, i) =>
    COLS.forEach((c) => {
      if ((raw[i]![c] ?? "") !== (r[c] ?? ""))
        changed.push(`r${i + 1}.${c}: "${raw[i]![c]}"→"${r[c]}"`);
    }),
  );
  return {
    result,
    error,
    changed,
    log: jobData().changeLog ?? [],
    sent: aiFix.mock.calls[0]?.[0] as
      { issues: LineListIssue[]; column_fill: Record<string, number> } | undefined,
  };
}
const issue = (
  row: number,
  column: string,
  code: string,
  value: string | null,
  extra: Partial<LineListIssue> = {},
): LineListIssue => ({
  row,
  column,
  code,
  value,
  severity: "HIGH",
  message: code,
  source: "rule",
  ...extra,
});
const NOAI = { corrections: [], unresolved: [], ai_used: true, prompt_version: "t" };
const ai = (corrections: unknown[]) => ({
  corrections,
  unresolved: [],
  ai_used: true,
  prompt_version: "t",
});
const rowsA = [base(1, { "Vacc date": "02/02/2026'" }), base(2)];
const issA = [
  // As the AI analysis returns it: not marked fixable, but a cell-local
  // format finding — routed by its category, not by the code's wording.
  issue(1, "Vacc date", "DATE_FORMAT_INVALID", "02/02/2026'", {
    source: "ai",
    fixable: false,
    issueType: "FIELD_FORMAT_INVALID",
  }),
];
// Two date columns are empty in row 1, so where its date belongs is only
// settled by the file: the vaccination date is filled in 9 of 10 rows, the
// report date in none.
const rowsM = [
  base(1, { Age: "4/2/26", "Vacc date": "", "Report date": "" }),
  ...Array.from({ length: 9 }, (_, i) => base(i + 2, { "Report date": "" })),
];
const issM = [issue(1, "Age", "FIELD_CONTENT_MISMATCH", "4/2/26")];

describe("recovery, without the AI", () => {
  it("puts swapped values back in a mixed file, touching nothing else", async () => {
    const r = await runFix(
      [
        base(1),
        base(2, { Sex: "3", Age: "MALE" }),
        base(3),
        base(4, { Age: "4/2/26", "Vacc date": "" }),
        base(5),
      ],
      [
        issue(2, "Sex", "FIELD_CONTENT_MISMATCH", "3"),
        issue(2, "Age", "FIELD_CONTENT_MISMATCH", "MALE"),
        issue(4, "Age", "FIELD_CONTENT_MISMATCH", "4/2/26"),
      ],
      NOAI,
    );
    expect(r.changed.sort()).toEqual([
      'r2.Age: "MALE"→"3"',
      'r2.Sex: "3"→"MALE"',
      'r4.Age: "4/2/26"→""',
      'r4.Vacc date: ""→"4/2/26"',
    ]);
    expect(new Set(r.log.map((l) => l.source))).toEqual(new Set(["recovery"]));
  });

  it("runs even when nothing is offered to the AI", async () => {
    const r = await runFix([base(1, { Sex: "3", Age: "MALE" })], [], NOAI);
    expect(r.changed).toHaveLength(2);
    expect(r.sent).toBeUndefined();
  });

  it("leaves a row alone when two values would land in one cell", async () => {
    const r = await runFix([base(1, { Sex: "3", Age: "MALE", "Vacc date": "7" })], [], NOAI);
    expect(r.changed).toEqual([]);
  });

  it("leaves dropped and held cases alone", async () => {
    for (const decision of [{ decision: "DROP", reason: "DUPLICATE" }, { decision: "STEP_DOWN" }]) {
      const r = await runFix(
        [base(1, { Sex: "3", Age: "MALE" })],
        [issue(1, "Sex", "FIELD_CONTENT_MISMATCH", "3")],
        NOAI,
        { decisions: [{ row: 1, by: "a", at: "x", ...decision }] },
      );
      expect(r.changed).toEqual([]);
    }
  });
});

describe("the AI's answers", () => {
  it("applies a correction derived from the cell", async () => {
    const r = await runFix(
      rowsA,
      issA,
      ai([{ row: 1, column: "Vacc date", new_value: "02/02/2026", reason: "stray ' removed" }]),
    );
    expect(r.changed).toEqual([`r1.Vacc date: "02/02/2026'"→"02/02/2026"`]);
  });

  it.each([
    ["an unrelated cell", [{ row: 2, column: "Outcome", new_value: "5", reason: "r" }]],
    ["the case ID", [{ row: 1, column: "ID", new_value: "HACK", reason: "r" }]],
    [
      "an invented value",
      [{ row: 1, column: "Vacc date", new_value: "15/09/2019", reason: "guess" }],
    ],
    ["a row that does not exist", [{ row: 99, column: "Vacc date", new_value: "x", reason: "r" }]],
    [
      "a column that does not exist",
      [{ row: 1, column: "Vacc  date", new_value: "x", reason: "r" }],
    ],
    [
      "two conflicting answers",
      [
        { row: 1, column: "Vacc date", new_value: "02/02/2026", reason: "a" },
        { row: 1, column: "Vacc date", new_value: "03/03/2026", reason: "b" },
      ],
    ],
  ])("changes nothing for %s, and reports it", async (_label, corrections) => {
    const r = await runFix(rowsA, issA, ai(corrections));
    expect(r.changed).toEqual([]);
    // Each refused answer is reported against its own cell, with a reason.
    for (const c of corrections as { row: number; column: string }[]) {
      expect(r.result!.unresolved).toContainEqual(
        expect.objectContaining({ row: c.row, column: c.column, reason: expect.any(String) }),
      );
    }
  });

  it("never changes the patient record number", async () => {
    const r = await runFix(
      [base(1, { "Hospital No": "MALE" })],
      [issue(1, "Hospital No", "FIELD_CONTENT_MISMATCH", "MALE")],
      ai([{ row: 1, column: "Hospital No", new_value: "HN0000", reason: "r" }]),
    );
    expect(r.changed).toEqual([]);
    expect(r.result!.unresolved).toContainEqual(
      expect.objectContaining({
        row: 1,
        column: "Hospital No",
        reason: expect.stringMatching(/never changed/),
      }),
    );
  });

  it("applies a move into an empty cell, both halves as one change", async () => {
    const r = await runFix(
      rowsM,
      issM,
      ai([
        { row: 1, column: "Vacc date", new_value: "4/2/26", reason: "move" },
        { row: 1, column: "Age", new_value: "", reason: "moved" },
      ]),
    );
    expect(r.changed.sort()).toEqual([`r1.Age: "4/2/26"→""`, `r1.Vacc date: ""→"4/2/26"`]);
    expect(new Set(r.log.map((l) => l.group)).size).toBe(1);
  });

  it("loses nothing when a move is refused", async () => {
    // The destination was reformatted, so the move is refused; the source
    // keeps its value.
    const r = await runFix(
      rowsM,
      issM,
      ai([
        { row: 1, column: "Vacc date", new_value: "2026-02-04", reason: "move" },
        { row: 1, column: "Age", new_value: "", reason: "m" },
      ]),
    );
    expect(r.changed).toEqual([]);
  });

  it("refuses a copy (the source not cleared)", async () => {
    const r = await runFix(
      rowsM,
      issM,
      ai([{ row: 1, column: "Vacc date", new_value: "4/2/26", reason: "move" }]),
    );
    expect(r.changed).toEqual([]);
  });

  it("changes nothing when the AI service fails", async () => {
    const failed = await runFix(rowsA, issA, {
      corrections: [],
      unresolved: [],
      ai_used: false,
      prompt_version: "t",
      error: "AI fix unavailable. No changes were made.",
    });
    expect(failed.changed).toEqual([]);
    const threw = await runFix(rowsA, issA, new Error("timeout"));
    expect(threw.changed).toEqual([]);
  });

  it("never sends a whole-file finding as a cell", async () => {
    const r = await runFix(
      [base(1)],
      [issue(0, "Remarks", "SOME_AI_FINDING", "x", { source: "ai", fixable: true })],
      NOAI,
    );
    expect(r.sent).toBeUndefined();
  });

  it("tells the AI how often each column is filled across the file", async () => {
    const r = await runFix(
      [base(1, { "Vacc date": "02/02/2026'" }), base(2, { Remarks: "" })],
      issA,
      NOAI,
    );
    expect(r.sent!.column_fill["Remarks"]).toBe(0.5);
    expect(r.sent!.column_fill["ID"]).toBe(1);
  });
});

describe("Undo and Re-apply", () => {
  it("undoes a move whole, keeps the cells from Fix, reports them, and re-applies", async () => {
    const first = await runFix(
      [base(1, { Sex: "3", Age: "MALE" })],
      [
        issue(1, "Sex", "FIELD_CONTENT_MISMATCH", "3"),
        issue(1, "Age", "FIELD_CONTENT_MISMATCH", "MALE"),
      ],
      NOAI,
    );
    const change = first.log[0]!;
    await linelist.undoChange(JOB, change.id);
    expect([jobData().rawRows[0]!["Sex"], jobData().rawRows[0]!["Age"]]).toEqual(["3", "MALE"]);
    tables["pv_linelist_issues"] = [
      { id: "z1", job_id: JOB, data: issue(1, "Sex", "FIELD_CONTENT_MISMATCH", "3") },
      { id: "z2", job_id: JOB, data: issue(1, "Age", "FIELD_CONTENT_MISMATCH", "MALE") },
    ];
    aiFix.mockReset();
    aiFix.mockResolvedValue(NOAI);
    const again = await linelist.fixIssues(JOB);
    expect([jobData().rawRows[0]!["Sex"], jobData().rawRows[0]!["Age"]]).toEqual(["3", "MALE"]);
    expect(again.unresolved.some((u) => /Kept by a person/.test(u.reason))).toBe(true);
    await linelist.reapplyChange(JOB, change.id);
    expect([jobData().rawRows[0]!["Sex"], jobData().rawRows[0]!["Age"]]).toEqual(["MALE", "3"]);
  });
});

describe("the audit trail", () => {
  const fixEntry = () =>
    (tables["pv_audit_events"] ?? [])
      .map((r) => r.data as { action: string; reason: string })
      .find((d) => d.action === "LINELIST_AI_FIX_APPLIED");

  it("records a recovery-only Fix as recovery only, not a blank prompt", async () => {
    await runFix([base(1, { Sex: "3", Age: "MALE" })], [], NOAI);
    expect(fixEntry()?.reason).toBe("0 by rule, 2 by recovery, 0 by AI; no AI call");
  });

  it("records the AI instructions' version and how many AI answers were refused", async () => {
    await runFix(rowsA, issA, {
      ...ai([
        { row: 1, column: "Vacc date", new_value: "02/02/2026", reason: "ok" },
        { row: 2, column: "Outcome", new_value: "5", reason: "unasked" },
      ]),
      prompt_version: "2026-10-12.2",
    });
    expect(fixEntry()?.reason).toBe(
      "0 by rule, 0 by recovery, 1 by AI; AI prompt 2026-10-12.2, 0 answer(s) refused by the server, 1 by the browser",
    );
  });
});

describe("normalisation rules: applied by Fix without the AI, recorded and reversible", () => {
  const sug = (value: string, rule = "stray-edge-character") => ({
    suggestion: { value, rule, version: "1" },
    fixable: true,
  });
  it("applies a rule's suggestion with no AI call, recorded as a rule change with the rule named", async () => {
    const r = await runFix(
      [base(1, { "Vacc date": "02/02/2026'" })],
      [issue(1, "Vacc date", "STRAY_CHARACTER", "02/02/2026'", sug("02/02/2026"))],
      NOAI,
    );
    expect(r.sent).toBeUndefined();
    expect(r.changed).toEqual([`r1.Vacc date: "02/02/2026'"→"02/02/2026"`]);
    expect(r.log).toEqual([
      expect.objectContaining({
        source: "rule",
        oldValue: "02/02/2026'",
        reason: expect.stringContaining("stray-edge-character v1"),
      }),
    ]);
    expect(jobData().lastFixRouting).toEqual([
      expect.objectContaining({
        row: 1,
        column: "Vacc date",
        route: "deterministic",
        outcome: "rule_corrected",
      }),
    ]);
  });
  it("does not apply a suggestion when the cell changed since it was checked — it reports it", async () => {
    const r = await runFix(
      [base(1, { "Vacc date": "03/02/2026" })],
      [issue(1, "Vacc date", "STRAY_CHARACTER", "02/02/2026'", sug("02/02/2026"))],
      NOAI,
    );
    expect(r.changed).toEqual([]);
    expect(r.result!.unresolved).toContainEqual(
      expect.objectContaining({
        column: "Vacc date",
        reason: expect.stringMatching(/changed after it was checked/),
      }),
    );
    expect(jobData().lastFixRouting![0]).toMatchObject({ outcome: "rule_skipped_value_changed" });
  });
  it("never applies a suggestion to an identifier, and reports it", async () => {
    const r = await runFix(
      [base(1, { ID: "T-101'" })],
      [issue(1, "ID", "STRAY_CHARACTER", "T-101'", sug("T-101"))],
      NOAI,
    );
    expect(r.changed).toEqual([]);
    expect(r.result!.unresolved).toContainEqual(
      expect.objectContaining({ column: "ID", reason: expect.stringMatching(/never changed/) }),
    );
  });
  it("a rule-settled cell is not also sent to the AI; other cells still are", async () => {
    const r = await runFix(
      [base(1, { "Vacc date": "02/02/2026'", "Report date": "5/2/20266" })],
      [
        issue(1, "Vacc date", "STRAY_CHARACTER", "02/02/2026'", sug("02/02/2026")),
        issue(1, "Vacc date", "DATE_FORMAT_INVALID", "02/02/2026'", {
          source: "ai",
          fixable: true,
          confidence: "HIGH",
        }),
        issue(1, "Report date", "INVALID_DATE_FORMAT", "5/2/20266", { fixable: true }),
      ],
      NOAI,
    );
    expect(r.sent!.issues.map((i) => i.column)).toEqual(["Report date"]);
    expect(r.changed).toEqual([`r1.Vacc date: "02/02/2026'"→"02/02/2026"`]);
  });
  it("a rule change can be undone and re-applied like any other", async () => {
    await runFix(
      [base(1, { "Vacc date": "02/02/2026'" })],
      [issue(1, "Vacc date", "STRAY_CHARACTER", "02/02/2026'", sug("02/02/2026"))],
      NOAI,
    );
    const id = jobData().changeLog![0]!.id;
    await linelist.undoChange(JOB, id);
    expect(jobData().rawRows[0]!["Vacc date"]).toBe("02/02/2026'");
    await linelist.reapplyChange(JOB, id);
    expect(jobData().rawRows[0]!["Vacc date"]).toBe("02/02/2026");
  });
  it("records every finding's route, including the ones a person decides", async () => {
    await runFix(
      [base(1, { Outcome: "2" })],
      [
        issue(1, "Outcome", "OUTCOME_SERIOUSNESS_CONTRADICTION", "2", { fixable: false }),
        issue(0, "(file)", "X", null),
      ],
      NOAI,
    );
    expect(
      jobData()
        .lastFixRouting!.map((r) => r.route)
        .sort(),
    ).toEqual(["file_level", "not_correctable"]);
  });
});

it("a finding on a cell a rule settles is recorded as settled by the rule, not as an AI result", async () => {
  await runFix(
    [base(1, { "Vacc date": "02/02/2026'" })],
    [
      issue(1, "Vacc date", "STRAY_CHARACTER", "02/02/2026'", {
        suggestion: { value: "02/02/2026", rule: "stray-edge-character", version: "1" },
        fixable: true,
      }),
      issue(1, "Vacc date", "DATE_FORMAT_INVALID", "02/02/2026'", {
        source: "ai",
        fixable: true,
        confidence: "HIGH",
      }),
    ],
    NOAI,
  );
  expect(jobData().lastFixRouting!.map((r) => [r.route, r.outcome])).toEqual([
    ["deterministic", "rule_corrected"],
    ["deterministic", "rule_corrected"],
  ]);
});
