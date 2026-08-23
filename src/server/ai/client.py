"""
Central, reusable OpenAI service.

Every AI-powered workflow in this app (line-list analysis/fix, PSUR/PBRER
review/fix, ICSR image extraction) goes through this module rather than
constructing its own OpenAI client. That keeps API key handling, timeout/
retry policy, and error classification in one place.

The API key is read from the server environment only (OPENAI_API_KEY) and
is never reachable from the browser — every caller of this module lives
under src/server/routes and runs on the FastAPI backend, never in
frontend code.

Responses are requested in JSON mode (guaranteed-valid JSON) rather than
OpenAI's stricter json_schema mode, because the app validates every
response against its own Pydantic model before using it either way
("never blindly parse untrusted model output") — that validation step is
the actual safety boundary, not a schema hint to the model.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
from dataclasses import dataclass
from typing import Any, Optional

from openai import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AsyncOpenAI,
    InternalServerError,
    RateLimitError,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "gpt-4o")
# Line-list validation (analysis + adversarial review) can be pointed at a
# stronger/different model independently of the app's other AI workflows,
# without editing code — falls back to DEFAULT_MODEL when unset.
VALIDATION_MODEL = os.getenv("OPENAI_VALIDATION_MODEL", DEFAULT_MODEL)
DEFAULT_TIMEOUT_SECONDS = 60.0
MAX_RETRIES = 2
# An empty-response retry costs a full model regeneration (tens of seconds
# for a reasoning-tier model), unlike a network/rate-limit retry which
# fails fast — so it gets its own, smaller budget. Burning all of
# MAX_RETRIES here on a slow, synchronous HTTP request risks exceeding a
# platform-level proxy timeout between the browser and the backend before
# a response — even an eventually-successful one — can be delivered.
MAX_EMPTY_RESPONSE_RETRIES = 1
BASE_BACKOFF_SECONDS = 1.0

# Only genuinely transient failures are retried: network/timeout issues,
# rate limits, and the API's own 5xx errors. Everything else (bad request,
# auth, not found, unprocessable entity, ...) means the request or config
# itself is wrong — retrying can't fix that, so those raise immediately
# instead of burning the retry budget on a guaranteed repeat failure.
_RETRYABLE_ERRORS = (APITimeoutError, APIConnectionError, RateLimitError, InternalServerError)

# Some models (typically newer reasoning-optimized ones) reject any explicit
# temperature, including 0, and only support their own fixed default — which
# model that is here is controlled by env vars this code doesn't choose, so
# rather than hardcode a per-model list, a model is added here the first
# time it actually rejects one, and every call for that model skips sending
# temperature at all from then on for the life of this process.
_MODELS_WITHOUT_CUSTOM_TEMPERATURE: set[str] = set()


def _is_unsupported_temperature_error(exc: APIError) -> bool:
    body = getattr(exc, "body", None)
    error = body.get("error", body) if isinstance(body, dict) else None
    if isinstance(error, dict) and error.get("param") == "temperature":
        return True
    # Fall back to matching the rendered error text in case the SDK's body
    # shape differs across versions — still specific enough not to
    # misfire on an unrelated 400.
    text = str(exc)
    return "'param': 'temperature'" in text or '"param": "temperature"' in text


class AiNotConfiguredError(Exception):
    """OPENAI_API_KEY is missing. Callers should catch this and fall back
    to deterministic behaviour rather than let it propagate as a 500."""


class AiRequestError(Exception):
    """The OpenAI request failed after retries, or returned output that
    couldn't be parsed/validated. Callers should fall back."""


_client: Optional[AsyncOpenAI] = None


def is_ai_configured() -> bool:
    return bool(os.getenv("OPENAI_API_KEY", "").strip())


def get_client() -> AsyncOpenAI:
    global _client
    if not is_ai_configured():
        raise AiNotConfiguredError(
            "OpenAI API key is not configured. Add OPENAI_API_KEY to the server environment."
        )
    if _client is None:
        _client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=DEFAULT_TIMEOUT_SECONDS)
    return _client


@dataclass
class StructuredCompletion:
    data: dict[str, Any]
    model: str
    usage_input_tokens: int
    usage_output_tokens: int


def _record_usage(response) -> tuple[int, int]:
    usage = getattr(response, "usage", None)
    if not usage:
        return 0, 0
    return usage.prompt_tokens or 0, usage.completion_tokens or 0


def _backoff_seconds(attempt: int, exc: Exception) -> float:
    """Exponential backoff with jitter, honouring the API's own Retry-After
    header when the error carries one — rate limits especially are only
    worth retrying after actually waiting, not immediately again."""
    response = getattr(exc, "response", None)
    if response is not None:
        header = response.headers.get("retry-after")
        if header:
            try:
                return max(0.0, float(header))
            except ValueError:
                pass
    return BASE_BACKOFF_SECONDS * (2**attempt) + random.uniform(0, 0.5)


async def structured_completion(
    *,
    system_prompt: str,
    user_content: str,
    model: str = DEFAULT_MODEL,
    max_output_tokens: int = 4000,
) -> StructuredCompletion:
    """Text-only JSON-mode completion, with retry on transient failures."""
    client = get_client()
    last_error: Optional[Exception] = None
    send_temperature = model not in _MODELS_WITHOUT_CUSTOM_TEMPERATURE

    for attempt in range(MAX_RETRIES + 1):
        try:
            kwargs: dict[str, Any] = dict(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                # max_completion_tokens (not the legacy max_tokens) works
                # across both older and newer OpenAI chat-completions models
                # — newer reasoning-family models reject max_tokens outright
                # (400 unsupported_parameter), and which model is actually
                # configured here is controlled by env vars that can change
                # independently of this code.
                max_completion_tokens=max_output_tokens,
            )
            if send_temperature:
                kwargs["temperature"] = 0
            response = await client.chat.completions.create(**kwargs)
            raw = response.choices[0].message.content
            if not raw:
                # Seen in practice with reasoning-tier models: the token
                # budget gets spent on hidden reasoning tokens, leaving
                # nothing for the visible JSON answer (finish_reason
                # "length" with empty content). This varies call to call
                # for the same input, so it's worth retrying rather than
                # failing the whole request on the first empty response.
                last_error = AiRequestError(
                    f"OpenAI returned an empty response (finish_reason={response.choices[0].finish_reason!r})."
                )
                if attempt < MAX_EMPTY_RESPONSE_RETRIES:
                    delay = _backoff_seconds(attempt, last_error)
                    logger.warning(
                        "OpenAI request attempt %s/%s returned an empty response, retrying in %.1fs",
                        attempt + 1, MAX_EMPTY_RESPONSE_RETRIES + 1, delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.error("OpenAI request failed after %s attempts: %s", attempt + 1, last_error)
                raise last_error
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise AiRequestError(f"OpenAI returned invalid JSON: {exc}") from exc

            in_tok, out_tok = _record_usage(response)
            return StructuredCompletion(data=data, model=response.model, usage_input_tokens=in_tok, usage_output_tokens=out_tok)
        except _RETRYABLE_ERRORS as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                delay = _backoff_seconds(attempt, exc)
                logger.warning(
                    "OpenAI request attempt %s/%s failed (%s), retrying in %.1fs: %s",
                    attempt + 1, MAX_RETRIES + 1, type(exc).__name__, delay, exc,
                )
                await asyncio.sleep(delay)
            else:
                logger.warning("OpenAI request attempt %s/%s failed: %s", attempt + 1, MAX_RETRIES + 1, exc)
            continue
        except APIError as exc:
            if send_temperature and _is_unsupported_temperature_error(exc):
                logger.warning("Model %s rejects an explicit temperature; retrying without it.", model)
                _MODELS_WITHOUT_CUSTOM_TEMPERATURE.add(model)
                send_temperature = False
                last_error = exc
                continue
            logger.error("OpenAI API error (not retried — not a transient failure): %s", exc)
            raise AiRequestError(f"OpenAI API error: {exc}") from exc

    logger.error("OpenAI request failed after %s attempts: %s", MAX_RETRIES + 1, last_error)
    raise AiRequestError(f"OpenAI request failed after retries: {last_error}")


async def vision_structured_completion(
    *,
    system_prompt: str,
    user_text: str,
    image_data_url: str,
    model: str = VISION_MODEL,
    max_output_tokens: int = 3000,
) -> StructuredCompletion:
    """Same contract as structured_completion, for a single-image vision
    request (used by ICSR image extraction). image_data_url must be a
    data: URI (base64) — nothing is uploaded to third-party storage."""
    client = get_client()
    last_error: Optional[Exception] = None
    send_temperature = model not in _MODELS_WITHOUT_CUSTOM_TEMPERATURE

    for attempt in range(MAX_RETRIES + 1):
        try:
            kwargs: dict[str, Any] = dict(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_text},
                            {"type": "image_url", "image_url": {"url": image_data_url}},
                        ],
                    },
                ],
                response_format={"type": "json_object"},
                # max_completion_tokens (not the legacy max_tokens) works
                # across both older and newer OpenAI chat-completions models
                # — newer reasoning-family models reject max_tokens outright
                # (400 unsupported_parameter), and which model is actually
                # configured here is controlled by env vars that can change
                # independently of this code.
                max_completion_tokens=max_output_tokens,
            )
            if send_temperature:
                kwargs["temperature"] = 0
            response = await client.chat.completions.create(**kwargs)
            raw = response.choices[0].message.content
            if not raw:
                last_error = AiRequestError(
                    f"OpenAI returned an empty response (finish_reason={response.choices[0].finish_reason!r})."
                )
                if attempt < MAX_EMPTY_RESPONSE_RETRIES:
                    delay = _backoff_seconds(attempt, last_error)
                    logger.warning(
                        "OpenAI vision request attempt %s/%s returned an empty response, retrying in %.1fs",
                        attempt + 1, MAX_EMPTY_RESPONSE_RETRIES + 1, delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                logger.error("OpenAI vision request failed after %s attempts: %s", attempt + 1, last_error)
                raise last_error
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise AiRequestError(f"OpenAI returned invalid JSON: {exc}") from exc

            in_tok, out_tok = _record_usage(response)
            return StructuredCompletion(data=data, model=response.model, usage_input_tokens=in_tok, usage_output_tokens=out_tok)
        except _RETRYABLE_ERRORS as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                delay = _backoff_seconds(attempt, exc)
                logger.warning(
                    "OpenAI vision request attempt %s/%s failed (%s), retrying in %.1fs: %s",
                    attempt + 1, MAX_RETRIES + 1, type(exc).__name__, delay, exc,
                )
                await asyncio.sleep(delay)
            else:
                logger.warning("OpenAI vision request attempt %s/%s failed: %s", attempt + 1, MAX_RETRIES + 1, exc)
            continue
        except APIError as exc:
            if send_temperature and _is_unsupported_temperature_error(exc):
                logger.warning("Model %s rejects an explicit temperature; retrying without it.", model)
                _MODELS_WITHOUT_CUSTOM_TEMPERATURE.add(model)
                send_temperature = False
                last_error = exc
                continue
            logger.error("OpenAI vision API error (not retried — not a transient failure): %s", exc)
            raise AiRequestError(f"OpenAI API error: {exc}") from exc

    logger.error("OpenAI vision request failed after %s attempts: %s", MAX_RETRIES + 1, last_error)
    raise AiRequestError(f"OpenAI vision request failed after retries: {last_error}")
