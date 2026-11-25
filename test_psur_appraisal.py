"""The critical scientific appraisal (NAFDAC feedback, Nov 2026).

Offline tests — no model is called. They pin down the parts of the pipeline
that decide whether the model is even ABLE to catch the two errors NAFDAC's
assessors reported:

- tables reach the model with their headers, so indication columns
  (ED / PAH) cannot be mistaken for interval / cumulative columns;
- the whole document is read, not only the first 120k characters;
- the prompts actually carry the rules (signal definition, table structure)
  and ask for the fields the schema accepts;
- one unreadable chunk is reported, never silently treated as a clean read.

Whether a given model then reaches the right conclusions is checked live by
scripts/eval_psur_appraisal.py against the same fictional test PSUR.
"""

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from server.ai import appraisal as appraisal_mod  # noqa: E402
from server.ai.appraisal import (  # noqa: E402
    AppraisalError,
    appraise_psur_text,
    merge_fact_chunks,
)
from server.ai.pdf_text import (  # noqa: E402
    chunk_page_range,
    extract_pdf_text,
    split_into_chunks,
    table_to_markdown,
)
from server.ai.prompts import (  # noqa: E402
    PSUR_APPRAISAL_PROMPT,
    PSUR_CRITICAL_APPRAISAL_RULES,
    PSUR_FACT_EXTRACTION_PROMPT,
    PSUR_REVIEW_PDF_PROMPT,
)
from server.ai.schemas import (  # noqa: E402
    _APPRAISAL_SECTIONS,
    _KNOWN_DEFICIENCY_TYPES,
    AiPsurAppraisal,
    AiPsurFactChunk,
    AiPsurFinding,
)


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def test_psur_text():
    make = pytest.importorskip("make_appraisal_test_psur")
    pytest.importorskip("reportlab")
    path = make.build(ROOT / "docs" / "test-psurs" / "appraisal-test-pbrer-sildenafil.pdf")
    text, pages = extract_pdf_text(path.read_bytes())
    assert pages == 3
    return text


def test_indication_table_keeps_its_headers(test_psur_text):
    # The exact failure NAFDAC reported: these columns are INDICATIONS.
    header = next(line for line in test_psur_text.splitlines() if line.startswith("| System Organ Class"))
    assert "Erectile dysfunction" in header
    assert "Pulmonary arterial hypertension" in header
    assert "| Total SAEs | 31 | 90 |" in test_psur_text


def test_tables_are_marked_and_prose_is_not_duplicated(test_psur_text):
    assert "[TABLE 1 on page 2]" in test_psur_text
    assert "[TABLE 1 on page 3]" in test_psur_text
    # Table cell text lives in the table only, not again as loose prose.
    assert test_psur_text.count("Cardiac disorders") == 1


def test_tables_stay_in_reading_order(test_psur_text):
    intro = test_psur_text.index("Table 6.1 presents")
    table = test_psur_text.index("[TABLE 1 on page 2]")
    after = test_psur_text.index("As shown in Table 6.1")
    assert intro < table < after


def test_signal_table_survives_with_all_three_rows(test_psur_text):
    for term in ("Raynaud's phenomenon", "Heart failure with preserved ejection fraction",
                 "Sudden sensorineural hearing loss"):
        assert term in test_psur_text


def test_table_to_markdown_pads_ragged_rows_and_drops_empty_ones():
    md = table_to_markdown([["A", "B", "C"], ["1", None], [None, None, None], ["x|y", "2", "3"]])
    lines = md.splitlines()
    assert lines[0] == "| A | B | C |"
    assert lines[2] == "| 1 |  |  |"
    assert lines[3] == "| x/y | 2 | 3 |"
    assert len(lines) == 4
    assert table_to_markdown([[None, ""]]) == ""


def test_extraction_reads_past_the_old_120k_limit():
    # The old extractor stopped at 120,000 characters — the signal and
    # benefit-risk sections of a long PBRER were never seen.
    from server.ai.pdf_text import MAX_EXTRACTED_CHARS

    assert MAX_EXTRACTED_CHARS >= 500_000


# --------------------------------------------------------------------------
# Chunking
# --------------------------------------------------------------------------


def _pages(n, size):
    return "".join(f"\n\n--- page {i} ---\n" + ("x" * size) for i in range(1, n + 1))


def test_chunks_split_only_at_page_boundaries_and_lose_nothing():
    text = _pages(10, 10_000)
    chunks = split_into_chunks(text, target_chars=25_000)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.lstrip().startswith("--- page")
    assert "".join(chunks).count("--- page") == 10
    assert sum(c.count("x") for c in chunks) == 100_000


def test_an_oversized_page_is_its_own_chunk_not_split():
    text = _pages(1, 5_000) + "\n\n--- page 2 ---\n" + ("y" * 60_000) + _pages(1, 10).replace("page 1", "page 3")
    chunks = split_into_chunks(text, target_chars=20_000)
    big = [c for c in chunks if "y" * 60_000 in c]
    assert len(big) == 1


def test_chunk_page_range():
    chunk = split_into_chunks(_pages(4, 100), target_chars=10**6)[0]
    assert chunk_page_range(chunk) == (1, 4)
    assert chunk_page_range("no markers") == (None, None)


# --------------------------------------------------------------------------
# Prompts carry the rules and ask for what the schema accepts
# --------------------------------------------------------------------------


def test_rules_state_the_signal_definition_and_what_is_not_a_signal():
    rules = PSUR_CRITICAL_APPRAISAL_RULES
    assert "CIOMS VIII" in rules
    assert "investigational therapeutic uses" in rules
    assert "do not constitute a PV safety signal" in rules or "does not constitute a PV safety signal" in rules


def test_rules_forbid_relabelling_indication_columns_as_time_periods():
    rules = PSUR_CRITICAL_APPRAISAL_RULES
    assert "must never" in rules and "be relabelled" in rules
    assert "time basis" in rules


def test_rules_test_signals_against_the_rsi_as_the_mah_states_it():
    rules = PSUR_CRITICAL_APPRAISAL_RULES
    assert "I. Signals and risks against the RSI" in rules
    assert "NOT SHOWN TO BE LISTED" in rules
    # Listedness comes from the submission's own RSI, never the model's memory
    # of the real label, and a partial list is never proof of "unlisted".
    assert "never from your own knowledge of the product's label" in rules
    assert "partial list" in rules
    assert "S4 is not SOUND merely because" in rules


def test_appraisal_workflow_applies_the_rsi_rule_to_genuine_signals():
    assert "Apply rule I" in PSUR_APPRAISAL_PROMPT


def test_extraction_copies_out_every_listed_rsi_term_and_whether_the_list_is_whole():
    assert '"listed_terms"' in PSUR_FACT_EXTRACTION_PROMPT
    assert '"listed_terms_complete"' in PSUR_FACT_EXTRACTION_PROMPT


def test_rsi_terms_survive_the_fact_sheet_merge():
    chunk = AiPsurFactChunk.model_validate(
        {"rsi_statements": [{"statement": "CCDS v14.0", "listed_terms": ["headache", "NAION"],
                             "listed_terms_complete": False, "page": 1}]}
    )
    merged = merge_fact_chunks([chunk])
    assert merged["rsi_statements"][0]["listed_terms"] == ["headache", "NAION"]
    assert merged["rsi_statements"][0]["listed_terms_complete"] is False


def test_rules_ask_the_assessors_four_questions():
    for q in ("CORRECT", "APPROPRIATELY CLASSIFIED", "SCIENTIFICALLY MEANINGFUL", "ADEQUATELY INTERPRETED"):
        assert q in PSUR_CRITICAL_APPRAISAL_RULES


@pytest.mark.parametrize("prompt", [PSUR_REVIEW_PDF_PROMPT, PSUR_APPRAISAL_PROMPT])
def test_both_review_prompts_apply_the_same_rules_and_ask_for_the_new_fields(prompt):
    assert PSUR_CRITICAL_APPRAISAL_RULES in prompt
    for field in AiPsurFinding.model_fields:
        if field in {"scientific_interpretation", "reviewer_recommendation", "confidence"}:
            assert f'"{field}"' in prompt, field


def test_new_deficiency_types_are_accepted_by_the_schema():
    assert {"MISCLASSIFICATION", "MISINTERPRETATION"} <= _KNOWN_DEFICIENCY_TYPES
    for t in ("MISCLASSIFICATION", "MISINTERPRETATION"):
        assert t in PSUR_REVIEW_PDF_PROMPT and t in PSUR_APPRAISAL_PROMPT


def test_appraisal_prompt_names_every_section_it_must_appraise():
    for section in _APPRAISAL_SECTIONS:
        assert section in PSUR_APPRAISAL_PROMPT


def test_extraction_prompt_never_lets_time_basis_be_guessed():
    assert "UNSTATED" in PSUR_FACT_EXTRACTION_PROMPT
    assert "stratifications, not time periods" in PSUR_FACT_EXTRACTION_PROMPT
    for key in AiPsurFactChunk.model_fields:
        assert f'"{key}"' in PSUR_FACT_EXTRACTION_PROMPT, key


# --------------------------------------------------------------------------
# Schema normalisation
# --------------------------------------------------------------------------


def test_appraisal_always_has_exactly_one_entry_per_section_in_order():
    parsed = AiPsurAppraisal.model_validate(
        {
            "section_appraisals": [
                {"v4_section": "s8_signal_evaluation", "classified": {"verdict": "concern", "reasoning": "r"}},
                {"v4_section": "S8_SIGNAL_EVALUATION"},  # duplicate — dropped
                {"v4_section": "S99_MADE_UP"},  # unknown — dropped
                "not a dict",
            ]
        }
    )
    assert [s.v4_section for s in parsed.section_appraisals] == _APPRAISAL_SECTIONS
    s8 = parsed.section_appraisals[_APPRAISAL_SECTIONS.index("S8_SIGNAL_EVALUATION")]
    assert s8.classified.verdict == "CONCERN"
    s1 = parsed.section_appraisals[0]
    assert s1.correct.verdict == "NOT_ASSESSABLE"  # skipped is never "sound"


def test_missing_section_appraisals_still_yields_all_sections():
    parsed = AiPsurAppraisal.model_validate({"findings": []})
    assert len(parsed.section_appraisals) == len(_APPRAISAL_SECTIONS)


def test_a_section_the_ai_skipped_is_marked_not_returned_but_a_returned_one_is_not():
    # "The AI returned nothing" is a failure and must be told apart from "the
    # MAH left the section out", which the AI reports as NOT_ASSESSABLE.
    parsed = AiPsurAppraisal.model_validate(
        {"section_appraisals": [{"v4_section": "S2_WORLDWIDE_STATUS",
                                 "correct": {"verdict": "not assessable", "reasoning": "absent"}}]}
    )
    by = {s.v4_section: s for s in parsed.section_appraisals}
    assert by["S2_WORLDWIDE_STATUS"].returned is True
    assert by["S2_WORLDWIDE_STATUS"].correct.verdict == "NOT_ASSESSABLE"
    assert by["S3_THERAPEUTIC_CONTEXT"].returned is False
    assert sum(1 for s in parsed.section_appraisals if not s.returned) == len(_APPRAISAL_SECTIONS) - 1


def test_one_bad_finding_does_not_sink_the_rest():
    parsed = AiPsurAppraisal.model_validate(
        {
            "findings": [
                {"category": "SIGNAL", "severity": "HIGH", "section": "15", "description": "d",
                 "evidence": "e", "deficiency_type": "misclassification", "confidence": "high",
                 "scientific_interpretation": "  ", "reviewer_recommendation": "Ask the MAH."},
                {"severity": "HIGH"},  # missing required fields
            ]
        }
    )
    assert len(parsed.findings) == 1
    f = parsed.findings[0]
    assert f.deficiency_type == "MISCLASSIFICATION"
    assert f.confidence == "HIGH"
    assert f.scientific_interpretation is None  # blank becomes None
    assert f.reviewer_recommendation == "Ask the MAH."


# --------------------------------------------------------------------------
# Pipeline, with a fake model
# --------------------------------------------------------------------------


class FakeModel:
    """Answers extraction calls with one table per chunk and the appraisal
    call with a canned appraisal; records every request."""

    def __init__(self, fail_chunks=()):
        self.calls = []
        self.fail_chunks = set(fail_chunks)

    async def __call__(self, *, system_prompt, user_content, model, max_output_tokens, timeout_seconds):
        payload = json.loads(user_content)
        self.calls.append((system_prompt, payload, model))
        if system_prompt is PSUR_FACT_EXTRACTION_PROMPT:
            index = int(payload["chunk"].split(" of ")[0])
            if index in self.fail_chunks:
                raise RuntimeError("model timed out")
            return SimpleNamespace(
                model="fake-extract",
                data={
                    "product_statements": {"product": "Sildenafil" if index == 1 else None,
                                           "approved_indications": ["ED", "PAH"]},
                    "tables": [{"title": f"Table from chunk {index}", "stratified_by": ["indication"],
                                "time_basis": "UNSTATED", "key_figures": []}],
                    "signals_presented": [{"term": f"signal {index}"}],
                    "sections_seen": "not a list",  # tolerated
                },
            )
        return SimpleNamespace(
            model="fake-appraise",
            data={
                "findings": [{"category": "SIGNAL", "severity": "HIGH", "section": "15",
                              "description": "d", "evidence": "e", "v4_section": "S8_SIGNAL_EVALUATION",
                              "deficiency_type": "MISCLASSIFICATION"}],
                "section_appraisals": [],
            },
        )


def test_every_chunk_is_read_then_appraised_once():
    fake = FakeModel()
    text = _pages(12, 10_000)
    result = asyncio.run(appraise_psur_text(text, complete=fake, product="Sildenafil"))
    extract_calls = [c for c in fake.calls if c[0] is PSUR_FACT_EXTRACTION_PROMPT]
    appraise_calls = [c for c in fake.calls if c[0] is PSUR_APPRAISAL_PROMPT]
    assert len(extract_calls) == result.chunks_total == result.chunks_read > 1
    assert len(appraise_calls) == 1
    sheet = appraise_calls[0][1]["fact_sheet"]
    assert len(sheet["tables"]) == result.chunks_total  # nothing lost in the merge
    assert sheet["product_statements"]["product"] == "Sildenafil"
    assert sheet["product_statements"]["approved_indications"] == ["ED", "PAH"]  # union, no dupes
    assert appraise_calls[0][1]["coverage_note"].startswith("The whole document was read")
    assert result.appraisal.findings[0].deficiency_type == "MISCLASSIFICATION"
    assert result.unread_pages == []


def test_appraisal_uses_its_own_model_setting():
    fake = FakeModel()
    asyncio.run(appraise_psur_text(_pages(2, 100), complete=fake))
    appraise_model = [c[2] for c in fake.calls if c[0] is PSUR_APPRAISAL_PROMPT][0]
    assert appraise_model == appraisal_mod.APPRAISAL_MODEL


def test_an_unread_chunk_is_reported_not_treated_as_clean():
    fake = FakeModel(fail_chunks={2})
    result = asyncio.run(appraise_psur_text(_pages(12, 10_000), complete=fake))
    assert result.chunks_read == result.chunks_total - 1
    assert len(result.unread_pages) == 1 and result.unread_pages[0].startswith("pages ")
    note = [c for c in fake.calls if c[0] is PSUR_APPRAISAL_PROMPT][0][1]["coverage_note"]
    assert "could NOT be read" in note and result.unread_pages[0] in note


def test_nothing_readable_is_an_error_not_an_empty_appraisal():
    fake = FakeModel(fail_chunks={1, 2, 3, 4, 5, 6, 7, 8, 9, 10})
    with pytest.raises(AppraisalError):
        asyncio.run(appraise_psur_text(_pages(3, 100), complete=fake))
    with pytest.raises(AppraisalError):
        asyncio.run(appraise_psur_text("   ", complete=fake))


def test_oversized_fact_sheet_is_trimmed_but_keeps_table_structure():
    big = AiPsurFactChunk.model_validate(
        {"tables": [{"title": f"T{i}", "stratified_by": ["indication"], "time_basis": "CUMULATIVE",
                     "key_figures": [{"label": "x" * 50, "value": "1"}] * 200} for i in range(40)]}
    )
    sheet = merge_fact_chunks([big])
    trimmed, was_trimmed = appraisal_mod._fit_fact_sheet(sheet, limit=50_000)
    assert was_trimmed
    assert len(trimmed["tables"]) == 40
    assert all(t["stratified_by"] == ["indication"] for t in trimmed["tables"])
    json.dumps(trimmed)  # still valid
