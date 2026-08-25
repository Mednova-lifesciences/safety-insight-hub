"""Tests for the public, unauthenticated adverse-event intake endpoint.

Uses an isolated FastAPI app that only mounts this one router, and a
fake Supabase client, so these tests never touch a real database and
don't require the full app's env vars (SUPABASE_URL etc.) to import.
"""

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("PUBLIC_INTAKE_ORG_ID", "test-org-123")

from src.server.routes import public_intake  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limit_store():
    public_intake._rate_limit_store.clear()
    yield
    public_intake._rate_limit_store.clear()


@pytest.fixture
def recorded_inserts(monkeypatch):
    inserts = []

    class FakeSupabaseClient:
        async def query(self, table, method="GET", filters=None, data=None, select=None):
            if method == "POST":
                inserts.append((table, data))
            return [data] if data else []

    monkeypatch.setattr(public_intake, "get_supabase_client", lambda: FakeSupabaseClient())
    return inserts


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(public_intake.router, prefix="/api/public")
    return TestClient(app)


VALID_PAYLOAD = {
    "reporterName": "Jane Doe",
    "reporterContact": "jane@example.com",
    "relationshipToPatient": "Self",
    "consent": True,
    "patientAge": "34",
    "patientSex": "FEMALE",
    "patientWeightKg": "61",
    "suspectProduct": "Amoxicillin",
    "reactionDescription": "Facial swelling and difficulty breathing",
    "onsetDate": "2026-08-20",
    "website": "",
}


def test_valid_submission_writes_a_conversation_row(client, recorded_inserts):
    response = client.post("/api/public/intake", json=VALID_PAYLOAD)

    assert response.status_code == 201
    assert response.json() == {"status": "received"}
    assert len(recorded_inserts) == 1
    table, row = recorded_inserts[0]
    assert table == "pv_intake_conversations"
    assert row["organization_id"] == "test-org-123"
    assert row["data"]["channel"] == "WEB_FORM"
    assert row["data"]["consent"] == "GRANTED"
    assert row["data"]["criteria"] == {
        "reporter": True,
        "patient": True,
        "product": True,
        "event": True,
    }
    extracted = {e["field"]: e["value"] for e in row["data"]["extracted"]}
    assert extracted["Suspect product"] == "Amoxicillin"
    assert extracted["Adverse event"] == "Facial swelling and difficulty breathing"


def test_honeypot_filled_drops_submission_silently(client, recorded_inserts):
    payload = {**VALID_PAYLOAD, "website": "http://spam.example"}

    response = client.post("/api/public/intake", json=payload)

    assert response.status_code == 201
    assert response.json() == {"status": "received"}
    assert recorded_inserts == []


def test_missing_required_field_is_rejected(client, recorded_inserts):
    payload = {**VALID_PAYLOAD}
    del payload["reactionDescription"]

    response = client.post("/api/public/intake", json=payload)

    assert response.status_code == 422
    assert recorded_inserts == []


def test_declined_consent_is_still_recorded(client, recorded_inserts):
    payload = {**VALID_PAYLOAD, "consent": False}

    response = client.post("/api/public/intake", json=payload)

    assert response.status_code == 201
    assert recorded_inserts[0][1]["data"]["consent"] == "DECLINED"


def test_rate_limit_blocks_after_max_requests(client, recorded_inserts):
    for _ in range(public_intake.RATE_LIMIT_MAX_REQUESTS):
        response = client.post("/api/public/intake", json=VALID_PAYLOAD)
        assert response.status_code == 201

    response = client.post("/api/public/intake", json=VALID_PAYLOAD)

    assert response.status_code == 429
    assert len(recorded_inserts) == public_intake.RATE_LIMIT_MAX_REQUESTS


def test_unconfigured_org_id_returns_503(client, recorded_inserts, monkeypatch):
    monkeypatch.delenv("PUBLIC_INTAKE_ORG_ID", raising=False)

    response = client.post("/api/public/intake", json=VALID_PAYLOAD)

    assert response.status_code == 503
    assert recorded_inserts == []
