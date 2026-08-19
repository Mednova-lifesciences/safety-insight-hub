"""
AI-powered ICSR image extraction.

Vision-only: this route extracts structured field values from an uploaded
image and returns them for the frontend to populate into the intake form.
Nothing here creates or submits a case — that stays a separate, explicit
human action on the existing form (src/routes/_app/icsr.new.tsx), exactly
as it already works for manually-typed intake.
"""
from __future__ import annotations

import base64
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel

from ..ai.client import AiNotConfiguredError, AiRequestError, is_ai_configured, vision_structured_completion
from ..ai.prompts import ICSR_IMAGE_EXTRACTION_PROMPT, PROMPT_VERSION
from ..ai.schemas import AiIcsrExtraction
from ..dependencies import AuthenticatedUser, require_permission

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_IMAGE_BYTES = 12 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


class ExtractionResponse(BaseModel):
    extracted: Optional[dict] = None
    ai_used: bool
    prompt_version: str
    model: Optional[str] = None
    error: Optional[str] = None


@router.get("/status")
async def ai_status():
    return {"configured": is_ai_configured()}


@router.post("/extract-image", response_model=ExtractionResponse)
async def extract_icsr_image(
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_permission("intake.manage")),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        return ExtractionResponse(
            ai_used=False, prompt_version=PROMPT_VERSION, error=f"Unsupported image type: {file.content_type}"
        )

    raw = await file.read()
    if len(raw) > MAX_IMAGE_BYTES:
        return ExtractionResponse(
            ai_used=False, prompt_version=PROMPT_VERSION, error="Image is too large (12MB maximum)."
        )
    if len(raw) == 0:
        return ExtractionResponse(ai_used=False, prompt_version=PROMPT_VERSION, error="The uploaded image is empty.")

    data_url = f"data:{file.content_type};base64,{base64.b64encode(raw).decode('ascii')}"

    try:
        completion = await vision_structured_completion(
            system_prompt=ICSR_IMAGE_EXTRACTION_PROMPT,
            user_text="Extract ICSR intake information from this image.",
            image_data_url=data_url,
        )
        parsed = AiIcsrExtraction.model_validate(completion.data)
        return ExtractionResponse(
            extracted=parsed.model_dump(), ai_used=True, prompt_version=PROMPT_VERSION, model=completion.model
        )
    except AiNotConfiguredError as exc:
        logger.info("ICSR image extraction skipped: %s", exc)
        return ExtractionResponse(ai_used=False, prompt_version=PROMPT_VERSION, error=str(exc))
    except AiRequestError as exc:
        logger.error("ICSR image extraction failed: %s", exc)
        return ExtractionResponse(ai_used=False, prompt_version=PROMPT_VERSION, error="AI extraction unavailable.")
    except Exception as exc:
        logger.error("ICSR image extraction returned unusable output: %s", exc)
        return ExtractionResponse(
            ai_used=False, prompt_version=PROMPT_VERSION, error="AI extraction returned an unusable response."
        )
