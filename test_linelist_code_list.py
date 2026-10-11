"""Reading a typed code list with the AI: it only restructures.

Two promises are pinned here. A row naming a field the request did not
allow never comes back as an entry (it is shown as unplaced instead), and
any failure answers ai_used=False rather than erroring — the person can
still use what the rule reader found.
"""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.routes import ai_linelist  # noqa: E402
from server.routes.ai_linelist import (  # noqa: E402
    CodeListColumnIn,
    CodeListFieldIn,
    ReadCodeListRequest,
    read_code_list,
)

USER = SimpleNamespace(id="u", organization_id="o", role="REVIEW_OFFICER")


def _request(text="Sex: 1=Male, 2=Female"):
    return ReadCodeListRequest(
        text=text,
        columns=[CodeListColumnIn(header="SEX", field="sex")],
        fields=[CodeListFieldIn(name="sex", description="patient sex"), CodeListFieldIn(name="outcome")],
    )


def test_rows_for_fields_not_allowed_are_dropped_and_shown(monkeypatch):
    async def fake(**_):
        return SimpleNamespace(
            data={
                "entries": [
                    {"field": "sex", "code": "1", "meaning": " Male "},
                    {"field": "colour", "code": "1", "meaning": "Red"},
                    {"field": "outcome", "code": "", "meaning": "Recovered"},
                ],
                "unplaced": ["something odd"],
            },
            model="test-model",
        )

    monkeypatch.setattr(ai_linelist, "structured_completion", fake)
    out = asyncio.run(read_code_list(_request(), user=USER))
    assert out.ai_used is True
    assert [(e.field, e.code, e.meaning) for e in out.entries] == [("sex", "1", "Male")]
    assert "colour: 1 = Red" in out.unplaced
    assert "something odd" in out.unplaced


def test_a_failure_never_errors(monkeypatch):
    async def boom(**_):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(ai_linelist, "structured_completion", boom)
    out = asyncio.run(read_code_list(_request(), user=USER))
    assert out.ai_used is False
    assert out.entries == []
    assert out.error


def test_empty_text_makes_no_call(monkeypatch):
    called = []

    async def fake(**_):
        called.append(1)

    monkeypatch.setattr(ai_linelist, "structured_completion", fake)
    out = asyncio.run(read_code_list(_request(text="   "), user=USER))
    assert out.ai_used is False and called == []
