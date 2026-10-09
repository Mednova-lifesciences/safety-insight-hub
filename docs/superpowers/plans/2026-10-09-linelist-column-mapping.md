# Line-list column mapping (sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended here) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every column of the Ondo AEFI form that carries case information reaches the E2B(R3) XML (or the narrative, where E2B has no field), instead of being silently dropped.

**Architecture:** Each column gets a canonical `TargetField` in `src/services/api/linelist.ts` (keyword-mapped like the existing ones, so any line list with the same kind of column benefits, not just Ondo), then `src/services/e2b-r3/mapping.ts` turns it into the E2B element. Nothing is guessed: placeholder values ("nil", "-", "UNKNOWN") are ignored, and a value that is present but unusable is flagged on the line list.

**Tech stack:** TypeScript, Vitest. Real-file evidence: `2026, ONDO STATE AEFI.xlsx` (never committed).

**Decision recorded (user, 2026-10-09):** C.1.4 uses the **national-level** received date.

## Global constraints
- Never fabricate a value; a blank or placeholder means "not stated".
- Keyword mapping, not Ondo-only header strings (see memory: E2B "generic" = any line list).
- New columns written into the fixed file stay out of mapping on re-upload (existing annotation-column rule).
- Do not rewrite published git history.

## What the Ondo file holds (231 cases)

| Column (as parsed) | Filled | Today | Goes to |
|---|---|---|---|
| Age **Months** | 127 | dropped | D.2.2a/b age, in months for under-2s |
| Date of Last immunisation **Time** | most | dropped | onset derivation (hour intervals) |
| Medical History (Allergy Presentation) | most | dropped | D.7.2 medical history text |
| Diluent Batch/Lot No | most | dropped | narrative (H.1), labelled |
| Other vaccines given just prior to AEFI | some | dropped | G.k concomitant products (verbatim) |
| Adress of reporting health facility | most | dropped | C.2.r.2.1 reporter organisation |
| e-mail address of the reporter | ~30 | dropped | mostly addresses, not e-mails — see Task 6 |
| Date report recived at the **national** level | 95 | dropped | **C.1.4** first received |
| Date report recived at the state level | 194 | dropped | fallback for C.1.4 — see Task 1 |

## Review focus
1. National date blank (136 cases) — C.1.4 must not silently become the processing date.
2. Years = 0 with Months = 8 → an infant reported as 8 months, never as "0 years".
3. "nil" / "UNKNOWN" / "-" in medical history or other vaccines → nothing written.
4. A re-uploaded fixed file maps the same columns the same way.
5. Phone numbers stored as numbers: the formatted cell reads "2.34805E+12" (raw value 2348054535217). Confirm the parser takes the raw value; if not, fix it in Task 6.

---

### Task 1: C.1.4 from the national received date
**Files:** `linelist.ts` (new fields `national_received_date`, `state_received_date`, keywords "national"+"receiv", "state"+"receiv"), `e2b-r3/mapping.ts:1179`, tests in `linelist-validation.test.ts` and `mapping.test.ts`.
- [ ] Failing tests: national date present → `dateFirstReceived` = national date; national blank, state present → state date, and the line list shows a LOW finding "National received date not recorded; the state-level date was used for C.1.4"; both blank → today's behaviour (report date, then processing date) with a MEDIUM finding saying so.
- [ ] Implement; run tests; commit.
- **Assumption to confirm in review:** falling back to the state date (the closest earlier receipt in the reporting chain) rather than blocking. Blocking would hold 136 of 231 Ondo cases.

### Task 2: Age in months
**Files:** `linelist.ts` (field `age_months`; the parser already names the merged sub-header "Age Months"), `mapping.ts` age block, tests.
- [ ] Failing tests: Years 0 + Months 8 → 8 months (unit month); Years 1 + Months 8 → 20 months; Years 5 + Months 3 → 5 years (months noted in narrative); Years blank + Months 8 → 8 months; Months 14 alone → 14 months; Months "nil" → years only.
- [ ] Implement; age-group (D.2.3) follows the computed age; run tests; commit.

### Task 3: Vaccination time in the onset derivation
**Files:** `linelist-onset.ts`, `linelist.ts` (field `vaccination_time`), tests.
- [ ] Failing tests: vaccination 3/2/26 11:00 + "15 hours" → onset 2026-02-04 (it crosses midnight); without the time the date stays as today; an unreadable time is ignored and noted.
- [ ] Implement; the note in "Changes made" mentions the time used; commit.

### Task 4: Medical history and diluent batch
**Files:** `linelist.ts` (fields `medical_history`, `diluent_batch`), `mapping.ts`, `serializer.ts` (D.7.2 text), tests incl. a schema-valid XML check.
- [ ] Failing tests: "Allergy to penicillin" → D.7.2 text; "UNKNOWN"/"nil"/"-" → nothing; diluent "0685Q061" → narrative line "Diluent batch/lot: 0685Q061".
- [ ] Implement; XSD test passes; commit.

### Task 5: Other vaccines as concomitant products
**Files:** `linelist.ts` (field `other_vaccines`), `mapping.ts` products, tests.
- [ ] Failing tests: "BCG, OPV" → two products, characterisation 2 (concomitant), verbatim names, WHODrug status as for suspects; "nil" → none; the C.1.7/suspect logic is unchanged.
- [ ] Implement; commit.

### Task 6: Facility, reporter e-mail column, phone
**Files:** `linelist.ts` (fields `reporter_organisation`, `reporter_email`), `mapping.ts` reporter block, parser check for numeric cells, tests.
- [ ] Failing tests: facility "BHC Okela" → C.2.r.2.1 organisation; an e-mail-shaped value is kept in the narrative (E2B(R3) C.2.r has no e-mail element); a non-e-mail value in that column ("Monogbe Street, Igbotako") → LOW finding "This is not an e-mail address" and, when no street is mapped, C.2.r.2.3 street; phone read as 2348054535217, never "2.34805E+12".
- [ ] Implement; commit.

### Task 7: Real-file check and release
- [ ] Re-run the Ondo real-dataset test; record before/after counts per new field in the PR.
- [ ] Full suite, typecheck; open the PR (merge needs the user's review).
- [ ] After merge: live check on pv-assist (admin section) — upload Ondo, Fix, download, E2B preflight; confirm the new fields in the preflight case view.
