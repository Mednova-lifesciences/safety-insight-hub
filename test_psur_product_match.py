"""The AI product match for the IBD register only proposes, and only from
the candidates it was sent: an invented id, or a low-confidence answer,
comes back as no match, and a failure never errors."""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.routes import ai_psur  # noqa: E402
from server.routes.ai_psur import (  # noqa: E402
    ProductMatchCandidateIn,
    ProductMatchReportIn,
    ProductMatchRequest,
    match_product,
)

USER = SimpleNamespace(id="u", organization_id="o", role="REVIEW_OFFICER")


def _request():
    return ProductMatchRequest(
        report=ProductMatchReportIn(product_name="Amoxicilin-clav 625", active_substance="amoxicilin"),
        candidates=[
            ProductMatchCandidateIn(id="ibd-1", active_substance="Amoxicillin / Clavulanate potassium"),
            ProductMatchCandidateIn(id="ibd-2", active_substance="Tramadol"),
        ],
    )


def _fake(data):
    async def fake(**_):
        return SimpleNamespace(data=data, model="test-model")

    return fake


def test_a_confident_match_to_a_candidate_is_returned(monkeypatch):
    monkeypatch.setattr(ai_psur, "structured_completion", _fake({"match_id": "ibd-1", "confidence": 0.92, "reason": "Same substance; misspelt."}))
    out = asyncio.run(match_product(_request(), user=USER))
    assert out.ai_used and out.match_id == "ibd-1" and out.reason


def test_an_invented_id_is_no_match(monkeypatch):
    monkeypatch.setattr(ai_psur, "structured_completion", _fake({"match_id": "ibd-999", "confidence": 0.99, "reason": "x"}))
    assert asyncio.run(match_product(_request(), user=USER)).match_id is None


def test_a_low_confidence_answer_is_no_match(monkeypatch):
    monkeypatch.setattr(ai_psur, "structured_completion", _fake({"match_id": "ibd-1", "confidence": 0.5, "reason": "maybe"}))
    assert asyncio.run(match_product(_request(), user=USER)).match_id is None


def test_a_failure_never_errors(monkeypatch):
    async def boom(**_):
        raise RuntimeError("down")

    monkeypatch.setattr(ai_psur, "structured_completion", boom)
    out = asyncio.run(match_product(_request(), user=USER))
    assert out.ai_used is False and out.match_id is None and out.error
