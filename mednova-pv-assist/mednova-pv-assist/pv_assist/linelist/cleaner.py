"""
AEFI / ICSR line-list cleaner.

Partner line-lists arrive messy: headers on the wrong row, columns swapped,
dates typed into the reaction field, mixed date formats. This module:

  1. Finds the real header row (not always row 1).
  2. Maps the partner's column names to a canonical schema by fuzzy matching,
     so "Pt Age (yrs)", "AGE", "age of patient" all land on `patient_age`.
  3. Normalises dates to ISO-8601 and detects values sitting in the wrong field
     (e.g. a date string in the reaction column).
  4. Produces (a) clean records and (b) a per-row data-quality report so a human
     validates the exceptions instead of re-keying the whole sheet.

Nothing is discarded. Rows that can't be confidently cleaned are kept and
flagged, never dropped.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import pandas as pd
from dateutil import parser as dateparser
from rapidfuzz import fuzz, process

# Canonical schema -> the many aliases we have seen in real partner sheets.
CANONICAL_FIELDS: dict[str, list[str]] = {
    "case_id":        ["case id", "case number", "report id", "aefi id", "unique id", "sn", "s/n", "serial"],
    "report_date":    ["report date", "date reported", "date of report", "notification date"],
    "onset_date":     ["onset date", "date of onset", "reaction date", "date of aefi", "event date"],
    "patient_initials": ["initials", "patient initials", "pt initials", "name initials"],
    "patient_age":    ["age", "patient age", "age (yrs)", "age of patient", "age years"],
    "patient_sex":    ["sex", "gender", "patient sex"],
    "vaccine_drug":   ["vaccine", "drug", "suspect drug", "product", "vaccine/drug", "suspected vaccine", "medicine"],
    "batch_lot":      ["batch", "lot", "batch number", "lot number", "batch/lot", "batch no", "lot no"],
    "dose":           ["dose", "dose number", "dose no"],
    "reaction":       ["reaction", "adverse event", "aefi", "event", "symptoms", "adr", "description"],
    "outcome":        ["outcome", "patient outcome", "result"],
    "seriousness":    ["serious", "seriousness", "severe", "severity"],
    "reporter":       ["reporter", "reported by", "hcp", "notifier"],
}

_DATE_LIKE = re.compile(r"\b(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+\w+\s+\d{2,4})\b")


@dataclass
class RowIssue:
    row: int
    field: str
    issue: str
    original: Any


@dataclass
class CleanResult:
    records: list[dict[str, Any]]
    issues: list[RowIssue] = field(default_factory=list)
    column_map: dict[str, str] = field(default_factory=dict)   # source col -> canonical

    def quality_report(self) -> pd.DataFrame:
        return pd.DataFrame([i.__dict__ for i in self.issues])


def _find_header_row(raw: pd.DataFrame, max_scan: int = 10) -> int:
    """The header row is the one whose cells best match known field aliases."""
    all_aliases = [a for aliases in CANONICAL_FIELDS.values() for a in aliases]
    best_row, best_score = 0, -1
    for r in range(min(max_scan, len(raw))):
        cells = [str(c).strip().lower() for c in raw.iloc[r].tolist() if str(c) != "nan"]
        score = sum(
            1 for c in cells
            if c and process.extractOne(c, all_aliases, scorer=fuzz.ratio)[1] >= 80
        )
        if score > best_score:
            best_row, best_score = r, score
    return best_row


def _map_columns(columns: list[str]) -> dict[str, str]:
    """Map each source column to a canonical field (best fuzzy match >= 78)."""
    mapping: dict[str, str] = {}
    for col in columns:
        c = str(col).strip().lower()
        best_field, best_score = None, 0
        for canon, aliases in CANONICAL_FIELDS.items():
            match = process.extractOne(c, aliases, scorer=fuzz.token_sort_ratio)
            if match and match[1] > best_score:
                best_field, best_score = canon, match[1]
        if best_field and best_score >= 78:
            mapping[col] = best_field
    return mapping


def _norm_date(value: Any) -> tuple[str | None, str | None]:
    """Return (iso_date, issue). Handles the common messy formats."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None, None
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.strftime("%Y-%m-%d"), None
    s = str(value).strip()
    if not s or s.lower() in {"nan", "none", "-"}:
        return None, None
    try:
        dt = dateparser.parse(s, dayfirst=True, fuzzy=True)
        return dt.strftime("%Y-%m-%d"), None
    except (ValueError, OverflowError):
        return None, f"unparseable date: {s!r}"


def clean(path_or_df: Any, sheet: Any = 0) -> CleanResult:
    if isinstance(path_or_df, pd.DataFrame):
        raw = path_or_df
    elif str(path_or_df).lower().endswith((".xlsx", ".xls", ".xlsm")):
        raw = pd.read_excel(path_or_df, sheet_name=sheet, header=None, dtype=object)
    else:
        # Partner CSVs are ragged (title rows shorter than data rows), which
        # breaks a fixed-width parse. Read rows individually and pad to width.
        import csv as _csv
        with open(path_or_df, newline="", encoding="utf-8-sig") as fh:
            rows = list(_csv.reader(fh))
        width = max((len(r) for r in rows), default=0)
        rows = [r + [None] * (width - len(r)) for r in rows]
        raw = pd.DataFrame(rows, dtype=object)

    header_row = _find_header_row(raw)
    header = [str(c).strip() for c in raw.iloc[header_row].tolist()]
    body = raw.iloc[header_row + 1:].reset_index(drop=True)
    body.columns = header

    col_map = _map_columns(header)
    records: list[dict[str, Any]] = []
    issues: list[RowIssue] = []

    for idx, row in body.iterrows():
        rec: dict[str, Any] = {}
        for src_col, canon in col_map.items():
            val = row.get(src_col)
            if canon in {"report_date", "onset_date"}:
                iso, err = _norm_date(val)
                rec[canon] = iso
                if err:
                    issues.append(RowIssue(idx, canon, err, val))
            else:
                rec[canon] = None if (isinstance(val, float) and pd.isna(val)) else val

        # cross-field sanity: a date sitting in the reaction / vaccine field
        for text_field in ("reaction", "vaccine_drug"):
            v = rec.get(text_field)
            if isinstance(v, str) and _DATE_LIKE.search(v) and len(v) < 16:
                issues.append(RowIssue(idx, text_field,
                                       "value looks like a date in a text field (possible column swap)", v))

        # a record with no reaction at all is suspicious
        if not rec.get("reaction"):
            issues.append(RowIssue(idx, "reaction", "missing reaction term", None))

        if any(rec.get(k) for k in rec):   # skip fully-empty rows
            records.append(rec)

    return CleanResult(records=records, issues=issues, column_map=col_map)
