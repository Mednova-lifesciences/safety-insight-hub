import { describe, expect, it } from "vitest";
import {
  appendCorrections,
  appliedChangesForRow,
  describeChangesForRow,
  isCellHeld,
  markReapplied,
  markUndone,
  newestFor,
  panelEntries,
  readCell,
  stateOf,
  writeCell,
  type ProposedCorrection,
} from "./linelist-change-log";
import type { LineListChange } from "@/types/pv";

const AT = "2026-10-05T10:00:00Z";

function idFactory() {
  let n = 0;
  return () => `llc-${++n}`;
}

function proposal(overrides: Partial<ProposedCorrection> = {}): ProposedCorrection {
  return {
    row: 1,
    column: "Outcome",
    newValue: "1",
    reason: "matched code list: 1=Recovered",
    source: "ai",
    ...overrides,
  };
}

describe("appending corrections", () => {
  it("records the value it replaced", () => {
    const { log, applied } = appendCorrections([], [proposal()], () => "recoverd", AT, idFactory());
    expect(applied).toHaveLength(1);
    expect(log[0]).toMatchObject({
      id: "llc-1",
      row: 1,
      column: "Outcome",
      oldValue: "recoverd",
      newValue: "1",
      source: "ai",
      appliedAt: AT,
      events: [],
    });
  });

  it("skips a correction that would not change the value", () => {
    const { log, applied } = appendCorrections([], [proposal()], () => "1", AT, idFactory());
    expect(applied).toEqual([]);
    expect(log).toEqual([]);
  });

  it("never touches a cell a person has taken over", () => {
    const first = appendCorrections([], [proposal()], () => "recoverd", AT, idFactory());
    const { log: undone } = markUndone(first.log, "llc-1", "A. Bello", AT);
    const again = appendCorrections(
      undone,
      [proposal({ newValue: "Recovered" })],
      () => "recoverd",
      AT,
      idFactory(),
    );
    expect(again.applied).toEqual([]);
    expect(again.log).toHaveLength(1);
  });

  it("chains two corrections to one cell within one batch", () => {
    // The second correction's old value is the first one's new value, not
    // the value the row held before the batch started.
    const { log } = appendCorrections(
      [],
      [proposal({ newValue: "Recovered" }), proposal({ newValue: "1" })],
      () => "recoverd",
      AT,
      idFactory(),
    );
    expect(log.map((e) => [e.oldValue, e.newValue])).toEqual([
      ["recoverd", "Recovered"],
      ["Recovered", "1"],
    ]);
  });

  it("does not mutate the log it was given", () => {
    const original: LineListChange[] = [];
    appendCorrections(original, [proposal()], () => "recoverd", AT, idFactory());
    expect(original).toEqual([]);
  });
});

describe("state and the newest entry", () => {
  it("is applied with no events and after a re-apply, undone after an undo", () => {
    const { log } = appendCorrections([], [proposal()], () => "x", AT, idFactory());
    expect(stateOf(log[0]!)).toBe("applied");
    const undone = markUndone(log, "llc-1", "A", AT).log;
    expect(stateOf(undone[0]!)).toBe("undone");
    const back = markReapplied(undone, "llc-1", "A", AT).log;
    expect(stateOf(back[0]!)).toBe("applied");
  });

  it("finds the newest entry for a cell", () => {
    const { log } = appendCorrections(
      [],
      [proposal({ newValue: "a" }), proposal({ newValue: "b" })],
      () => "x",
      AT,
      idFactory(),
    );
    expect(newestFor(log, 1, "Outcome")?.id).toBe("llc-2");
    expect(newestFor(log, 2, "Outcome")).toBeUndefined();
  });

  it("calls a cell held only while its newest entry is undone", () => {
    const { log } = appendCorrections([], [proposal()], () => "x", AT, idFactory());
    expect(isCellHeld(log, 1, "Outcome")).toBe(false);
    const undone = markUndone(log, "llc-1", "A", AT).log;
    expect(isCellHeld(undone, 1, "Outcome")).toBe(true);
    expect(isCellHeld(markReapplied(undone, "llc-1", "A", AT).log, 1, "Outcome")).toBe(false);
  });
});

describe("undo and re-apply", () => {
  it("undo returns the old value to write back, and appends an event", () => {
    const { log } = appendCorrections([], [proposal()], () => "recoverd", AT, idFactory());
    const { log: next, cell } = markUndone(log, "llc-1", "A. Bello", "2026-10-05T11:00:00Z");
    expect(cell).toEqual({ row: 1, column: "Outcome", value: "recoverd" });
    expect(next[0]!.events).toEqual([
      { kind: "undone", by: "A. Bello", at: "2026-10-05T11:00:00Z" },
    ]);
    expect(log[0]!.events).toEqual([]);
  });

  it("re-apply returns the new value to write back", () => {
    const { log } = appendCorrections([], [proposal()], () => "recoverd", AT, idFactory());
    const undone = markUndone(log, "llc-1", "A", AT).log;
    expect(markReapplied(undone, "llc-1", "A", AT).cell.value).toBe("1");
  });

  it("refuses to undo an entry that is not the newest for its cell", () => {
    const { log } = appendCorrections(
      [],
      [proposal({ newValue: "a" }), proposal({ newValue: "b" })],
      () => "x",
      AT,
      idFactory(),
    );
    expect(() => markUndone(log, "llc-1", "A", AT)).toThrow(/latest change/i);
  });

  it("refuses to undo twice, or to re-apply something not undone", () => {
    const { log } = appendCorrections([], [proposal()], () => "x", AT, idFactory());
    const undone = markUndone(log, "llc-1", "A", AT).log;
    expect(() => markUndone(undone, "llc-1", "A", AT)).toThrow(/already undone/i);
    expect(() => markReapplied(log, "llc-1", "A", AT)).toThrow(/not undone/i);
  });

  it("refuses an id that does not exist", () => {
    expect(() => markUndone([], "nope", "A", AT)).toThrow(/no longer exists/i);
  });
});

describe("describing a row's changes", () => {
  it("lists applied changes as was → now with the reason", () => {
    const { log } = appendCorrections(
      [],
      [
        proposal({ column: "Age Years", newValue: "1", reason: "unit split from the number" }),
        proposal({ column: "Outcome", newValue: "1", reason: "matched code list: 1=Recovered" }),
      ],
      (_row, column) => (column === "Age Years" ? "1 yr" : "recoverd"),
      AT,
      idFactory(),
    );
    expect(describeChangesForRow(log, 1)).toBe(
      'Age Years: "1 yr" → "1" (unit split from the number) · Outcome: "recoverd" → "1" (matched code list: 1=Recovered)',
    );
  });

  it("leaves out undone changes", () => {
    const { log } = appendCorrections([], [proposal()], () => "recoverd", AT, idFactory());
    const undone = markUndone(log, "llc-1", "A", AT).log;
    expect(appliedChangesForRow(undone, 1)).toEqual([]);
    expect(describeChangesForRow(undone, 1)).toBe("");
  });
});

describe("the panel view", () => {
  it("lists newest first, offers one action per cell, and marks older entries superseded", () => {
    const { log } = appendCorrections(
      [],
      [proposal({ newValue: "a" }), proposal({ newValue: "b" }), proposal({ row: 2 })],
      () => "x",
      AT,
      idFactory(),
    );
    const rows = panelEntries(log);
    expect(rows.map((r) => [r.entry.id, r.superseded, r.action])).toEqual([
      ["llc-3", false, "undo"],
      ["llc-2", false, "undo"],
      ["llc-1", true, null],
    ]);
  });

  it("offers re-apply on an undone newest entry", () => {
    const { log } = appendCorrections([], [proposal()], () => "x", AT, idFactory());
    const undone = markUndone(log, "llc-1", "A", AT).log;
    expect(panelEntries(undone)[0]).toMatchObject({ state: "undone", action: "reapply" });
  });
});

describe("reading and writing a cell", () => {
  const rows = () => ({
    rawRows: [{ Outcome: "recoverd", Remarks: "" }],
    parsedRows: [{ outcome: "recoverd" }] as Record<string, string | undefined>[],
    mapping: { Outcome: "outcome" },
  });

  it("reads from rawRows first", () => {
    expect(readCell(rows(), 1, "Outcome")).toBe("recoverd");
  });

  it("falls back to parsedRows through the mapping when there is no raw row", () => {
    const r = {
      parsedRows: [{ outcome: "2" }] as Record<string, string | undefined>[],
      mapping: { Outcome: "outcome" },
    };
    expect(readCell(r, 1, "Outcome")).toBe("2");
  });

  it("writes the raw cell and the mapped field together", () => {
    const r = rows();
    writeCell(r, 1, "Outcome", "1");
    expect(r.rawRows![0]!.Outcome).toBe("1");
    expect(r.parsedRows[0]!["outcome"]).toBe("1");
  });

  it("writes only the raw cell for an unmapped column", () => {
    const r = rows();
    writeCell(r, 1, "Remarks", "checked");
    expect(r.rawRows![0]!.Remarks).toBe("checked");
    expect(r.parsedRows[0]).toEqual({ outcome: "recoverd" });
  });
});
