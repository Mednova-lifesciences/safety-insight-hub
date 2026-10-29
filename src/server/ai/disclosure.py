"""
The record of what each AI call disclosed — field names and counts, never
values (Nigeria Data Protection Act 2023: accountability, s.24(3) and
s.39). One row per OpenAI request, in pv_ai_disclosures, readable by the
organisation's administrators.

The caller's identity and the endpoint are carried in a context variable
set during authentication (dependencies.get_current_user) and by the
request middleware, so client.py can log any call without every route
passing them down.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class AiRequestContext:
    organization_id: Optional[str] = None
    user_id: Optional[str] = None
    role: Optional[str] = None
    endpoint: Optional[str] = None


_context: contextvars.ContextVar[Optional[AiRequestContext]] = contextvars.ContextVar(
    "ai_request_context", default=None
)

# Tasks are kept referenced until they finish, so a log write is never
# garbage-collected mid-flight.
_pending: set[asyncio.Task] = set()


def set_endpoint(endpoint: str) -> None:
    ctx = _context.get() or AiRequestContext()
    _context.set(AiRequestContext(ctx.organization_id, ctx.user_id, ctx.role, endpoint))


def set_caller(organization_id: Optional[str], user_id: Optional[str], role: Optional[str]) -> None:
    ctx = _context.get() or AiRequestContext()
    _context.set(AiRequestContext(organization_id, user_id, role, ctx.endpoint))


def current() -> AiRequestContext:
    return _context.get() or AiRequestContext()


def build_row(summary: dict[str, Any], *, model: str, kind: str, ctx: AiRequestContext) -> dict[str, Any]:
    return {
        "organization_id": ctx.organization_id,
        "user_id": ctx.user_id,
        "data": {
            "at": datetime.now(timezone.utc).isoformat(),
            "endpoint": ctx.endpoint,
            "role": ctx.role,
            "model": model,
            "kind": kind,
            "replaced": summary.get("replaced", {}),
            "fields": summary.get("fields", {}),
            "total": summary.get("total", 0),
        },
    }


async def _write(row: dict[str, Any]) -> None:
    try:
        from ..db import get_supabase_client

        await get_supabase_client().query("pv_ai_disclosures", method="POST", data=row)
    except Exception as exc:  # never fail an AI call over its log line
        logger.warning("Could not record the AI disclosure log entry: %s", exc)


def record(summary: dict[str, Any], *, model: str, kind: str = "text") -> None:
    """Queues the log row. Calls made outside a signed-in request (tests,
    scripts) have no organisation and are not stored."""
    ctx = current()
    if not ctx.organization_id:
        return
    row = build_row(summary, model=model, kind=kind, ctx=ctx)
    try:
        task = asyncio.get_running_loop().create_task(_write(row))
    except RuntimeError:
        return
    _pending.add(task)
    task.add_done_callback(_pending.discard)
