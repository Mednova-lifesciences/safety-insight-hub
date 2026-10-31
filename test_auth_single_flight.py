"""A token being verified is verified once, however many requests carrying
it arrive meanwhile (server/dependencies.py). No network: Supabase and the
profile read are stood in for."""

import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server import dependencies  # noqa: E402
from server import db  # noqa: E402


class _Response:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body or {}

    def json(self):
        return self._body


def _stand_in(monkeypatch, status_code=200):
    calls = {"verify": 0, "profile": 0}

    async def verify(token):
        calls["verify"] += 1
        await asyncio.sleep(0.05)
        return _Response(status_code, {"id": "u-1", "email": "test@example.com"})

    class _Client:
        async def get_user_profile(self, user_id):
            calls["profile"] += 1
            return {"organization_id": "org-1", "role": "REVIEW_OFFICER"}

    monkeypatch.setattr(dependencies, "_verify_token_with_supabase", verify)
    monkeypatch.setattr(db, "get_supabase_client", lambda: _Client())
    dependencies.forget_cached_identities()
    return calls


def _token(value="tok-1"):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=value)


async def _many(n, token="tok-1"):
    return await asyncio.gather(
        *(dependencies.get_current_user(_token(token)) for _ in range(n)), return_exceptions=True
    )


def test_requests_arriving_together_verify_the_token_once(monkeypatch):
    calls = _stand_in(monkeypatch)
    users = asyncio.run(_many(9))
    assert calls == {"verify": 1, "profile": 1}
    assert {u.user_id for u in users} == {"u-1"}
    assert not dependencies._identity_in_flight


def test_a_rejected_token_is_rejected_for_every_waiting_request(monkeypatch):
    calls = _stand_in(monkeypatch, status_code=401)
    results = asyncio.run(_many(5))
    assert calls["verify"] == 1
    assert all(isinstance(r, HTTPException) and r.status_code == 401 for r in results)
    assert not dependencies._identity_in_flight


def test_a_failure_is_not_remembered_and_different_tokens_are_verified_separately(monkeypatch):
    calls = _stand_in(monkeypatch, status_code=401)
    asyncio.run(_many(3))
    asyncio.run(_many(3))
    assert calls["verify"] == 2
    calls = _stand_in(monkeypatch)

    async def two_tokens():
        return await asyncio.gather(
            dependencies.get_current_user(_token("tok-a")),
            dependencies.get_current_user(_token("tok-b")),
        )

    asyncio.run(two_tokens())
    assert calls["verify"] == 2
