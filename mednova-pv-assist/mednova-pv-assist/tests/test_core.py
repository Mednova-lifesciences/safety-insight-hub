"""Minimal tests — a starting point for a validation dossier, not the whole thing."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pv_assist.seriousness.analyzer import analyze
from pv_assist.coding.dictionary import Dictionary
from pv_assist.coding.coder import suggest
from pv_assist.linelist.cleaner import clean

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def test_seriousness_flags_hidden_serious():
    r = analyze("T1", "Patient admitted to ICU with anaphylaxis.", reported_serious=False)
    assert r.mismatch and r.priority == "high"

def test_seriousness_no_false_alarm_on_mild():
    r = analyze("T2", "Mild transient itching, resolved same day.", reported_serious=False)
    assert not r.mismatch

def test_seriousness_negator():
    r = analyze("T3", "Patient was NOT admitted; seen as outpatient.", reported_serious=False)
    # 'admitted' is negated by 'not admitted' / 'outpatient'
    assert not any(c["key"] == "hospitalisation" for c in r.matched_criteria)

def test_coding_exact_and_fuzzy():
    d = Dictionary.from_csv(os.path.join(DATA, "meddra_sample.csv"), "MedDRA", "27.0")
    assert suggest("throwing up", d)[0].method == "exact"
    top = suggest("hedache", d)[0]
    assert top.term == "Headache" and top.method == "fuzzy"

def test_coding_never_returns_unknown():
    d = Dictionary.from_csv(os.path.join(DATA, "meddra_sample.csv"), "MedDRA", "27.0")
    assert suggest("zxqw nonsense term", d, fuzzy_floor=70) == []

def test_linelist_detects_column_swap():
    res = clean(os.path.join(DATA, "sample_linelist_messy.csv"))
    assert any("column swap" in i.issue for i in res.issues)
    assert res.column_map.get("Reaction") == "reaction"


if __name__ == "__main__":
    import traceback
    passed = failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn(); passed += 1; print(f"PASS {name}")
            except Exception:
                failed += 1; print(f"FAIL {name}"); traceback.print_exc()
    print(f"\n{passed} passed, {failed} failed")
