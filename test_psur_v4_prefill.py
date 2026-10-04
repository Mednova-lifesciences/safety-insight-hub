"""The V4 pre-fill reads the submission; these tests pin what it accepts.

Models return counts as numbers as often as strings, leave whole blocks
out, and occasionally return more rows than any form should hold. None of
that may cost the assessor the rest of the extraction.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.ai.schemas import AiPsurV4Prefill  # noqa: E402
from server.routes import ai_psur  # noqa: E402


def test_numbers_become_text_and_missing_blocks_default():
    p = AiPsurV4Prefill.model_validate(
        {
            "fields": {"rsi_type_version": "SmPC v7.2 (p. 12)", "studies": None},
            "exposure": {"nigerian_interval": 38400, "nigerian_cumulative": "247,900 courses"},
            "adrs": [{"soc": "Skin", "interval": 12, "cumulative": 140, "nigerian": 2}],
        }
    )
    assert p.fields.rsi_type_version == "SmPC v7.2 (p. 12)"
    assert p.fields.studies is None
    assert p.exposure.nigerian_interval == "38400"
    assert p.adrs[0].interval == "12"
    assert p.diseases == [] and p.signals == []


def test_an_empty_table_cell_may_come_back_as_null():
    p = AiPsurV4Prefill.model_validate(
        {"diseases": [{"disease": "Sinusitis", "mortality": None, "severity": None}]}
    )
    assert p.diseases[0].disease == "Sinusitis" and p.diseases[0].mortality == ""


def test_the_endpoint_caps_rows_and_never_fails_on_bad_output(monkeypatch):
    class Done:
        model = "test-model"
        data = {"adrs": [{"soc": f"SOC {i}"} for i in range(60)]}

    async def fake(**_):
        return Done()

    monkeypatch.setattr(ai_psur, "structured_completion", fake)
    req = ai_psur.V4PrefillRequest(filename="x.pdf", extractedText="--- page 1 ---\ntext")
    r = asyncio.run(ai_psur.v4_prefill(req, user=None))
    assert r.ai_used and len(r.adrs) == ai_psur.MAX_PREFILL_ROWS

    class Bad:
        model = "test-model"
        data = {"fields": "not an object"}

    async def bad(**_):
        return Bad()

    monkeypatch.setattr(ai_psur, "structured_completion", bad)
    r = asyncio.run(ai_psur.v4_prefill(req, user=None))
    assert not r.ai_used and r.error


def test_no_text_means_no_call():
    req = ai_psur.V4PrefillRequest(filename="x.pdf", extractedText="  ")
    r = asyncio.run(ai_psur.v4_prefill(req, user=None))
    assert not r.ai_used and "No extracted text" in r.error
