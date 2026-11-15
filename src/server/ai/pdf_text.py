"""Table-aware PDF text extraction for PSUR/PBRER submissions.

Why this exists (NAFDAC feedback, Nov 2026): the review misread a clinical
trial SAE table that was broken down by INDICATION (erectile dysfunction vs
pulmonary arterial hypertension) as if its two columns were "reporting
interval" and "cumulative". Plain ``page.extract_text()`` flattens a table
into loose lines of numbers and throws away which header each number sat
under — after that, no amount of prompting can recover what the columns
meant. Here every table pdfplumber can detect is emitted as a Markdown
table WITH its header row, in reading order, so the model sees exactly the
structure the reviewer sees on the page.

The previous extractor also stopped reading after 120,000 characters, so the
later sections of a long PBRER (signals, benefit-risk) were never seen by the
model at all. Extraction now keeps up to ``MAX_EXTRACTED_CHARS``; each AI
call decides for itself how much of that it sends (see appraisal.py, which
reads the whole document in chunks).

Pure functions, no FastAPI/OpenAI imports, so they're directly testable.
"""

from __future__ import annotations

import io
import re

# Generous ceiling on what is RETAINED (it is stored on the document record
# and re-sent for the deferred scientific review). ~800k chars is several
# hundred PDF pages — beyond that the submission is almost certainly
# appendix line listings, which this review does not need verbatim.
MAX_EXTRACTED_CHARS = 800_000

_PAGE_MARKER_RE = re.compile(r"^--- page (\d+) ---$", re.MULTILINE)


def _clean_cell(value: object) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r", " ").replace("\n", " ")
    text = re.sub(r"\s+", " ", text).strip()
    # A literal pipe would break the Markdown table's column alignment.
    return text.replace("|", "/")


def table_to_markdown(rows: list[list[object]]) -> str:
    """Render one extracted table as Markdown, first row as the header.

    Rows are padded to the widest row so a ragged extraction never shifts a
    number into the wrong column. Fully empty rows are dropped. Returns ""
    for a table with no content at all.
    """
    cleaned = [[_clean_cell(c) for c in row] for row in rows if row is not None]
    cleaned = [row for row in cleaned if any(cell for cell in row)]
    if not cleaned:
        return ""
    width = max(len(r) for r in cleaned)
    padded = [r + [""] * (width - len(r)) for r in cleaned]
    header, body = padded[0], padded[1:]
    lines = [
        "| " + " | ".join(h or f"(col {i + 1})" for i, h in enumerate(header)) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    lines += ["| " + " | ".join(row) + " |" for row in body]
    return "\n".join(lines)


def _page_text_with_tables(page, page_number: int) -> str:
    """Page text in reading order, with each detected table as Markdown.

    Text inside a table's bounding box is excluded from the prose (it is in
    the table instead), so numbers are not duplicated out of context.
    Falls back to the plain text layer if table detection fails for any
    reason — a page we can read badly beats a page we can't read at all.
    """
    try:
        tables = sorted(page.find_tables(), key=lambda t: t.bbox[1])
    except Exception:
        tables = []
    if not tables:
        return (page.extract_text() or "").strip()

    def _outside_tables(obj) -> bool:
        x0, top, x1, bottom = obj.get("x0"), obj.get("top"), obj.get("x1"), obj.get("bottom")
        if x0 is None or top is None:
            return True
        for t in tables:
            tx0, ttop, tx1, tbottom = t.bbox
            if x0 >= tx0 - 1 and x1 <= tx1 + 1 and top >= ttop - 1 and bottom <= tbottom + 1:
                return False
        return True

    try:
        prose_page = page.filter(_outside_tables)
        parts: list[str] = []
        cursor = 0.0
        for index, table in enumerate(tables, start=1):
            _, ttop, _, tbottom = table.bbox
            if ttop > cursor:
                above = prose_page.crop((0, cursor, page.width, ttop)).extract_text() or ""
                if above.strip():
                    parts.append(above.strip())
            markdown = table_to_markdown(table.extract())
            if markdown:
                parts.append(f"[TABLE {index} on page {page_number}]\n{markdown}\n[END TABLE]")
            cursor = max(cursor, tbottom)
        if cursor < page.height:
            below = prose_page.crop((0, cursor, page.width, page.height)).extract_text() or ""
            if below.strip():
                parts.append(below.strip())
        return "\n\n".join(parts)
    except Exception:
        return (page.extract_text() or "").strip()


def extract_pdf_text(raw: bytes, max_chars: int = MAX_EXTRACTED_CHARS) -> tuple[str, int]:
    """Return (text with ``--- page N ---`` markers, total page count)."""
    import pdfplumber

    parts: list[str] = []
    budget = max_chars
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        total_pages = len(pdf.pages)
        for i, page in enumerate(pdf.pages):
            if budget <= 0:
                break
            page_text = _page_text_with_tables(page, i + 1)
            if not page_text:
                continue
            chunk = f"\n\n--- page {i + 1} ---\n{page_text[:budget]}"
            parts.append(chunk)
            budget -= len(chunk)
    return "".join(parts), total_pages


def split_into_chunks(text: str, target_chars: int = 45_000) -> list[str]:
    """Split extracted text into chunks of roughly ``target_chars``,
    breaking only at page boundaries so a table is never cut in half.

    A single page longer than the target becomes its own chunk (it is not
    split mid-page). Text before the first page marker, if any, stays with
    the first chunk.
    """
    if not text.strip():
        return []
    starts = [m.start() for m in _PAGE_MARKER_RE.finditer(text)]
    if not starts:
        # No page markers (e.g. text pasted by hand): fall back to splitting
        # on blank lines.
        pieces = re.split(r"\n\s*\n", text)
    else:
        pieces = []
        if starts[0] > 0:
            pieces.append(text[: starts[0]])
        for idx, start in enumerate(starts):
            end = starts[idx + 1] if idx + 1 < len(starts) else len(text)
            pieces.append(text[start:end])

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + len(piece) > target_chars:
            chunks.append(current)
            current = ""
        current += piece if current == "" or piece.startswith("\n") else "\n\n" + piece
    if current.strip():
        chunks.append(current)
    return chunks


def chunk_page_range(chunk: str) -> tuple[int | None, int | None]:
    pages = [int(m.group(1)) for m in _PAGE_MARKER_RE.finditer(chunk)]
    if not pages:
        return None, None
    return pages[0], pages[-1]
