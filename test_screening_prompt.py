"""The screening prompt must actually describe the shape it asks for.

This exists because of a real failure. The prompt ended with "Return ONLY
the JSON object described by the schema" — but `structured_completion` uses
plain `json_object` mode, so there IS no schema for the model to follow.
The model inferred `submission_details` from the field names appearing in
the prose and got every one of them right, then guessed at `checks` and got
it wrong, so all fifteen rows were discarded by the validator.

The result was an empty checklist, which is indistinguishable on screen
from a model that read the document and honestly could not answer anything.
It took a live run against a real PDF to notice.

These checks are cheap and would have caught it before deploying.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.ai.prompts import PSUR_SCREENING_PDF_PROMPT  # noqa: E402
from server.ai.schemas import (  # noqa: E402
    _KNOWN_SCREENING_CHECK_IDS,
    _KNOWN_SCREENING_STATUSES,
    AiPsurSubmissionDetails,
)

# Item 8 is computed by the application from the extracted Data Lock Point,
# so the model is told not to answer it.
COMPUTED_ID = "RECEIVED_WITHIN_TIMEFRAME"
EXPECTED_IDS = _KNOWN_SCREENING_CHECK_IDS - {COMPUTED_ID}


def test_prompt_names_every_check_id_the_schema_accepts():
    missing = sorted(i for i in EXPECTED_IDS if i not in PSUR_SCREENING_PDF_PROMPT)
    assert not missing, (
        f"The prompt never names {missing}. A row the model does not know to "
        f"produce is a check that silently never gets answered."
    )


def test_prompt_tells_the_model_not_to_answer_the_computed_item():
    assert COMPUTED_ID in PSUR_SCREENING_PDF_PROMPT, (
        "The prompt must name the computed item in order to exclude it."
    )
    assert "must NOT appear" in PSUR_SCREENING_PDF_PROMPT, (
        "The prompt names the computed item but never says to omit it."
    )


def test_prompt_shows_the_output_json_shape():
    # json_object mode enforces valid JSON, not a particular shape. If the
    # prompt does not spell the shape out, the model invents one.
    for fragment in ('"checks"', '"id"', '"status"', '"deficiency"', '"submission_details"'):
        assert fragment in PSUR_SCREENING_PDF_PROMPT, (
            f"The prompt never shows {fragment} as a JSON key, so the model has "
            f"nothing to copy."
        )


def test_prompt_names_every_submission_detail_field():
    for field in AiPsurSubmissionDetails.model_fields:
        assert field in PSUR_SCREENING_PDF_PROMPT, (
            f"Section A field {field!r} is never named in the prompt, so it will "
            f"always come back empty."
        )


def test_prompt_names_every_status_the_schema_accepts():
    for status in _KNOWN_SCREENING_STATUSES:
        assert status in PSUR_SCREENING_PDF_PROMPT, (
            f"Status {status!r} is accepted by the schema but never offered to the model."
        )


def test_prompt_does_not_promise_a_schema_it_does_not_supply():
    # The exact wording that caused the failure.
    assert "described by the schema" not in PSUR_SCREENING_PDF_PROMPT, (
        "The prompt points at a schema the API call does not send."
    )


def test_external_record_items_are_forced_to_not_assessable():
    # Items 2, 3, 7 and 16 ask whether the submission matches a NAFDAC
    # record the system does not hold. The prompt must instruct
    # NOT_ASSESSABLE for all four; the mapper enforces it as well.
    block = re.search(
        r"CHECKS YOU MUST ALWAYS RETURN AS NOT_ASSESSABLE(.+?)ITEM 8",
        PSUR_SCREENING_PDF_PROMPT,
        re.S,
    )
    assert block, "The prompt no longer has a section forcing the unanswerable items."
    for item in ("2", "3", "7", "16"):
        assert item in block.group(1), f"Item {item} is no longer forced to NOT_ASSESSABLE."


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {name}: {exc}")
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
