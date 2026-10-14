"""The server's normalisation rules against the shared cases recorded from
the browser's rules (normalise-vectors.json)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.linelist.normalise import normalise  # noqa: E402

VECTORS = json.loads((Path(__file__).parent / "src" / "services" / "api" / "normalise-vectors.json").read_text(encoding="utf-8"))


def test_server_rules_match_the_browser_rules(monkeypatch):
    wrong = []
    for c in VECTORS:
        got = normalise(c["field"], c["value"], c.get("header", ""))
        value, rule = (got[0], got[1]) if got else (None, None)
        if value != c["expected"] or rule != c["rule"]:
            wrong.append(f'{c["field"]} {c["value"]!r}: server {value!r}/{rule}, browser {c["expected"]!r}/{c["rule"]}')
    assert not wrong, wrong
