# Release report: admin features and data protection (29–30 Oct 2026)

- **PR #94:** merged 29 Oct 2026 20:33 UTC; deployed to Render at 20:35 and to Vercel production.
- **PR #95 (Phase 3), #96 (formatting), #97, #98, #99 (fixes):** merged and deployed on 30 Oct 2026.
- **Final result:** one full E2E run on production, covering every flow and role, passed with no failures (see the end of this report).

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
5. **Batch/facility flags and observed-vs-expected cards could keep loading indefinitely** (PR #97). A request lost on a poor connection had no timeout or retry. Now: 30 s timeout, two retries.
6. **Finalized C.1.7 decisions were undone by the next preflight** (PR #98). Preflight could run before the organisation's E2B settings had loaded. Each assessment was then saved against a case without the report type, sender and reporter qualification. The next preflight saw a "changed" case and created new pending assessments over the reviewer's decisions. On production, 12 cases were finalized at 05:49:37–41 and superseded at 05:49:44–54. Preflight and export now wait for the settings.
7. **A peer reviewer's countersignature could be erased** (PR #99). The V4 pre-fill is an AI reading that runs when a report is opened and can finish a minute later. It saved the whole document back, so the evaluator's still-open page erased the peer's countersignature 0.6 s after it was made; the audit trail still recorded it. The pre-fill is now written alone by `psur_set_v4_prefill` (migration `20261030120000`, applied live, with a rollback).

## Test results

- **vitest:** 2,188 tests pass, including the new pure modules and the seed-data checks (exactly 6 duplicates, no near-miss, the PCV-7781 flag, the forecast picture).
- **Backend:** pytest passes, including the de-identification tests.
- **Typecheck:** clean.
- **Build:** passes (on Vercel; it ran out of memory on the test machine on 30 Oct).
- **Lint:** 0 errors on `main` since the formatting-only PR #96 (warnings only).

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

## Timings on production, before vs after (ms)

"Final" is two clean full runs on 30 Oct after every fix (PRs #94–#99), from a reset test organisation; both runs are shown.

| Action | Before | After (29 Oct) | Final run 1 | Final run 2 |
|---|---|---|---|---|
| Upload line list A | 15,516 | 22,552 | 17,582 | 23,619 |
| Validate | 29,682 | 40,239 | 24,659 | 32,332 |
| Fix Issues | 9,776 | 9,819 | — | — |
| Download fixed CSV | 2,743 | 2,409 | 1,364 | 1,387 |
| Download executive summary | 1,847 | 1,381 | 705 | 685 |
| PSUR upload + AI screening | 76,054 | 42,888 | 42,545 | 43,973 |
| Signed screening outcome | 9,187 | 4,393 | 3,842 | 4,577 |
| AI scientific review | failed (timeout) | 92,344 | 83,322 | 75,275 |
| Open `/psur` | 2,362 | 1,228 | 360 | 561 |
| Section saves | 2,000–3,258 | 2,211–3,105 | 1,600–4,009 | — |
| VigiFlow preflight | — | — | 6,508 | 5,496 |
| E2B(R3) XML download | — | — | 2,211 | 2,106 |
| Evaluator flags card | — | — | 3,175 | 5,242 |
| Possible duplicates panel | — | — | 4,053 | 2,431 |
| Peer countersign | — | — | 5,379 | 6,215 |

- **Upload line list A is slower than the baseline in both final runs** (17.6 s and 23.6 s against 15.5 s; mean 20.6 s).
  - The two runs differ from each other by 6 s, and the baseline is a single sample, so most of the gap is run-to-run variation (file transfer and server parsing).
  - One change does sit on this path: after an upload, the page now waits for the job list to refresh (1 KB, about 1 s) before it selects the new file. That is the fix for the wrong file being validated (Fixed #3).
- **Validate:** 24.7 s and 32.3 s against 29.7 s; about level on average.
- **Everything else** is at or below the baseline. The PSUR screening, the signed outcome and opening `/psur` are faster, and the AI scientific review now completes instead of timing out.
- **Fix Issues:** not exercised in the seeded run, because the seed files have no fixable issues.
- **Direct timing:** measured directly as a signed-in user, the page queries take about 1 s: job list 0.8–1.1 s (1 KB), PSUR list 0.6–1.9 s (35 KB), and the cross-file loader 1.4–1.9 s (17 KB, read only when its panel is scrolled into view).
- **Job list:** still light; no rows were added to it.
- **A third run did not finish:** the laptop's battery hit critical at 10:35 and it slept until 10:56 (Windows Kernel-Power events 524, 42, 107), during the AI scientific review. It is not counted.

## Phase 3 status

- Built, tested and merged (PR #95) after Phases 0–2 passed on production.
- Passes on production in the final full run; the result is below.

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

**One full run of `e2e/run-all.sh` on production passed with no failures.** It ran after every fix (#94–#99) were deployed, from a freshly reset test organisation with the seed data loaded, and covered every flow and role.

| Flow | Result |
|---|---|
| Line lists A and B: upload, mapping, validate, Drop / Hold / Keep, fixed CSV, dropped & held, executive summary | Pass |
| E2B: VigiFlow preflight, C.1.7 accepted as recommended, preflight again, E2B(R3) XML (152 KB) | Pass |
| Review Officer: PSURs due and overdue (card and `/screening` tab) | Pass |
| Evaluator: batch/facility flags, observed vs expected, 6 possible duplicates, Not a duplicate, Drop as duplicate (4 left), AI data log | Pass |
| PSUR: upload and AI screening, 16 checks, signed outcome, AI scientific review, a finding, Sections 9–11, memo inputs, evaluator sign-off, peer countersign | Pass |
| Downloads: V4 report, executive summary, MAH feedback letter, assessment memo, the officer's screening letter | Pass |
| Isolation between organisations | 41/41 |
| Console errors | 0 |
| Render logs during the run | No errors and no 5xx; one routine model-temperature retry warning |

**Earlier runs that day, corrected.** Earlier runs failed at three steps, and two were first put down to the connection:

| Step | Cause | Status |
|---|---|---|
| Flags card kept loading | No timeout or retry on a lost request | Fixed by #97 |
| Second VigiFlow preflight | **The C.1.7 bug above**, not the connection | Fixed by #98 |
| Peer countersign | **The pre-fill overwrite above** | Fixed by #99 |
| Officer's screening letter | A test gap: the officer's background tab never regained focus, so its list stayed as it was before the peer review | The test now reloads the tab, as a person returning to it would |

**Phase 3 on production.** The evaluator ran HPV anaphylaxis with 50,000 doses:

- expected 0.085;
- observed 1 (TST-A-003; the same case in file B was counted once);
- exact 95% CI 0.025–5.572;
- result: higher than expected, within chance.

The run is recorded in the audit trail with the full calculation.

**Vercel preview (30 Oct).** The goal asked for tests on a Vercel preview, and that was not possible at first. Two settings were missing:
- the preview builds had no Supabase settings (they were set for Production only);
- the backend's `CORS_ORIGINS` list does not include preview addresses.

What was set up:
- **A stable preview:** branch `preview/e2e`, with the same code as production, at `safety-insight-hub-git-preview-e2e-mednova.vercel.app`.
- **Supabase settings for that branch only:** the two public values (URL and publishable key). This preview therefore uses the live database, like production. It stays behind Vercel's login, and the tests touch only the synthetic test organisation.
- **Test access:** the E2E runs pass Vercel's login with the signed-in CLI's short-lived development token, sent only to the preview's address. Deployment Protection stays on.
- **CORS:** the backend's list was not changed, because its current value could not be read. Instead, the throwaway test browser skips its own CORS check (`PREVIEW_SKIP_CORS=1`, Chrome's `--disable-web-security`). Requests still go straight from the preview page to the real backend and database; only the backend's CORS list is not exercised. An earlier attempt re-sent the backend calls through Playwright, which broke PDF uploads ("No /Root object!" in the backend log). To let people use the preview directly, add `https://safety-insight-hub-git-preview-e2e-mednova.vercel.app` to `CORS_ORIGINS` on Render.

**Result on the preview so far:**
- **Passed, with 0 console errors:** line lists A and B through the E2B XML, and every new feature.
- **Isolation:** 41/41, run alongside.
- **PSUR flow:** not yet complete on the preview. Two attempts went through the broken pass-through (the PDF arrived damaged), and both were then stopped because the test machine ran out of memory. A third attempt uses the corrected harness.

**Follow-up:** the other long AI steps (`runScientificReview`, `runFullFix`) still save the whole PSUR document. They run before hand-over, so they did not cause this problem, but they can be moved to field-level writes like the pre-fill.
