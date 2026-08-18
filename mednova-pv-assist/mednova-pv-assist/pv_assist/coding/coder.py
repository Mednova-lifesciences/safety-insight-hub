"""
Coding suggester.

The single most important rule in this whole project lives here:

    THE MODEL NEVER INVENTS A CODE.

Free LLM generation will happily produce a MedDRA code that looks real and is
wrong. So coding is constrained matching against the actual licensed dictionary:
  1. exact / synonym hit  -> high confidence
  2. fuzzy string match    -> ranked candidates
  3. (optional) an LLM only *disambiguates* between candidates the dictionary
     already returned — it can reorder or pick, never mint a new code.

Output is always a ranked candidate list for a human to accept. Auto-accept is
allowed ONLY on an exact/synonym hit, and even that is logged for review.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

from rapidfuzz import process, fuzz

from .dictionary import Dictionary
from ..audit import AuditTrail
from ..llm import LLMClient


@dataclass
class Candidate:
    code: str
    term: str
    level: str
    score: float
    method: str        # "exact" | "synonym" | "fuzzy" | "llm_pick"


def suggest(
    verbatim: str,
    dictionary: Dictionary,
    *,
    top_n: int = 5,
    fuzzy_floor: int = 60,
    llm: LLMClient | None = None,
) -> list[Candidate]:
    verbatim = (verbatim or "").strip()
    if not verbatim:
        return []

    # 1. exact / synonym
    code = dictionary.exact(verbatim)
    if code:
        t = next(t for t in dictionary.terms if t.code == code)
        return [Candidate(t.code, t.term, t.level, 100.0, "exact")]

    # 2. fuzzy over every surface string, mapped back to its term
    choices = {}
    for t in dictionary.terms:
        for s in t.all_strings():
            choices[s] = t
    matches = process.extract(verbatim, list(choices.keys()),
                              scorer=fuzz.token_sort_ratio, limit=top_n * 2)
    seen: set[str] = set()
    candidates: list[Candidate] = []
    for surface, score, _ in matches:
        if score < fuzzy_floor:
            continue
        t = choices[surface]
        if t.code in seen:
            continue
        seen.add(t.code)
        candidates.append(Candidate(t.code, t.term, t.level, float(score), "fuzzy"))
        if len(candidates) >= top_n:
            break

    # 3. optional LLM disambiguation — reorders/picks from THESE candidates only
    if llm and llm.available and len(candidates) > 1:
        picked = _llm_disambiguate(verbatim, candidates, llm)
        if picked:
            candidates = picked
    return candidates


def _llm_disambiguate(verbatim: str, candidates: list[Candidate], llm: LLMClient) -> list[Candidate] | None:
    table = "\n".join(f"{i}. {c.code} — {c.term}" for i, c in enumerate(candidates))
    out = llm.judge_json(
        "You match a verbatim adverse-event term to the single best candidate "
        "from a fixed list. You may only choose from the list — never propose a "
        "code that is not listed. Return JSON {\"best_index\": int, \"why\": str}.",
        f"Verbatim: {verbatim!r}\nCandidates:\n{table}",
    )
    if not out or "best_index" not in out:
        return None
    i = out["best_index"]
    if not isinstance(i, int) or not (0 <= i < len(candidates)):
        return None
    chosen = candidates[i]
    chosen.method = "llm_pick"
    rest = [c for j, c in enumerate(candidates) if j != i]
    return [chosen, *rest]


def code_case(
    case_id: str,
    reactions: list[str],
    drugs: list[str],
    reaction_dict: Dictionary,
    drug_dict: Dictionary,
    *,
    audit: AuditTrail | None = None,
    llm: LLMClient | None = None,
) -> dict[str, Any]:
    """Suggest codes for every uncoded reaction and drug in a case."""
    result = {"case_id": case_id, "reactions": [], "drugs": []}
    for verb in reactions:
        cands = suggest(verb, reaction_dict, llm=llm)
        auto = bool(cands) and cands[0].method in {"exact", "synonym"}
        result["reactions"].append({
            "verbatim": verb,
            "candidates": [asdict(c) for c in cands],
            "auto_acceptable": auto,
        })
        if audit:
            audit.record(module="coding", action="reaction_code_suggested",
                         subject_id=case_id, confidence=(cands[0].score / 100) if cands else 0.0,
                         detail={"verbatim": verb, "dictionary": reaction_dict.name,
                                 "version": reaction_dict.version,
                                 "top": asdict(cands[0]) if cands else None})
    for verb in drugs:
        cands = suggest(verb, drug_dict, llm=llm)
        result["drugs"].append({
            "verbatim": verb,
            "candidates": [asdict(c) for c in cands],
            "auto_acceptable": bool(cands) and cands[0].method in {"exact", "synonym"},
        })
        if audit:
            audit.record(module="coding", action="drug_code_suggested",
                         subject_id=case_id, confidence=(cands[0].score / 100) if cands else 0.0,
                         detail={"verbatim": verb, "dictionary": drug_dict.name,
                                 "version": drug_dict.version,
                                 "top": asdict(cands[0]) if cands else None})
    return result
