# Release report: admin features and data protection (29–30 Oct 2026)

- **PR #94:** merged 29 Oct 2026 20:33 UTC; deployed to Render at 20:35 and to Vercel production.
- **PR #95 (Phase 3):** open at the time of writing.

All testing used the synthetic test organisation "MedNova TEST A (synthetic data only)". A second synthetic organisation (TEST B) was used for the isolation checks. No real organisation's data was read or changed.

## Built

| Area | What | Where |
|---|---|---|
| Phase 1a | **Possible duplicates in other files.** Rule-based pairs blocked on vaccine + vaccination date ±3 days, then scored on sex, age ±1, initials, batch, reaction, onset ±2 days and facility. Matched fields are listed and both rows are shown side by side. *Drop as duplicate* uses the existing Drop with reason Duplicate; *Not a duplicate* is stored on the job. Both are audited, and nothing is dropped automatically. | `/line-list` |
| Phase 1b | **Batch and facility flags for review.** 2 or more serious cases (the rule engine's own seriousness test) sharing a real batch, or the same vaccine at the same facility, within 30 days. Dropped, held and duplicate cases are left out. | `/line-list`, Evaluator dashboard |
| Phase 1c | **PSURs due and overdue.** A compliance forecast, not AI. Next DLP = the recorded date, otherwise last DLP + the same interval; deadline = DLP + 70 or 90 days. Shows overdue / due now / due in N / cannot forecast, the MAH's lateness history, and the items cited last time. | Review Officer dashboard, `/screening` tab |
| Phase 2 | Server-side **de-identification of every OpenAI call**. Names, initials, record numbers, dates of birth, phones, e-mails and addresses become tokens and are restored in the answer. | `src/server/ai/deidentify.py` |
| Phase 2 | **AI data log**: field names and counts only, readable by administrators. | `/ai-log` |
| Phase 2 | **Grant hardening migration**, applied live and reversible. | `supabase/migrations/20261029120000_*` |
| Phase 2 | **Data-protection record** against NDPA 2023. | `docs/DATA-PROTECTION.md` |
| Phase 3 | **Observed vs expected (screening check)**. WHO-cited background rates, exact Poisson 95% interval, kept and de-duplicated cases. Labelled with its high false-positive rate. | Evaluator dashboard (PR #95) |
| Tooling | Synthetic seed data and reset scripts; a live E2E suite (`e2e/run-all.sh`); a two-organisation isolation check. | `scripts/seed/`, `e2e/` |

## Fixed

1. **Invite codes were readable by anyone with the public key.**
   - The project rebuilt on 4 Oct had lost migrations 013, 015 and 016.
   - Anonymous callers could also run SECURITY DEFINER functions.
   - The open "demo workspace access" policies would have come back on any fresh database, because of migration ordering.
   - Fixed live; the isolation check went from 35/37 to 41/41.
2. **The PSUR scientific review timed out on production on every attempt.** The client limit was 60 s; it is now 180 s for the two whole-document review endpoints. On production the review now completes in 92 s.
3. **The wrong line list could be validated.** Just after an upload, *Re-run validation* could act on the previous file.
4. **The audit timeline had blank keys** for C.1.7 events written by the database functions.

## Test results

- **vitest:** 2,188 tests pass, including the new pure modules and the seed-data checks (exactly 6 duplicates, no near-miss, the PCV-7781 flag, the forecast picture).
- **Backend:** pytest passes, including the de-identification tests.
- **Typecheck:** clean.
- **Build:** passes (on Vercel; it ran out of memory on the test machine on 30 Oct).
- **Lint:** the files added or changed are clean. The 101 Prettier formatting errors that existed before this work remain (about 240 files would have to be reformatted). They are left for a separate formatting-only change.

**Production E2E after the merge:**

| Flow | Result |
|---|---|
| Line lists A and B: upload, mapping, validate, Fix, Drop / Hold / Keep, the 3 downloads, VigiFlow preflight, C.1.7, E2B(R3) XML | Pass, 0 console errors |
| New features: forecast card and tab, batch/facility flags, 6 duplicate pairs, Not a duplicate, Drop as duplicate, AI log | Pass, 0 console errors |
| PSUR: upload and AI screening, 16-item checklist, signed outcome, AI scientific review, findings, Sections 9–11, memo inputs, evaluator sign-off, peer countersign, V4 report, executive summary, MAH letter, assessment memo, screening letter | Pass. Console errors were network-level only (`ERR_TIMED_OUT` on the test machine) |
| De-identification on production | Confirmed in the AI log: 40, 14 and 4 identifiers replaced per call, no values stored |
| Isolation between organisations, including the cross-file loader | 41/41 |
| Render logs since deploy | No errors |

- **AI results with and without de-identification:** the same payload was sent 3 times each way. The same date and batch findings came back each time; the differences were ordinary run-to-run variation.
- **Vercel preview:** not used. The production backend's CORS setting refuses preview origins, so a preview could not reach the API. The branch was instead tested end to end with its own backend and frontend on the test machine before merging.

## Timings on production, before vs after (median, ms)

| Action | Before | After |
|---|---|---|
| Upload line list A | 15,516 | 22,552 |
| Validate | 29,682 | 40,239 |
| Fix Issues | 9,776 | 9,819 |
| Download fixed CSV | 2,743 | 2,409 |
| Download executive summary | 1,847 | 1,381 |
| PSUR upload + AI screening | 76,054 | 42,888 |
| Signed screening outcome | 9,187 | 4,393 |
| AI scientific review | failed (timeout) | 92,344 |
| Open `/psur` | 2,362 | 1,228 |
| Section saves | 2,000–3,258 | 2,211–3,105 |

- **Slower rows:** the upload, validate and page-load rows that look slower were single samples taken while the test machine's connection was dropping requests.
- **Direct timing:** measured directly as a signed-in user, the page queries take about 1 s: job list 0.8–1.1 s (1 KB), PSUR list 0.6–1.9 s (35 KB), and the cross-file loader 1.4–1.9 s (17 KB, read only when its panel is scrolled into view).
- **Job list:** still light; no rows were added to it.
- **Conclusion:** no slowdown attributable to the changes was found.

## Phase 3 status

- Built and tested; Vercel build passes.
- Opened as PR #95, to be merged after Phases 0–2 passed on production.
- After the merge, run the evaluator check on production. The expected result on the seed files: HPV anaphylaxis with 50,000 doses gives observed 1 (the case reported in both files is counted once) against expected 0.085, "within chance".

## Still to do (MedNova and NAFDAC)

See `docs/DATA-PROTECTION.md` §7:

- the DPIA;
- the processing agreements (NAFDAC with MedNova; MedNova with OpenAI, Supabase, Render and Vercel);
- the record of each transfer's basis;
- OpenAI zero data retention or EU residency;
- the breach procedure;
- retention periods.

Software gaps in the same document: image intake is not de-identified, and unlabelled names in free text are not detected.

## Final production verification (30 Oct 2026)

All four phases are merged: #94, #95, #96 (formatting only; lint on `main` now has **0 errors**) and #97 (this fix).

**One-pass full run on production.** A single run of `e2e/run-all.sh` covered every role. Everything passed except three steps:

| Step that failed | Why | Re-check |
|---|---|---|
| Second VigiFlow preflight | Timed out on the test machine's connection | E2B re-run passed: preflight, C.1.7, preflight again, XML (96 KB), 0 console errors |
| Officer's screening-letter download | Timed out the same way | Passed: V4 report, executive summary, MAH letter, memo and screening letter, 0 console errors |
| Batch/facility flags card on the Evaluator dashboard | **A real bug**, fixed by #97: a request lost on a poor connection had no timeout or retry, so the card kept loading | — |

Everything else in that run passed:

- line lists A and B up to the first preflight;
- PSURs due and overdue;
- duplicates: 6 pairs, then Not a duplicate and Drop as duplicate;
- observed vs expected;
- the AI log;
- the whole PSUR flow, from officer screening through evaluator sign-off and peer countersign;
- isolation: 41/41.

**Render logs since the deploys:** no errors; one routine model-temperature retry warning.

**Phase 3 on production.** The evaluator ran HPV anaphylaxis with 50,000 doses:

- expected 0.085;
- observed 1 (TST-A-003; the same case in file B was counted once);
- exact 95% CI 0.025–5.572;
- result: higher than expected, within chance.

The run is recorded in the audit trail with the full calculation.

**Not done as written: the Vercel preview.** The production backend's CORS setting refuses preview origins, so a preview cannot reach the API. With the user's agreement, the branch was instead tested end to end with its own frontend and backend before merging. To make previews testable, add the preview domain to the Render `CORS_ORIGINS` setting.
