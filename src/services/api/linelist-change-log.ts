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
  /** Same value for every correction of one recovery move; see
   *  LineListChange.group. */
  group?: string | undefined;
}

/**
 * Records the corrections that will actually change something.
 *
 * Skips a cell a person holds, and a correction that would leave the value
 * as it is. Two corrections to one cell in one batch chain: the second's
 * old value is the first's new value. A grouped move is all or nothing: if
 * a person holds any of its cells, none of it is applied (clearing the
 * source while the held target keeps its own value would lose the value).
 * Pure — the given log is not mutated; the caller writes `applied` into the
 * job's rows.
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
  const blockedGroups = new Set(
    proposed.filter((p) => p.group && isCellHeld(log, p.row, p.column)).map((p) => p.group),
  );
  for (const p of proposed) {
    if (p.group && blockedGroups.has(p.group)) continue;
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
      ...(p.group ? { group: p.group } : {}),
    };
    working.push(entry);
    applied.push(entry);
    writtenThisBatch.set(key, p.newValue);
  }
  return { log: working, applied };
}

/** The entries that are undone and re-applied with this one: its whole
 *  group, or just itself when it has none. Log order. */
function membersOf(log: LineListChange[], entry: LineListChange): LineListChange[] {
  return entry.group ? log.filter((e) => e.group === entry.group) : [entry];
}

export type CellWrite = { row: number; column: string; value: string };

/**
 * Flips one entry, or its whole group, to `to`. Every member must be the
 * newest entry for its cell: undoing an older one underneath a newer one
 * would leave the cell in a state no entry describes, and undoing only half
 * of a move would lose or duplicate the value it moved.
 */
function toggle(
  log: LineListChange[],
  id: string,
  to: "undone" | "reapplied",
  by: string,
  at: string,
): { log: LineListChange[]; cells: CellWrite[]; entries: LineListChange[] } {
  const entry = log.find((e) => e.id === id);
  if (!entry) throw new Error("That change no longer exists.");
  const members = membersOf(log, entry);
  for (const m of members) {
    if (newestFor(log, m.row, m.column) !== m) {
      throw new Error("Only the latest change to a cell can be undone or re-applied.");
    }
  }
  const from: ChangeState = to === "undone" ? "applied" : "undone";
  for (const m of members) {
    if (stateOf(m) !== from) {
      throw new Error(
        to === "undone" ? "That change is already undone." : "That change is not undone.",
      );
    }
  }
  const updated = new Map(
    members.map((m) => [m.id, { ...m, events: [...m.events, { kind: to, by, at }] }]),
  );
  return {
    log: log.map((e) => updated.get(e.id) ?? e),
    cells: members.map((m) => ({
      row: m.row,
      column: m.column,
      value: to === "undone" ? m.oldValue : m.newValue,
    })),
    entries: [...updated.values()],
  };
}

/** A person takes the cell (or the whole move) over: the old values go back. */
export function markUndone(
  log: LineListChange[],
  id: string,
  by: string,
  at: string,
): { log: LineListChange[]; cells: CellWrite[]; entries: LineListChange[] } {
  return toggle(log, id, "undone", by, at);
}

/** A person hands the cell (or the whole move) back: the tool's values return. */
export function markReapplied(
  log: LineListChange[],
  id: string,
  by: string,
  at: string,
): { log: LineListChange[]; cells: CellWrite[]; entries: LineListChange[] } {
  return toggle(log, id, "reapplied", by, at);
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
  /** Part of a recovery move: its action acts on every cell of the move,
   *  and is offered only when the whole move can take it. */
  group: { id: string; size: number } | null;
  action: "undo" | "reapply" | null;
}

/** Newest first, as the Changes made panel lists them. */
export function panelEntries(log: LineListChange[]): PanelEntry[] {
  const isNewest = (e: LineListChange) => newestFor(log, e.row, e.column) === e;
  return [...log].reverse().map((entry) => {
    const newest = isNewest(entry);
    const state = stateOf(entry);
    const members = membersOf(log, entry);
    const whole = members.every((m) => isNewest(m) && stateOf(m) === state);
    return {
      entry,
      state,
      superseded: !newest,
      group: entry.group ? { id: entry.group, size: members.length } : null,
      action: !newest || !whole ? null : state === "applied" ? "undo" : "reapply",
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
