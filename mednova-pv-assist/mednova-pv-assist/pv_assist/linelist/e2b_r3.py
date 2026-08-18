"""
E2B(R3) ICSR XML generation.

E2B(R3) is the ICH ICSR message in HL7 v3 form. This module builds a
structurally faithful ICSR carrying the core data elements you get from an
AEFI line-list: safety report id and dates (C.1), primary source/reporter
(C.2), patient (D), reaction with MedDRA (E.i), and suspect product (G.k).

READ THIS BEFORE UPLOADING ANYTHING REAL
-----------------------------------------
This produces well-formed E2B(R3)-shaped XML for the fields a line-list gives
you. It is NOT a substitute for validating against the official ICH E2B(R3)
schema and VigiFlow's own business rules. Before any live upload you must:
  * validate against the official ICH ICSR XSD,
  * confirm reaction terms carry real MedDRA LLT codes (see coding/),
  * complete the mandatory elements a bare line-list does not contain
    (sender/receiver identifiers, message numbering, null flavours).
Treat the output as a 90%-there draft that a validator finishes, not a
push-button feed to production.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from xml.dom import minidom
from xml.etree.ElementTree import Element, SubElement, tostring

HL7 = "urn:hl7-org:v3"

_SEX_CODE = {"m": "1", "male": "1", "f": "2", "female": "2"}


def _ts(iso_date: str | None) -> str | None:
    if not iso_date:
        return None
    return iso_date.replace("-", "")   # E2B dates are YYYYMMDD


def _sub(parent: Element, tag: str, **attrs) -> Element:
    el = SubElement(parent, tag)
    for k, v in attrs.items():
        el.set(k, str(v))
    return el


def build_icsr(
    record: dict[str, Any],
    *,
    sender_id: str = "MEDNOVA",
    receiver_id: str = "NAFDAC-NPC",
    country: str = "NG",
) -> Element:
    """Build one ICSR safety report element from a cleaned line-list record."""
    report_id = str(record.get("case_id") or uuid.uuid4())

    root = Element("investigationEvent", {"xmlns": HL7})
    _sub(root, "id", extension=report_id, root=sender_id)
    _sub(root, "code", code="1", codeSystem="2.16.840.1.113883.3.989.2.1.1.1")

    # C.1 — administrative
    comp = _sub(root, "component")
    icsr = _sub(comp, "adverseEventAssessment")
    subj = _sub(icsr, "subject1")
    pr = _sub(subj, "primaryRole")

    # C.1.2 first-received / most-recent dates
    if record.get("report_date"):
        _sub(pr, "effectiveTime", value=_ts(record["report_date"]))

    # D — patient
    patient = _sub(pr, "player1")
    if record.get("patient_initials"):
        name = _sub(patient, "name")
        name.text = str(record["patient_initials"])
    sex = str(record.get("patient_sex") or "").strip().lower()
    if sex in _SEX_CODE:
        _sub(patient, "administrativeGenderCode", code=_SEX_CODE[sex],
             codeSystem="1.0.5218")
    if record.get("patient_age") not in (None, ""):
        age = _sub(patient, "quantity", value=str(record["patient_age"]), unit="a")  # a = years

    # E.i — reaction / event
    reaction = _sub(pr, "subjectOf2")
    obs = _sub(reaction, "observation")
    rterm = _sub(obs, "value")
    rterm.text = str(record.get("reaction") or "")
    # MedDRA LLT code goes here once coded; left as nullFlavor until then.
    meddra = record.get("reaction_meddra_llt")
    if meddra:
        _sub(obs, "code", code=str(meddra),
             codeSystem="2.16.840.1.113883.6.163", codeSystemName="MedDRA")
    else:
        _sub(obs, "code", nullFlavor="NI", codeSystemName="MedDRA")
    if record.get("onset_date"):
        _sub(obs, "effectiveTime", value=_ts(record["onset_date"]))
    # E.i.3.2 seriousness
    serious = _serious_flag(record.get("seriousness"))
    _sub(obs, "seriousnessCode", code="1" if serious else "2")
    if record.get("outcome"):
        oc = _sub(obs, "outcome")
        oc.text = str(record["outcome"])

    # G.k — suspect product
    drug = _sub(pr, "subjectOf1")
    admin = _sub(drug, "substanceAdministration")
    prod = _sub(admin, "consumable")
    inst = _sub(prod, "instanceOfKind")
    kind = _sub(inst, "kindOfProduct")
    pname = _sub(kind, "name")
    pname.text = str(record.get("vaccine_drug") or "")
    if record.get("batch_lot"):
        lot = _sub(inst, "lotNumberText")
        lot.text = str(record["batch_lot"])

    return root


def _serious_flag(value: Any) -> bool:
    if value is None:
        return False
    s = str(value).strip().lower()
    return s in {"1", "yes", "y", "true", "serious", "severe"}


def build_message(records: list[dict[str, Any]], **kwargs) -> str:
    """Wrap one or more ICSRs in a batch message and pretty-print."""
    batch = Element("MCCI_IN200100UV01", {"xmlns": HL7})
    hdr = _sub(batch, "id", extension=str(uuid.uuid4()), root=kwargs.get("sender_id", "MEDNOVA"))
    _sub(batch, "creationTime", value=datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"))
    _sub(batch, "versionCode", code="E2B(R3)")
    for rec in records:
        wrapper = _sub(batch, "PORR_IN049016UV")
        wrapper.append(build_icsr(rec, **kwargs))
    xml = tostring(batch, encoding="unicode")
    return minidom.parseString(xml).toprettyxml(indent="  ")
