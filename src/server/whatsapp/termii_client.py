"""
Termii WhatsApp client (two-way messaging).

Payload shapes below are taken from Termii's public developer docs
(developers.termii.com/messaging-api, developer.termii.com/incoming) as
of 2026-09 — not yet verified against a real send, since no API key was
available while this was built. TERMII_BASE_URL defaults to a best guess
(Termii's docs mask their own base URL as "BASE_URL"); if the real base
URL differs, only the env var needs to change, not this code.

Mirrors the AiNotConfiguredError/AiRequestError pattern in
src/server/ai/client.py: a missing API key is a distinct, expected state
(not configured yet) that callers can degrade around, rather than a
request failure.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

TERMII_BASE_URL = os.getenv("TERMII_BASE_URL", "https://api.ng.termii.com").rstrip("/")
TERMII_API_KEY = os.getenv("TERMII_API_KEY", "").strip()
TERMII_WEBHOOK_SECRET = os.getenv("TERMII_WEBHOOK_SECRET", "").strip()
DEFAULT_TIMEOUT_SECONDS = 20.0


class TermiiNotConfiguredError(Exception):
    """TERMII_API_KEY is missing. Callers should record the message as
    send-failed rather than let this propagate as a 500 — the rest of the
    conversation pipeline (webhook receipt, AI turn, persistence) works
    the same with or without a live Termii connection."""


class TermiiRequestError(Exception):
    """The Termii API rejected the request or returned something unusable."""


def is_termii_configured() -> bool:
    return bool(TERMII_API_KEY)


def webhook_secret_configured() -> bool:
    return bool(TERMII_WEBHOOK_SECRET)


@dataclass
class SendResult:
    message_id: str
    raw: dict


async def send_whatsapp_message(to: str, from_number: str, text: str) -> SendResult:
    """Sends a two-way WhatsApp message. `to` and `from_number` are
    international-format phone numbers (no leading '+', per Termii's
    documented examples, e.g. "2347880234567")."""
    if not TERMII_API_KEY:
        raise TermiiNotConfiguredError(
            "TERMII_API_KEY is not configured. Add it to the server environment to enable sending."
        )
    payload = {
        "api_key": TERMII_API_KEY,
        "to": to,
        "from": from_number,
        "sms": text,
        "type": "plain",
        "channel": "whatsapp",
    }
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT_SECONDS) as client:
            response = await client.post(f"{TERMII_BASE_URL}/api/sms/send", json=payload)
    except httpx.HTTPError as exc:
        raise TermiiRequestError(f"Termii request failed: {exc}") from exc

    if response.status_code >= 400:
        raise TermiiRequestError(f"Termii send failed ({response.status_code}): {response.text}")

    data = response.json()
    message_id = data.get("message_id") or data.get("message_id_str")
    if not message_id:
        raise TermiiRequestError(f"Termii response missing message_id: {data}")
    return SendResult(message_id=str(message_id), raw=data)
