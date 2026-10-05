# Line-list decisions and the fixed workbook — design

**Date:** 2026-10-05
**Status:** Design approved section by section in conversation; this written spec awaits review.
**Sub-project:** 2 of 2. Sub-project 1 (column-mapping fixes from the real Ondo run) gets its own spec — see section 12.

---

## 1. Why

A NAFDAC official reviewing the Excel-to-XML tool:

> "If we still have to spend a significant amount of time manually cleaning and formatting the Excel file before it can pass through the tool, then the value it adds is somewhat limited… Ideally, the tool should be able to handle most of the data preparation and cleaning, with us mainly coming in at the decision points — to accept, reject, or step down cases from the line list as necessary."

Two follow-up asks from the product owner on 2026-10-05:

1. A way to **drop a case** from the issues table.
2. After Fix and those decisions, a **download of the actual fixed line list**, with an extra column saying **what changed in each row**.

Measured the same day on a real Ondo State AEFI line list (253 rows, 34 merged ranges, a three-part code list at the bottom): the structural preparation is already strong, but there is no way to decide about a case, and the old value of every automatic correction is thrown away — so a "what changed" column is impossible today.

## 2. Decisions taken

| # | Question | Decision |
|---|---|---|
| D1 | What is downloaded | **Their own workbook, corrected in place** — letterhead, merges and styling intact, changed cells highlighted with a note, three new columns. (Option B.) |
| D2 | Meaning of "step down" | **Hold for later, within the same upload.** Left out of the XML **and** the fixed workbook. Flipping it back to Keep puts it in the next export. Held cases do not move between uploads. |
| D3 | Where the workbook comes from | **Rebuilt on demand** from the stored original plus whatever is in force at that moment. The original lives in its own table. (Approach A.) |
| D4 | What Undo means for later Fix runs | **The cell is taken over.** Fix never changes it again; it is still flagged if invalid. **Re-apply** hands it back. |
| D5 | Drop | Left out of the XML; **kept and marked** in the fixed workbook so it still lines up row-for-row with what was submitted. Reason required. |
| D6 | Manual edits | **None.** People accept, undo, re-apply, drop, step down. They do not type new values. |
| D7 | Where decisions are made | **On the issues table.** A case with no issues cannot be dropped in this round. |
| D8 | Permissions | **No new rules.** Whoever can run Fix on a job can make these decisions. |

## 3. Non-goals

- Typing corrected values by hand (D6).
- An "all cases" view; dropping a clean case such as a duplicate of an issue-free row (D7).
- Moving held cases between uploads (D2).
- `.xls` uploads — the line-list upload accepts only `.csv` and `.xlsx` today (`line-list.tsx:214`).
- Supabase Storage buckets — the project has none, and a table follows the existing isolation pattern (D3).
- Column-mapping fixes and the C.1.4 received-date question — sub-project 1.
- Role-based RLS on line-list tables — the existing org-scoped rule stands; see section 11.

## 4. What is stored

### 4.1 The original upload — `pv_linelist_files`

A new table, one row per job:

| Column | Type | Notes |
|---|---|---|
| `job_id` | text, primary key | References the job |
| `organization_id` | uuid, not null | Same org-isolation RLS as every other `pv_` table |
| `filename` | text | As uploaded |
| `content_type` | text | `.xlsx` or `.csv` MIME type |
| `content_base64` | text | The file bytes |
| `size_bytes` | integer | |
| `uploaded_at` | timestamptz | |

- Written once, at upload, in the same flow that creates the job.
- Read **only** when someone downloads the fixed line list. Never loaded with the job, so ordinary job reads stay small.
- Files over **10 MB** are not stored. The job records why, and the download falls back to CSV (section 6.5). The Ondo file is 62 KB.
- Deleted with the job.

It holds the same patient data `rawRows` already holds on the job, under the same isolation rule.

### 4.2 Where each value sits in the sheet — `layout`

Today the job stores `sheetName`, `headerRowNumber` and `sourceRowNumbers`. Those row numbers are positions in the matrix SheetJS returns, which starts at the **first cell of the sheet's used range**. That equals the sheet's own numbering only when the used range starts at `A1`. Ondo's does (`A1:AI253`), but nothing guarantees it; a sheet whose used range starts at `B2` would put every written correction one row and one column off.

Two changes at upload:

1. **The existing `headerRowNumber` and `sourceRowNumbers` become absolute** — the parser adds the used range's starting row. They keep their names and stay where they are, so there is one copy of each. This also corrects the "File row" the issues table shows for such sheets.
2. **A new `layout` field records only what is missing today:**

```ts
interface LineListLayout {
  /** 1, or 2 when a merged two-row header was combined. */
  headerRowCount: 1 | 2;
  /** Absolute column letter of each original header, e.g. { "Age Years": "F" }.
   *  Blank and repeated header names are omitted — see section 8. */
  columnLetters: Record<string, string>;
}
```

The writer addresses a cell as `columnLetters[column]` + `sourceRowNumbers[row - 1]`, on the job's existing `sheetName`.

Jobs created before this ships have no `layout` and no stored file. They keep the CSV download (section 6.5) rather than get a workbook built on guessed positions.

### 4.3 The change log — replaces `lastFixCorrections`

`lastFixCorrections` records only the most recent Fix run, and never the old value. It is replaced by an append-only log on the job:

```ts
interface LineListChange {
  id: string;
  /** 1-based data-row index — the same numbering LineListIssue.row uses. */
  row: number;
  /** Original header text. */
  column: string;
  oldValue: string;
  newValue: string;
  reason: string;
  source: "rule" | "ai" | "recovery";
  appliedAt: string;
  /** Undo / re-apply history, oldest first. Never edited, only appended. */
  events: { kind: "undone" | "reapplied"; by: string; at: string }[];
}
```

- **State** of an entry is its last event: none or `reapplied` → *applied*; `undone` → *undone*.
- **A cell is held by a person** when the newest entry for that `(row, column)` is *undone* (D4).
- Entries are never deleted or rewritten. Undo and Re-apply append an event.

Existing jobs keep `lastFixCorrections`. They are shown read-only, without Undo — there is no old value to restore.

### 4.4 Decisions

```ts
type LineListDecisionKind = "DROP" | "STEP_DOWN";
type DropReason = "DUPLICATE" | "NOT_AN_AEFI" | "INSUFFICIENT_INFORMATION" | "OTHER";

interface LineListDecision {
  row: number;                 // 1-based data-row index
  decision: LineListDecisionKind;
  reason?: DropReason;         // required when decision is DROP
  note?: string;               // required when reason is OTHER
  by: string;
  at: string;
}
```

- Stored on the job as the **current** decision per row. No entry means **Keep**.
- Every change — including back to Keep — is written to the existing audit trail (`recordAudit`): `LINELIST_CASE_DROPPED`, `LINELIST_CASE_STEPPED_DOWN`, `LINELIST_CASE_KEPT`. The audit trail is where the history lives.
- Rows never move within a job: Step down is a status, not a deletion. Row numbers in the log and in decisions stay valid for the life of the job.

## 5. Behaviour

### 5.1 Fix

As today, with three changes:

1. **Before writing** a correction, read the cell's current value from `rawRows` and record it as `oldValue` in a new log entry.
2. **Skip** any correction for a cell held by a person (4.3) and any correction whose new value equals the current value.
3. **Act on Kept rows only.** Dropped and held rows are not corrected. A held row returned to Keep is picked up by the next Fix run.

The audit line `LINELIST_AI_FIX_APPLIED` stays.

### 5.2 Undo

- Offered only on the **newest** entry for a cell, and only while it is *applied*. Older entries for the same cell are shown as superseded. This keeps cell history linear: undoing an older change underneath a newer one would leave the cell in a state no entry describes.
- Restores `oldValue` into `rawRows[row][column]`, and into `parsedRows[row][field]` when that column is mapped.
- Appends an `undone` event; audit `LINELIST_CHANGE_UNDONE`.
- Re-runs the deterministic validation, as Fix does, so the issue reappears.

### 5.3 Re-apply

- Offered only on the newest entry for a cell, while it is *undone*.
- Writes `newValue` back, appends a `reapplied` event, audit `LINELIST_CHANGE_REAPPLIED`, re-runs validation.
- The cell is no longer held; later Fix runs may update it as normal.

### 5.4 Drop, Step down, Keep

- **Drop** requires a reason; **Other** also requires a note.
- A decision applies to the **case**: every issue row for that case reflects it.
- Effects of Drop and Step down:
  - **Not in the XML** (5.5).
  - **Not counted**: excluded from `Fix Issues (N)`, from "issues remaining", and from anything that blocks export. The existing export override applies only to the cases that remain.
  - **Fixed workbook**: Drop → kept and marked; Step down → removed (section 6).
- **Keep** clears the decision. A held case returned to Keep is included in the next export.

### 5.5 Leaving cases out of the XML without renumbering them

When a case has no source case ID, its sender's case ID is generated from its **row position** — `${caseIdPrefix}-${sourceRow}` (`mapping.ts:828`), with `sourceRow` the index in `parsedRows` (`export.ts:221`). Removing decided rows from `parsedRows` **before** mapping would therefore give every later case a different ID on the next export, and VigiFlow would see the same patients as new cases.

So: **every row is mapped with its original position, and decided cases are removed from the result afterwards.** The export reports how many were left out and why ("3 dropped, 2 held").

## 6. The fixed line list

### 6.1 One central function

`buildFixedWorkbook(original, layout, changes, decisions, remainingIssues) → bytes`. It is pure — no network, no job reads — so it can be tested on fixtures. The caller loads the stored file and the job, and triggers the download.

**ExcelJS** is added as a dependency and loaded only when the download button is pressed, so the rest of the app does not carry its ~900 KB. SheetJS stays as the reader; its community build cannot write cell styling.

### 6.2 For `.xlsx` uploads

In this order:

1. **Open** the stored original and select `layout.sheetName`. Every other sheet is left exactly as it was.
2. **Correct each changed cell in place.** A cell is written when it has at least one *applied* entry. Its value comes from the job's current `rawRows` — the single source of truth, which Undo has already restored where needed.
   - **Value type follows the original cell:** a number cell given a numeric value is written as a number; a date cell given a date is written as a date and keeps its number format; anything else is written as text. Without this, Excel shows corrected numbers as text with a warning triangle.
   - **Fill:** light yellow (`FFFFF2CC`). Font and borders are not touched.
   - **Note:** `Was: <the cell's text in the original file>`, then one line per applied change: `<reason> (<rule|AI|recovery>)`. The "was" value is read from the original cell itself, so a cell changed twice still shows what the file originally said.
   - A corrected cell that held a formula has it replaced by the value; the note says `Was: formula =…`.
3. **Add three columns** immediately after the last used column:

   | Column | Content |
   |---|---|
   | **Changes made** | Applied changes on the row, joined with ` · `: `Age Years: "1 yr" → "1" · Outcome: "recoverd" → "1" (matched code list: 1=Recovered)` |
   | **Decision** | `DROPPED — Duplicate` (plus `: <note>` when present). Blank for Keep. |
   | **Still needs review** | Issues remaining on the row, including items Fix could not resolve, joined with ` · `. |

   The header cells sit on the header row. With a two-row header they are merged down over both rows, so they look native. Their style is copied from the last original header cell; the columns get a width and wrap text.
4. **Remove stepped-down rows**, bottom-up, so earlier positions do not move while deleting:
   1. Record every merged range, then unmerge all.
   2. Delete the rows.
   3. Re-merge each range, shifted up by the number of deleted rows above it:
      - entirely within deleted rows → gone;
      - partly overlapping deleted rows → shrunk by the overlap;
      - otherwise → shifted.

   ExcelJS's own row deletion drops merges below the deleted row: on the Ondo file it lost 3 of 34, including the code-list block (`A249:T250`) and a data-area merge spanning two rows (`F235:F236`). This procedure kept all 34 in a probe.
5. **The code list** at the bottom is not touched; it moves up with the deletions.
6. Downloaded as `<original name without extension> - fixed.xlsx`.

Writing the cells and columns before or after the deletions is the plan's choice. Either way, the tests in section 9 assert that fills, notes and the three columns end up on the right rows after deletions.

### 6.3 For `.csv` uploads

There is no workbook to correct. The CSV download keeps today's behaviour, with:

- the same three columns, which **replace** today's `Needs review` and `Unresolved column(s)`;
- stepped-down rows removed, dropped rows kept and marked;
- the code list kept at the bottom under `# ORIGINAL SOURCE TEXT`, as today.

### 6.4 Re-uploading a fixed file

The fixed file is meant to be uploadable again; today's CSV already keeps its code list for that reason.

- The column mapper **never maps** `Changes made`, `Decision`, `Still needs review`, or the legacy `Needs review` and `Unresolved column(s)`.
- A row whose `Decision` reads `DROPPED — …` is imported **with the Drop decision already set**. The reason is parsed from the text; text that does not parse becomes `OTHER` with the text as its note. Otherwise a dropped case would silently come back as a live case.
- Highlights and notes carry no meaning on re-upload. The corrected values are already in the cells.

### 6.5 When the workbook cannot be built

If the job has no `layout`, the original was not stored (older job, over 10 MB) or cannot be opened, or the case sheet is missing: the button says which, and offers the CSV. **No partial file is ever downloaded** — the function either returns a complete workbook or fails, and failure falls back.

## 7. On screen

1. **Issues table.** A Decision control at the end of every row: *Keep · Drop… · Step down*. *Drop…* opens a small dialog with the four reasons and a note. Decided cases' rows turn grey and sit under a divider, *"Dropped or held — not counted"*. A filter row: **All · Kept · Dropped · Held (N)** — "Held" is where a case is returned to Keep.
2. **Changes made panel**, below the table once Fix has run, replacing the one-line "N fields corrected" message. Each line: file row, case ID, column, **was → now**, why, made by, and **Undo** or **Re-apply**. Superseded entries are shown greyed without a button. A held cell shows a small "kept by you" mark.
3. **Download.** `Download Fixed CSV` becomes **Download fixed line list (.xlsx)** for `.xlsx` jobs with a stored original. Otherwise it is the CSV, with the reason. Beside it: *"231 cases · 12 cells changed · 3 dropped · 2 held"*.
4. **E2B step.** States what is left out: *"3 dropped and 2 held cases will not be in the XML."*
5. **Executive summary.** Reads corrections from the change log (falling back to `lastFixCorrections` for old jobs) and reports dropped and held counts.

## 8. Errors and edge cases

| Case | Behaviour |
|---|---|
| Two changes to one cell, both applied | Cell shows the latest value; note shows the file's original value and both reasons; only the newer entry offers Undo |
| Undo on a dropped row | Allowed |
| Fix on a decided row | Skipped (5.1) |
| Original over 10 MB | Not stored; CSV download with the reason |
| Corrected cell held a formula | Replaced by the value; note records the formula |
| Data validation or conditional-format ranges below a deleted row | Not shifted by ExcelJS; listed as a known limitation in the download's help text |
| Decision on a case that later has no issues left | The decision stands and still shows under the Dropped / Held filter |
| Changes made before a case was dropped or held | They stay applied, and appear in the workbook for dropped cases |
| A change to a column whose header is blank or repeated | `rawRows` is keyed by header text, so such columns cannot be told apart (already true today; Ondo has six blank header cells). The writer does **not** write that cell. It adds `not written to the file — column name blank or repeated` to Still needs review. |
| Re-upload of a fixed file | Section 6.4 |

## 9. Testing

- **Workbook builder**, on synthetic fixtures built inside the tests with ExcelJS — never real files. The fixture mirrors Ondo's shape: letterhead rows, a merged two-row header, a styled header, a data-area merge spanning two rows, a merged code list at the bottom, a second sheet. Assert:
  - corrected values, fills and notes on the right cells;
  - numbers and dates keep their type and format;
  - the three columns and their two-row header merge;
  - stepped-down rows gone, dropped rows present and marked;
  - every merge preserved, shifted or shrunk as section 6.2 says;
  - the code list intact, the other sheet untouched;
  - fills, notes and columns on the right rows **after** deletions.
- **A sheet whose used range starts at `B3`**: corrections land on the right cells.
- **Change log**: old value captured; Fix skips held cells and no-op changes; Undo and Re-apply cycles; Undo offered only on the newest entry.
- **Decisions**: left out of the XML; **case IDs of the remaining cases unchanged** when an earlier row is dropped (5.5); excluded from counts and blocking; Fix skips decided rows; Keep restores inclusion.
- **Re-upload**: the three columns are never mapped; `DROPPED` rows come back dropped.
- **Real file**, local only: the existing Ondo harness gains a round trip — build the fixed workbook and assert all 34 merges and the code list survive. It skips when the file is absent and writes nothing unless asked, as now.

## 10. Rollout and compatibility

- A migration adds `pv_linelist_files` with the org-isolation policy used by `006_pv_tables_org_isolation.sql`.
- `layout`, `changeLog` and `decisions` are new optional fields on the job's data. Old jobs read as having none.
- `lastFixCorrections` stays readable for old jobs and is no longer written.
- ExcelJS is lazy-loaded (6.1).

**Delivery in two plans**, each shipping something usable on its own:

- **2a — Decisions and the change log:** sections 4.3, 4.4, 5 and screen items 7.1, 7.2, 7.4, 7.5. People can drop, step down, undo and re-apply, and the XML reflects it. The CSV download gains the three columns (6.3).
- **2b — The fixed workbook:** sections 4.1, 4.2, 6.1, 6.2, 6.4, 6.5 and screen item 7.3. Builds on 2a's log and decisions.

## 11. Open items

- **Role-based RLS.** Line-list tables are org-scoped only. Decisions follow the same rule as Fix (D8). Tightening by role is separate work.
- **All-cases view** (D7), if clean duplicates turn out to need dropping.
- The C.1.4 received-date question belongs to sub-project 1.

## 12. Sub-project 1, for orientation

The column-mapping fixes found on the Ondo run: bare `ID` → case ID, asking rather than generating when no case ID column maps; reporter name; Age Months; reporter e-mail; other vaccines given just before; medical history; facility address; diluent batch into the narrative; and the C.1.4 received date. Separate spec. It does not depend on this one, and this one does not depend on it.
