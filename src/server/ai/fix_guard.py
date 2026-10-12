"""What the line-list fix endpoint lets out of the server.

The model is told never to invent a value, but an instruction is not a
control. This module is the control on the backend: every answer the model
gives is checked here before the response leaves the server, so an invented
value, an identifier change or an ambiguous move never reaches any client,
whatever that client's code does. The app checks the same rules again
(src/services/api/linelist-ai-fix-guard.ts); both are tested against
src/services/api/fix-guard-vectors.json so they cannot drift apart.

Python note: regular expressions use [0-9], not \\d (which matches non-ASCII
digits), and no index may go negative (Python would wrap around).
"""

from __future__ import annotations

import re
from typing import Any, Optional

PROTECTED_FIELDS = {"case_id", "patient_id", "previous_case_id"}

FIELD_KIND = {
    "vaccination_date": "date",
    "report_date": "date",
    "onset_date": "date",
    "date_of_birth": "date",
    "state_received_date": "date",
    "national_received_date": "date",
    "age": "age",
    "sex": "sex",
    "reporter_phone": "phone",
}

MOVE_FILL_DESTINATION = 0.9
MOVE_FILL_OTHERS = 0.5

_DMY = re.compile(r"^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{2}|[0-9]{4})$")
_ISO = re.compile(r"^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$")


def _trimmed(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _alnum(v: str) -> str:
    return re.sub(r"[^a-z0-9]", "", v.lower())


def _digits(v: str) -> str:
    return re.sub(r"[^0-9]", "", v)


def _letters(v: str) -> str:
    return re.sub(r"[^a-z]", "", v.lower())


def value_kind(value: str) -> Optional[str]:
    v = value.strip()
    if _DMY.match(v) or _ISO.match(v):
        return "date"
    if re.match(r"^(m|f|male|female)$", v, re.IGNORECASE):
        return "sex"
    if re.match(r"^\+?[0-9]{10,14}$", re.sub(r"[\s-]", "", v)):
        return "phone"
    if re.match(r"^[0-9]{1,3}(\.[0-9]+)?$", v) and float(v) <= 130:
        return "age"
    return None


def _drops_one_repeat(big: str, small: str) -> bool:
    if len(big) != len(small) + 1:
        return False
    for k, ch in enumerate(big):
        repeats = (k > 0 and ch == big[k - 1]) or (k + 1 < len(big) and ch == big[k + 1])
        if repeats and big[:k] + big[k + 1 :] == small:
            return True
    return False


def _letter_typo(a: str, b: str) -> bool:
    if a == b:
        return True
    if len(a) == len(b):
        diff = sum(1 for x, y in zip(a, b) if x != y)
        return len(a) >= 2 and diff <= (1 if len(a) <= 3 else 2)
    return _drops_one_repeat(a, b) or _drops_one_repeat(b, a)


def _same_date_as_iso(source: str, to: str) -> bool:
    iso = _ISO.match(to.strip())
    dmy = _DMY.match(source.strip())
    if not iso or not dmy:
        return False
    return (
        int(iso.group(3)) == int(dmy.group(1))
        and int(iso.group(2)) == int(dmy.group(2))
        and iso.group(1).endswith(dmy.group(3))
    )


def is_derived_value(source: Any, to: Any, row_values: list) -> bool:
    """Whether `to` can replace `source` without inventing anything — the
    same rules as isDerivedValue in linelist-ai-fix-guard.ts. A dropped word
    is never accepted: it is information lost, not a correction."""
    a = _trimmed(source)
    b = _trimmed(to)
    if not b:
        return False
    if any(_trimmed(v) != "" and _trimmed(v) == b and _trimmed(v) != a for v in row_values):
        return True
    if _alnum(a) == _alnum(b):
        return True
    if _same_date_as_iso(a, b):
        return True
    same_digits = _digits(a) == _digits(b)
    same_letters = _letters(a) == _letters(b)
    if same_digits and not same_letters and len(_letters(a)) >= 2:
        return _letter_typo(_letters(a), _letters(b))
    if same_letters and not same_digits and len(_digits(b)) > 0:
        return _drops_one_repeat(_digits(a), _digits(b))
    return False


def _well_formed(c: Any) -> bool:
    return (
        isinstance(c, dict)
        and isinstance(c.get("row"), int)
        and not isinstance(c.get("row"), bool)
        and isinstance(c.get("column"), str)
        and isinstance(c.get("new_value"), str)
    )


def check_fix_answer(
    corrections: list,
    requested: list,
    rows: list,
    mapping: dict,
    column_fill: Optional[dict] = None,
) -> tuple[list, list]:
    """(accepted, refused) — the same rules as acceptedAiCorrections in
    linelist-ai-fix-guard.ts. `requested` is [{"row", "column"}], `rows` the
    file's rows (row N is index N-1). Refused entries carry a reason."""
    fill = column_fill or {}
    asked = {(r["row"], r["column"]) for r in requested}
    refused: list = []

    def refuse(c: dict, reason: str) -> None:
        # The refused value is kept, so a person can see whether the AI was
        # wrong or the rule too strict.
        if not any(x["row"] == c["row"] and x["column"] == c["column"] for x in refused):
            proposed = c.get("new_value") if isinstance(c.get("new_value"), str) else None
            refused.append({"row": c["row"], "column": c["column"], "reason": reason, "proposed": proposed})

    formed = []
    for c in corrections:
        if _well_formed(c):
            formed.append({**c, "reason": c.get("reason") if isinstance(c.get("reason"), str) else ""})
        elif isinstance(c, dict) and isinstance(c.get("row"), int) and isinstance(c.get("column"), str):
            refuse(c, "The AI's answer for this cell was malformed, so it was left as it is.")

    by_cell: dict = {}
    conflicted = set()
    for c in formed:
        k = (c["row"], c["column"])
        seen = by_cell.get(k)
        if seen is not None and _trimmed(seen["new_value"]) != _trimmed(c["new_value"]):
            conflicted.add(k)
        elif seen is None:
            by_cell[k] = c
    for k in conflicted:
        refuse(by_cell.pop(k), "The AI gave conflicting answers for this cell, so it was left as it is.")

    def row_of(n: int) -> Optional[dict]:
        return rows[n - 1] if 1 <= n <= len(rows) and isinstance(rows[n - 1], dict) else None

    def cell(n: int, column: str) -> str:
        r = row_of(n)
        return _trimmed(r.get(column)) if r else ""

    def protected(column: str) -> bool:
        return mapping.get(column) in PROTECTED_FIELDS

    move_of: dict = {}
    ambiguous = set()
    for c in by_cell.values():
        k = (c["row"], c["column"])
        if k in asked or c["column"] not in mapping or protected(c["column"]):
            continue
        r = row_of(c["row"])
        if r is None or cell(c["row"], c["column"]) != "":
            continue
        value = _trimmed(c["new_value"])
        if not value:
            continue
        source = next(
            (
                s
                for s in by_cell.values()
                if s["row"] == c["row"]
                and (s["row"], s["column"]) in asked
                and not protected(s["column"])
                and cell(s["row"], s["column"]) == value
            ),
            None,
        )
        if source is None:
            continue
        kind = value_kind(value)
        if not kind or FIELD_KIND.get(mapping.get(c["column"], "")) != kind:
            ambiguous.add(k)
            continue
        candidates = [
            h for h in r if h != source["column"] and FIELD_KIND.get(mapping.get(h, "")) == kind and _trimmed(r.get(h)) == ""
        ]
        settled = len(candidates) == 1 or (
            fill.get(c["column"], 0) >= MOVE_FILL_DESTINATION
            and all(h == c["column"] or fill.get(h, 1) <= MOVE_FILL_OTHERS for h in candidates)
        )
        if settled:
            move_of[k] = (c, source)
        else:
            ambiguous.add(k)

    source_move = {(m[1]["row"], m[1]["column"]): m for m in move_of.values()}
    accepted = []
    for c in by_cell.values():
        k = (c["row"], c["column"])
        if c["column"] not in mapping or row_of(c["row"]) is None:
            refuse(c, "The AI named a row or column that does not exist, so nothing was changed.")
            continue
        if protected(c["column"]):
            refuse(c, "Identifiers (case ID, patient record number) are never changed by Fix.")
            continue
        if k in move_of:
            accepted.append(c)
            continue
        if k not in asked:
            refuse(
                c,
                "Ambiguous destination: more than one empty column could hold this value, so it was left for a person."
                if k in ambiguous
                else "Fix did not ask about this cell, and it is not a valid move into an empty cell.",
            )
            continue
        if _trimmed(c["new_value"]) == "":
            if k in source_move:
                accepted.append(c)
            else:
                refuse(c, "The AI would have emptied this cell without putting its value anywhere, so it was left as it is.")
            continue
        others = [_trimmed(v) for v in (row_of(c["row"]) or {}).values()]
        if not is_derived_value(cell(c["row"], c["column"]), c["new_value"], others):
            refuse(c, "The AI proposed a value that is not in this cell or this row — Fix never invents a value.")
            continue
        accepted.append(c)
    return accepted, refused
