"""The backend fix guard against the shared cases — the same file the app's
guard is tested against (fix-guard-vectors.test.ts), so the two cannot
disagree about what the AI may change."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.ai.fix_guard import check_fix_answer, is_derived_value  # noqa: E402

VECTORS = json.loads(
    (Path(__file__).parent / "src" / "services" / "api" / "fix-guard-vectors.json").read_text(encoding="utf-8")
)
MAPPING = {
    "ID": "case_id",
    "Hospital No": "patient_id",
    "Sex": "sex",
    "Age": "age",
    "Vacc date": "vaccination_date",
    "Report date": "report_date",
    "Remarks": "remarks",
}


def test_derived_values_match_the_shared_cases(monkeypatch):
    wrong = [
        f'{d["from"]!r} -> {d["to"]!r} expected {d["ok"]} ({d["why"]})'
        for d in VECTORS["derived"]
        if is_derived_value(d["from"], d["to"], d["row"]) is not d["ok"]
    ]
    assert not wrong, wrong


def test_ai_answers_match_the_shared_cases(monkeypatch):
    wrong = []
    for c in VECTORS["corrections"]:
        accepted, refused = check_fix_answer(
            [{"row": 1, "reason": "r", **a} for a in c["answer"]],
            [{"row": 1, "column": col} for col in c["asked"]],
            [c["row"]],
            MAPPING,
            c.get("fill", {}),
        )
        got = (sorted(a["column"] for a in accepted), sorted(r["column"] for r in refused))
        want = (sorted(c["applied"]), sorted(c["refused"]))
        if got != want:
            wrong.append(f'{c["name"]}: got {got}, want {want}')
    assert not wrong, wrong


def test_refusals_carry_a_reason(monkeypatch):
    _, refused = check_fix_answer(
        [{"row": 1, "column": "Age", "new_value": "7", "reason": "r"}],
        [{"row": 1, "column": "Age"}],
        [{"ID": "T", "Age": "4/2/26"}],
        MAPPING,
    )
    assert refused and refused[0]["reason"]
    assert refused[0]["proposed"] == "7"


def test_a_dropped_specification_is_refused(monkeypatch):
    accepted, refused = check_fix_answer(
        [{"row": 1, "column": "Remarks", "new_value": "6", "reason": "drop the description"}],
        [{"row": 1, "column": "Remarks"}],
        [{"ID": "T", "Remarks": "6 SWELLING OF THE LIP"}],
        MAPPING,
    )
    assert accepted == [] and refused[0]["proposed"] == "6"
