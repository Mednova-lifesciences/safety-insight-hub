"""Server validation of saved cell changes (server/linelist/save_guard.py).
Synthetic jobs only."""

import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.linelist.save_guard import validate_cell_save  # noqa: E402

COLUMNS = ["Case ID", "Vacc date", "Dose", "Sex", "Age", "Remarks"]
MAPPING = {"Case ID": "case_id", "Vacc date": "vaccination_date", "Dose": "dose", "Sex": "sex", "Age": "age", "Remarks": "remarks"}


def job(rows, log=None, version=3):
    return {
        "id": "ll-test",
        "version": version,
        "columns": COLUMNS,
        "mapping": MAPPING,
        "rawRows": [dict(r) for r in rows],
        "parsedRows": [{MAPPING[k]: v for k, v in r.items()} for r in rows],
        "changeLog": log or [],
    }


ROW = {"Case ID": "T-1", "Vacc date": "02/02/2026'", "Dose": "1at", "Sex": "3", "Age": "MALE", "Remarks": ""}


def entry(i, row, column, old, new, source, **extra):
    return {"id": f"c{i}", "row": row, "column": column, "oldValue": old, "newValue": new, "source": source,
            "reason": "r", "appliedAt": "2026-10-14T00:00:00Z", "events": [], **extra}


def propose(current, cells, entries):
    p = copy.deepcopy(current)
    for (row, column), value in cells.items():
        p["rawRows"][row - 1][column] = value
        p["parsedRows"][row - 1][MAPPING[column]] = value
    p["changeLog"] = (current.get("changeLog") or []) + entries
    return p


def reasons(current, proposed):
    return [p["reason"] for p in validate_cell_save(current, proposed)]


def test_a_rule_change_the_server_reproduces_is_accepted(monkeypatch):
    cur = job([ROW])
    p = propose(cur, {(1, "Vacc date"): "02/02/2026"}, [entry(1, 1, "Vacc date", "02/02/2026'", "02/02/2026", "rule", rule={"id": "stray-edge-character", "version": "1"})])
    assert reasons(cur, p) == []


def test_a_rule_change_the_server_does_not_reproduce_is_refused(monkeypatch):
    cur = job([ROW])
    p = propose(cur, {(1, "Dose"): "2nd"}, [entry(1, 1, "Dose", "1at", "2nd", "rule", rule={"id": "ordinal-suffix-typo", "version": "1"})])
    assert reasons(cur, p) == ["The rule does not give this value on the server."]


def test_a_rule_change_naming_another_rule_is_refused(monkeypatch):
    cur = job([ROW])
    p = propose(cur, {(1, "Dose"): "1st"}, [entry(1, 1, "Dose", "1at", "1st", "rule", rule={"id": "stray-edge-character", "version": "1"})])
    assert reasons(cur, p) == ["The rule does not give this value on the server."]


def test_an_invented_ai_value_is_refused_and_a_derived_one_accepted(monkeypatch):
    cur = job([ROW])
    bad = propose(cur, {(1, "Vacc date"): "15/09/2019"}, [entry(1, 1, "Vacc date", "02/02/2026'", "15/09/2019", "ai")])
    good = propose(cur, {(1, "Dose"): "1st"}, [entry(1, 1, "Dose", "1at", "1st", "ai")])
    assert reasons(cur, bad) == ["The AI's value is not derived from this cell or this row."]
    assert reasons(cur, good) == []


def test_a_swap_group_is_accepted_and_a_move_that_loses_a_value_refused(monkeypatch):
    cur = job([ROW])
    swap = propose(cur, {(1, "Sex"): "MALE", (1, "Age"): "3"}, [
        entry(1, 1, "Sex", "3", "MALE", "recovery", group="g1"), entry(2, 1, "Age", "MALE", "3", "recovery", group="g1")])
    lose = propose(cur, {(1, "Sex"): "MALE", (1, "Age"): ""}, [
        entry(1, 1, "Sex", "3", "MALE", "recovery", group="g1"), entry(2, 1, "Age", "MALE", "", "recovery", group="g1")])
    assert reasons(cur, swap) == []
    assert reasons(cur, lose) == ["A move would invent or lose a value."] * 2


def test_identifiers_never_change_even_with_a_recorded_change(monkeypatch):
    cur = job([ROW])
    p = propose(cur, {(1, "Case ID"): "T-2"}, [entry(1, 1, "Case ID", "T-1", "T-2", "ai")])
    assert "Identifiers are never changed." in reasons(cur, p)


def test_a_cell_changed_without_a_recorded_correction_is_refused(monkeypatch):
    cur = job([ROW])
    p = propose(cur, {(1, "Remarks"): "edited"}, [])
    assert reasons(cur, p) == ["The cell changed without a recorded correction."]


def test_a_recorded_change_that_was_not_applied_is_refused(monkeypatch):
    cur = job([ROW])
    p = propose(cur, {}, [entry(1, 1, "Dose", "1at", "1st", "ai")])
    assert reasons(cur, p) == ["A recorded change was not applied to the cell."]


def test_a_recorded_old_value_that_is_not_the_stored_value_is_refused(monkeypatch):
    cur = job([ROW])
    p = propose(cur, {(1, "Dose"): "1st"}, [entry(1, 1, "Dose", "1xt", "1st", "ai")])
    assert reasons(cur, p) == ["The recorded change does not match the stored value."]


def test_undo_and_reapply_must_return_exactly_to_the_recorded_values(monkeypatch):
    done = dict(ROW, Dose="1st")
    e = entry(1, 1, "Dose", "1at", "1st", "rule", rule={"id": "ordinal-suffix-typo", "version": "1"})
    cur = job([done], [e])
    undo = propose(cur, {(1, "Dose"): "1at"}, [])
    undo["changeLog"][0] = dict(e, events=[{"kind": "undone", "at": "t", "by": "p"}])
    wrong = propose(cur, {(1, "Dose"): "9at"}, [])
    wrong["changeLog"][0] = dict(e, events=[{"kind": "undone", "at": "t", "by": "p"}])
    assert reasons(cur, undo) == []
    assert reasons(cur, wrong) == ["Undo or Re-apply did not return the cell to its recorded value."]
    held = job([ROW], [dict(e, events=[{"kind": "undone", "at": "t", "by": "p"}])])
    redo = propose(held, {(1, "Dose"): "1st"}, [])
    redo["changeLog"][0] = dict(e, events=[{"kind": "undone", "at": "t", "by": "p"}, {"kind": "reapplied", "at": "t2", "by": "p"}])
    assert reasons(held, redo) == []


def test_the_change_log_cannot_be_rewritten_or_shortened(monkeypatch):
    e = entry(1, 1, "Dose", "1at", "1st", "ai")
    cur = job([dict(ROW, Dose="1st")], [e])
    rewritten = copy.deepcopy(cur)
    rewritten["changeLog"][0]["oldValue"] = "1xt"
    removed = copy.deepcopy(cur)
    removed["changeLog"] = []
    assert reasons(cur, rewritten) == ["A recorded change was rewritten."]
    assert reasons(cur, removed) == ["A recorded change was removed from the change log."]


def test_columns_mapping_and_row_count_cannot_change_in_a_cell_save(monkeypatch):
    cur = job([ROW])
    a = copy.deepcopy(cur)
    a["mapping"] = dict(MAPPING, Remarks="age")
    b = copy.deepcopy(cur)
    b["rawRows"].append(dict(ROW))
    b["parsedRows"].append({})
    assert reasons(cur, a) == ["Columns or column mapping changed in a cell save."]
    assert reasons(cur, b) == ["The number of rows changed in a cell save."]


def test_mapped_values_cannot_change_on_rows_whose_cells_did_not(monkeypatch):
    cur = job([ROW, ROW])
    p = propose(cur, {(1, "Dose"): "1st"}, [entry(1, 1, "Dose", "1at", "1st", "ai")])
    p["parsedRows"][1]["sex"] = "FEMALE"
    assert reasons(cur, p) == ["Mapped values changed on a row whose cells did not."]


def test_reasons_never_contain_cell_values(monkeypatch):
    cur = job([ROW])
    p = propose(cur, {(1, "Vacc date"): "15/09/2019"}, [entry(1, 1, "Vacc date", "02/02/2026'", "15/09/2019", "ai")])
    for problem in validate_cell_save(cur, p):
        assert "15/09/2019" not in problem["reason"] and "02/02/2026" not in problem["reason"]


def _volume_job(header):
    rows = [{"Case ID": "T-1", header: "0,5"}]
    mapping = {"Case ID": "case_id", header: "dose"}
    return {"id": "ll-test", "version": 3, "columns": ["Case ID", header], "mapping": mapping,
            "rawRows": rows, "parsedRows": [{"case_id": "T-1", "dose": "0,5"}], "changeLog": []}


def _volume_fix(cur, header):
    p = copy.deepcopy(cur)
    p["rawRows"][0][header] = "0.5"
    p["parsedRows"][0]["dose"] = "0.5"
    p["changeLog"] = [entry(1, 1, header, "0,5", "0.5", "rule", rule={"id": "dose-decimal-comma", "version": "3"})]
    return p


def test_a_header_stated_unit_is_read_by_the_server_rule_too(monkeypatch):
    # "0,5" is a volume only because the header says mL: the server re-runs
    # the rule with the same header, so it reproduces the browser's fix.
    cur = _volume_job("Volume administered (mL)")
    assert reasons(cur, _volume_fix(cur, "Volume administered (mL)")) == []


def test_without_a_unit_in_the_header_the_same_fix_is_refused(monkeypatch):
    cur = _volume_job("Dose")
    assert reasons(cur, _volume_fix(cur, "Dose")) == ["The rule does not give this value on the server."]


def _ai_comma_fix(header):
    cur = _volume_job(header)
    p = copy.deepcopy(cur)
    p["rawRows"][0][header] = "0.5"
    p["parsedRows"][0]["dose"] = "0.5"
    p["changeLog"] = [entry(1, 1, header, "0,5", "0.5", "ai")]
    return cur, p


def test_an_ai_decimal_comma_change_without_an_established_unit_is_refused(monkeypatch):
    # The digits are the same, so "derived" alone would accept it; the server
    # refuses because the stored header gives no unit.
    cur, p = _ai_comma_fix("Dose")
    assert reasons(cur, p) == ["A decimal comma is changed only when the unit is stated in the cell or the column header."]


def test_an_ai_decimal_comma_change_under_a_stored_ml_header_is_accepted(monkeypatch):
    cur, p = _ai_comma_fix("Volume administered (mL)")
    assert reasons(cur, p) == []


def test_a_save_cannot_supply_its_own_header(monkeypatch):
    # Renaming the column to one that states mL, in the same save, is refused:
    # the header the rule reads is the stored one.
    cur = _volume_job("Dose")
    p = _volume_fix(cur, "Dose")
    p["columns"] = ["Case ID", "Dose (mL)"]
    assert "Columns or column mapping changed in a cell save." in reasons(cur, p)


def _serious_job(value):
    cols = ["Case ID", "Seriousness"]
    mapping = {"Case ID": "case_id", "Seriousness": "seriousness"}
    return {"id": "ll-test", "version": 3, "columns": cols, "mapping": mapping,
            "rawRows": [{"Case ID": "T-1", "Seriousness": value}],
            "parsedRows": [{"case_id": "T-1", "seriousness": value}], "changeLog": []}


def _serious_change(cur, new):
    p = copy.deepcopy(cur)
    old = cur["rawRows"][0]["Seriousness"]
    p["rawRows"][0]["Seriousness"] = new
    p["parsedRows"][0]["seriousness"] = new
    p["changeLog"] = [entry(1, 1, "Seriousness", old, new, "rule", rule={"id": "fatal-outcome-serious", "version": "1"})]
    return p


def test_the_fatal_outcome_rule_may_mark_a_non_serious_case_serious():
    cur = _serious_job("Non-serious")
    assert reasons(cur, _serious_change(cur, "Serious")) == []
    cur = _serious_job("No")
    assert reasons(cur, _serious_change(cur, "Yes")) == []


def test_the_fatal_outcome_rule_never_makes_a_case_less_serious_or_writes_anything_else():
    cur = _serious_job("Serious")
    assert reasons(cur, _serious_change(cur, "Non-serious")) == [
        "The fatal-outcome rule only marks a non-serious case serious."]
    cur = _serious_job("Non-serious")
    assert reasons(cur, _serious_change(cur, "Hospitalised")) == [
        "The fatal-outcome rule only marks a non-serious case serious."]


def test_the_new_spelling_rules_are_reproduced_on_the_server():
    cur = _serious_job("Serius")
    p = copy.deepcopy(cur)
    p["rawRows"][0]["Seriousness"] = "Serious"
    p["parsedRows"][0]["seriousness"] = "Serious"
    p["changeLog"] = [entry(1, 1, "Seriousness", "Serius", "Serious", "rule", rule={"id": "seriousness-spelling", "version": "1"})]
    assert reasons(cur, p) == []
