"""The fix endpoint passes the file-wide column fill rates to the model:
it receives only the rows with issues, so column_fill is its view of the
rest of the file."""

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.routes import ai_linelist  # noqa: E402
from server.routes.ai_linelist import FixRequest, fix_linelist  # noqa: E402

USER = SimpleNamespace(id="u", organization_id="o", role="REVIEW_OFFICER")


def test_column_fill_reaches_the_model_and_only_issue_rows_are_sent(monkeypatch):
    seen = {}

    async def fake(**kwargs):
        seen["payload"] = json.loads(kwargs["user_content"])
        return SimpleNamespace(data={"corrections": [], "unresolved": []}, model="m")

    monkeypatch.setattr(ai_linelist, "structured_completion", fake)
    request = FixRequest(
        headers=["ID", "Age"],
        mapping={"ID": "case_id", "Age": "age"},
        rows=[{"ID": "A", "Age": "4"}, {"ID": "B", "Age": "4/2/26"}, {"ID": "C", "Age": "3"}],
        issues=[{"row": 2, "column": "Age", "fixable": True}],
        column_fill={"ID": 1.0, "Age": 1.0},
    )
    out = asyncio.run(fix_linelist(request, user=USER))
    assert out.ai_used is True
    assert seen["payload"]["column_fill"] == {"ID": 1.0, "Age": 1.0}
    assert [r["row"] for r in seen["payload"]["rows"]] == [2]


def test_column_fill_is_optional_for_older_clients(monkeypatch):
    request = FixRequest(headers=["ID"], mapping={}, rows=[], issues=[])
    assert request.column_fill == {}
