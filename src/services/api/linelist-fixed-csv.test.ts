import { describe, expect, it } from "vitest";
import {
  buildFixedCsv,
  escapeCsvCell,
  FIXED_FILE_COLUMNS,
  stillNeedsReviewFor,
} from "./linelist-fixed-csv";
import type { LineListChange, LineListDecision, LineListIssue } from "@/types/pv";

const AT = "2026-10-05T10:00:00Z";

function change(row: number, overrides: Partial<LineListChange> = {}): LineListChange {
  return {
    id: `llc-${row}`,
    row,
    column: "Outcome",
    oldValue: "recoverd",
    newValue: "1",
    reason: "matched code list: 1=Recovered",
    source: "ai",
    appliedAt: AT,
    events: [],
    ...overrides,
  };
}

function issue(row: number, overrides: Partial<LineListIssue> = {}): LineListIssue {
  return {
    row,
    column: "Sex",
    severity: "HIGH",
    code: "X",
    message: "Sex not recognised",
    value: "?",
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    columns: ["ID", "Outcome", "Sex"],
    rows: [
      { ID: "NIE-001", Outcome: "1", Sex: "F" },
      { ID: "NIE-002", Outcome: "2", Sex: "?" },
      { ID: "NIE-003", Outcome: "1", Sex: "M" },
    ],
    changeLog: [change(1)],
    decisions: [] as LineListDecision[],
    issues: [issue(2)],
    unresolved: [] as { row: number; column: string; reason: string }[],
    preservedSourceText: [] as string[],
    ...overrides,
  };
}

const linesOf = (csv: string) => csv.split("\n");

describe("the fixed CSV", () => {
  it("adds the three columns after the original ones", () => {
    expect(linesOf(buildFixedCsv(input()))[0]).toBe(
      ["ID", "Outcome", "Sex", ...FIXED_FILE_COLUMNS].join(","),
    );
  });

  it("says what changed on each row", () => {
    const rowOne = linesOf(buildFixedCsv(input()))[1]!;
    expect(rowOne).toContain('Outcome: ""recoverd"" → ""1"" (matched code list: 1=Recovered)');
  });

  it("says what still needs review", () => {
    expect(linesOf(buildFixedCsv(input()))[2]).toContain("Sex: Sex not recognised");
  });

  it("keeps a dropped case, marked", () => {
    const csv = buildFixedCsv(
      input({
        decisions: [
          { row: 2, decision: "DROP", reason: "DUPLICATE", note: "row 1", by: "A", at: AT },
        ],
      }),
    );
    const lines = linesOf(csv);
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain("DROPPED — Duplicate: row 1");
  });

  it("leaves a stepped-down case out entirely", () => {
    const csv = buildFixedCsv(
      input({ decisions: [{ row: 2, decision: "STEP_DOWN", by: "A", at: AT }] }),
    );
    expect(csv).not.toContain("NIE-002");
    expect(linesOf(csv)).toHaveLength(3);
  });

  it("keeps the source form's code list at the bottom", () => {
    const csv = buildFixedCsv(
      input({
        preservedSourceText: [
          "KEY TO SUMMARY FINDINGS:",
          "3) OUTCOME: 1= Recovered, 2=Hospitalized",
        ],
      }),
    );
    const lines = linesOf(csv);
    // The last line contains a comma, so it is quoted.
    expect(lines.slice(-4)).toEqual([
      "",
      "# ORIGINAL SOURCE TEXT — preserved from uploaded file",
      "KEY TO SUMMARY FINDINGS:",
      '"3) OUTCOME: 1= Recovered, 2=Hospitalized"',
    ]);
  });

  it("keeps the code list even when every case is held", () => {
    const decisions: LineListDecision[] = [1, 2, 3].map((row) => ({
      row,
      decision: "STEP_DOWN",
      by: "A",
      at: AT,
    }));
    const csv = buildFixedCsv(
      input({ decisions, preservedSourceText: ["KEY TO SUMMARY FINDINGS:"] }),
    );
    expect(csv).toContain("KEY TO SUMMARY FINDINGS:");
  });

  // Review Focus 3.
  it("keeps one line per case when values contain quotes, commas and line breaks", () => {
    const csv = buildFixedCsv(
      input({
        changeLog: [change(1, { oldValue: 'said "fine", then\nfainted', newValue: "Syncope" })],
      }),
    );
    // Header + 3 cases. A raw newline inside a quoted cell is legal CSV,
    // so count records by parsing rather than by splitting on \n.
    const records = parseCsv(csv);
    expect(records).toHaveLength(4);
    expect(records[1]![3]).toBe(
      'Outcome: "said "fine", then\nfainted" → "Syncope" (matched code list: 1=Recovered)',
    );
  });
});

describe("cell escaping", () => {
  it("quotes only when needed", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "x"')).toBe('"say ""x"""');
    expect(escapeCsvCell("a\nb")).toBe('"a\nb"');
    expect(escapeCsvCell("a\rb")).toBe('"a\rb"');
  });
});

describe("still needs review", () => {
  it("joins issues and unresolved fix items without repeats", () => {
    expect(
      stillNeedsReviewFor(
        2,
        [issue(2), issue(2)],
        [{ row: 2, column: "Outcome", reason: "Low-confidence AI finding" }],
      ),
    ).toBe("Sex: Sex not recognised · Outcome: Low-confidence AI finding");
  });
});

/** Minimal RFC 4180 reader for the assertions above. */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  record.push(field);
  records.push(record);
  return records;
}
