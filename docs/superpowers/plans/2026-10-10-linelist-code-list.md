# Line-list code list (codebook) a person adds — Implementation Plan

**Goal:** A coded line list that arrives without its code list can be given one on the line-list page — typed, pasted or uploaded in ordinary wording — read by rules then AI, confirmed by a person, and used for that file; and saved for every later file from the same form.

**Decisions (user, 2026-10-10):**
1. Every coded column, not only reaction/outcome/seriousness.
2. "Save for all files from this form" — still editable; a file that brings its own code list overrides the saved one for the fields it covers.
3. Uploads: .txt, .csv, .xlsx (plus typing/pasting).

**Constraints:** no new database tables (migrations do not reach the live database without a separate step); humans at decision points — the AI only restructures text, a person confirms; nothing guessed.

## Design

**Model.** A code list entry is the existing `SourceCodebookEntry` `{ field, sourceCode, meaning }`; `field` is a canonical line-list field (`reaction`, `outcome`, `seriousness` = the criterion-code column, `sex`, `route`, `dose_unit`, `age_unit`, `age_group`, `reporter_designation`, `product`, …). A job gains `codeList?: { entries; text; origin: "PERSON" | "FORM"; formKey; by; at }`.

**Form.** "Files from this form" = files with the same column layout: `formKey` = profile id + sorted, letters-only column headers. A generic profile covers many states' forms, so the profile alone would share one state's codes with another.

**Saved form code lists.** Stored as rows in `pv_linelist_jobs` with id `codelist-<formKey hash>` and `data.kind = "FORM_CODE_LIST"` (org-isolated by the table's existing RLS). `linelist.jobs()` and the backend `/linelist/jobs` listing exclude them.

**Precedence (per field):** base profile < saved form list < the file's own legend < the person's list for this file. A field the file's own legend covers ignores the saved form list for that field (decision 2).

**Reading.** 1) Rules: the legend parser, extended to multi-line blocks (a heading line, then one `code = meaning` per line) and to the new fields' headings, plus the job's own column headers as headings. 2) AI (new backend endpoint `/api/ai/linelist/read-code-list`) only when rules leave text unread; returns rows restricted to the job's mapped fields. 3) Preview table with problems: a code with two meanings, codes in the file the list does not cover, conflicts with the file's own legend. Nothing applies until **Use this code list**.

**Applying.** One entry point — `discoverAndApplyCodebook` — so line-list checks, E2B preflight and export read the file identically. Reaction/outcome/seriousness keep their own decode pipelines; every other coded field is decoded (code → meaning) at the start of both `runValidation` and `applyColumnMap`, before any field logic. Confirming re-runs the deterministic checks (`recheckJob`), audited; the fixed file prints the added list at the bottom.

**Upload of a new file:** if a saved form list matches its `formKey`, it is attached (`origin: "FORM"`) and shown on the panel as "Using the code list saved for this form".

## Tasks (test-first each)
1. Legend parser: multi-line blocks, new field headings, column-header headings.
2. Merge with precedence + generic decode of other coded fields in validation and mapping.
3. Job `codeList`, `setCodeList` / `clearCodeList` (audit + recheck), form key, saved form lists (+ list filtering), attach on upload, fixed-file footer.
4. Backend AI endpoint + prompt + schema; frontend client.
5. Line-list page: "Code list" panel in "How to read this file" (found-in-file view, type/paste/upload, preview with problems, confirm, save for this form, remove), missing-code-list prompt, blocker link.
6. Full suite, ICH XSD check, offline Ondo run with its legend stripped then supplied; PR; live check after deploy.
