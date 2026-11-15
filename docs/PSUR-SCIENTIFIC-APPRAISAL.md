# PSUR critical scientific appraisal

Added November 2026 in response to NAFDAC's review of the tool's output. The
assessors' point: the review asked *"is the information present?"* but never
*"is it correct, appropriately classified, scientifically meaningful and
adequately interpreted?"*. Two concrete misses they reported:

- investigational **therapeutic uses** listed by the MAH under "signals" were
  accepted as safety signals;
- a clinical-trial SAE table broken down by **indication** (erectile
  dysfunction vs pulmonary arterial hypertension) was read as reporting
  interval vs cumulative data.

## What changed

| Problem | Fix | Where |
| --- | --- | --- |
| Only the first 120k characters were ever read | Extraction keeps up to 800k; the appraisal reads all of it in page-aligned chunks | `src/server/ai/pdf_text.py`, `appraisal.py` |
| Tables were flattened, losing which header a number sat under | Every detected table is emitted as Markdown with its header row, in reading order | `pdf_text.py` |
| One call did the template *and* the reasoning | Two stages: (1) fact extraction per chunk — every table's structure, every "signal" with the MAH's description; (2) appraisal over that fact sheet | `appraisal.py`, `PSUR_FACT_EXTRACTION_PROMPT`, `PSUR_APPRAISAL_PROMPT` |
| No rules for judging correctness or classification | `PSUR_CRITICAL_APPRAISAL_RULES`: the four questions, plus explicit rules for signals (CIOMS VIII / GVP IX), table structure, seriousness/listedness, exposure, risks and benefit-risk, literature, RSI | `prompts.py` (shared by the completeness review and the appraisal) |
| Nowhere to put an interpretation | Every finding can carry a *scientific interpretation*, a *recommended next step* and a *confidence*; new deficiency types `MISCLASSIFICATION`, `MISINTERPRETATION` | `schemas.py`, `types/pv.ts` |
| Reasoning on gpt-4o | `OPENAI_APPRAISAL_MODEL` points the appraisal at a reasoning model independently | `.env.example` |

On the assessor's form, each section S1–S11 shows the four-question appraisal,
and a summary table sits above the sections. It also lists any pages the
appraisal could not read: a section with no concerns may simply not have been
seen. Misclassification and misinterpretation findings go on the MAH letter
with a specific required action. The recommended next step stays internal.

## Flow

`runScientificReview` (`services/api/psur.ts`) calls `/review-pdf-text`
(completeness) and `/appraise-pdf-text` (appraisal) in parallel. If the
appraisal fails, the review still completes and the failure is shown on the
form. Appraisal findings are added after section reconciliation, so they never
stand in for a "section missing" finding.

## Testing

- `pytest test_psur_appraisal.py` runs offline, with no model: extraction,
  chunking, prompt/schema agreement, and the pipeline with a fake model.
- `python scripts/make_appraisal_test_psur.py` builds a **fictional** test
  PBRER (`docs/test-psurs/`) containing both reported errors, one genuine
  safety signal (sudden hearing loss) that must *not* be dismissed, and a
  benefit-risk conclusion that leans on investigational benefits.
- `python scripts/eval_psur_appraisal.py` is the live check (needs
  `OPENAI_API_KEY`). It runs the real pipeline on that PDF and reports
  PASS/FAIL for each expected catch.

The appraisal is guidance for the reviewer, not a decision. It will still make
mistakes, which is why every finding shows its reasoning and confidence.
