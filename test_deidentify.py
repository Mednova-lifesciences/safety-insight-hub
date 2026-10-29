"""Every request to OpenAI is de-identified on the server (ai/deidentify.py,
called from ai/client.py) and the answer is restored. These check that no
direct identifier survives, that the model can still tell two rows about
the same patient apart, and that the answer comes back with real values."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.ai.deidentify import (  # noqa: E402
    PLACEHOLDER_NOTICE,
    TOKEN_RE,
    pseudonymise_request,
)

ROWS_PAYLOAD = {
    "columns": ["Case ID", "Patient Name", "Hospital No.", "Sex", "Age", "Date of Birth", "Reporter Name",
                "Reporter Phone", "Address", "Remarks", "Unmapped Mobile"],
    "mapping": {
        "Case ID": "case_id",
        "Patient Name": "patient_identifier",
        "Hospital No.": "patient_id",
        "Sex": "sex",
        "Age": "age",
        "Date of Birth": "date_of_birth",
        "Reporter Name": "reporter_name",
        "Reporter Phone": "reporter_phone",
    },
    "rows": [
        {
            "row": 1,
            "Case ID": "TST-A-001",
            "Patient Name": "Adaeze Okon",
            "Hospital No.": "TST/H/1001",
            "Sex": "F",
            "Age": "9",
            "Date of Birth": "02/12/2025",
            "Reporter Name": "Bisi Ade",
            "Reporter Phone": "+2348000000101",
            "Address": "12 Oba Adesida Road, Akure",
            "Remarks": "Mother (Mrs Okon) called on 08031234567, email adaeze.mum@example.com",
            "Unmapped Mobile": "0803 123 4567",
        },
        {
            "row": 2,
            "Case ID": "TST-A-002",
            "Patient Name": "Adaeze Okon",
            "Hospital No.": "TST/H/1001",
            "Sex": "F",
            "Age": "9",
            "Date of Birth": "02/12/2025",
            "Reporter Name": "Femi Ojo",
            "Reporter Phone": "+2348000000102",
            "Address": "",
            "Remarks": "Batch MR-2231A, onset 2 days, 1000 doses given",
            "Unmapped Mobile": "",
        },
    ],
}

SECRETS = [
    "Adaeze Okon", "TST/H/1001", "02/12/2025", "Bisi Ade", "Femi Ojo", "+2348000000101",
    "+2348000000102", "12 Oba Adesida Road", "08031234567", "adaeze.mum@example.com", "0803 123 4567", "Okon",
]


def test_no_identifier_reaches_the_request():
    sent, p = pseudonymise_request(json.dumps(ROWS_PAYLOAD))
    for secret in SECRETS:
        assert secret not in sent, secret
    assert p.summary()["total"] > 0


def test_clinical_values_and_structure_are_kept():
    sent, _ = pseudonymise_request(json.dumps(ROWS_PAYLOAD))
    data = json.loads(sent)
    assert data["columns"] == ROWS_PAYLOAD["columns"]
    assert data["mapping"] == ROWS_PAYLOAD["mapping"]
    row = data["rows"][1]
    assert row["Case ID"] == "TST-A-002"
    assert row["Sex"] == "F" and row["Age"] == "9"
    assert row["Remarks"] == "Batch MR-2231A, onset 2 days, 1000 doses given"


def test_same_patient_gets_the_same_token():
    sent, _ = pseudonymise_request(json.dumps(ROWS_PAYLOAD))
    rows = json.loads(sent)["rows"]
    assert rows[0]["Patient Name"] == rows[1]["Patient Name"]
    assert rows[0]["Hospital No."] == rows[1]["Hospital No."]
    assert rows[0]["Reporter Name"] != rows[1]["Reporter Name"]
    assert TOKEN_RE.fullmatch(rows[0]["Patient Name"])


def test_answer_is_restored():
    sent, p = pseudonymise_request(json.dumps(ROWS_PAYLOAD))
    token = json.loads(sent)["rows"][0]["Patient Name"]
    answer = {"findings": [{"row": 1, "message": f"{token} appears twice", "value": token}]}
    restored = p.restore(answer)
    assert restored["findings"][0]["value"] == "Adaeze Okon"
    assert restored["findings"][0]["message"] == "Adaeze Okon appears twice"


def test_summary_has_counts_and_field_names_but_no_values():
    _, p = pseudonymise_request(json.dumps(ROWS_PAYLOAD))
    s = json.dumps(p.summary())
    for secret in SECRETS:
        assert secret not in s
    summary = p.summary()
    assert summary["fields"]["patient_identifier"] == 2
    assert summary["replaced"]["NAME"] >= 3


def test_free_text_psur():
    text = (
        "QPPV: Ngozi Adeyemi, Tel +234 803 555 0101, qppv@testpharma.example. "
        "Case 12: patient born on 14 March 1990 developed rash. Reported by Dr. Tunde Bakare. "
        "Head office: 4 Allen Avenue, Ikeja. Interval 01 Jan 2025 - 31 Dec 2025; 1,250,000 doses."
    )
    sent, p = pseudonymise_request(text)
    for secret in ["Ngozi Adeyemi", "+234 803 555 0101", "qppv@testpharma.example", "14 March 1990",
                   "Tunde Bakare", "4 Allen Avenue"]:
        assert secret not in sent, secret
    # Dates of the reporting interval and counts are not identifiers.
    assert "01 Jan 2025 - 31 Dec 2025" in sent
    assert "1,250,000 doses" in sent
    assert p.restore(sent) == text


def test_cell_level_findings_follow_their_column():
    payload = {
        "mapping": {"Patient Name": "patient_identifier"},
        "findings": [{"row": 1, "column": "Patient Name", "value": "Adaeze Okon"}],
    }
    sent, _ = pseudonymise_request(json.dumps(payload))
    assert "Adaeze Okon" not in sent


def test_nothing_to_hide_changes_nothing():
    payload = {"columns": ["Sex"], "mapping": {"Sex": "sex"}, "rows": [{"row": 1, "Sex": "F"}]}
    sent, p = pseudonymise_request(json.dumps(payload))
    assert json.loads(sent) == payload
    assert p.summary()["total"] == 0


def test_notice_tells_the_model_how_to_treat_tokens():
    assert "[[NAME_1]]" in PLACEHOLDER_NOTICE
    assert "Do not" in PLACEHOLDER_NOTICE


def test_clinical_numbers_are_not_mistaken_for_identifiers():
    for text in ["2026-09-03", "08/09/2026 12:00", "2026-10-29T12:51:39Z", "1000000 doses", "1,250,000",
                 "MR-2231A", "PEN 5510 2231", "Lot 20250301 1102", "Fever, Rash", "Section 16.2 Annex 4"]:
        sent, _ = pseudonymise_request(text)
        assert sent == text, text


def test_phone_shapes():
    for text in ["+234 (0) 803 123 4567", "0803 123 4567", "08031234567", "2348031234567", "+1-202-555-0143"]:
        sent, _ = pseudonymise_request(f"call {text} today")
        assert text not in sent, text
