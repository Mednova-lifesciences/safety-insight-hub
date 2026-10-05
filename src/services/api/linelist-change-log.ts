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
