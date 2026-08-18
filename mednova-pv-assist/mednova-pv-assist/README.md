# MedNova PV Assist

A human-in-the-loop foundation for four pharmacovigilance workflows:

1. **Seriousness triage** — flags cases where the narrative implies serious but the reporter didn't tick the box.
2. **Coding assist** — suggests MedDRA/WHODrug codes by constrained matching against *your* licensed dictionary (never invents codes).
3. **Line-list cleaning → E2B(R3)** — turns messy partner AEFI spreadsheets into normalised records and E2B(R3)-shaped ICSR XML.
4. **PSUR/PBRER review assist** — extracts sections from PDF and runs completeness + consistency checks so assessors read for judgement, not for bookkeeping.

Everything runs today on sample data with **no API key**:

```bash
pip install -r requirements.txt
python examples/run_all.py
```

Set `ANTHROPIC_API_KEY` to additionally turn on the optional narrative-reasoning layer.

---

## The one rule that makes this safe

Nothing here silently changes an ICSR. Every module **suggests or flags with evidence**, writes to an append-only audit trail (`pv_assist/audit.py`), and waits for a human decision. That is the line between an inspection *asset* and an inspection *liability*.

The LLM never mints a code. Coding is constrained matching against your licensed dictionary; the model, if enabled, only *disambiguates between candidates the dictionary already returned*.

---

## What runs offline vs what needs you to plug in

| Module | Works offline today | You must supply |
|---|---|---|
| Seriousness | ✅ full rules engine | (optional) API key for narrative reasoning |
| Line-list → E2B(R3) | ✅ cleaning + XML draft | official ICH E2B(R3) XSD + VigiFlow business-rule validation before real upload |
| Coding | ✅ fuzzy matcher + sample dict | your **licensed MedDRA/WHODrug** export (CSV) |
| PSUR review | ✅ extraction + structure/consistency checks | (optional) API key for supported-conclusion checks |

The sample dictionaries in `data/` are ~10 rows so the pipeline runs end-to-end. Swap in your real export (same CSV columns) and nothing else changes.

---

## Honest scope

This is a **validated foundation to build on, not a certified production system.** Before any of this touches live cases:

- **E2B(R3):** the generator produces faithful ICSR structure for the fields a line-list carries. It is *not* a push-button VigiFlow feed. Validate against the official ICH XSD, complete the mandatory elements a bare line-list lacks (sender/receiver identifiers, message numbering, null flavours), and confirm every reaction carries a real MedDRA LLT code.
- **Coding:** auto-accept is limited to exact/synonym hits and is still logged. Everything else is a ranked candidate list for a human.
- **Data residency:** narratives are personal health data. If they can't leave your environment, set `llm.provider: none` (the rules engines still run) or point the client at a self-hosted model. Decide this before switching the LLM layer on.
- **Validation:** for GxP use you need documented validation (test cases, expected vs actual, sign-off). The `tests/` folder is a starting point, not that dossier.

---

## Layout

```
pv_assist/
  audit.py              append-only audit trail (used everywhere)
  llm.py                optional, pluggable LLM client
  seriousness/          criteria.py (ICH rules) + analyzer.py (mismatch flagging)
  coding/               dictionary.py (pluggable) + coder.py (constrained suggest)
  linelist/             cleaner.py (messy → normalised) + e2b_r3.py (→ XML)
  psur/                 extract.py (PDF → sections) + review.py (checks)
examples/run_all.py     end-to-end demo on sample data
data/                   sample dictionaries + a deliberately messy line-list
```

## Suggested build order

Start with **seriousness** and the **line-list converter** — highest value, lowest regulatory risk, easiest to prove out. Bring in coding once your licensed dictionary is wired. Treat PSUR review as assist-only throughout.
