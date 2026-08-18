"""
Dictionary loader.

MedDRA and WHODrug are licensed and version-pinned. This system does NOT ship
them. You load YOUR subscribed dictionary export as a CSV and the coder matches
against it. The CSV contract is intentionally minimal:

    code,term,level,synonyms
    10028813,Nausea,LLT,"feeling sick|queasy"
    10047700,Vomiting,LLT,"emesis|throwing up"

`level` is free text (LLT/PT for MedDRA; PreferredName/TradeName for WHODrug).
`synonyms` is pipe-separated and optional.

A tiny sample dictionary lives in data/ so the pipeline runs end-to-end today.
Swap in the real export and nothing else changes.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, field


@dataclass
class Term:
    code: str
    term: str
    level: str = ""
    synonyms: list[str] = field(default_factory=list)

    def all_strings(self) -> list[str]:
        return [self.term, *self.synonyms]


class Dictionary:
    def __init__(self, name: str, version: str = "unspecified"):
        self.name = name
        self.version = version          # log this in the audit trail — inspectors ask
        self.terms: list[Term] = []
        self._lookup: dict[str, str] = {}   # lowercased string -> code

    @classmethod
    def from_csv(cls, path: str, name: str, version: str = "unspecified") -> "Dictionary":
        d = cls(name, version)
        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                syn = [s.strip() for s in (row.get("synonyms") or "").split("|") if s.strip()]
                t = Term(row["code"].strip(), row["term"].strip(),
                         row.get("level", "").strip(), syn)
                d.terms.append(t)
                for s in t.all_strings():
                    d._lookup[s.lower()] = t.code
        return d

    def exact(self, text: str) -> str | None:
        return self._lookup.get(text.strip().lower())
