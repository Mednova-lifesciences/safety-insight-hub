# Line-list Decisions and Change Log (Plan 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person Keep, Drop or Step down each case from the issues table, and Undo or Re-apply each automatic correction, with an append-only change log of old → new values that the XML, the counts, the fixed CSV and the executive summary all read from.

**Architecture:** All rules live in three new pure modules — the change log, decisions, and the fixed-CSV builder — each fully unit-tested. `linelist.ts` and `export.ts` gain thin wiring that calls them; the screen gets two small components. Decided cases are removed from the XML **after** every row has been mapped, so no case's generated ID shifts.

**Tech Stack:** TypeScript, React, TanStack Router, vitest, Supabase (via the existing `readJob`/`saveJob`/`storeIssues` helpers), shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-10-05-linelist-decisions-and-fixed-workbook-design.md` — this plan is delivery **2a** (sections 4.3, 4.4, 5, 6.3, 7.1, 7.2, 7.4, 7.5). Plan 2b (the fixed workbook) follows.

## Global Constraints

- **Case IDs must not shift.** Map every row with its original position, then leave decided cases out (spec 5.5). Never filter `parsedRows` before `mapJobToCases`.
- **No manual edits.** People keep, drop, step down, undo, re-apply. Nothing in this plan lets a person type a new value (spec D6).
- **The change log is append-only.** Entries are never deleted or rewritten. Undo and Re-apply append an event (spec 4.3).
- **Undo and Re-apply act only on the newest entry for a cell** (spec 5.2, 5.3).
- **Drop requires a reason; reason `OTHER` requires a non-blank note** (spec 4.4).
- **Decided rows are not in the XML, not counted, and not fixed** (spec 5.1, 5.4).
- **No new permission rules** (spec D8).
- `exactOptionalPropertyTypes` is on: optional properties are spread conditionally (`...(x ? { k: x } : {})`), never assigned `undefined`.
- Run the suite with `npx vitest run --pool=threads`. On this machine the default forks pool can drop whole test files while printing a passing summary.
- Never commit a real line list. Test fixtures are built inside the tests.
- **API wiring is not unit-tested.** The repo has no Supabase test harness; every rule the wiring relies on is in a tested pure module, and the wiring is kept to calls of those functions. Wiring tasks are gated by `tsc`, the full suite and the build.
- **Clarification of spec 5.2:** Undo and Re-apply re-run the *deterministic* validation, as Fix does. An issue only the AI had found returns on the next **Re-run validation**, not immediately — running a full AI scan on every Undo would make Undo slow and its result non-deterministic. The Changes made panel marks the cell "kept by you", so it is not lost from view.
- The legacy XML generator (`buildE2bXml` in `src/services/api/e2b.ts`) is not reachable from the UI — only its override methods are called — and is not changed.
- `lastFixCorrections` is no longer written; it is still read for jobs fixed before this ships. Those older corrections appear, read-only, in the executive summary (spec 4.3); the Changes made panel lists only logged changes, since an older correction has no old value to undo.

## Review Focus

1. **Mapping output that is not one row → one case.** If `mapJobToCases` ever returned a different number of cases than there are rows, excluding "case at position N" would drop the wrong patient. `excludeDecidedCases` must refuse instead of guessing. Pinned in Task 3.
2. **Drop with reason "Other" and a note of only spaces** must be rejected, not saved as a blank justification in the audit trail. Pinned in Task 3.
3. **Old or new values containing quotes, commas or line breaks** must not split a case across CSV rows when they appear in "Changes made". Pinned in Task 4.
4. **A decision on a row that is not a case** — 0, negative, or past the last row — must be rejected, not stored as a phantom decision. Pinned in Task 3.
5. **Two decisions clicked in quick succession on one job** must both survive. Each is a read-modify-write of the job, so without serialising, the second save overwrites the first. Pinned in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/pv.ts` (modify) | New types: `LineListChange`, `LineListChangeEvent`, `LineListChangeSource`, `LineListDecision`, `LineListDecisionKind`, `DropReason`. `LineListJob` gains `changeLog?` and `decisions?`. |
| `src/services/api/linelist-change-log.ts` (create) | Pure change-log rules: state, newest entry, held cells, appending corrections with old values, undo/re-apply, panel view model, "Changes made" text, reading and writing a cell in the job's rows. |
| `src/services/api/linelist-decisions.ts` (create) | Pure decision rules: validate and set/clear, kept-only filtering, counts, labels, filter view model, excluding decided cases from mapped output. |
| `src/services/api/linelist-fixed-csv.ts` (create) | Pure builder for the fixed CSV: three new columns, step-down rows removed, dropped rows marked, code list kept. |
| `src/services/api/keyed-queue.ts` (create) | Serialises async work per key, so overlapping job writes cannot lose each other. |
| `src/services/api/linelist.ts` (modify) | Wiring: Fix records the change log and acts on kept rows; counts exclude decided rows; new `decideCase`, `keepCase`, `undoChange`, `reapplyChange`; CSV and executive summary read the log and decisions. |
| `src/services/e2b-r3/export.ts` (modify) | Leaves decided cases out of preflight and XML after mapping; reports how many. |
| `src/components/pv/linelist-decision-control.tsx` (create) | The per-row Keep / Drop… / Step down control and the Drop dialog. |
| `src/components/pv/linelist-changes-panel.tsx` (create) | The Changes made panel with Undo / Re-apply. |
| `src/routes/_app/line-list.tsx` (modify) | Decision column, filter, divider, counts from kept rows, the panel, download availability. |
| `src/routes/_app/e2b.tsx` (modify) | Says how many dropped and held cases are left out of the XML. |

---

### Task 1: Types

**Files:**
- Modify: `src/types/pv.ts` (the `LineListJob` interface, which starts at `export interface LineListJob {` and currently ends with the `openFixIn?` field)

**Interfaces:**
- Consumes: nothing new.
- Produces: `DropReason`, `LineListDecisionKind`, `LineListDecision`, `LineListChangeSource`, `LineListChangeEvent`, `LineListChange`; `LineListJob.changeLog?: LineListChange[]`, `LineListJob.decisions?: LineListDecision[]`.

- [ ] **Step 1: Add the new types immediately above `export interface LineListJob {`**

```ts
/** Why a case was dropped from a line list. */
export type DropReason = "DUPLICATE" | "NOT_AN_AEFI" | "INSUFFICIENT_INFORMATION" | "OTHER";

/** DROP leaves a case out of the XML but keeps it, marked, in the fixed
 *  file. STEP_DOWN holds it for later: out of the XML and out of the fixed
 *  file, until someone returns it to Keep. No decision means Keep. */
export type LineListDecisionKind = "DROP" | "STEP_DOWN";

export interface LineListDecision {
  /** 1-based data-row index — the same numbering LineListIssue.row uses. */
  row: number;
  decision: LineListDecisionKind;
  /** Required when decision is DROP. */
  reason?: DropReason | undefined;
  /** Required when reason is OTHER. Optional otherwise. */
  note?: string | undefined;
  by: string;
  at: string;
}

export type LineListChangeSource = "rule" | "ai" | "recovery";

export interface LineListChangeEvent {
  kind: "undone" | "reapplied";
  by: string;
  at: string;
}

/**
 * One automatic correction to one cell. Append-only: an entry is never
 * edited or deleted. Undo and Re-apply append to `events`, so the record of
 * what the tool changed — and what a person did about it — survives.
 */
export interface LineListChange {
  id: string;
  /** 1-based data-row index. */
  row: number;
  /** Original header text, as in rawRows. */
  column: string;
  oldValue: string;
  newValue: string;
  reason: string;
  source: LineListChangeSource;
  appliedAt: string;
  /** Oldest first. The last event decides the entry's state. */
  events: LineListChangeEvent[];
}
```

- [ ] **Step 2: Add the two fields to `LineListJob`, directly after the `openFixIn?: LineListFixLocation[] | undefined;` line**

```ts
  /** Every automatic correction ever applied to this job, with the value
   *  it replaced. Supersedes lastFixCorrections, which kept only the most
   *  recent run and never the old value. Absent until Fix first changes a
   *  cell. */
  changeLog?: LineListChange[] | undefined;
  /** The current Drop / Step down decision per case. No entry means Keep.
   *  History lives in the audit trail. */
  decisions?: LineListDecision[] | undefined;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/types/pv.ts
git commit -m "feat: types for line-list decisions and the change log"
```

---

### Task 2: The change log

**Files:**
- Create: `src/services/api/linelist-change-log.ts`
- Test: `src/services/api/linelist-change-log.test.ts`

**Interfaces:**
- Consumes: `LineListChange`, `LineListChangeSource` (Task 1).
- Produces:
  - `type ChangeState = "applied" | "undone"`
  - `stateOf(entry: LineListChange): ChangeState`
  - `newestFor(log: LineListChange[], row: number, column: string): LineListChange | undefined`
  - `isCellHeld(log: LineListChange[], row: number, column: string): boolean`
  - `interface ProposedCorrection { row: number; column: string; newValue: string; reason: string; source: LineListChangeSource }`
  - `appendCorrections(log, proposed: ProposedCorrection[], currentValue: (row: number, column: string) => string, at: string, makeId: () => string): { log: LineListChange[]; applied: LineListChange[] }`
  - `markUndone(log, id: string, by: string, at: string): { log: LineListChange[]; cell: { row: number; column: string; value: string } }`
  - `markReapplied(log, id: string, by: string, at: string): { log: LineListChange[]; cell: { row: number; column: string; value: string } }`
  - `appliedChangesForRow(log, row: number): LineListChange[]`
  - `describeChangesForRow(log, row: number): string`
  - `interface PanelEntry { entry: LineListChange; state: ChangeState; superseded: boolean; action: "undo" | "reapply" | null }`
  - `panelEntries(log): PanelEntry[]`
  - `type CellRows = { rawRows?: Record<string, string>[] | undefined; parsedRows: Record<string, string | undefined>[]; mapping: Record<string, string> }`
  - `readCell(rows: CellRows, row: number, column: string): string`
  - `writeCell(rows: CellRows, row: number, column: string, value: string): void` — mutates the arrays in `rows`; callers pass copies.

- [ ] **Step 1: Write the failing tests**

```ts
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
    const { log, applied } = appendCorrections(
      [],
      [proposal()],
      () => "recoverd",
      AT,
      idFactory(),
    );
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
    const again = appendCorrections(undone, [proposal({ newValue: "Recovered" })], () => "recoverd", AT, idFactory());
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
    const r = { parsedRows: [{ outcome: "2" }] as Record<string, string | undefined>[], mapping: { Outcome: "outcome" } };
    expect(readCell(r, 1, "Outcome")).toBe("2");
  });

  it("writes the raw cell and the mapped field together", () => {
    const r = rows();
    writeCell(r, 1, "Outcome", "1");
    expect(r.rawRows![0]!.Outcome).toBe("1");
    expect(r.parsedRows[0]!.outcome).toBe("1");
  });

  it("writes only the raw cell for an unmapped column", () => {
    const r = rows();
    writeCell(r, 1, "Remarks", "checked");
    expect(r.rawRows![0]!.Remarks).toBe("checked");
    expect(r.parsedRows[0]).toEqual({ outcome: "recoverd" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads src/services/api/linelist-change-log.test.ts`
Expected: FAIL — `Cannot find module './linelist-change-log'`.

- [ ] **Step 3: Write the implementation**

```ts
import type { LineListChange, LineListChangeSource } from "@/types/pv";

/**
 * The line-list change log.
 *
 * Every automatic correction is recorded with the value it replaced, and
 * nothing is ever deleted or rewritten: Undo and Re-apply append an event.
 * That is what makes a "what changed" column possible, what lets a person
 * reverse the tool, and what stops Fix from silently re-applying something
 * a person reversed.
 */

export type ChangeState = "applied" | "undone";

export function stateOf(entry: LineListChange): ChangeState {
  const last = entry.events[entry.events.length - 1];
  return last?.kind === "undone" ? "undone" : "applied";
}

const cellKey = (row: number, column: string) => `${row}\u0000${column}`;

/** The most recent entry for one cell. Entries are appended in time order,
 *  so the last match is the newest. */
export function newestFor(
  log: LineListChange[],
  row: number,
  column: string,
): LineListChange | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]!;
    if (entry.row === row && entry.column === column) return entry;
  }
  return undefined;
}

/** True when a person has taken this cell over by undoing the tool's
 *  latest change to it. Fix must leave such a cell alone. */
export function isCellHeld(log: LineListChange[], row: number, column: string): boolean {
  const newest = newestFor(log, row, column);
  return !!newest && stateOf(newest) === "undone";
}

export interface ProposedCorrection {
  row: number;
  column: string;
  newValue: string;
  reason: string;
  source: LineListChangeSource;
}

/**
 * Records the corrections that will actually change something.
 *
 * Skips a cell a person holds, and a correction that would leave the value
 * as it is. Two corrections to one cell in one batch chain: the second's
 * old value is the first's new value. Pure — the given log is not mutated;
 * the caller writes `applied` into the job's rows.
 */
export function appendCorrections(
  log: LineListChange[],
  proposed: ProposedCorrection[],
  currentValue: (row: number, column: string) => string,
  at: string,
  makeId: () => string,
): { log: LineListChange[]; applied: LineListChange[] } {
  const working = [...log];
  const applied: LineListChange[] = [];
  const writtenThisBatch = new Map<string, string>();
  for (const p of proposed) {
    if (isCellHeld(working, p.row, p.column)) continue;
    const key = cellKey(p.row, p.column);
    const oldValue = writtenThisBatch.get(key) ?? currentValue(p.row, p.column);
    if (oldValue === p.newValue) continue;
    const entry: LineListChange = {
      id: makeId(),
      row: p.row,
      column: p.column,
      oldValue,
      newValue: p.newValue,
      reason: p.reason,
      source: p.source,
      appliedAt: at,
      events: [],
    };
    working.push(entry);
    applied.push(entry);
    writtenThisBatch.set(key, p.newValue);
  }
  return { log: working, applied };
}

function newestEntryOrThrow(log: LineListChange[], id: string): LineListChange {
  const entry = log.find((e) => e.id === id);
  if (!entry) throw new Error("That change no longer exists.");
  // Only the newest entry for a cell may be reversed: undoing an older one
  // underneath a newer one would leave the cell in a state no entry
  // describes.
  if (newestFor(log, entry.row, entry.column) !== entry) {
    throw new Error("Only the latest change to a cell can be undone or re-applied.");
  }
  return entry;
}

/** A person takes the cell over: the old value goes back. */
export function markUndone(
  log: LineListChange[],
  id: string,
  by: string,
  at: string,
): { log: LineListChange[]; cell: { row: number; column: string; value: string } } {
  const entry = newestEntryOrThrow(log, id);
  if (stateOf(entry) !== "applied") throw new Error("That change is already undone.");
  const updated: LineListChange = { ...entry, events: [...entry.events, { kind: "undone", by, at }] };
  return {
    log: log.map((e) => (e.id === id ? updated : e)),
    cell: { row: entry.row, column: entry.column, value: entry.oldValue },
  };
}

/** A person hands the cell back: the tool's value returns. */
export function markReapplied(
  log: LineListChange[],
  id: string,
  by: string,
  at: string,
): { log: LineListChange[]; cell: { row: number; column: string; value: string } } {
  const entry = newestEntryOrThrow(log, id);
  if (stateOf(entry) !== "undone") throw new Error("That change is not undone.");
  const updated: LineListChange = {
    ...entry,
    events: [...entry.events, { kind: "reapplied", by, at }],
  };
  return {
    log: log.map((e) => (e.id === id ? updated : e)),
    cell: { row: entry.row, column: entry.column, value: entry.newValue },
  };
}

export function appliedChangesForRow(log: LineListChange[], row: number): LineListChange[] {
  return log.filter((e) => e.row === row && stateOf(e) === "applied");
}

/** The "Changes made" text for one row. Empty when nothing applies. */
export function describeChangesForRow(log: LineListChange[], row: number): string {
  return appliedChangesForRow(log, row)
    .map((e) => `${e.column}: "${e.oldValue}" → "${e.newValue}" (${e.reason})`)
    .join(" · ");
}

export interface PanelEntry {
  entry: LineListChange;
  state: ChangeState;
  /** A newer entry exists for the same cell; no action is offered. */
  superseded: boolean;
  action: "undo" | "reapply" | null;
}

/** Newest first, as the Changes made panel lists them. */
export function panelEntries(log: LineListChange[]): PanelEntry[] {
  return [...log].reverse().map((entry) => {
    const newest = newestFor(log, entry.row, entry.column) === entry;
    const state = stateOf(entry);
    return {
      entry,
      state,
      superseded: !newest,
      action: !newest ? null : state === "applied" ? "undo" : "reapply",
    };
  });
}

/** The job's two parallel row arrays and the column mapping between them. */
export type CellRows = {
  rawRows?: Record<string, string>[] | undefined;
  parsedRows: Record<string, string | undefined>[];
  mapping: Record<string, string>;
};

/** A cell's current value: the original column when the job has raw rows,
 *  otherwise the mapped canonical field. */
export function readCell(rows: CellRows, row: number, column: string): string {
  const idx = row - 1;
  const raw = rows.rawRows?.[idx];
  if (raw && column in raw) return raw[column] ?? "";
  const field = rows.mapping[column];
  return field ? (rows.parsedRows[idx]?.[field] ?? "") : "";
}

/** Writes one cell into the raw row and, when the column is mapped, the
 *  canonical field. Mutates the arrays in `rows` — pass copies. */
export function writeCell(rows: CellRows, row: number, column: string, value: string): void {
  const idx = row - 1;
  if (idx < 0) return;
  const raw = rows.rawRows?.[idx];
  if (rows.rawRows && raw && column in raw) {
    rows.rawRows[idx] = { ...raw, [column]: value };
  }
  const field = rows.mapping[column];
  if (field && idx < rows.parsedRows.length) {
    rows.parsedRows[idx] = { ...rows.parsedRows[idx], [field]: value };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads src/services/api/linelist-change-log.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/api/linelist-change-log.ts src/services/api/linelist-change-log.test.ts
git commit -m "feat: an append-only line-list change log with undo and re-apply"
```

---

### Task 3: Decisions

**Files:**
- Create: `src/services/api/linelist-decisions.ts`
- Test: `src/services/api/linelist-decisions.test.ts`

**Interfaces:**
- Consumes: `DropReason`, `LineListDecision`, `LineListDecisionKind`, `LineListIssue` (Task 1 and existing).
- Produces:
  - `DROP_REASON_LABELS: Record<DropReason, string>`
  - `interface DecisionInput { row: number; decision: LineListDecisionKind; reason?: DropReason; note?: string }`
  - `decisionFor(decisions: LineListDecision[] | undefined, row: number): LineListDecision | undefined`
  - `isExcluded(decisions: LineListDecision[] | undefined, row: number): boolean`
  - `withDecision(decisions: LineListDecision[] | undefined, input: DecisionInput, rowCount: number, by: string, at: string): LineListDecision[]`
  - `withoutDecision(decisions: LineListDecision[] | undefined, row: number): LineListDecision[]`
  - `keptOnly<T extends { row: number }>(items: T[], decisions: LineListDecision[] | undefined): T[]`
  - `describeDecision(d: LineListDecision): string`
  - `decisionCounts(decisions: LineListDecision[] | undefined): { dropped: number; held: number }`
  - `describeExcluded(counts: { dropped: number; held: number }): string`
  - `type DecisionFilter = "ALL" | "KEPT" | "DROPPED" | "HELD"`
  - `issuesForFilter(issues: LineListIssue[], decisions: LineListDecision[] | undefined, filter: DecisionFilter): { kept: LineListIssue[]; decided: LineListIssue[] }`
  - `decidedRowsWithoutIssues(issues: LineListIssue[], decisions: LineListDecision[] | undefined, filter: DecisionFilter): number[]`
  - `excludeDecidedCases<T>(cases: T[], decisions: LineListDecision[] | undefined, rowCount: number): { included: T[]; dropped: number; held: number }`

- [ ] **Step 1: Write the failing tests**

```ts
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
    const out = withDecision([], { row: 3, decision: "DROP", reason: "DUPLICATE", note: "row 14" }, 10, "A. Bello", AT);
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
    const second = withDecision(first, { row: 2, decision: "DROP", reason: "NOT_AN_AEFI" }, 10, "B", AT);
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
    const out = withDecision([], { row: 1, decision: "DROP", reason: "OTHER", note: "  test entry  " }, 10, "A", AT);
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
    const all: LineListDecision[] = [1, 2].map((row) => ({ row, decision: "STEP_DOWN", by: "A", at: AT }));
    expect(keptOnly([issue(0), issue(1), issue(2)], all).map((i) => i.row)).toEqual([0]);
  });

  it("treats no decisions as everything kept", () => {
    expect(keptOnly([issue(1)], undefined)).toHaveLength(1);
  });
});

describe("describing decisions", () => {
  it("says dropped with the reason and the note", () => {
    expect(
      describeDecision({ row: 2, decision: "DROP", reason: "DUPLICATE", note: "row 14", by: "A", at: AT }),
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
    expect(rowsOf(issuesForFilter(all, decisions, "ALL"))).toEqual({ kept: [0, 1], decided: [2, 3] });
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
    expect(excludeDecidedCases(["c1"], undefined, 1)).toEqual({ included: ["c1"], dropped: 0, held: 0 });
  });

  // Review Focus 1.
  it("refuses to guess when cases and rows do not line up one to one", () => {
    expect(() => excludeDecidedCases(["c1", "c2"], decisions, 3)).toThrow(/one case per row/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads src/services/api/linelist-decisions.test.ts`
Expected: FAIL — `Cannot find module './linelist-decisions'`.

- [ ] **Step 3: Write the implementation**

```ts
import type {
  DropReason,
  LineListDecision,
  LineListDecisionKind,
  LineListIssue,
} from "@/types/pv";

/**
 * Case decisions on a line list: Keep (no entry), Drop, Step down.
 *
 * NAFDAC's bar for this tool is that it does the cleaning and people come
 * in only at the decision points — to accept, reject or step down cases.
 * These are those decision points, and every rule about what a decision
 * does lives here so the API, the XML and the screen cannot disagree.
 */

export const DROP_REASON_LABELS: Record<DropReason, string> = {
  DUPLICATE: "Duplicate",
  NOT_AN_AEFI: "Not an AEFI",
  INSUFFICIENT_INFORMATION: "Insufficient information",
  OTHER: "Other",
};

export interface DecisionInput {
  row: number;
  decision: LineListDecisionKind;
  reason?: DropReason;
  note?: string;
}

export function decisionFor(
  decisions: LineListDecision[] | undefined,
  row: number,
): LineListDecision | undefined {
  return decisions?.find((d) => d.row === row);
}

/** Both Drop and Step down take a case out of the XML and the counts. */
export function isExcluded(decisions: LineListDecision[] | undefined, row: number): boolean {
  return !!decisionFor(decisions, row);
}

/**
 * The decisions with this row's decision set — validated.
 *
 * A row that is not a case is refused rather than stored as a phantom
 * decision. A Drop needs a reason, and "Other" needs a note with actual
 * words in it: the audit trail is where someone will later ask why a case
 * never reached VigiFlow.
 */
export function withDecision(
  decisions: LineListDecision[] | undefined,
  input: DecisionInput,
  rowCount: number,
  by: string,
  at: string,
): LineListDecision[] {
  if (!Number.isInteger(input.row) || input.row < 1 || input.row > rowCount) {
    throw new Error(`Row ${input.row} is not a case in this line list.`);
  }
  const note = input.note?.trim() ?? "";
  if (input.decision === "DROP") {
    if (!input.reason) throw new Error("Choose a reason for dropping this case.");
    if (input.reason === "OTHER" && !note) {
      throw new Error('Add a note explaining the drop when the reason is "Other".');
    }
  }
  const next: LineListDecision = {
    row: input.row,
    decision: input.decision,
    ...(input.decision === "DROP" && input.reason ? { reason: input.reason } : {}),
    ...(note ? { note } : {}),
    by,
    at,
  };
  return [...(decisions ?? []).filter((d) => d.row !== input.row), next];
}

/** Back to Keep. */
export function withoutDecision(
  decisions: LineListDecision[] | undefined,
  row: number,
): LineListDecision[] {
  return (decisions ?? []).filter((d) => d.row !== row);
}

/**
 * Only what belongs to kept cases. A file-level item (row 0 or below) is
 * always kept: a wrong source form blocks the whole file, and dropping
 * cases does not make it go away.
 */
export function keptOnly<T extends { row: number }>(
  items: T[],
  decisions: LineListDecision[] | undefined,
): T[] {
  if (!decisions || decisions.length === 0) return items;
  return items.filter((i) => i.row < 1 || !isExcluded(decisions, i.row));
}

export function describeDecision(d: LineListDecision): string {
  const note = d.note ? `: ${d.note}` : "";
  if (d.decision === "STEP_DOWN") return `HELD — stepped down${note}`;
  const reason = d.reason ? DROP_REASON_LABELS[d.reason] : "No reason recorded";
  return `DROPPED — ${reason}${note}`;
}

export function decisionCounts(
  decisions: LineListDecision[] | undefined,
): { dropped: number; held: number } {
  const all = decisions ?? [];
  return {
    dropped: all.filter((d) => d.decision === "DROP").length,
    held: all.filter((d) => d.decision === "STEP_DOWN").length,
  };
}

/** One sentence for the E2B step, or "" when nothing is left out. */
export function describeExcluded(counts: { dropped: number; held: number }): string {
  if (counts.dropped === 0 && counts.held === 0) return "";
  return `${counts.dropped} dropped and ${counts.held} held case(s) will not be in the XML.`;
}

export type DecisionFilter = "ALL" | "KEPT" | "DROPPED" | "HELD";

/** The issues table's two groups: kept rows first, decided rows under the
 *  "not counted" divider. */
export function issuesForFilter(
  issues: LineListIssue[],
  decisions: LineListDecision[] | undefined,
  filter: DecisionFilter,
): { kept: LineListIssue[]; decided: LineListIssue[] } {
  const kept = keptOnly(issues, decisions);
  const decidedAs = (kind: LineListDecisionKind) =>
    issues.filter((i) => i.row >= 1 && decisionFor(decisions, i.row)?.decision === kind);
  switch (filter) {
    case "KEPT":
      return { kept, decided: [] };
    case "DROPPED":
      return { kept: [], decided: decidedAs("DROP") };
    case "HELD":
      return { kept: [], decided: decidedAs("STEP_DOWN") };
    default:
      return { kept, decided: issues.filter((i) => i.row >= 1 && isExcluded(decisions, i.row)) };
  }
}

/**
 * Decided cases with no open issue, for the filter in force.
 *
 * The issues table is built from issues, so a decided case whose issues
 * have all gone would otherwise disappear — and a held case that cannot be
 * seen cannot be returned to Keep.
 */
export function decidedRowsWithoutIssues(
  issues: LineListIssue[],
  decisions: LineListDecision[] | undefined,
  filter: DecisionFilter,
): number[] {
  if (filter === "KEPT") return [];
  const withIssues = new Set(issues.map((i) => i.row));
  return (decisions ?? [])
    .filter((d) => !withIssues.has(d.row))
    .filter(
      (d) =>
        filter === "ALL" ||
        (filter === "DROPPED" && d.decision === "DROP") ||
        (filter === "HELD" && d.decision === "STEP_DOWN"),
    )
    .map((d) => d.row)
    .sort((a, b) => a - b);
}

/**
 * Leaves decided cases out of mapped output, by row position.
 *
 * Called AFTER every row has been mapped. A case without its own ID gets
 * one generated from its row position (mapping.ts), so removing rows
 * before mapping would hand every later case a different ID on the next
 * export, and VigiFlow would see existing patients as new cases.
 *
 * Refuses when the cases do not line up one to one with the rows: then
 * "the case at position N" may not be row N's case, and excluding it would
 * drop the wrong patient.
 */
export function excludeDecidedCases<T>(
  cases: T[],
  decisions: LineListDecision[] | undefined,
  rowCount: number,
): { included: T[]; dropped: number; held: number } {
  if (cases.length !== rowCount) {
    throw new Error(
      `Expected one case per row (${rowCount} rows, ${cases.length} cases); refusing to guess which cases were decided.`,
    );
  }
  const included: T[] = [];
  let dropped = 0;
  let held = 0;
  cases.forEach((c, i) => {
    const d = decisionFor(decisions, i + 1);
    if (!d) included.push(c);
    else if (d.decision === "DROP") dropped++;
    else held++;
  });
  return { included, dropped, held };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads src/services/api/linelist-decisions.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/api/linelist-decisions.ts src/services/api/linelist-decisions.test.ts
git commit -m "feat: line-list case decisions — keep, drop with a reason, step down"
```

---

### Task 4: The fixed CSV builder

**Files:**
- Create: `src/services/api/linelist-fixed-csv.ts`
- Test: `src/services/api/linelist-fixed-csv.test.ts`

**Interfaces:**
- Consumes: `describeChangesForRow` (Task 2); `decisionFor`, `describeDecision` (Task 3); `LineListChange`, `LineListDecision`, `LineListIssue`.
- Produces:
  - `FIXED_FILE_COLUMNS: readonly ["Changes made", "Decision", "Still needs review"]`
  - `escapeCsvCell(value: string): string`
  - `stillNeedsReviewFor(row: number, issues: LineListIssue[], unresolved: { row: number; column: string; reason: string }[]): string`
  - `interface FixedCsvInput { columns: string[]; rows: Record<string, string>[]; changeLog: LineListChange[]; decisions: LineListDecision[]; issues: LineListIssue[]; unresolved: { row: number; column: string; reason: string }[]; preservedSourceText: string[] }`
  - `buildFixedCsv(input: FixedCsvInput): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { buildFixedCsv, escapeCsvCell, FIXED_FILE_COLUMNS, stillNeedsReviewFor } from "./linelist-fixed-csv";
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
  return { row, column: "Sex", severity: "HIGH", code: "X", message: "Sex not recognised", value: "?", ...overrides };
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
    expect(linesOf(buildFixedCsv(input()))[0]).toBe(["ID", "Outcome", "Sex", ...FIXED_FILE_COLUMNS].join(","));
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
      input({ decisions: [{ row: 2, decision: "DROP", reason: "DUPLICATE", note: "row 1", by: "A", at: AT }] }),
    );
    const lines = linesOf(csv);
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain("DROPPED — Duplicate: row 1");
  });

  it("leaves a stepped-down case out entirely", () => {
    const csv = buildFixedCsv(input({ decisions: [{ row: 2, decision: "STEP_DOWN", by: "A", at: AT }] }));
    expect(csv).not.toContain("NIE-002");
    expect(linesOf(csv)).toHaveLength(3);
  });

  it("keeps the source form's code list at the bottom", () => {
    const csv = buildFixedCsv(
      input({ preservedSourceText: ["KEY TO SUMMARY FINDINGS:", "3) OUTCOME: 1= Recovered, 2=Hospitalized"] }),
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
    const decisions: LineListDecision[] = [1, 2, 3].map((row) => ({ row, decision: "STEP_DOWN", by: "A", at: AT }));
    const csv = buildFixedCsv(input({ decisions, preservedSourceText: ["KEY TO SUMMARY FINDINGS:"] }));
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
    expect(records[1]![3]).toBe('Outcome: "said "fine", then\nfainted" → "Syncope" (matched code list: 1=Recovered)');
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --pool=threads src/services/api/linelist-fixed-csv.test.ts`
Expected: FAIL — `Cannot find module './linelist-fixed-csv'`.

- [ ] **Step 3: Write the implementation**

```ts
import type { LineListChange, LineListDecision, LineListIssue } from "@/types/pv";
import { describeChangesForRow } from "./linelist-change-log";
import { decisionFor, describeDecision } from "./linelist-decisions";

/**
 * The fixed line list as CSV — for `.csv` uploads, and for every upload
 * until the corrected-workbook download (plan 2b) exists.
 *
 * Three columns are added after the original ones. A dropped case stays,
 * marked, so the file still lines up row for row with what was submitted;
 * a stepped-down case is held for later and left out. The source form's
 * code list goes back at the bottom so a re-upload rediscovers it.
 */

export const FIXED_FILE_COLUMNS = ["Changes made", "Decision", "Still needs review"] as const;

export function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function stillNeedsReviewFor(
  row: number,
  issues: LineListIssue[],
  unresolved: { row: number; column: string; reason: string }[],
): string {
  const lines = [
    ...issues.filter((i) => i.row === row).map((i) => `${i.column}: ${i.message}`),
    ...unresolved.filter((u) => u.row === row).map((u) => `${u.column}: ${u.reason}`),
  ];
  return [...new Set(lines)].join(" · ");
}

export interface FixedCsvInput {
  columns: string[];
  /** One record per data row, keyed by original header; row N is index N-1. */
  rows: Record<string, string>[];
  changeLog: LineListChange[];
  decisions: LineListDecision[];
  issues: LineListIssue[];
  unresolved: { row: number; column: string; reason: string }[];
  /** The sparse rows the parser preserved — usually the code list. */
  preservedSourceText: string[];
}

export function buildFixedCsv(input: FixedCsvInput): string {
  const header = [...input.columns, ...FIXED_FILE_COLUMNS].map(escapeCsvCell).join(",");
  const body: string[] = [];
  input.rows.forEach((record, idx) => {
    const row = idx + 1;
    const decision = decisionFor(input.decisions, row);
    if (decision?.decision === "STEP_DOWN") return;
    body.push(
      [
        ...input.columns.map((c) => record[c] ?? ""),
        describeChangesForRow(input.changeLog, row),
        decision ? describeDecision(decision) : "",
        stillNeedsReviewFor(row, input.issues, input.unresolved),
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  });
  const lines = [header, ...body];
  if (input.preservedSourceText.length > 0) {
    lines.push("", escapeCsvCell("# ORIGINAL SOURCE TEXT — preserved from uploaded file"));
    lines.push(...input.preservedSourceText.map(escapeCsvCell));
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --pool=threads src/services/api/linelist-fixed-csv.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/api/linelist-fixed-csv.ts src/services/api/linelist-fixed-csv.test.ts
git commit -m "feat: the fixed CSV says what changed and what was decided on every row"
```

---

### Task 5: Leave decided cases out of the XML without renumbering anyone

**Files:**
- Modify: `src/services/e2b-r3/export.ts` (`ValidatedExportResult`; `runValidatedPreflightForJob`, which starts `const job = await readJob(jobId);`)
- Test: `src/services/e2b-r3/export-decisions.test.ts`

**Interfaces:**
- Consumes: `excludeDecidedCases` (Task 3); `mapJobToCases` (existing).
- Produces: `ValidatedExportResult.excludedByDecision: { dropped: number; held: number }`. `totalCases` now counts only the included cases.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

/**
 * Leaving a case out must not renumber anyone else.
 *
 * A case without its own ID gets one from its row position. If decided
 * rows were removed before mapping, every later case would carry a
 * different ID on the next export and VigiFlow would see existing patients
 * as new cases. So every row is mapped, and decided cases are removed from
 * the result. This drives the real mapping to prove the IDs hold.
 *
 * MedDRA coding is stubbed: it is the only part of this path that needs a
 * server, and nothing here is about coding.
 */
vi.mock("./coding-provider", async () => {
  const actual = await vi.importActual<typeof import("./coding-provider")>("./coding-provider");
  return { ...actual, meddra29Provider: actual.unavailableMedDraProvider };
});

const { mapJobToCases } = await import("./export");
const { unconfiguredOrgRegulatoryConfig } = await import("./regulatory-config");
const { excludeDecidedCases } = await import("@/services/api/linelist-decisions");

const TRANSMISSION = {
  environment: "uat" as const,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND-01" },
  receiver: { identifier: "NAFDAC-RCV-01" },
  reportType: "1" as const,
  reportTypeConfirmed: true,
};

const config = () => ({ ...unconfiguredOrgRegulatoryConfig(), transmission: TRANSMISSION });

// No case_id on any row: every ID is generated from row position.
const row = (patient: string) => ({
  patient_identifier: patient,
  product: "Penta",
  reaction: "Fever",
  outcome: "Recovered",
  reporter_designation: "Nurse",
});

const job = {
  id: "job-decisions",
  filename: "ondo_aefi.csv",
  sourceProfileId: "generic-verbatim",
  mapping: { Patient: "patient_identifier" },
  parsedRows: [row("A.A."), row("B.B."), row("C.C."), row("D.D.")],
};

describe("dropping a case leaves every other case's ID where it was", () => {
  it("keeps generated IDs stable when an earlier row is dropped", async () => {
    const { cases } = await mapJobToCases(job, config());
    const before = cases.map((c) => [c.internalCaseId, c.sendersCaseId]);

    const { included, dropped, held } = excludeDecidedCases(
      cases,
      [
        { row: 1, decision: "DROP", reason: "DUPLICATE", by: "A", at: "2026-10-05T10:00:00Z" },
        { row: 3, decision: "STEP_DOWN", by: "A", at: "2026-10-05T10:00:00Z" },
      ],
      job.parsedRows.length,
    );

    expect({ dropped, held }).toEqual({ dropped: 1, held: 1 });
    expect(included.map((c) => [c.internalCaseId, c.sendersCaseId])).toEqual([before[1], before[3]]);
  });

  it("would have renumbered them had rows been removed first — the trap this avoids", async () => {
    const { cases: all } = await mapJobToCases(job, config());
    const { cases: filteredFirst } = await mapJobToCases(
      { ...job, parsedRows: [job.parsedRows[1]!, job.parsedRows[3]!] },
      config(),
    );
    expect(filteredFirst.map((c) => c.sendersCaseId)).not.toEqual([
      all[1]!.sendersCaseId,
      all[3]!.sendersCaseId,
    ]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run --pool=threads src/services/e2b-r3/export-decisions.test.ts`
Expected: PASS, 2 tests — this test pins behaviour of functions that already exist (Tasks 3 and the mapper) composed the way Step 3 wires them. It must pass **before** the wiring, proving the composition is right; if the second test fails, the premise of spec 5.5 is wrong and the executor must stop and report it.

- [ ] **Step 3: Wire it into `runValidatedPreflightForJob`**

Add to the imports at the top of `src/services/e2b-r3/export.ts`:

```ts
import { excludeDecidedCases } from "@/services/api/linelist-decisions";
```

Replace:

```ts
  const job = await readJob(jobId);
  const { cases, mappingWarnings, sourceProfile, discovered } = await mapJobToCases(
    job,
    regulatoryConfig,
    explicitProfile,
  );
```

with:

```ts
  const job = await readJob(jobId);
  const mapped = await mapJobToCases(job, regulatoryConfig, explicitProfile);
  const { mappingWarnings, sourceProfile, discovered } = mapped;
  // Every row is mapped first and decided cases are left out afterwards: a
  // case without its own ID is numbered by row position, so removing rows
  // before mapping would renumber every later case (spec 5.5). Done before
  // the C.1.7 loop so a dropped case costs no assessment and no AI call.
  const excluded = excludeDecidedCases(
    mapped.cases,
    job.decisions,
    (job.parsedRows ?? []).length,
  );
  const cases = excluded.included;
```

In `export interface ValidatedExportResult`, directly after `totalCases: number;` add:

```ts
  /** Cases left out of preflight and the XML by a person's decision on the
   *  line list. Never counted in totalCases. */
  excludedByDecision: { dropped: number; held: number };
```

In the object `runValidatedPreflightForJob` returns, directly after `totalCases: cases.length,` add:

```ts
    excludedByDecision: { dropped: excluded.dropped, held: excluded.held },
```

- [ ] **Step 4: Typecheck and run the export tests**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. If `tsc` reports `excludedByDecision` missing on another object literal typed `ValidatedExportResult`, add `excludedByDecision: { dropped: 0, held: 0 }` there.

Run: `npx vitest run --pool=threads src/services/e2b-r3`
Expected: PASS, no failures.

- [ ] **Step 5: Commit**

```bash
git add src/services/e2b-r3/export.ts src/services/e2b-r3/export-decisions.test.ts
git commit -m "feat: decided cases leave the XML after mapping, so no case is renumbered"
```

---

### Task 6: Serialised job writes; Fix records the change log and fixes kept rows only; counts exclude decided rows

**Files:**
- Create: `src/services/api/keyed-queue.ts`
- Test: `src/services/api/keyed-queue.test.ts`
- Modify: `src/services/api/linelist.ts` — `storeIssues` (starts `async function storeIssues(`), and `fixIssues` in the `linelist` object (starts `fixIssues: async (`).

**Interfaces:**
- Consumes: `appendCorrections`, `readCell`, `writeCell` (Task 2); `keptOnly` (Task 3).
- Produces: `createKeyedQueue(): <T>(key: string, work: () => Promise<T>) => Promise<T>`; a module-level `inJobQueue` in `linelist.ts`, used by Tasks 6 and 7.

- [ ] **Step 1: Write the failing queue tests**

```ts
import { describe, expect, it } from "vitest";
import { createKeyedQueue } from "./keyed-queue";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("the keyed queue", () => {
  // Review Focus 5: two decisions on one job are two read-modify-writes;
  // run together, the second save would overwrite the first.
  it("runs work for the same key one after another", async () => {
    const inQueue = createKeyedQueue();
    const order: string[] = [];
    const a = inQueue("job-1", async () => {
      order.push("a:start");
      await tick();
      order.push("a:end");
    });
    const b = inQueue("job-1", async () => {
      order.push("b:start");
      order.push("b:end");
    });
    await Promise.all([a, b]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("does not make different keys wait for each other", async () => {
    const inQueue = createKeyedQueue();
    const order: string[] = [];
    const slow = inQueue("job-1", async () => {
      await tick();
      order.push("job-1");
    });
    const fast = inQueue("job-2", async () => {
      order.push("job-2");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["job-2", "job-1"]);
  });

  it("keeps going after a failure, and still reports the failure", async () => {
    const inQueue = createKeyedQueue();
    const failed = inQueue("job-1", async () => {
      throw new Error("boom");
    });
    const next = inQueue("job-1", async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run --pool=threads src/services/api/keyed-queue.test.ts`
Expected: FAIL — `Cannot find module './keyed-queue'`.

- [ ] **Step 3: Write the queue**

```ts
/**
 * Serialises async work per key.
 *
 * Line-list writes read the whole job and save it back. Two overlapping —
 * a person dropping two cases in quick succession, or a drop landing while
 * Fix is running — would let the later save overwrite the earlier one's
 * change with a stale copy. Queueing per job closes that within this tab.
 * The same pattern as the PSUR memo's document queue.
 */
export function createKeyedQueue() {
  const queues = new Map<string, Promise<unknown>>();
  return function inQueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    queues.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };
}
```

- [ ] **Step 4: Run the queue tests to verify they pass**

Run: `npx vitest run --pool=threads src/services/api/keyed-queue.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the imports and the job queue to `linelist.ts`**

Add to the imports at the top of `src/services/api/linelist.ts`:

```ts
import { appendCorrections, readCell, writeCell } from "./linelist-change-log";
import { keptOnly } from "./linelist-decisions";
import { createKeyedQueue } from "./keyed-queue";
```

Immediately above `async function readJob(jobId: string)` add:

```ts
/** Every write to one job — Fix, decisions, undo — runs one at a time. */
const inJobQueue = createKeyedQueue();
```

- [ ] **Step 6: Make `storeIssues` count kept rows only**

In `storeIssues`, the issues are still all stored (decided rows are shown greyed). Only the counts change. Replace:

```ts
  const blocking = issues.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
  const advisory = issues.filter((i) => i.severity === "MEDIUM" || i.severity === "LOW");
```

with:

```ts
  // Dropped and held cases are left out of the XML, so they are left out
  // of every count that says how ready the file is. Their issues are still
  // stored and still shown, under the "not counted" divider.
  const counted = keptOnly(issues, job.decisions);
  const keptRows = Math.max(job.rows - (job.decisions?.length ?? 0), 0);
  const blocking = counted.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
  const advisory = counted.filter((i) => i.severity === "MEDIUM" || i.severity === "LOW");
```

Replace `const e2bBlocked = issues.filter((i) => i.blocksE2b);` with:

```ts
  const e2bBlocked = counted.filter((i) => i.blocksE2b);
```

In the `next` object, replace these six lines:

```ts
    criticalCount: issues.filter((i) => i.severity === "CRITICAL").length,
    highCount: issues.filter((i) => i.severity === "HIGH").length,
    mediumCount: issues.filter((i) => i.severity === "MEDIUM").length,
    lowCount: issues.filter((i) => i.severity === "LOW").length,
    validCases: Math.max(job.rows - invalidCases, 0),
    e2bBlockedCases: wholeFileBlocked ? job.rows : new Set(e2bBlocked.map((i) => i.row)).size,
```

with:

```ts
    criticalCount: counted.filter((i) => i.severity === "CRITICAL").length,
    highCount: counted.filter((i) => i.severity === "HIGH").length,
    mediumCount: counted.filter((i) => i.severity === "MEDIUM").length,
    lowCount: counted.filter((i) => i.severity === "LOW").length,
    validCases: Math.max(keptRows - invalidCases, 0),
    e2bBlockedCases: wholeFileBlocked ? keptRows : new Set(e2bBlocked.map((i) => i.row)).size,
```

- [ ] **Step 7: Serialise `fixIssues`**

Replace the method's opening:

```ts
  fixIssues: async (
    jobId: string,
  ): Promise<{
```

with:

```ts
  fixIssues: (
    jobId: string,
  ): Promise<{
```

and the line `  }> => {` that ends its return type (the first `  }> => {` after `fixIssues: (`) with:

```ts
  }> =>
    inJobQueue(jobId, async () => {
```

Then replace the method's closing — the lines

```ts
      aiError: fixResult.error ?? undefined,
    };
  },

  /**
   * Creates a new line-list processing job directly from case data already
```

with:

```ts
      aiError: fixResult.error ?? undefined,
    };
    }),

  /**
   * Creates a new line-list processing job directly from case data already
```

- [ ] **Step 8: Fix acts on kept rows only and records the change log**

Replace:

```ts
    const allFixable = currentIssues.filter((i) => i.fixable);
```

with:

```ts
    // Dropped and held cases are not corrected (spec 5.1). A held case
    // returned to Keep is picked up by the next run.
    const allFixable = keptOnly(currentIssues, job.decisions).filter((i) => i.fixable);
```

In the early-return branch for `autoFixable.length === 0`, replace:

```ts
      await saveJob({
        ...job,
        lastFixCorrections: [],
        lastFixUnresolved: needsReviewUnresolved,
      });
```

with:

```ts
      await saveJob({ ...job, lastFixUnresolved: needsReviewUnresolved });
```

Replace:

```ts
    const deterministicRecovery = buildRecoveryCorrections(job);
```

with:

```ts
    const deterministicRecovery = keptOnly(buildRecoveryCorrections(job), job.decisions);
```

Replace the whole block from `    if (corrections.length > 0) {` down to and including the closing of its `else` branch:

```ts
    } else {
      updatedJob = { ...job, lastFixCorrections: [], lastFixUnresolved: combinedUnresolved };
      await saveJob(updatedJob);
    }
```

with:

```ts
    // Every correction is recorded with the value it replaced, so it can be
    // shown, undone and audited. A cell a person has taken over is skipped
    // (appendCorrections), and so is a correction that changes nothing.
    const recoveredKeys = new Set(recoveredCorrections.map((c) => `${c.row}:${c.column}`));
    const cellRows = {
      rawRows: job.rawRows ? [...job.rawRows] : undefined,
      parsedRows: [...job.parsedRows] as Record<string, string | undefined>[],
      mapping: job.mapping as Record<string, string>,
    };
    const { log: changeLog, applied } = appendCorrections(
      job.changeLog ?? [],
      corrections.map((c) => ({
        row: c.row,
        column: c.column,
        newValue: c.new_value,
        reason: c.reason,
        source: recoveredKeys.has(`${c.row}:${c.column}`) ? ("recovery" as const) : ("ai" as const),
      })),
      (row, column) => readCell(cellRows, row, column),
      new Date().toISOString(),
      () => newId("llc"),
    );
    for (const change of applied) writeCell(cellRows, change.row, change.column, change.newValue);
    if (applied.length > 0) {
      updatedJob = {
        ...job,
        parsedRows: cellRows.parsedRows as ParsedRow[],
        ...(cellRows.rawRows ? { rawRows: cellRows.rawRows } : {}),
        fixedAt: new Date().toISOString(),
        changeLog,
        lastFixUnresolved: combinedUnresolved,
      };
      await saveJob(updatedJob);
      await recordAudit({
        action: "LINELIST_AI_FIX_APPLIED",
        entity: "LineListJob",
        entityId: jobId,
        newValue: `${applied.length} field(s) corrected, ${combinedUnresolved.length} left unresolved`,
        reason: `Prompt ${fixResult.prompt_version}`,
      });
    } else {
      updatedJob = { ...job, lastFixUnresolved: combinedUnresolved };
      await saveJob(updatedJob);
    }
```

Replace:

```ts
    const correctedKeys = new Set(corrections.map((c) => `${c.row}:${c.column}`));
```

with:

```ts
    // Only what was actually applied resolves an issue: a skipped held cell
    // keeps its finding.
    const correctedKeys = new Set(applied.map((c) => `${c.row}:${c.column}`));
```

Replace `      correctionsApplied: corrections.length,` with:

```ts
      correctionsApplied: applied.length,
```

- [ ] **Step 9: Typecheck, then run the line-list and full suites**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx vitest run --pool=threads`
Expected: all test files pass, 0 errors. Read the "Test Files" count and confirm it equals the previous run's count plus the new files — a smaller number means files were silently skipped.

- [ ] **Step 10: Commit**

```bash
git add src/services/api/keyed-queue.ts src/services/api/keyed-queue.test.ts src/services/api/linelist.ts
git commit -m "feat: Fix records every change with its old value, skips decided cases and held cells"
```

---

### Task 7: The API for decisions, Undo and Re-apply

**Files:**
- Modify: `src/services/api/linelist.ts` — add four methods to the `linelist` object, directly after `fixIssues`.

**Interfaces:**
- Consumes: `inJobQueue` (Task 6); `markUndone`, `markReapplied`, `readCell`, `writeCell` (Task 2); `withDecision`, `withoutDecision`, `decisionFor`, `describeDecision`, `DecisionInput` (Task 3); existing `readJob`, `storeIssues`, `computeDeterministicIssues`, `mergeFindings`, `recordAudit`, `currentActor`, `rowLabel`.
- Produces on `linelist` (exported as `linelist`, imported in the UI as `linelistApi`):
  - `decideCase(jobId: string, input: DecisionInput): Promise<LineListJob>`
  - `keepCase(jobId: string, row: number): Promise<LineListJob>`
  - `undoChange(jobId: string, changeId: string): Promise<LineListJob>`
  - `reapplyChange(jobId: string, changeId: string): Promise<LineListJob>`

- [ ] **Step 1: Extend the imports added in Task 6**

Replace:

```ts
import { appendCorrections, readCell, writeCell } from "./linelist-change-log";
import { keptOnly } from "./linelist-decisions";
```

with:

```ts
import {
  appendCorrections,
  markReapplied,
  markUndone,
  readCell,
  writeCell,
} from "./linelist-change-log";
import {
  decisionFor,
  describeDecision,
  keptOnly,
  withDecision,
  withoutDecision,
  type DecisionInput,
} from "./linelist-decisions";
```

- [ ] **Step 2: Add a module-level helper for Undo and Re-apply, directly above `export const linelist = {`**

```ts
/**
 * Writes one restored cell, records the event, and re-runs the
 * deterministic checks so the screen shows the cell's real state.
 *
 * Only the deterministic rules re-run: an issue only the AI had found
 * returns on the next "Re-run validation". A full AI scan on every Undo
 * would make Undo slow and its result non-deterministic.
 */
async function restoreCell(
  job: LineListJobRow,
  changeLog: LineListChange[],
  cell: { row: number; column: string; value: string },
  audit: { action: string; previousValue: string; newValue: string },
): Promise<LineListJobRow> {
  if (!job.parsedRows || !job.mapping) {
    throw new Error("This job has no stored row data to change.");
  }
  const cellRows = {
    rawRows: job.rawRows ? [...job.rawRows] : undefined,
    parsedRows: [...job.parsedRows] as Record<string, string | undefined>[],
    mapping: job.mapping as Record<string, string>,
  };
  writeCell(cellRows, cell.row, cell.column, cell.value);
  const updated: LineListJobRow = {
    ...job,
    parsedRows: cellRows.parsedRows as ParsedRow[],
    ...(cellRows.rawRows ? { rawRows: cellRows.rawRows } : {}),
    changeLog,
  };
  const currentIssues = await linelist.issues(job.id);
  const priorAi = currentIssues.filter((i) => i.source === "ai");
  const finalIssues = mergeFindings(await computeDeterministicIssues(updated), priorAi);
  const next = await storeIssues(updated, finalIssues, { validatedAt: new Date().toISOString() });
  await recordAudit({
    action: audit.action,
    entity: "LineListJob",
    entityId: job.id,
    previousValue: audit.previousValue,
    newValue: audit.newValue,
    reason: `${rowLabel(job, cell.row)}, ${cell.column}`,
  });
  return next;
}
```

Add `LineListChange` to the existing `import type { … } from "@/types/pv";` list in `linelist.ts`.

- [ ] **Step 3: Add the four methods to the `linelist` object, directly after the `}),` that now closes `fixIssues`**

```ts
  /** Drop or step down one case. Recounts without re-validating: a
   *  decision changes what counts, not what is wrong. */
  decideCase: (jobId: string, input: DecisionInput): Promise<LineListJob> =>
    inJobQueue(jobId, async () => {
      const job = await readJob(jobId);
      const actor = currentActor();
      const decisions = withDecision(
        job.decisions,
        input,
        job.parsedRows?.length ?? job.rows,
        actor.name,
        new Date().toISOString(),
      );
      const next = await storeIssues({ ...job, decisions }, await linelist.issues(jobId));
      await recordAudit({
        action: input.decision === "DROP" ? "LINELIST_CASE_DROPPED" : "LINELIST_CASE_STEPPED_DOWN",
        entity: "LineListJob",
        entityId: jobId,
        newValue: `${rowLabel(job, input.row)}: ${describeDecision(decisionFor(decisions, input.row)!)}`,
      });
      return next;
    }),

  /** Return a dropped or held case to Keep. */
  keepCase: (jobId: string, row: number): Promise<LineListJob> =>
    inJobQueue(jobId, async () => {
      const job = await readJob(jobId);
      const previous = decisionFor(job.decisions, row);
      if (!previous) return job;
      const decisions = withoutDecision(job.decisions, row);
      const next = await storeIssues({ ...job, decisions }, await linelist.issues(jobId));
      await recordAudit({
        action: "LINELIST_CASE_KEPT",
        entity: "LineListJob",
        entityId: jobId,
        previousValue: `${rowLabel(job, row)}: ${describeDecision(previous)}`,
        newValue: `${rowLabel(job, row)}: KEPT`,
      });
      return next;
    }),

  /** A person takes a cell over: the old value returns and Fix leaves the
   *  cell alone from now on. */
  undoChange: (jobId: string, changeId: string): Promise<LineListJob> =>
    inJobQueue(jobId, async () => {
      const job = await readJob(jobId);
      const actor = currentActor();
      const { log, cell } = markUndone(job.changeLog ?? [], changeId, actor.name, new Date().toISOString());
      const entry = log.find((e) => e.id === changeId)!;
      return restoreCell(job, log, cell, {
        action: "LINELIST_CHANGE_UNDONE",
        previousValue: entry.newValue,
        newValue: entry.oldValue,
      });
    }),

  /** Hands the cell back to the tool: its value returns. */
  reapplyChange: (jobId: string, changeId: string): Promise<LineListJob> =>
    inJobQueue(jobId, async () => {
      const job = await readJob(jobId);
      const actor = currentActor();
      const { log, cell } = markReapplied(
        job.changeLog ?? [],
        changeId,
        actor.name,
        new Date().toISOString(),
      );
      const entry = log.find((e) => e.id === changeId)!;
      return restoreCell(job, log, cell, {
        action: "LINELIST_CHANGE_REAPPLIED",
        previousValue: entry.oldValue,
        newValue: entry.newValue,
      });
    }),
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx vitest run --pool=threads`
Expected: all test files pass, 0 errors, file count unchanged from Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/services/api/linelist.ts
git commit -m "feat: API to drop, step down, keep, undo and re-apply — serialised and audited"
```

---

### Task 8: The fixed CSV download and the executive summary read the log and the decisions

**Files:**
- Modify: `src/services/api/linelist.ts` — `downloadCsv` and `downloadExecutiveSummary` in the `linelist` object.

**Interfaces:**
- Consumes: `buildFixedCsv` (Task 4); `stateOf` (Task 2); `decisionCounts`, `describeDecision`, `keptOnly` (Task 3).
- Produces: no new names.

- [ ] **Step 1: Extend the imports**

Add `stateOf` to the `./linelist-change-log` import list, `decisionCounts` to the `./linelist-decisions` import list, and add:

```ts
import { buildFixedCsv } from "./linelist-fixed-csv";
```

- [ ] **Step 2: Rebuild `downloadCsv` on `buildFixedCsv`**

In `downloadCsv`, replace everything from the line `    const { columns } = job;` up to and including the line `    const blob = new Blob([lines.join("\n")], { type: "text/csv" });` with:

```ts
    const { columns } = job;
    const issues = await linelist.issues(jobId);
    // createFromCases jobs have no raw rows; rebuild each record from the
    // canonical fields so the builder always sees original headers.
    const rows: Record<string, string>[] =
      job.rawRows ??
      job.parsedRows!.map((row) =>
        Object.fromEntries(
          columns.map((header) => {
            const field = job.mapping![header] as TargetField | undefined;
            return [header, field ? (row[field] ?? "") : ""];
          }),
        ),
      );
    const csv = buildFixedCsv({
      columns,
      rows,
      changeLog: job.changeLog ?? [],
      decisions: job.decisions ?? [],
      issues,
      unresolved: job.lastFixUnresolved ?? [],
      preservedSourceText: (job.discardedRows ?? [])
        .map((entry) => entry.text.trim())
        .filter(Boolean),
    });
    const blob = new Blob([csv], { type: "text/csv" });
```

- [ ] **Step 3: The executive summary reports changes from the log, and decisions**

In `downloadExecutiveSummary`, replace the whole block that starts `    if (job.lastFixCorrections || job.lastFixUnresolved) {` and ends with its closing `    }` (the block that pushes `RUN FULL FIX`, `CORRECTED —` and `UNRESOLVED —` lines) with:

```ts
    const logged = job.changeLog ?? [];
    // Jobs fixed before the change log existed still show what was recorded.
    const legacyCorrections = job.changeLog ? [] : (job.lastFixCorrections ?? []);
    if (job.changeLog || job.lastFixCorrections || job.lastFixUnresolved) {
      lines.push(
        `RUN FULL FIX${job.fixedAt ? ` — last applied ${job.fixedAt.slice(0, 16).replace("T", " ")} UTC` : ""}`,
      );
      lines.push(rule);
      const applied = logged.filter((c) => stateOf(c) === "applied");
      const undone = logged.filter((c) => stateOf(c) === "undone");
      const unresolved = job.lastFixUnresolved ?? [];
      if (applied.length === 0 && legacyCorrections.length === 0 && unresolved.length === 0) {
        lines.push("Fix Issues was run and found nothing it could safely auto-correct.");
      }
      for (const c of applied) {
        lines.push(
          `CORRECTED — ${rowLabel(job, c.row)}, ${c.column}: "${c.oldValue}" → "${c.newValue}" (${c.reason})`,
        );
      }
      for (const c of legacyCorrections) {
        lines.push(
          `CORRECTED — ${rowLabel(job, c.row)}, ${c.column}: "${c.new_value}" (${c.reason})`,
        );
      }
      for (const c of undone) {
        const last = c.events[c.events.length - 1]!;
        lines.push(
          `UNDONE — ${rowLabel(job, c.row)}, ${c.column}: kept as "${c.oldValue}" by ${last.by}`,
        );
      }
      for (const u of unresolved) {
        lines.push(`UNRESOLVED — ${rowLabel(job, u.row)}, ${u.column}: ${u.reason}`);
      }
      lines.push("");
    }

    if ((job.decisions ?? []).length > 0) {
      const { dropped, held } = decisionCounts(job.decisions);
      lines.push(`CASE DECISIONS — ${dropped} dropped, ${held} held (left out of the E2B(R3) XML)`);
      lines.push(rule);
      for (const d of [...job.decisions!].sort((a, b) => a.row - b.row)) {
        lines.push(`${rowLabel(job, d.row)}: ${describeDecision(d)} — ${d.by}, ${d.at.slice(0, 10)}`);
      }
      lines.push("");
    }
```

Then, in the same method, replace:

```ts
    const e2bBlockers = issues.filter((i) => i.blocksE2b && i.row > 0);
```

with:

```ts
    // A dropped or held case is not going to VigiFlow, so it blocks nothing.
    const e2bBlockers = keptOnly(issues, job.decisions).filter((i) => i.blocksE2b && i.row > 0);
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npx vitest run --pool=threads`
Expected: all test files pass, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/api/linelist.ts
git commit -m "feat: the fixed CSV and the executive summary report changes and decisions"
```

---

### Task 9: The Decision control on the issues table

**Files:**
- Create: `src/components/pv/linelist-decision-control.tsx`
- Modify: `src/routes/_app/line-list.tsx` — the issues table, the Fix count, the readiness banner.

**Interfaces:**
- Consumes: `linelist.decideCase`, `linelist.keepCase` (Task 7); `DROP_REASON_LABELS`, `decisionFor`, `issuesForFilter`, `keptOnly`, `decisionCounts`, `DecisionFilter` (Task 3).
- Produces: `LineListDecisionControl({ job, row, onChanged }: { job: LineListJob; row: number; onChanged: () => void })`.

This task's behaviour rules are all tested in Task 3; the component is verified by `tsc`, lint and the build. The repo has no DOM test setup.

- [ ] **Step 1: Create the control**

```tsx
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/pv/primitives";
import { linelist as linelistApi } from "@/services/api/linelist";
import { DROP_REASON_LABELS, decisionFor } from "@/services/api/linelist-decisions";
import type { DropReason, LineListJob } from "@/types/pv";

/**
 * Keep · Drop… · Step down for one case.
 *
 * The decision applies to the case, so every issue row of that case shows
 * the same control and the same state.
 */
export function LineListDecisionControl({
  job,
  row,
  onChanged,
}: {
  job: LineListJob;
  row: number;
  onChanged: () => void;
}) {
  const current = decisionFor(job.decisions, row);
  const [busy, setBusy] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [reason, setReason] = useState<DropReason | "">("");
  const [note, setNote] = useState("");

  if (row < 1) return <span className="text-xs text-muted-foreground">Whole file</span>;

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the decision.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDrop = async () => {
    if (!reason) return;
    await run(
      () =>
        linelistApi.decideCase(job.id, {
          row,
          decision: "DROP",
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      "Case dropped — it will not be in the XML.",
    );
    setDropOpen(false);
    setReason("");
    setNote("");
  };

  return (
    <div className="flex items-center gap-1.5">
      {current ? (
        <StatusPill tone={current.decision === "DROP" ? "critical" : "warning"}>
          {current.decision === "DROP" ? "Dropped" : "Held"}
        </StatusPill>
      ) : (
        <span className="text-xs text-muted-foreground">Keep</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={busy} aria-label="Decide this case">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {current ? (
            <DropdownMenuItem
              onSelect={() => void run(() => linelistApi.keepCase(job.id, row), "Case returned to Keep.")}
            >
              Keep
            </DropdownMenuItem>
          ) : null}
          {current?.decision !== "DROP" ? (
            <DropdownMenuItem onSelect={() => setDropOpen(true)}>Drop…</DropdownMenuItem>
          ) : null}
          {current?.decision !== "STEP_DOWN" ? (
            <DropdownMenuItem
              onSelect={() =>
                void run(
                  () => linelistApi.decideCase(job.id, { row, decision: "STEP_DOWN" }),
                  "Case held for later — out of the XML and the fixed file until you keep it.",
                )
              }
            >
              Step down
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dropOpen} onOpenChange={setDropOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop this case</DialogTitle>
            <DialogDescription>
              It will not be in the XML. It stays in the fixed line list, marked as dropped, with
              the reason you give.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={reason} onValueChange={(v) => setReason(v as DropReason)}>
            {(Object.keys(DROP_REASON_LABELS) as DropReason[]).map((r) => (
              <div key={r} className="flex items-center gap-2">
                <RadioGroupItem value={r} id={`drop-${row}-${r}`} />
                <Label htmlFor={`drop-${row}-${r}`}>{DROP_REASON_LABELS[r]}</Label>
              </div>
            ))}
          </RadioGroup>
          <div className="space-y-1.5">
            <Label htmlFor={`drop-note-${row}`}>
              Note{reason === "OTHER" ? " (required)" : " (optional)"}
            </Label>
            <Textarea
              id={`drop-note-${row}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={reason === "DUPLICATE" ? "e.g. duplicate of file row 14" : ""}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDropOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !reason || (reason === "OTHER" && !note.trim())}
              onClick={() => void confirmDrop()}
            >
              Drop case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the issues table**

In `src/routes/_app/line-list.tsx`, add to the imports:

```tsx
import { LineListDecisionControl } from "@/components/pv/linelist-decision-control";
import {
  decisionCounts,
  issuesForFilter,
  keptOnly,
  type DecisionFilter,
} from "@/services/api/linelist-decisions";
```

Next to the existing `const [fixing, setFixing] = useState(false);` add:

```tsx
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("ALL");
```

In the Fix button's render function, replace:

```tsx
                    const fixableCount = rows.filter((i) => i.fixable).length;
```

with:

```tsx
                    // Dropped and held cases are not fixed (spec 5.1).
                    const fixableCount = keptOnly(rows, activeJob.decisions).filter(
                      (i) => i.fixable,
                    ).length;
```

Replace:

```tsx
                const rows = onlyE2bBlockers ? allRows.filter((i) => i.blocksE2b) : allRows;
```

with:

```tsx
                const counted = keptOnly(allRows, activeJob.decisions);
                const base = onlyE2bBlockers ? allRows.filter((i) => i.blocksE2b) : allRows;
                const { kept, decided } = issuesForFilter(
                  base,
                  activeJob.decisions,
                  decisionFilter,
                );
                const rows = [...kept, ...decided];
                const { held } = decisionCounts(activeJob.decisions);
```

Replace `<E2bReadinessBanner job={activeJob} issues={allRows} />` with:

```tsx
                    <E2bReadinessBanner job={activeJob} issues={counted} />
```

Directly after the closing `) : null}` of the "Show only what blocks E2B(R3) / VigiFlow" label, add the filter row:

```tsx
                    {(activeJob.decisions ?? []).length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Show:</span>
                        {(
                          [
                            ["ALL", "All"],
                            ["KEPT", "Kept"],
                            ["DROPPED", "Dropped"],
                            ["HELD", `Held (${held})`],
                          ] as [DecisionFilter, string][]
                        ).map(([value, label]) => (
                          <Button
                            key={value}
                            size="sm"
                            variant={decisionFilter === value ? "default" : "outline"}
                            className="h-7 px-2.5 text-xs"
                            onClick={() => setDecisionFilter(value)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
```

In the table header array, add `"Decision"` after `"Source"`:

```tsx
                                "Source",
                                "Decision",
```

Change `import type { LineListJob } from "@/types/pv";` to:

```tsx
import type { LineListIssue, LineListJob } from "@/types/pv";
```

and add `decidedRowsWithoutIssues` to the `@/services/api/linelist-decisions` import added above.

Directly after the line `const { held } = decisionCounts(activeJob.decisions);` (added above), add the row renderer and the decided cases that have no issues. The cells are today's cells, unchanged, plus `opacity-60` for decided rows and a final Decision cell:

```tsx
                const withoutIssues = decidedRowsWithoutIssues(
                  allRows,
                  activeJob.decisions,
                  decisionFilter,
                );
                const refresh = () => {
                  issues.refetch();
                  jobs.refetch();
                };
                const renderIssueRow = (i: LineListIssue, idx: number, muted: boolean) => (
                  <tr
                    key={`${i.row}-${i.column}-${idx}`}
                    className={cn("border-b border-border last:border-0", muted && "opacity-60")}
                  >
                    <td className="mono-num px-3 py-2">
                      {i.row < 1 ? "—" : (describeRow(activeJob, i.row).fileRow ?? `#${i.row}`)}
                    </td>
                    <td className="mono-num whitespace-nowrap px-3 py-2">
                      {describeRow(activeJob, i.row).caseId ?? "—"}
                    </td>
                    <td className="mono-num px-3 py-2">{i.column}</td>
                    <td className="px-3 py-2">
                      <StatusPill
                        tone={
                          i.severity === "CRITICAL"
                            ? "critical"
                            : i.severity === "HIGH"
                              ? "warning"
                              : i.severity === "MEDIUM"
                                ? "info"
                                : "neutral"
                        }
                      >
                        {i.severity.toLowerCase()}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2">
                      {i.blocksE2b ? (
                        <StatusPill tone="critical">Blocks</StatusPill>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <p>{i.message}</p>
                      <FixAction fixIn={i.fixIn} />
                    </td>
                    <td className="mono-num px-3 py-2 text-muted-foreground">{i.value ?? "—"}</td>
                    <td className="px-3 py-2">
                      <StatusPill
                        tone={
                          i.sources && i.sources.length > 1
                            ? "success"
                            : i.source === "ai"
                              ? "assist"
                              : "neutral"
                        }
                      >
                        {i.sources && i.sources.length > 1
                          ? "rule + AI"
                          : i.source === "ai"
                            ? "AI"
                            : "rule"}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2">
                      <LineListDecisionControl job={activeJob} row={i.row} onChanged={refresh} />
                    </td>
                  </tr>
                );
```

Change the empty-state condition `{rows.length === 0 ? (` to:

```tsx
                    {rows.length === 0 && withoutIssues.length === 0 ? (
```

Replace the table body — from `                          <tbody>` through its `</tbody>` — with:

```tsx
                          <tbody>
                            {kept.map((i, idx) => renderIssueRow(i, idx, false))}
                            {kept.length > 0 && decided.length + withoutIssues.length > 0 ? (
                              <tr className="border-b border-border bg-muted/30">
                                <td colSpan={9} className="px-3 py-1.5 text-xs text-muted-foreground">
                                  Dropped or held — not counted
                                </td>
                              </tr>
                            ) : null}
                            {decided.map((i, idx) => renderIssueRow(i, kept.length + idx, true))}
                            {withoutIssues.map((row) => (
                              <tr
                                key={`decided-${row}`}
                                className="border-b border-border last:border-0 opacity-60"
                              >
                                <td className="mono-num px-3 py-2">
                                  {describeRow(activeJob, row).fileRow ?? `#${row}`}
                                </td>
                                <td className="mono-num whitespace-nowrap px-3 py-2">
                                  {describeRow(activeJob, row).caseId ?? "—"}
                                </td>
                                <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground">
                                  No open issues
                                </td>
                                <td className="px-3 py-2">
                                  <LineListDecisionControl job={activeJob} row={row} onChanged={refresh} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
```

- [ ] **Step 3: Typecheck, lint and build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npm run lint`
Expected: no new errors in the touched files.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/pv/linelist-decision-control.tsx src/routes/_app/line-list.tsx
git commit -m "feat: keep, drop or step down a case from the issues table"
```

---

### Task 10: The Changes made panel, download availability, and the E2B step

**Files:**
- Create: `src/components/pv/linelist-changes-panel.tsx`
- Modify: `src/routes/_app/line-list.tsx` — the Fix toast, the download button's condition, the panel.
- Modify: `src/routes/_app/e2b.tsx` — the preflight toasts.

**Interfaces:**
- Consumes: `linelist.undoChange`, `linelist.reapplyChange` (Task 7); `panelEntries` (Task 2); `describeExcluded` (Task 3); `describeRow` (existing); `ValidatedExportResult.excludedByDecision` (Task 5).
- Produces: `LineListChangesPanel({ job, onChanged }: { job: LineListJob; onChanged: () => void })`.

- [ ] **Step 1: Create the panel**

```tsx
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section, StatusPill } from "@/components/pv/primitives";
import { describeRow, linelist as linelistApi } from "@/services/api/linelist";
import { panelEntries } from "@/services/api/linelist-change-log";
import type { LineListJob } from "@/types/pv";

const MADE_BY = { ai: "AI", rule: "rule", recovery: "recovery" } as const;

/**
 * Every automatic correction, newest first, with Undo or Re-apply.
 *
 * Undo means "I'm taking this cell over": the old value returns and Fix
 * leaves the cell alone. Re-apply hands it back. Only the newest change to
 * a cell can be reversed; older ones are shown as superseded.
 */
export function LineListChangesPanel({
  job,
  onChanged,
}: {
  job: LineListJob;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const entries = panelEntries(job.changeLog ?? []);
  if (entries.length === 0) return null;

  const act = async (id: string, action: "undo" | "reapply") => {
    setBusy(id);
    try {
      if (action === "undo") await linelistApi.undoChange(job.id, id);
      else await linelistApi.reapplyChange(job.id, id);
      toast.success(action === "undo" ? "Change undone — the cell is yours now." : "Change re-applied.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update that change.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      title="Changes made"
      description="Every correction Fix applied, with the value it replaced. Undo keeps the original value and stops Fix changing that cell again."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              {["File row", "Case ID", "Column", "Was → Now", "Why", "Made by", ""].map((h) => (
                <th key={h} className="label-caps px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map(({ entry, state, superseded, action }) => {
              const where = describeRow(job, entry.row);
              return (
                <tr
                  key={entry.id}
                  className={`border-b border-border last:border-0 ${superseded ? "opacity-50" : ""}`}
                >
                  <td className="mono-num px-3 py-2">{where.fileRow ?? `#${entry.row}`}</td>
                  <td className="mono-num whitespace-nowrap px-3 py-2">{where.caseId ?? "—"}</td>
                  <td className="mono-num px-3 py-2">{entry.column}</td>
                  <td className="px-3 py-2">
                    <span className="text-muted-foreground line-through">{entry.oldValue || "(blank)"}</span>
                    {" → "}
                    <span>{entry.newValue || "(blank)"}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{entry.reason}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={entry.source === "ai" ? "assist" : "neutral"}>
                      {MADE_BY[entry.source]}
                    </StatusPill>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {superseded ? (
                      <span className="text-xs text-muted-foreground">Superseded</span>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        {state === "undone" ? (
                          <StatusPill tone="info">Kept by you</StatusPill>
                        ) : null}
                        {action ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === entry.id}
                            onClick={() => void act(entry.id, action)}
                          >
                            {action === "undo" ? "Undo" : "Re-apply"}
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Wire the panel, the toast and the download into `line-list.tsx`**

Add to the imports:

```tsx
import { LineListChangesPanel } from "@/components/pv/linelist-changes-panel";
```

In the Fix button's success toast, replace:

```tsx
                                `${result.correctionsApplied} field(s) corrected.${result.unresolved.length ? ` ${result.unresolved.length} left unresolved.` : ""}`,
```

with:

```tsx
                                `${result.correctionsApplied} field(s) corrected — see Changes made below.${result.unresolved.length ? ` ${result.unresolved.length} left unresolved.` : ""}`,
```

Replace the download button's condition `{AUTO_FIX_ENABLED && activeJob.fixedAt ? (` with:

```tsx
                {AUTO_FIX_ENABLED &&
                (activeJob.fixedAt || (activeJob.decisions ?? []).length > 0) ? (
```

Directly after the `<ReactionTermsPanel … />` element inside the issues section, add:

```tsx
                    <LineListChangesPanel
                      job={activeJob}
                      onChanged={() => {
                        issues.refetch();
                        jobs.refetch();
                      }}
                    />
```

- [ ] **Step 3: Say what is left out of the XML on the E2B step**

In `src/routes/_app/e2b.tsx`, add to the imports:

```tsx
import { describeExcluded } from "@/services/api/linelist-decisions";
```

After `setPreflightResults((prev) => ({ ...prev, [jobId]: result }));` add:

```tsx
      const leftOut = describeExcluded(result.excludedByDecision);
```

Then prefix the three preflight toasts with it. Replace:

```tsx
          `${result.totalCases} case(s) passed VigiFlow preflight — ready for real E2B(R3) export.`,
```

with:

```tsx
          `${result.totalCases} case(s) passed VigiFlow preflight — ready for real E2B(R3) export.${leftOut ? ` ${leftOut}` : ""}`,
```

Replace:

```tsx
          "All cases passed VigiFlow preflight, but transmission configuration (sender/receiver identifiers) is not yet confirmed by NAFDAC/Ondo — export still blocked.",
```

with:

```tsx
          `All cases passed VigiFlow preflight, but transmission configuration (sender/receiver identifiers) is not yet confirmed by NAFDAC/Ondo — export still blocked.${leftOut ? ` ${leftOut}` : ""}`,
```

Replace:

```tsx
          `${result.preflight.blockedCases}/${result.totalCases} case(s) blocked — see reasons below. Not ready for validated export.`,
```

with:

```tsx
          `${result.preflight.blockedCases}/${result.totalCases} case(s) blocked — see reasons below. Not ready for validated export.${leftOut ? ` ${leftOut}` : ""}`,
```

- [ ] **Step 4: Typecheck, lint, full suite and build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run: `npm run lint`
Expected: no new errors in the touched files.

Run: `npx vitest run --pool=threads`
Expected: all test files pass, 0 errors; the file count is the pre-plan count plus 5 (`linelist-change-log`, `linelist-decisions`, `linelist-fixed-csv`, `export-decisions`, `keyed-queue`).

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/pv/linelist-changes-panel.tsx src/routes/_app/line-list.tsx src/routes/_app/e2b.tsx
git commit -m "feat: the Changes made panel with undo and re-apply; the E2B step names what it leaves out"
```

---

## Out of scope for this plan

- **The corrected workbook (plan 2b):** storing the original upload, recording sheet positions, ExcelJS, highlights and notes, merge-safe row removal, renaming the download, the "231 cases · 12 changed" summary line, and the re-upload rules.
- **Column-mapping fixes (sub-project 1)**, including the C.1.4 received date.
- **An all-cases view** for dropping a case that has no issues.
- **Role-based RLS** on line-list tables.
