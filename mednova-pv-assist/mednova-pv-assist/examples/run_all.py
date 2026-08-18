"""
End-to-end demo. Runs every module on sample data with NO API key required.
    python examples/run_all.py

Set ANTHROPIC_API_KEY to additionally exercise the optional LLM layers.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pv_assist.audit import AuditTrail
from pv_assist.llm import LLMClient
from pv_assist.seriousness.analyzer import analyze
from pv_assist.coding.dictionary import Dictionary
from pv_assist.coding.coder import code_case
from pv_assist.linelist.cleaner import clean
from pv_assist.linelist.e2b_r3 import build_message

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")

audit = AuditTrail(os.path.join(HERE, "..", "output", "audit_log.jsonl"))
llm = LLMClient()   # inert if no key
print(f"LLM layer: {'ON — ' + llm.model if llm.available else 'OFF (rules only)'}\n")


def rule(title): print("\n" + "=" * 70 + f"\n{title}\n" + "=" * 70)


# ---------------------------------------------------------------- 1. SERIOUSNESS
rule("1. SERIOUSNESS  — narrative says serious, field says no")
cases = [
    ("NG-2026-0001", "Patient developed rash and mild itching after dose. Resolved next day.", False),
    ("NG-2026-0002", "Patient collapsed with anaphylaxis and was admitted to ICU overnight.", False),
    ("NG-2026-0003", "Febrile seizure reported the evening after vaccination; child hospitalised.", None),
]
for cid, narr, reported in cases:
    r = analyze(cid, narr, reported, audit=audit, llm=llm)
    tag = {"high": "🔴 FLAG", "review": "🟡 review", "ok": "🟢 ok"}[r.priority]
    print(f"\n{tag}  {cid}  (reporter said serious={r.reported_serious})")
    for c in r.matched_criteria:
        print(f"     • {c['label']}: {c['evidence']}")


# -------------------------------------------------------------------- 2. CODING
rule("2. CODING — constrained suggestions against a pluggable dictionary")
meddra = Dictionary.from_csv(os.path.join(DATA, "meddra_sample.csv"), "MedDRA", "27.0")
whodrug = Dictionary.from_csv(os.path.join(DATA, "whodrug_sample.csv"), "WHODrug", "GLOBAL-2025-Sep")
coded = code_case(
    "NG-2026-0002",
    reactions=["throwing up", "anaphylactic shock", "hedache"],   # note typo
    drugs=["astrazeneca covid", "panadol"],
    reaction_dict=meddra, drug_dict=whodrug, audit=audit, llm=llm,
)
for r in coded["reactions"]:
    top = r["candidates"][0] if r["candidates"] else None
    auto = " [auto-acceptable]" if r["auto_acceptable"] else ""
    print(f"\n  reaction {r['verbatim']!r}{auto}")
    for c in r["candidates"][:3]:
        print(f"     {c['code']}  {c['term']:<24} {c['score']:.0f}%  ({c['method']})")


# ---------------------------------------------------- 3. LINE-LIST -> E2B(R3)
rule("3. LINE-LIST CLEANING  ->  E2B(R3) XML")
res = clean(os.path.join(DATA, "sample_linelist_messy.csv"))
print(f"\n  detected column map: {res.column_map}")
print(f"  cleaned {len(res.records)} records, {len(res.issues)} data-quality issues:")
for iss in res.issues:
    print(f"     row {iss.row}: [{iss.field}] {iss.issue}  {iss.original!r}")

# code the reactions before emitting XML (shows the pieces connecting)
for rec in res.records:
    cands = code_case(str(rec.get("case_id")), [rec.get("reaction") or ""], [],
                      meddra, whodrug)["reactions"][0]["candidates"]
    if cands and cands[0]["method"] == "exact":
        rec["reaction_meddra_llt"] = cands[0]["code"]

xml = build_message(res.records, sender_id="MEDNOVA", receiver_id="NAFDAC-NPC")
out_dir = os.path.join(HERE, "..", "output")
os.makedirs(out_dir, exist_ok=True)
xml_path = os.path.join(out_dir, "aefi_icsr_e2b_r3.xml")
with open(xml_path, "w", encoding="utf-8") as fh:
    fh.write(xml)
print(f"\n  E2B(R3) draft written -> {os.path.relpath(xml_path)}")
print("  (validate against the official ICH XSD + VigiFlow rules before real upload)")

print("\n\nAudit trail -> output/audit_log.jsonl")
