"""
De-identification of everything sent to OpenAI (Nigeria Data Protection
Act 2023, s.39 — pseudonymisation as a security measure).

Every OpenAI call goes through ai/client.py, and client.py runs the request
through `pseudonymise_request` before it leaves the server and runs the
answer through `Pseudonymiser.restore` when it comes back. Doing it there,
rather than in each route or in the browser, is what makes it enforced: a
new AI route cannot forget it, and a modified browser cannot skip it.

Direct identifiers are replaced by placeholder tokens such as [[NAME_1]]:
patient names and initials, patient record numbers, dates of birth,
reporter names, phone numbers, e-mail addresses and street addresses.
The same value always gets the same token within one request, so the
model can still see that two rows name the same patient or that a
reporter appears twice. The real values never leave the server and are
put back into the answer here, so the application sees exactly what it
saw before.

Two passes:
  1. Structured. A JSON payload with line-list rows ("columns", "mapping",
     "rows") has every cell of an identifier column replaced, whatever the
     value looks like — the column says what it is.
  2. Free text. Every remaining string (and non-JSON text such as a PSUR)
     is scanned for e-mail addresses, phone numbers, street addresses,
     dates written as a date of birth, and names introduced by a title or
     a label ("Dr", "Mrs", "Patient name:", "QPPV:").

What it records is the shape of the disclosure — which fields and how many
values of each kind were replaced — never the values themselves.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Optional

# Canonical line-list fields (TARGET_FIELDS in services/api/linelist.ts)
# that hold a direct identifier, and the token kind each becomes.
IDENTIFIER_FIELDS: dict[str, str] = {
    "patient_identifier": "NAME",
    "patient_id": "RECORD",
    "date_of_birth": "DOB",
    "reporter_name": "NAME",
    "reporter_phone": "PHONE",
    "reporter_email": "EMAIL",
    "reporter_address": "ADDRESS",
}

# Header words that mark an identifier column even when it was not mapped
# (an unmapped column still goes to the model in rawRows).
_HEADER_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"e-?mail", re.I), "EMAIL"),
    (re.compile(r"phone|mobile|tel\b|telephone|gsm|contact\s*(no|number)", re.I), "PHONE"),
    (re.compile(r"date\s*of\s*birth|\bdob\b|birth\s*date", re.I), "DOB"),
    (re.compile(r"address|street|residence|house\s*no", re.I), "ADDRESS"),
    (
        re.compile(
            r"hospital\s*(no|number|num)|record\s*(no|number)|\bmrn\b|folder\s*(no|number)|"
            r"card\s*(no|number)|patient\s*(id|no|number)|nin\b|national\s*id",
            re.I,
        ),
        "RECORD",
    ),
    (
        re.compile(
            r"(patient|child|client|vaccinee|mother|caregiver|parent|guardian|reporter)'?s?\s*(full\s*)?name|"
            r"^name\b|name\s*of\s*(patient|child|reporter|vaccinee)|initials|^reporter$|reported\s*by",
            re.I,
        ),
        "NAME",
    ),
]

TOKEN_RE = re.compile(r"\[\[(NAME|RECORD|DOB|PHONE|EMAIL|ADDRESS)_(\d+)\]\]")

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Nigerian and international numbers: +234…, 00…, 234…, or a 0-prefixed
# national number, with spaces, dashes or a "(0)" between groups.
_PHONE = re.compile(r"(?<![\w/.-])(?:\+|00)?\d[\d\s()-]{7,20}\d(?![\w/.-])")
_STREET = re.compile(
    r"\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Z][A-Za-z'-]+\s+){1,4}"
    r"(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Close|Crescent|Cres\.?|Way|Lane|Ln\.?|Drive|Dr\.?|Estate|Layout|Boulevard)\b",
)
_DOB_LABELLED = re.compile(
    r"(?P<label>\b(?:date\s+of\s+birth|d\.?o\.?b\.?|born(?:\s+on)?)\s*[:\-]?\s*)"
    r"(?P<value>\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})",
    re.I,
)
_TITLED_NAME = re.compile(
    r"\b(?P<title>Dr|Mr|Mrs|Ms|Miss|Mallam|Alhaji|Alhaja|Chief|Pharm|Prof|Nurse|Sister)\.?\s+"
    r"(?P<name>[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2})"
)
_LABELLED_NAME = re.compile(
    r"(?P<label>\b(?:patient(?:'s)?\s+name|name\s+of\s+(?:patient|child|reporter|qppv)|reporter(?:'s)?\s+name|"
    r"reported\s+by|qppv(?:\s+name)?|qualified\s+person[^:\n]{0,40}|contact\s+person|signed\s+by)\s*[:\-]\s*)"
    r"(?P<name>[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3})",
    re.I,
)

# What the model is told, added to every system prompt.
PLACEHOLDER_NOTICE = (
    "\n\nDATA PROTECTION NOTE: direct identifiers in this request (names and initials, record "
    "numbers, dates of birth, phone numbers, e-mail and street addresses) have been replaced by "
    "placeholder tokens such as [[NAME_1]], [[RECORD_2]], [[DOB_1]], [[PHONE_3]]. Treat each token "
    "as a present, valid value of that kind; the same token always means the same value. Do not "
    "report a token as missing, malformed or invalid, do not propose a new value for a token, and "
    "when you refer to one, write the token exactly as given."
)


@dataclass
class Pseudonymiser:
    """One request's token table. Never persisted, never logged."""

    _by_value: dict[tuple[str, str], str] = field(default_factory=dict)
    _by_token: dict[str, str] = field(default_factory=dict)
    _counters: Counter = field(default_factory=Counter)
    kinds: Counter = field(default_factory=Counter)
    fields: Counter = field(default_factory=Counter)

    def token(self, kind: str, value: str, field_name: Optional[str] = None) -> str:
        key = (kind, value.strip().lower())
        tok = self._by_value.get(key)
        if tok is None:
            self._counters[kind] += 1
            tok = f"[[{kind}_{self._counters[kind]}]]"
            self._by_value[key] = tok
            self._by_token[tok] = value
            self.kinds[kind] += 1
        if field_name:
            self.fields[field_name] += 1
        return tok

    # -- free text ---------------------------------------------------------

    def scrub_text(self, text: str, field_name: Optional[str] = None) -> str:
        if not text or not isinstance(text, str):
            return text
        if TOKEN_RE.fullmatch(text.strip()):
            return text
        out = _EMAIL.sub(lambda m: self.token("EMAIL", m.group(0), field_name or "text:email"), text)
        out = _DOB_LABELLED.sub(
            lambda m: m.group("label") + self.token("DOB", m.group("value"), field_name or "text:date_of_birth"),
            out,
        )
        out = _STREET.sub(lambda m: self.token("ADDRESS", m.group(0), field_name or "text:address"), out)
        out = _PHONE.sub(lambda m: self._phone(m.group(0), field_name), out)
        out = _LABELLED_NAME.sub(
            lambda m: m.group("label") + self.token("NAME", m.group("name"), field_name or "text:name"),
            out,
        )
        out = _TITLED_NAME.sub(
            lambda m: f"{m.group('title')}. {self.token('NAME', m.group('name'), field_name or 'text:name')}",
            out,
        )
        return out

    def _phone(self, candidate: str, field_name: Optional[str]) -> str:
        text = candidate.strip()
        digits = re.sub(r"\D", "", text)
        # A phone number has 10-15 digits and starts the way numbers are
        # dialled (+, 00, 0, 234). Anything else — a lot number, a date
        # run together, a count — is left alone.
        if 10 <= len(digits) <= 15 and (text.startswith(("+", "00", "0")) or digits.startswith("234")):
            return self.token("PHONE", candidate, field_name or "text:phone")
        return candidate

    # -- structured --------------------------------------------------------

    def scrub_cell(self, kind: str, value: Any, field_name: str) -> Any:
        if not isinstance(value, str) or not value.strip() or TOKEN_RE.fullmatch(value.strip()):
            return value
        return self.token(kind, value, field_name)

    def restore(self, value: Any) -> Any:
        """Puts the real values back wherever the answer quotes a token."""
        if isinstance(value, str):
            if "[[" not in value:
                return value
            return TOKEN_RE.sub(lambda m: self._by_token.get(m.group(0), m.group(0)), value)
        if isinstance(value, list):
            return [self.restore(v) for v in value]
        if isinstance(value, dict):
            return {k: self.restore(v) for k, v in value.items()}
        return value

    def summary(self) -> dict[str, Any]:
        """Field names and counts only — never a value."""
        return {
            "replaced": dict(self.kinds),
            "fields": dict(self.fields),
            "total": int(sum(self.kinds.values())),
        }


def identifier_kind_for_column(header: str, mapped_field: Optional[str]) -> Optional[str]:
    if mapped_field and mapped_field in IDENTIFIER_FIELDS:
        return IDENTIFIER_FIELDS[mapped_field]
    for pattern, kind in _HEADER_RULES:
        if pattern.search(header or ""):
            return kind
    return None


def _scrub_rows(p: Pseudonymiser, rows: list[Any], mapping: dict[str, str]) -> list[Any]:
    kinds: dict[str, Optional[str]] = {}
    out = []
    for row in rows:
        if not isinstance(row, dict):
            out.append(_walk(p, row))
            continue
        new_row = {}
        for col, value in row.items():
            if col not in kinds:
                kinds[col] = identifier_kind_for_column(col, mapping.get(col))
            kind = kinds[col]
            if kind:
                new_row[col] = p.scrub_cell(kind, value, mapping.get(col) or col)
            elif isinstance(value, str):
                new_row[col] = p.scrub_text(value)
            else:
                new_row[col] = _walk(p, value)
        out.append(new_row)
    return out


# Keys whose value in a payload is itself one identifier, wherever it sits
# (a fix request's "cells", an E2B case, a coding request).
_IDENTIFIER_KEYS = {
    **IDENTIFIER_FIELDS,
    "patientInitials": "NAME",
    "patient_initials": "NAME",
    "patientName": "NAME",
    "patient_name": "NAME",
    "reporterName": "NAME",
    "reporterPhone": "PHONE",
    "reporterEmail": "EMAIL",
    "reporterAddress": "ADDRESS",
    "dateOfBirth": "DOB",
    "patientRecordNumber": "RECORD",
    "qppv": "NAME",
    "qppvName": "NAME",
    "qppvContact": "PHONE",
}


def _walk(p: Pseudonymiser, value: Any, mapping: Optional[dict[str, str]] = None) -> Any:
    if isinstance(value, str):
        return p.scrub_text(value)
    if isinstance(value, list):
        return [_walk(p, v, mapping) for v in value]
    if isinstance(value, dict):
        local_mapping = value.get("mapping") if isinstance(value.get("mapping"), dict) else mapping or {}
        out: dict[str, Any] = {}
        for k, v in value.items():
            if k in ("rows", "rawRows", "sample_rows", "sampleRows") and isinstance(v, list):
                out[k] = _scrub_rows(p, v, local_mapping)
            elif k in _IDENTIFIER_KEYS and isinstance(v, str):
                out[k] = p.scrub_cell(_IDENTIFIER_KEYS[k], v, k)
            elif k in ("mapping", "columns", "headers"):
                # Column names and the header->field map are structure, not
                # data; they are what the model needs to read the rows.
                out[k] = v
            else:
                out[k] = _walk(p, v, local_mapping)
        # A cell-level item (a finding, a fix candidate) that names its
        # column and carries the cell's value.
        column = value.get("column")
        if isinstance(column, str):
            kind = identifier_kind_for_column(column, local_mapping.get(column))
            if kind:
                for vk in ("value", "original", "current", "proposed", "evidence"):
                    if isinstance(out.get(vk), str):
                        out[vk] = p.scrub_cell(kind, value[vk], local_mapping.get(column) or column)
        return out
    return value


def pseudonymise_request(user_content: str) -> tuple[str, Pseudonymiser]:
    """The request as it may be sent to OpenAI, and the table that undoes it."""
    p = Pseudonymiser()
    try:
        payload = json.loads(user_content)
    except (TypeError, ValueError):
        return p.scrub_text(user_content), p
    if not isinstance(payload, (dict, list)):
        return p.scrub_text(user_content), p
    return json.dumps(_walk(p, payload), ensure_ascii=False), p
