import { describe, expect, it } from "vitest";
import {
  decidedRowsWithoutIssues,
  decisionCounts,
  decisionFor,
  describeDecision,
  describeExcluded,
  excludeDecidedCases,
  isExcluded,
  issuesForFilter,
  keptOnly,
  withDecision,
  withoutDecision,
} from "./linelist-decisions";
import type { LineListDecision, LineListIssue } from "@/types/pv";

const AT = "2026-10-05T10:00:00Z";

function issue(row: number, overrides: Partial<LineListIssue> = {}): LineListIssue {
  return {
    row,
    column: "Outcome",
    severity: "HIGH",
    code: "X",
    message: "Outcome not recognised",
    value: "recoverd",
    ...overrides,
  };
}

describe("setting a decision", () => {
  it("drops a case with a reason", () => {
    const out = withDecision(
      [],
      { row: 3, decision: "DROP", reason: "DUPLICATE", note: "row 14" },
      10,
      "A. Bello",
      AT,
    );
    expect(out).toEqual([
      { row: 3, decision: "DROP", reason: "DUPLICATE", note: "row 14", by: "A. Bello", at: AT },
    ]);
  });

  it("steps a case down without a reason", () => {
    const out = withDecision([], { row: 2, decision: "STEP_DOWN" }, 10, "A", AT);
    expect(out).toEqual([{ row: 2, decision: "STEP_DOWN", by: "A", at: AT }]);
  });

  it("replaces an earlier decision on the same row", () => {
    const first = withDecision([], { row: 2, decision: "STEP_DOWN" }, 10, "A", AT);
    const second = withDecision(
      first,
      { row: 2, decision: "DROP", reason: "NOT_AN_AEFI" },
      10,
      "B",
      AT,
    );
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ decision: "DROP", reason: "NOT_AN_AEFI", by: "B" });
  });

  it("requires a reason to drop", () => {
    expect(() => withDecision([], { row: 1, decision: "DROP" }, 10, "A", AT)).toThrow(/reason/i);
  });

  it("requires a note when the reason is Other", () => {
    expect(() =>
      withDecision([], { row: 1, decision: "DROP", reason: "OTHER" }, 10, "A", AT),
    ).toThrow(/note/i);
  });

  // Review Focus 2.
  it("treats a note of only spaces as no note", () => {
    expect(() =>
      withDecision([], { row: 1, decision: "DROP", reason: "OTHER", note: "   " }, 10, "A", AT),
    ).toThrow(/note/i);
  });

  it("trims the note it stores", () => {
    const out = withDecision(
      [],
      { row: 1, decision: "DROP", reason: "OTHER", note: "  test entry  " },
      10,
      "A",
      AT,
    );
    expect(out[0]!.note).toBe("test entry");
  });

  // Review Focus 4.
  it("rejects a row that is not a case in this line list", () => {
    for (const row of [0, -1, 11, 1.5]) {
      expect(() => withDecision([], { row, decision: "STEP_DOWN" }, 10, "A", AT)).toThrow(
        /not a case/i,
      );
    }
  });
});

describe("returning a case to Keep", () => {
  it("removes the decision for that row only", () => {
    const decisions = [
      ...withDecision([], { row: 1, decision: "STEP_DOWN" }, 10, "A", AT),
      ...withDecision([], { row: 2, decision: "STEP_DOWN" }, 10, "A", AT),
    ];
    expect(withoutDecision(decisions, 1).map((d) => d.row)).toEqual([2]);
  });
});

describe("what a decision excludes", () => {
  const decisions: LineListDecision[] = [
    { row: 2, decision: "DROP", reason: "DUPLICATE", by: "A", at: AT },
    { row: 3, decision: "STEP_DOWN", by: "A", at: AT },
  ];

  it("excludes dropped and held rows, keeps the rest", () => {
    expect(isExcluded(decisions, 1)).toBe(false);
    expect(isExcluded(decisions, 2)).toBe(true);
    expect(isExcluded(decisions, 3)).toBe(true);
    expect(decisionFor(decisions, 3)?.decision).toBe("STEP_DOWN");
  });

  it("keeps only issues on kept rows", () => {
    expect(keptOnly([issue(1), issue(2), issue(3)], decisions).map((i) => i.row)).toEqual([1]);
  });

  it("always keeps a file-level issue, even when every case is decided", () => {
    // A wrong source form blocks the whole file; dropping cases does not
    // make it go away.
    const all: LineListDecision[] = [1, 2].map((row) => ({
      row,
      decision: "STEP_DOWN",
      by: "A",
      at: AT,
    }));
    expect(keptOnly([issue(0), issue(1), issue(2)], all).map((i) => i.row)).toEqual([0]);
  });

  it("treats no decisions as everything kept", () => {
    expect(keptOnly([issue(1)], undefined)).toHaveLength(1);
  });
});

describe("describing decisions", () => {
  it("says dropped with the reason and the note", () => {
    expect(
      describeDecision({
        row: 2,
        decision: "DROP",
        reason: "DUPLICATE",
        note: "row 14",
        by: "A",
        at: AT,
      }),
    ).toBe("DROPPED — Duplicate: row 14");
  });

  it("says held for a step down", () => {
    expect(describeDecision({ row: 3, decision: "STEP_DOWN", by: "A", at: AT })).toBe(
      "HELD — stepped down",
    );
  });

  it("counts dropped and held", () => {
    expect(
      decisionCounts([
        { row: 1, decision: "DROP", reason: "DUPLICATE", by: "A", at: AT },
        { row: 2, decision: "STEP_DOWN", by: "A", at: AT },
        { row: 3, decision: "STEP_DOWN", by: "A", at: AT },
      ]),
    ).toEqual({ dropped: 1, held: 2 });
    expect(decisionCounts(undefined)).toEqual({ dropped: 0, held: 0 });
  });

  it("describes what was left out of the XML, or nothing", () => {
    expect(describeExcluded({ dropped: 3, held: 2 })).toBe(
      "3 dropped and 2 held case(s) will not be in the XML.",
    );
    expect(describeExcluded({ dropped: 0, held: 0 })).toBe("");
  });
});

describe("filtering the issues table", () => {
  const decisions: LineListDecision[] = [
    { row: 2, decision: "DROP", reason: "DUPLICATE", by: "A", at: AT },
    { row: 3, decision: "STEP_DOWN", by: "A", at: AT },
  ];
  const all = [issue(0), issue(1), issue(2), issue(3)];
  const rowsOf = (r: { kept: LineListIssue[]; decided: LineListIssue[] }) => ({
    kept: r.kept.map((i) => i.row),
    decided: r.decided.map((i) => i.row),
  });

  it("ALL puts decided rows after the kept ones", () => {
    expect(rowsOf(issuesForFilter(all, decisions, "ALL"))).toEqual({
      kept: [0, 1],
      decided: [2, 3],
    });
  });

  it("KEPT, DROPPED and HELD show only their own rows", () => {
    expect(rowsOf(issuesForFilter(all, decisions, "KEPT"))).toEqual({ kept: [0, 1], decided: [] });
    expect(rowsOf(issuesForFilter(all, decisions, "DROPPED"))).toEqual({ kept: [], decided: [2] });
    expect(rowsOf(issuesForFilter(all, decisions, "HELD"))).toEqual({ kept: [], decided: [3] });
  });
});

describe("decided cases that have no issues left", () => {
  // A held case must stay findable so it can be returned to Keep, even if
  // its issues have since gone (a Settings change can clear a blocker).
  // The issues table is built from issues, so without these rows such a
  // case would vanish from the screen for good.
  const decisions: LineListDecision[] = [
    { row: 2, decision: "DROP", reason: "DUPLICATE", by: "A", at: AT },
    { row: 5, decision: "STEP_DOWN", by: "A", at: AT },
    { row: 7, decision: "DROP", reason: "NOT_AN_AEFI", by: "A", at: AT },
  ];
  const issues = [issue(1), issue(2)];

  it("lists decided rows with no issue, in row order", () => {
    expect(decidedRowsWithoutIssues(issues, decisions, "ALL")).toEqual([5, 7]);
  });

  it("respects the filter", () => {
    expect(decidedRowsWithoutIssues(issues, decisions, "HELD")).toEqual([5]);
    expect(decidedRowsWithoutIssues(issues, decisions, "DROPPED")).toEqual([7]);
    expect(decidedRowsWithoutIssues(issues, decisions, "KEPT")).toEqual([]);
  });
});

describe("leaving decided cases out of the XML", () => {
  const decisions: LineListDecision[] = [
    { row: 1, decision: "DROP", reason: "DUPLICATE", by: "A", at: AT },
    { row: 3, decision: "STEP_DOWN", by: "A", at: AT },
  ];

  it("removes cases by their row position and counts them", () => {
    const out = excludeDecidedCases(["c1", "c2", "c3", "c4"], decisions, 4);
    expect(out).toEqual({ included: ["c2", "c4"], dropped: 1, held: 1 });
  });

  it("returns everything when nothing is decided", () => {
    expect(excludeDecidedCases(["c1"], undefined, 1)).toEqual({
      included: ["c1"],
      dropped: 0,
      held: 0,
    });
  });

  // Review Focus 1.
  it("refuses to guess when cases and rows do not line up one to one", () => {
    expect(() => excludeDecidedCases(["c1", "c2"], decisions, 3)).toThrow(/one case per row/i);
  });
});
