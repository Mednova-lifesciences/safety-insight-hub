"""Critical scientific appraisal of a PSUR/PBRER — the "is it correct,
appropriately classified, scientifically meaningful and adequately
interpreted?" pass NAFDAC asked for (Nov 2026 feedback).

Two stages:

1. **Fact extraction, whole document.** The extracted text (table-aware —
   see pdf_text.py) is split at page boundaries into chunks, and every chunk
   is read in parallel with PSUR_FACT_EXTRACTION_PROMPT. Each records only
   what the MAH presented — signals with the MAH's own description of them,
   every table with its structure (what it is stratified by, its data
   source, its stated time basis), exposure and case figures, risks, MAH
   conclusions — with page numbers. Nothing is judged yet.
2. **Appraisal.** The merged fact sheet goes to PSUR_APPRAISAL_PROMPT, which
   applies PSUR_CRITICAL_APPRAISAL_RULES with nothing else competing for the
   model's attention, and returns findings (each with a scientific
   interpretation and a recommendation for the reviewer) plus a four-question
   verdict for each of S1–S11.

The completion function is injected (``complete``) rather than imported, so
this module has no OpenAI dependency and is testable with a fake model.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from .pdf_text import chunk_page_range, split_into_chunks
from .prompts import PSUR_APPRAISAL_PROMPT, PSUR_FACT_EXTRACTION_PROMPT
from .schemas import AiPsurAppraisal, AiPsurFactChunk

logger = logging.getLogger(__name__)

# The appraisal is where the reasoning happens, so it can be pointed at a
# reasoning-tier model on its own, without changing every other AI workflow.
# Extraction is transcription-like and runs once per chunk, so it defaults to
# the app's normal model.
APPRAISAL_MODEL = os.getenv("OPENAI_APPRAISAL_MODEL") or os.getenv("OPENAI_MODEL", "gpt-4o")
EXTRACTION_MODEL = os.getenv("OPENAI_EXTRACTION_MODEL") or os.getenv("OPENAI_MODEL", "gpt-4o")

CHUNK_TARGET_CHARS = 45_000
MAX_PARALLEL_EXTRACTIONS = 6
EXTRACTION_MAX_OUTPUT_TOKENS = 6_000
EXTRACTION_TIMEOUT_SECONDS = 150.0
APPRAISAL_MAX_OUTPUT_TOKENS = 16_000
APPRAISAL_TIMEOUT_SECONDS = 300.0
# Keeps the stage-2 request a sensible size even for a very long PBRER.
MAX_FACT_SHEET_CHARS = 220_000

_LIST_KEYS = [
    "sections_seen",
    "signals_presented",
    "tables",
    "exposure_statements",
    "case_count_statements",
    "risks_presented",
    "rsi_statements",
    "mah_conclusions",
    "other_notable",
]

CompleteFn = Callable[..., Awaitable[Any]]


@dataclass
class AppraisalResult:
    appraisal: AiPsurAppraisal
    model: Optional[str]
    chunks_total: int
    chunks_read: int
    unread_pages: list[str] = field(default_factory=list)


class AppraisalError(Exception):
    """Raised when no part of the document could be read, or the appraisal
    call itself failed — the caller turns it into ai_used=False."""


def merge_fact_chunks(chunks: list[AiPsurFactChunk]) -> dict[str, Any]:
    """Combine per-chunk facts into one fact sheet, in document order.

    Lists are concatenated (each entry already carries its page). For the
    product statements the first chunk that states a value wins — the title
    page and introduction come first — and indications are unioned.
    """
    merged: dict[str, Any] = {key: [] for key in _LIST_KEYS}
    product: dict[str, Any] = {"approved_indications": []}
    for chunk in chunks:
        for key in _LIST_KEYS:
            merged[key].extend(getattr(chunk, key))
        for k, v in chunk.product_statements.items():
            if k == "approved_indications":
                for ind in v if isinstance(v, list) else []:
                    if isinstance(ind, str) and ind.strip() and ind not in product["approved_indications"]:
                        product["approved_indications"].append(ind.strip())
            elif v not in (None, "", []) and product.get(k) in (None, ""):
                product[k] = v
    merged["product_statements"] = product
    return merged


def _fit_fact_sheet(sheet: dict[str, Any], limit: int = MAX_FACT_SHEET_CHARS) -> tuple[dict[str, Any], bool]:
    """Shrink the sheet if it is too large, trimming the bulkiest,
    least-decisive detail first: per-table key figures, then "other notable"
    notes. Table STRUCTURE and signals are never trimmed — they are what the
    appraisal most needs. Always returns a whole (valid) sheet."""

    def size() -> int:
        return len(json.dumps(sheet, ensure_ascii=False))

    if size() <= limit:
        return sheet, False
    for cap in (25, 10, 3, 0):
        for table in sheet["tables"]:
            figures = table.get("key_figures")
            if isinstance(figures, list) and len(figures) > cap:
                table["key_figures"] = figures[:cap] + [
                    {"label": "(trimmed)", "value": f"{len(figures) - cap} more figures not shown"}
                ]
        if size() <= limit:
            return sheet, True
    sheet["other_notable"] = sheet["other_notable"][:40]
    return sheet, True


async def _extract_chunk(
    complete: CompleteFn,
    semaphore: asyncio.Semaphore,
    chunk: str,
    index: int,
    total: int,
    product: str,
    reporting_period: str,
) -> Optional[AiPsurFactChunk]:
    async with semaphore:
        payload = {
            "chunk": f"{index + 1} of {total}",
            "declaredProduct": product or None,
            "declaredReportingPeriod": reporting_period or None,
            "text": chunk,
        }
        try:
            completion = await complete(
                system_prompt=PSUR_FACT_EXTRACTION_PROMPT,
                user_content=json.dumps(payload, ensure_ascii=False),
                model=EXTRACTION_MODEL,
                max_output_tokens=EXTRACTION_MAX_OUTPUT_TOKENS,
                timeout_seconds=EXTRACTION_TIMEOUT_SECONDS,
            )
            return AiPsurFactChunk.model_validate(completion.data)
        except Exception as exc:  # one unreadable chunk must not sink the rest
            logger.warning("PSUR fact extraction failed for chunk %d/%d: %s", index + 1, total, exc)
            return None


async def appraise_psur_text(
    text: str,
    *,
    complete: CompleteFn,
    filename: str = "",
    product: str = "",
    reporting_period: str = "",
) -> AppraisalResult:
    chunks = split_into_chunks(text, CHUNK_TARGET_CHARS)
    if not chunks:
        raise AppraisalError("No extracted text is available to appraise.")

    semaphore = asyncio.Semaphore(MAX_PARALLEL_EXTRACTIONS)
    results = await asyncio.gather(
        *(
            _extract_chunk(complete, semaphore, chunk, i, len(chunks), product, reporting_period)
            for i, chunk in enumerate(chunks)
        )
    )
    read = [r for r in results if r is not None]
    unread_pages: list[str] = []
    for chunk, result in zip(chunks, results):
        if result is None:
            first, last = chunk_page_range(chunk)
            unread_pages.append(
                f"pages {first}-{last}" if first is not None else "an unnumbered part of the text"
            )
    if not read:
        raise AppraisalError("The AI could not read any part of the document for appraisal.")

    sheet = merge_fact_chunks(read)
    sheet, trimmed = _fit_fact_sheet(sheet)
    payload = {
        "filename": filename or None,
        "declaredProduct": product or None,
        "declaredReportingPeriod": reporting_period or None,
        "coverage_note": (
            "The whole document was read."
            if not unread_pages
            else "These parts could NOT be read and are absent from the fact sheet — do not treat "
            "anything on them as missing from the submission: " + "; ".join(unread_pages)
        )
        + (" Some per-table figures were trimmed for length." if trimmed else ""),
        "fact_sheet": sheet,
    }
    try:
        completion = await complete(
            system_prompt=PSUR_APPRAISAL_PROMPT,
            user_content=json.dumps(payload, ensure_ascii=False),
            model=APPRAISAL_MODEL,
            max_output_tokens=APPRAISAL_MAX_OUTPUT_TOKENS,
            timeout_seconds=APPRAISAL_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        raise AppraisalError(f"The appraisal call failed: {exc}") from exc

    appraisal = AiPsurAppraisal.model_validate(completion.data)
    return AppraisalResult(
        appraisal=appraisal,
        model=getattr(completion, "model", None),
        chunks_total=len(chunks),
        chunks_read=len(read),
        unread_pages=unread_pages,
    )
