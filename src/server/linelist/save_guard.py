"""Server validation of every saved cell change in a line list.

The browser computes corrections (rules, AI answers, recovery moves) and
Undo / Re-apply; before anything is stored the server compares the stored
job with the proposed one and refuses the whole save unless every changed
cell is explained by an append-only change-log entry that it can verify
itself:

- rule:     the named rule, re-run here (server/linelist/normalise.py) on
            the stored value, gives exactly the new value;
- ai:       the new value is derived from the stored value (no invented
            value; server/ai/fix_guard.py), or the cell is part of a move
            or swap group;
- recovery: always a move or swap group;
- group:    the cells of a move or swap only rearrange their values —
            nothing invented, nothing lost;
- undo / re-apply: the cell returns exactly to the entry's old / new value.

Identifier columns never change. Columns, mapping and row count never
change in a cell save. Reasons name a row and a column, never a value.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Optional

from ..ai.fix_guard import is_derived_value
from .normalise import normalise

PROTECTED_FIELDS = {"case_id", "patient_id", "previous_case_id"}
IMMUTABLE_ENTRY_KEYS = ("id", "row", "column", "oldValue", "newValue", "source", "group", "rule", "appliedAt")


def _cell(job: dict, row: int, column: str) -> str:
    raw = job.get("rawRows")
    if isinstance(raw, list):
        r = raw[row - 1] if 0 < row <= len(raw) and isinstance(raw[row - 1], dict) else {}
        return str(r.get(column) or "")
    parsed = job.get("parsedRows") or []
    field = (job.get("mapping") or {}).get(column)
    r = parsed[row - 1] if 0 < row <= len(parsed) and isinstance(parsed[row - 1], dict) else {}
    return str(r.get(field) or "") if field else ""


def _rows(job: dict) -> int:
    raw = job.get("rawRows")
    return len(raw) if isinstance(raw, list) else len(job.get("parsedRows") or [])


def validate_cell_save(current: dict, proposed: dict) -> list:
    """Problems that make the save unsafe: [{row, column, reason}]. Empty
    means every changed cell is accounted for."""
    problems: list = []

    def problem(row: int, column: str, reason: str) -> None:
        problems.append({"row": row, "column": column, "reason": reason})

    if proposed.get("columns") != current.get("columns") or proposed.get("mapping") != current.get("mapping"):
        problem(0, "(file)", "Columns or column mapping changed in a cell save.")
        return problems
    if _rows(proposed) != _rows(current) or isinstance(proposed.get("rawRows"), list) != isinstance(current.get("rawRows"), list):
        problem(0, "(file)", "The number of rows changed in a cell save.")
        return problems

    mapping = current.get("mapping") or {}
    columns = [c for c in (current.get("columns") or []) if c]
    old_log = current.get("changeLog") or []
    new_log = proposed.get("changeLog") or []
    if not isinstance(new_log, list):
        problem(0, "(file)", "The change log is not a list.")
        return problems

    # The change log only grows: no entry removed or rewritten, events only appended.
    by_id = {e.get("id"): e for e in new_log if isinstance(e, dict)}
    for e in old_log:
        n = by_id.get(e.get("id"))
        if n is None:
            problem(e.get("row", 0), e.get("column", ""), "A recorded change was removed from the change log.")
            continue
        if any(n.get(k) != e.get(k) for k in IMMUTABLE_ENTRY_KEYS):
            problem(e.get("row", 0), e.get("column", ""), "A recorded change was rewritten.")
        old_events, new_events = e.get("events") or [], n.get("events") or []
        if new_events[: len(old_events)] != old_events:
            problem(e.get("row", 0), e.get("column", ""), "The history of a recorded change was rewritten.")
    if problems:
        return problems

    old_ids = {e.get("id") for e in old_log}
    newest: dict = {}
    for e in new_log:
        if isinstance(e, dict):
            newest[(e.get("row"), e.get("column"))] = e
    old_events_by_id = {e.get("id"): len(e.get("events") or []) for e in old_log}

    changed = {
        (row, col)
        for row in range(1, _rows(current) + 1)
        for col in columns
        if _cell(current, row, col) != _cell(proposed, row, col)
    }

    # New entries must each correspond to a changed cell.
    new_entries = [e for e in new_log if isinstance(e, dict) and e.get("id") not in old_ids]
    for e in new_entries:
        if (e.get("row"), e.get("column")) not in changed:
            problem(e.get("row", 0), e.get("column", ""), "A recorded change was not applied to the cell.")

    groups: dict = {}
    for row, col in sorted(changed):
        if mapping.get(col) in PROTECTED_FIELDS:
            problem(row, col, "Identifiers are never changed.")
            continue
        entry = newest.get((row, col))
        before, after = _cell(current, row, col), _cell(proposed, row, col)
        if entry is None:
            problem(row, col, "The cell changed without a recorded correction.")
            continue
        if entry.get("id") in old_ids:
            added = (entry.get("events") or [])[old_events_by_id.get(entry.get("id"), 0):]
            if not added:
                problem(row, col, "The cell changed without a recorded correction.")
                continue
            kind = added[-1].get("kind") if isinstance(added[-1], dict) else None
            want = entry.get("oldValue") if kind == "undone" else entry.get("newValue") if kind == "reapplied" else None
            if want is None or after != want:
                problem(row, col, "Undo or Re-apply did not return the cell to its recorded value.")
            continue
        if entry.get("oldValue") != before or entry.get("newValue") != after or entry.get("events"):
            problem(row, col, "The recorded change does not match the stored value.")
            continue
        source = entry.get("source")
        if entry.get("group"):
            groups.setdefault(entry["group"], []).append((row, col, before, after))
            if source not in ("ai", "recovery"):
                problem(row, col, "Only AI and recovery changes may move values between cells.")
            continue
        if source == "rule":
            rule = entry.get("rule") or {}
            got = normalise(mapping.get(col, ""), before.strip(), col)
            if not got or got[0] != after or got[1] != rule.get("id") or got[2] != rule.get("version"):
                problem(row, col, "The rule does not give this value on the server.")
        elif source == "ai":
            others = [b for (r2, c2) in changed if r2 == row and c2 != col for b in [_cell(current, r2, c2)]]
            if not is_derived_value(before, after, others):
                problem(row, col, "The AI's value is not derived from this cell or this row.")
        else:
            problem(row, col, "Unknown kind of change.")

    for group, cells in groups.items():
        before_values = Counter(b.strip() for _, _, b, _ in cells if b.strip())
        after_values = Counter(a.strip() for _, _, _, a in cells if a.strip())
        if before_values != after_values:
            for row, col, _, _ in cells:
                problem(row, col, "A move would invent or lose a value.")

    # Mapped values change only on rows whose cells changed (jobs that keep
    # the original rows).
    if isinstance(current.get("rawRows"), list):
        rows_changed = {r for r, _ in changed}
        for i, (a, b) in enumerate(zip(current.get("parsedRows") or [], proposed.get("parsedRows") or []), start=1):
            if a != b and i not in rows_changed:
                problem(i, "(mapped values)", "Mapped values changed on a row whose cells did not.")
    return problems
