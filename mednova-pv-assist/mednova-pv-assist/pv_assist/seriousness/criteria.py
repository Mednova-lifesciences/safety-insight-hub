"""
The six ICH E2D / ICH E2A seriousness criteria, expressed as detectable signals.

A case is SERIOUS if the reaction:
  - resulted in death
  - is life-threatening
  - required inpatient hospitalisation or prolongation of existing hospitalisation
  - resulted in persistent or significant disability / incapacity
  - is a congenital anomaly / birth defect
  - is another medically important condition (judgement call)

These patterns catch the common ways reporters *describe* seriousness in free
text without ticking the box. They are intentionally high-recall: the tool's
job is to raise a hand for human eyes, not to auto-upgrade the case.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class Criterion:
    key: str
    label: str
    patterns: list[str]
    # phrases that, if present near a hit, usually mean it is NOT serious
    negators: list[str] = field(default_factory=list)

    def compiled(self) -> list[re.Pattern]:
        return [re.compile(p, re.IGNORECASE) for p in self.patterns]


CRITERIA: list[Criterion] = [
    Criterion(
        "death", "Death",
        patterns=[
            r"\bdied\b", r"\bdeath\b", r"\bdeceased\b", r"\bfatal\b",
            r"\bpassed away\b", r"\bexpired\b", r"\bdemise\b",
        ],
        negators=[r"near[- ]death", r"feared death", r"afraid.*death"],
    ),
    Criterion(
        "life_threatening", "Life-threatening",
        patterns=[
            r"life[- ]threatening", r"\banaphyla", r"\bcardiac arrest\b",
            r"\brespiratory (?:arrest|failure)\b", r"\bcrash(?:ed|ing)?\b(?=.*(?:bp|blood pressure))",
            r"\bICU\b", r"\bintensive care\b", r"\bventilat", r"\bintubat",
            r"\bshock\b", r"\bcoma\b", r"\bunresponsive\b",
        ],
    ),
    Criterion(
        "hospitalisation", "Hospitalisation / prolongation",
        patterns=[
            r"\bhospitali[sz]", r"\badmitted\b", r"\badmission\b", r"\binpatient\b",
            r"\bkept in (?:the )?hospital\b", r"\bstayed? in (?:the )?hospital\b",
            r"\bprolong", r"\breferred to (?:the )?hospital\b", r"\bwas on admission\b",
        ],
        negators=[
            r"\bnot (?:admitted|hospitali)", r"\bwithout admission\b",
            r"\boutpatient\b", r"\bemergency (?:room|department)\b(?!.*admit)",
            r"\bdischarged same day\b",
        ],
    ),
    Criterion(
        "disability", "Persistent / significant disability",
        patterns=[
            r"\bdisabilit", r"\bdisabled\b", r"\bincapacit", r"\bparaly",
            r"\bpermanent (?:damage|loss|impair)", r"\bloss of (?:sight|vision|hearing|function)\b",
            r"\bunable to (?:walk|work|move)\b", r"\bblind", r"\bdeaf",
        ],
    ),
    Criterion(
        "congenital", "Congenital anomaly / birth defect",
        patterns=[
            r"\bcongenital\b", r"\bbirth defect", r"\bmalformation\b",
            r"\bfetal\b", r"\bfoetal\b", r"\bin utero\b", r"\bneonat.*(?:anomaly|defect)",
        ],
    ),
    Criterion(
        "medically_important", "Other medically important condition",
        patterns=[
            r"\bseizure", r"\bconvuls", r"\bbronchospasm\b", r"\bhepat(?:itis|ic failure)\b",
            r"\bhepatotox", r"\bblood dyscrasia\b", r"\bagranulocyt", r"\bstevens[- ]johnson\b",
            r"\bSJS\b", r"\bTEN\b", r"\btoxic epidermal\b", r"\bsuicidal\b",
            r"\bhaemorrhage\b", r"\bhemorrhage\b", r"\bacute (?:kidney|renal) (?:injury|failure)\b",
        ],
    ),
]


@dataclass
class CriterionHit:
    key: str
    label: str
    evidence: str        # the snippet of narrative that triggered it
    span: tuple[int, int]


def scan(narrative: str) -> list[CriterionHit]:
    """Return every seriousness signal found in the narrative, with evidence."""
    hits: list[CriterionHit] = []
    text = narrative or ""
    for crit in CRITERIA:
        neg = [re.compile(n, re.IGNORECASE) for n in crit.negators]
        found = False
        for pat in crit.compiled():
            if found:
                break
            for m in pat.finditer(text):
                start = max(0, m.start() - 40)
                end = min(len(text), m.end() + 40)
                window = text[start:end]
                if any(n.search(window) for n in neg):
                    continue
                hits.append(CriterionHit(
                    key=crit.key,
                    label=crit.label,
                    evidence="…" + window.strip() + "…",
                    span=(m.start(), m.end()),
                ))
                found = True  # one hit per criterion is enough to flag
                break
    return hits
