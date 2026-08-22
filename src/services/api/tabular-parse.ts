import * as XLSX from "xlsx";

export function isSpreadsheetFile(file: File): boolean {
  return /\.(csv|xlsx|xls)$/i.test(file.name);
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /** The sheet the parser selected as the actual data table — a workbook's
   *  first sheet is not assumed to be it (see sheet ranking below). */
  sheetName: string;
  /** 1-indexed row number, in the original sheet, of the header row that
   *  was actually used — for tracing a finding back to the source file. */
  headerRowNumber: number;
  /** How many rows above the detected header were skipped as title/
   *  letterhead/metadata rows (0 for a normal file whose first row is the
   *  real header). */
  skippedRows: number;
  /** Human-readable notes about parsing decisions (header skipped, a
   *  two-row header merged, no confident header found) — surfaced to the
   *  UI/audit trail rather than silently acted on. */
  warnings: string[];
}

/** Normalised (lowercase, alphanumeric-only) header-concept fragments used
 *  to recognise a real column-header row versus a title/letterhead/
 *  instruction row. Deliberately broad and government-AEFI-form-aware, but
 *  a header row only needs a couple of hits — this is a detector, not a
 *  field mapper (mapColumnsByKeywords, below, still owns actual field
 *  assignment). */
const HEADER_SIGNAL_KEYWORDS = [
  "serial",
  "sn",
  "caseid",
  "reportid",
  "reportno",
  "patient",
  "name",
  "sex",
  "gender",
  "address",
  "age",
  "years",
  "months",
  "dob",
  "birth",
  "immuniz",
  "immunis",
  "vaccin",
  "product",
  "drug",
  "dose",
  "batch",
  "lot",
  "diluent",
  "reaction",
  "aefi",
  "adverseevent",
  "event",
  "onset",
  "serious",
  "outcome",
  "hospital",
  "reporter",
  "designation",
  "phone",
  "telephone",
  "email",
  "contact",
  "lga",
  "state",
  "facility",
  "ward",
  "district",
  "history",
  "allerg",
  "remark",
  "note",
  "comment",
  "date",
  "time",
];

function normalizeCell(v: unknown): string {
  return String(v ?? "").trim();
}

/** A real header row has several distinct, short, label-like cells that
 *  recognisably name a field concept. A title/letterhead row typically has
 *  one populated cell (a merged banner); an instructions paragraph has one
 *  long sentence. Neither should be mistaken for the header. */
function scoreHeaderRow(row: (string | number)[]): { nonEmpty: number; keywordHits: number } {
  let nonEmpty = 0;
  let keywordHits = 0;
  for (const cell of row) {
    const text = normalizeCell(cell);
    if (!text) continue;
    nonEmpty++;
    const norm = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (HEADER_SIGNAL_KEYWORDS.some((kw) => norm.includes(kw))) keywordHits++;
  }
  return { nonEmpty, keywordHits };
}

/** Scans the top of a sheet (not just row 0) for the row that actually
 *  looks like a column-header row, so a government form's letterhead/
 *  title/instructions block above the real table doesn't get mistaken for
 *  the header. Requires at least two cells that both look like real
 *  content (non-empty) and recognisable as a field concept — a single
 *  merged banner cell or a one-sentence instruction line won't qualify. */
function detectHeaderRowIndex(
  matrix: (string | number)[][],
): { index: number; score: number } | null {
  const scanLimit = Math.min(matrix.length, 60);
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < scanLimit; i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;
    const { nonEmpty, keywordHits } = scoreHeaderRow(row);
    if (nonEmpty < 2 || keywordHits < 2) continue;
    const score = keywordHits * 10 + nonEmpty;
    if (!best || score > best.score) best = { index: i, score };
  }
  return best;
}

/** Propagates a merged header cell's value across the columns it spans
 *  (e.g. "AGE" merged over two columns) using the sheet's own merge
 *  metadata — not a value-pattern guess — so a sub-header row underneath
 *  isn't left orphaned under blank parent cells. Returns which columns
 *  were filled this way, since only those are eligible to be combined with
 *  a sub-header row below. */
function propagateMergedHeaders(
  sheet: XLSX.WorkSheet,
  headerRow: string[],
  headerRowIndex: number,
): Set<number> {
  const filled = new Set<number>();
  const merges = (sheet["!merges"] ?? []) as {
    s: { r: number; c: number };
    e: { r: number; c: number };
  }[];
  for (const m of merges) {
    if (m.s.r > headerRowIndex || m.e.r < headerRowIndex || m.e.c <= m.s.c) continue;
    const parentValue = headerRow[m.s.c];
    if (!parentValue) continue;
    // The merge's own anchor column is just as eligible to combine with a
    // sub-header below it as the columns filled by propagation — "Age"
    // merged over two columns should combine with both "Years" and
    // "Months" beneath it, not just the column that had to be filled in.
    filled.add(m.s.c);
    for (let c = m.s.c + 1; c <= m.e.c; c++) {
      if (!headerRow[c]) {
        headerRow[c] = parentValue;
        filled.add(c);
      }
    }
  }
  return filled;
}

/** Combines a detected two-row header ("AGE" over "YEARS" / "MONTHS") into
 *  single column names ("AGE YEARS", "AGE MONTHS"), only for columns whose
 *  parent value came from a merge (propagateMergedHeaders) — so a real data
 *  row is never mistaken for a sub-header. Requires at least two columns to
 *  actually combine before treating the row as consumed. */
function mergeSubHeaderRow(
  headerRow: string[],
  subRow: string[],
  filledFromMergeCols: Set<number>,
): { merged: string[]; consumed: boolean } {
  let matches = 0;
  const merged = headerRow.map((h, i) => {
    const child = normalizeCell(subRow[i]);
    if (!child || !filledFromMergeCols.has(i)) return h;
    matches++;
    return h ? `${h} ${child}` : child;
  });
  return { merged, consumed: matches >= 2 };
}

function buildMatrix(sheet: XLSX.WorkSheet): (string | number)[][] {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    // Read each cell through its own number format (so an Excel date cell
    // comes back as "2026-08-10", not the raw serial number 46239.4...).
    raw: false,
  }) as (string | number)[][];
}

/** Reads a CSV or XLSX file into a header row + string matrix. Throws on
 *  anything that can't be parsed as tabular data at all. Shared by
 *  line-list processing and PSUR/PBRER spreadsheet uploads.
 *
 *  Does not assume the first sheet is the relevant one, or that its first
 *  row is the header: real-world government/institutional exports commonly
 *  carry a letterhead/title/instructions block, blank rows, and sometimes a
 *  two-row header before the actual case table. Every sheet is scored for
 *  how "tabular" it looks (a confidently-detected header plus a plausible
 *  number of data rows below it) and the best-scoring one is used; rows
 *  above its real header are skipped rather than misread as columns. */
export async function parseTabularFile(file: File): Promise<ParsedTable> {
  const isCsv = /\.csv$/i.test(file.name);
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });

  if (workbook.SheetNames.length === 0) throw new Error("The file has no sheets.");

  let best: {
    sheetName: string;
    sheet: XLSX.WorkSheet;
    matrix: (string | number)[][];
    header: { index: number; score: number };
    rank: number;
  } | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = buildMatrix(sheet);
    if (matrix.length === 0) continue;
    const header = detectHeaderRowIndex(matrix);
    if (!header) continue;
    const dataRowCount = matrix
      .slice(header.index + 1)
      .filter((r) => r.filter((c) => normalizeCell(c).length > 0).length >= 2).length;
    // A sheet that scores well on header-likeness but has almost no data
    // beneath it is probably a lookup/reference/summary sheet, not the
    // case table — data row count matters at least as much as header score.
    const rank = header.score * 1000 + dataRowCount;
    if (!best || rank > best.rank) best = { sheetName, sheet, matrix, header, rank };
  }

  if (!best) {
    // No sheet had a row confidently recognisable as a header. Rather than
    // failing outright, fall back to the first sheet's first row — the
    // pre-existing behaviour — so an unusual-but-legitimate file (e.g. very
    // few, very generically-named columns) still gets a chance to map.
    const sheetName = workbook.SheetNames[0]!;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error("The file has no sheets.");
    const matrix = buildMatrix(sheet);
    const [headerRow, ...dataRows] = matrix;
    if (!headerRow || headerRow.length === 0) throw new Error("No header row found.");
    const headers = headerRow.map(normalizeCell);
    const rows = dataRows
      .filter((r) => r.some((cell) => normalizeCell(cell).length > 0))
      .map((r) => headers.map((_, i) => normalizeCell(r[i])));
    return {
      headers,
      rows,
      sheetName,
      headerRowNumber: 1,
      skippedRows: 0,
      warnings: [
        "Could not confidently identify a header row anywhere in the first 60 rows of any sheet; used the first row of the first sheet as a last resort.",
      ],
    };
  }

  const { sheetName, sheet, matrix, header } = best;
  const warnings: string[] = [];
  if (header.index > 0) {
    warnings.push(
      `Skipped ${header.index} row(s) above the detected header (row ${header.index + 1}) as title/letterhead/metadata content.`,
    );
  }

  let headerRow = (matrix[header.index] ?? []).map(normalizeCell);
  const filledFromMergeCols = propagateMergedHeaders(sheet, headerRow, header.index);

  let dataStartIndex = header.index + 1;
  const candidateSubRow = matrix[dataStartIndex];
  if (candidateSubRow && filledFromMergeCols.size > 0) {
    const { merged, consumed } = mergeSubHeaderRow(
      headerRow,
      candidateSubRow.map(normalizeCell),
      filledFromMergeCols,
    );
    if (consumed) {
      headerRow = merged;
      dataStartIndex += 1;
      warnings.push(
        "Combined a two-row header (merged parent cell + sub-header row) into single column names.",
      );
    }
  }

  const headers = headerRow;
  const headerKey = headers.join("");
  // A real case record populates more than a single field even when
  // sparse — a row with only one populated cell is essentially always a
  // banner/title/letterhead band reprinted partway down the sheet (a
  // common artefact in paginated government-form exports flattened into
  // one sheet), never genuine case data. Only applied when the table has
  // enough columns for "more than one populated cell" to mean anything.
  const minPopulatedCells = headers.length >= 3 ? 2 : 1;
  let structuralRowsDropped = 0;
  const rows = matrix
    .slice(dataStartIndex)
    .map((r) => headers.map((_, i) => normalizeCell(r[i])))
    .filter((r) => {
      const populated = r.filter((cell) => cell.length > 0).length;
      if (populated === 0) return false; // fully blank
      if (r.join("") === headerKey) return false; // exact repeat of the header row
      if (populated < minPopulatedCells) {
        structuralRowsDropped++;
        return false;
      }
      return true;
    });
  if (structuralRowsDropped > 0) {
    warnings.push(
      `Dropped ${structuralRowsDropped} sparse row(s) within the data region (fewer than ${minPopulatedCells} populated cell(s)) as non-data structural content, e.g. a repeated letterhead/title band.`,
    );
  }

  return {
    headers,
    rows,
    sheetName,
    headerRowNumber: header.index + 1,
    skippedRows: header.index,
    warnings,
  };
}

/** Scores every header against every field by keyword specificity and
 *  assigns highest-confidence (header, field) pairs first, so a
 *  distinctive column name always beats a generic substring collision
 *  (e.g. "Drug name (WHODrug)" beats "Drug role" for a "product" field). */
export function mapColumnsByKeywords<TField extends string>(
  headers: string[],
  fieldKeywords: Record<TField, [string, number][]>,
): Record<string, TField> {
  const fields = Object.keys(fieldKeywords) as TField[];
  const candidates: { header: string; field: TField; score: number }[] = [];
  for (const header of headers) {
    const h = header.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const field of fields) {
      let best = 0;
      for (const [keyword, weight] of fieldKeywords[field]) {
        if (h.includes(keyword)) best = Math.max(best, weight);
      }
      if (best > 0) candidates.push({ header, field, score: best });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const mapping: Record<string, TField> = {};
  const usedFields = new Set<TField>();
  const usedHeaders = new Set<string>();
  for (const c of candidates) {
    if (usedFields.has(c.field) || usedHeaders.has(c.header)) continue;
    mapping[c.header] = c.field;
    usedFields.add(c.field);
    usedHeaders.add(c.header);
  }
  return mapping;
}
