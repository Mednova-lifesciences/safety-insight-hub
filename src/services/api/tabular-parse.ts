import * as XLSX from "xlsx";

export function isSpreadsheetFile(file: File): boolean {
  return /\.(csv|xlsx|xls)$/i.test(file.name);
}

/** Reads a CSV or XLSX file into a header row + string matrix. Throws on
 *  anything that can't be parsed as tabular data at all. Shared by
 *  line-list processing and PSUR/PBRER spreadsheet uploads. */
export async function parseTabularFile(
  file: File,
): Promise<{ headers: string[]; rows: string[][] }> {
  const isCsv = /\.csv$/i.test(file.name);
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("The file has no sheets.");
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    // Read each cell through its own number format (so an Excel date cell
    // comes back as "2026-08-10", not the raw serial number 46239.4...).
    raw: false,
  }) as (string | number)[][];

  const [headerRow, ...dataRows] = matrix;
  if (!headerRow || headerRow.length === 0) throw new Error("No header row found.");
  const headers = headerRow.map((h) => String(h ?? "").trim());
  const rows = dataRows
    .filter((r) => r.some((cell) => String(cell ?? "").trim().length > 0))
    .map((r) => headers.map((_, i) => String(r[i] ?? "").trim()));
  return { headers, rows };
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
