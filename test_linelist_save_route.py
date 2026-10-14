"""The save-cells endpoint: tenant scoping, version check, all-or-nothing.
The database is replaced by fakes; the validator is the real one."""

import asyncio
import copy
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent / "src"))

from fastapi import HTTPException  # noqa: E402

from server.dependencies import AuthenticatedUser  # noqa: E402
from server.routes import linelist_save  # noqa: E402
from server.routes.linelist_save import SaveCellsRequest, save_cells  # noqa: E402

USER = AuthenticatedUser("u1", "a@b.c", "org-A", "admin")
STORED = {
    "id": "ll-1", "version": 3, "columns": ["ID", "Dose"], "mapping": {"ID": "case_id", "Dose": "dose"},
    "rawRows": [{"ID": "T-1", "Dose": "1at"}], "parsedRows": [{"case_id": "T-1", "dose": "1at"}], "changeLog": [],
}


def fixed(monkeypatch, stored, written):
    async def load(job_id, org):
        return copy.deepcopy(stored) if org == "org-A" and job_id == "ll-1" else None

    async def write(job_id, org, expected, data):
        written.append((job_id, org, expected, data))
        return 1

    monkeypatch.setattr(linelist_save, "_load", load)
    monkeypatch.setattr(linelist_save, "_write", write)


def proposal(dose="1st", rule=True):
    p = copy.deepcopy(STORED)
    p["rawRows"][0]["Dose"] = dose
    p["parsedRows"][0]["dose"] = dose
    p["changeLog"] = [{"id": "c1", "row": 1, "column": "Dose", "oldValue": "1at", "newValue": dose, "source": "rule" if rule else "ai",
                       "reason": "r", "appliedAt": "t", "events": [], **({"rule": {"id": "ordinal-suffix-typo", "version": "1"}} if rule else {})}]
    return p


def call(job, expected=3, job_id="ll-1"):
    return asyncio.run(save_cells(job_id, SaveCellsRequest(job=job, expected_version=expected), user=USER))


def status(fn):
    try:
        fn()
    except HTTPException as e:
        return e.status_code
    return 200


def test_a_verified_save_writes_once_with_the_next_version(monkeypatch):
    written = []
    fixed(monkeypatch, STORED, written)
    out = call(proposal())
    assert out.version == 4
    assert len(written) == 1 and written[0][2] == 3 and written[0][3]["version"] == 4 and written[0][3]["rawRows"][0]["Dose"] == "1st"


def test_another_organisations_job_is_not_found_and_nothing_is_written(monkeypatch):
    written = []
    fixed(monkeypatch, STORED, written)
    assert status(lambda: call(proposal(), job_id="ll-2")) == 404
    assert written == []


def test_a_stale_version_is_refused_and_nothing_is_written(monkeypatch):
    written = []
    fixed(monkeypatch, STORED, written)
    assert status(lambda: call(proposal(), expected=2)) == 409
    assert written == []


def test_an_unverifiable_change_refuses_the_whole_save(monkeypatch):
    written = []
    fixed(monkeypatch, STORED, written)
    bad = proposal(dose="2nd")
    try:
        call(bad)
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 422 and e.detail["problems"][0]["column"] == "Dose"
    assert written == []


def test_a_write_that_lost_the_race_is_reported_as_stale(monkeypatch):
    fixed(monkeypatch, STORED, [])

    async def write(*a):
        return 0

    monkeypatch.setattr(linelist_save, "_write", write)
    assert status(lambda: call(proposal())) == 409
