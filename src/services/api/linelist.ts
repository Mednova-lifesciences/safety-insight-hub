import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import { mapColumnsByKeywords, parseTabularFile } from "./tabular-parse";
import { ai } from "./ai";
import { RULE_BASED_DETECTION_ENABLED } from "./feature-flags";
import type { LineListIssue, LineListJob } from "@/types/pv";

export interface ColumnInspection {
  jobId: string;
  detectedColumns: { name: string; sample: string[]; suggestedField: string | null }[];
  targetFields: string[];
}

/**
 * The canonical field vocabulary. This started as the 7 fields a generic
 * ICSR/line-list export needs (case_id..outcome) and has been extended
 * with AEFI-specific fields so the free, zero-token rule engine can check
 * them deterministically wherever the header is recognisable. This list
 * is a mapping *hint* and what drives the deterministic checks — it is
 * NOT the limit of what gets validated: every original column, recognised
 * or not, is still sent to the AI analysis pass in full (see rawRows).
 */
export const TARGET_FIELDS = [
  "case_id",
  "patient_identifier",
  "product",
  "reaction",
  "onset_date",
  "seriousness",
  "outcome",
  "sex",
  "age",
  "vaccination_date",
  "reaction_code",
  "serious_code",
  "vaccine_batch",
  "dose",
  "reporter_designation",
  "reporter_phone",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

const SERIOUSNESS_VALUES = new Set([
  "SERIOUS",
  "NON_SERIOUS",
  "NON-SERIOUS",
  "NONSERIOUS",
  "YES",
  "NO",
  "Y",
  "N",
]);
const NON_SERIOUS_VALUES = new Set(["NON_SERIOUS", "NON-SERIOUS", "NONSERIOUS", "NO", "N"]);
const SERIOUS_TEXT_VALUES = new Set(["SERIOUS", "YES", "Y"]);
const OUTCOME_VALUES = new Set([
  "RECOVERED",
  "RECOVERING",
  "NOT_RECOVERED",
  "NOT RECOVERED",
  "RECOVERED_WITH_SEQUELAE",
  "RECOVERED WITH SEQUELAE",
  "FATAL",
  "UNKNOWN",
]);
const BATCH_PLACEHOLDER_VALUES = new Set(["-", "0", "NAN", "NIL", "NILL", "N/A", "NA"]);
const MULTI_VALUE_RE = /[,/]|\bAND\b/i;

/** A parsed, column-mapped row from an uploaded file — the canonical-field
 *  input to the deterministic rule engine, and to createFromCases jobs
 *  which have no original file to preserve in the first place. */
export type ParsedRow = Partial<Record<TargetField, string>>;

/** Extends the public LineListJob shape with the raw parse the job was
 *  built from, so validation can run against real content. Legacy/demo
 *  jobs seeded directly in the database won't have this — validate()
 *  falls back to their pre-existing issues rather than erasing them. */
interface LineListJobRow extends LineListJob {
  columns?: string[];
  mapping?: Record<string, TargetField>;
  parsedRows?: ParsedRow[];
  /** Every original column, keyed by its real header text, for every row
   *  — unlike parsedRows, nothing outside the canonical fields is dropped.
   *  This is what actually gets sent to AI analysis/fix for a real upload,
   *  so a column outside the app's canonical field list is never silently
   *  invisible to validation. Absent on jobs synthesized internally
   *  (createFromCases) — those are already fully canonical with no
   *  original file to preserve. */
  rawRows?: Record<string, string>[];
  /** Parser notes from ingestion (e.g. "skipped 9 title/letterhead rows
   *  above the detected header on row 10", "combined a two-row header") —
   *  kept for traceability back to how the raw file was actually read, not
   *  shown as validation issues. Empty for a file whose first row was
   *  already the real header. */
  parseWarnings?: string[];
  validatedAt?: string;
  /** The AI prompt version last used to analyse this job, surfaced on the
   *  executive summary so it's traceable to exactly what ran. */
  promptVersion?: string;
  /** The outcome of the most recent "Fix Issues" run, kept so the
   *  executive summary always reflects the job's real current state
   *  rather than a stale pre-fix snapshot. Present (possibly empty) once
   *  fixIssues() has run at least once. */
  lastFixCorrections?: { row: number; column: string; new_value: string; reason: string }[];
  lastFixUnresolved?: { row: number; column: string; reason: string }[];
}

async function readJob(jobId: string): Promise<LineListJobRow> {
  const { data, error } = await supabase
    .from("pv_linelist_jobs")
    .select("data")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Line-list job not found");
  return data.data as unknown as LineListJobRow;
}

async function saveJob(job: LineListJobRow): Promise<LineListJobRow> {
  const { error } = await supabase
    .from("pv_linelist_jobs")
    .update({ data: toJson(job) })
    .eq("id", job.id);
  if (error) throw new Error(error.message);
  return job;
}

/**
 * Column-name → target-field matching. Deterministic string matching, not
 * AI — the same header always maps the same way.
 *
 * Real-world PV exports (e.g. WHO-UMC/VigiLyze-style ICSR listings) have
 * many columns whose names share short, generic substrings — "Age at
 * onset of reaction" contains "reaction", "Drug role" contains "drug".
 * A naive first-match-wins scan picks those up ahead of the actual
 * "Reaction / event (MedDRA)" or "Drug name (WHODrug)" columns. Instead,
 * every header is scored against every field by keyword specificity, and
 * headers are assigned to fields in descending score order — the most
 * confident matches win regardless of column order.
 */
export const FIELD_KEYWORDS: Record<TargetField, [string, number][]> = {
  case_id: [
    ["otherreportid", 90],
    ["caseid", 90],
    ["reportid", 80],
    ["reportno", 80],
    ["reportnumber", 80],
    ["reference", 40],
    ["case", 20],
  ],
  patient_identifier: [
    ["patientidentifier", 95],
    ["patientinitials", 90],
    ["initials", 80],
    ["patientid", 85],
    ["subjectid", 80],
    ["specialistrecordnumber", 60],
    ["patientno", 70],
    ["patient", 20],
    ["subject", 20],
  ],
  product: [
    ["drugnamewhodrug", 95],
    ["drugname", 90],
    ["suspectproduct", 90],
    ["vaccinename", 90],
    ["product", 25],
    ["drug", 20],
    ["vaccine", 20],
    ["medication", 25],
  ],
  reaction: [
    ["reactioneventmeddra", 95],
    ["reactionevent", 85],
    ["adverseevent", 80],
    ["reactionterm", 80],
    ["aeterm", 70],
    ["reaction", 15],
    ["event", 10],
  ],
  onset_date: [
    ["onsetdatetime", 90],
    ["onsetdate", 85],
    ["eventdate", 60],
    ["datestarted", 60],
    ["startdate", 30],
    ["onset", 20],
  ],
  seriousness: [
    ["seriousness", 95],
    ["serious", 30],
  ],
  outcome: [
    ["outcome", 85],
    ["resolution", 30],
    ["result", 20],
  ],
  sex: [
    ["sex", 90],
    ["gender", 85],
  ],
  age: [
    ["ageatonset", 70],
    ["ageyears", 70],
    ["age", 30],
  ],
  vaccination_date: [
    ["dateoflastimmunization", 95],
    ["dateoflastimmunisation", 95],
    ["dateofvaccination", 90],
    ["immunizationdate", 85],
    ["immunisationdate", 85],
    ["vaccinationdate", 85],
  ],
  reaction_code: [
    ["reactioncode", 95],
    ["aefireactioncode", 95],
    ["eventcode", 70],
  ],
  serious_code: [
    ["seriouscode", 90],
    ["aefitype", 85],
    ["severitycode", 70],
  ],
  vaccine_batch: [
    ["vaccinebatch", 90],
    ["batchno", 90],
    ["batchnumber", 90],
    ["lotno", 85],
    ["lotnumber", 85],
    ["batch", 30],
    ["lot", 25],
  ],
  dose: [
    ["doseno", 85],
    ["dosenumber", 85],
    ["doseadministered", 70],
    ["dose", 30],
  ],
  reporter_designation: [
    ["reporterdesignation", 90],
    ["designationofreporter", 90],
    ["reporterrole", 80],
    ["designation", 40],
  ],
  reporter_phone: [
    ["reporterphonenumber", 90],
    ["reporterphone", 90],
    ["telephonenumber", 65],
    ["phonenumber", 70],
    ["telephone", 60],
    ["phone", 30],
  ],
};

function mapColumns(headers: string[]): Record<string, TargetField> {
  return mapColumnsByKeywords(headers, FIELD_KEYWORDS);
}

function toParsedRows(
  headers: string[],
  rows: string[][],
  mapping: Record<string, TargetField>,
): ParsedRow[] {
  return rows.map((row) => {
    const parsed: ParsedRow = {};
    headers.forEach((header, i) => {
      const field = mapping[header];
      if (field && row[i]) parsed[field] = row[i];
    });
    return parsed;
  });
}

/** Every original column, keyed by its real header text — nothing dropped,
 *  unlike toParsedRows(). This is what a real upload sends to AI analysis
 *  and fix, so a column outside the canonical field list is never
 *  invisible to validation. */
function toRawRows(headers: string[], rows: string[][]): Record<string, string>[] {
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj;
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{1,2}-\d{1,2}-\d{2,4}$/;

/** Best-effort parse of the same shapes DATE_RE accepts, for chronology/
 *  future-date comparisons only — day/month order in a D/M vs M/D form is
 *  inherently ambiguous without knowing the source locale, so this uses a
 *  day-first assumption (common on African AEFI forms) and only swaps to
 *  month-first when day-first is out of range. A wrong guess here only
 *  affects this supplementary chronology check, not the core
 *  INVALID_DATE_FORMAT check, which just tests the shape. */
function parseDateLoose(value: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const [, y, m, d] = iso;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const slashOrDash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  if (slashOrDash) {
    const [, a, b, y] = slashOrDash;
    const year = y!.length === 2 ? Number(y) + 2000 : Number(y);
    let day = Number(a);
    let month = Number(b);
    if (day <= 12 && month > 12) {
      [day, month] = [month, day];
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Reduces a case/report ID to a shape signature (letters -> "A", digits ->
 *  "9", separators kept as-is) so IDs following the same structural
 *  pattern collapse to the same signature regardless of their specific
 *  characters. Used to flag an ID that breaks from the file's own
 *  majority pattern — never against an assumed external format. */
function idSignature(id: string): string {
  return id
    .trim()
    .toUpperCase()
    .replace(/[A-Z]+/g, "A")
    .replace(/\d+/g, "9");
}

/** Flags rows whose case_id doesn't match the structural pattern most
 *  other rows in the same file use. Only fires when there's a genuine
 *  majority-vs-minority split (not "all different", not "all the same")
 *  — an inherently varied ID scheme isn't itself a finding. */
function checkCaseIdConsistency(rows: ParsedRow[], caseIdColumn: string): LineListIssue[] {
  const withId = rows
    .map((r, i) => ({ idx: i, id: r.case_id }))
    .filter((r): r is { idx: number; id: string } => !!r.id);
  if (withId.length < 3) return [];

  const sigCounts = new Map<string, number>();
  for (const r of withId) {
    const sig = idSignature(r.id);
    sigCounts.set(sig, (sigCounts.get(sig) ?? 0) + 1);
  }
  const sorted = [...sigCounts.entries()].sort((a, b) => b[1] - a[1]);
  const majority = sorted[0];
  if (!majority || majority[1] < 2 || majority[1] === withId.length) return [];

  return withId
    .filter((r) => idSignature(r.id) !== majority[0])
    .map((r) => ({
      row: r.idx + 1,
      column: caseIdColumn,
      severity: "HIGH" as const,
      confidence: "HIGH" as const,
      code: "CASE_ID_FORMAT_INCONSISTENT",
      message: `"${r.id}" doesn't match the case/report ID format most other rows in this file use.`,
      value: r.id,
      source: "rule" as const,
      fixable: false,
    }));
}

/** Deterministic, rule-based validation — no AI involved. Every uploaded
 *  file gets the same checks run against its actual mapped content.
 *  Issues reference the *original column header* wherever one is known
 *  (via the reverse of `mapping`), not the internal canonical field name
 *  — so a fixable rule issue and an AI-fixable issue always identify a
 *  column the same way, which matters once fixIssues() has to look that
 *  column up in rawRows (keyed by original header, not canonical field). */
function runValidation(
  headers: string[],
  mapping: Record<string, TargetField>,
  rows: ParsedRow[],
): LineListIssue[] {
  const issues: LineListIssue[] = [];
  const mappedFields = new Set(Object.values(mapping));
  const headerForField = new Map<TargetField, string>();
  for (const [header, field] of Object.entries(mapping)) headerForField.set(field, header);
  const col = (field: TargetField): string => headerForField.get(field) ?? field;

  if (mappedFields.size === 0 && rows.length > 0) {
    issues.push({
      row: 0,
      column: "(all columns)",
      severity: "CRITICAL",
      confidence: "HIGH",
      code: "NO_COLUMNS_MAPPED",
      message: `None of the columns (${headers.join(", ")}) could be automatically matched to an expected field (${TARGET_FIELDS.join(", ")}). Manual column mapping is required before this file can be validated.`,
      value: null,
      source: "rule",
      fixable: false,
    });
    return issues;
  }

  const seenCaseIds = new Map<string, number>();
  const today = new Date();

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;

    (["patient_identifier", "product", "reaction"] as const).forEach((field) => {
      if (!row[field]) {
        issues.push({
          row: rowNum,
          column: col(field),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: `MISSING_${field.toUpperCase()}`,
          message: `${field.replaceAll("_", " ")} is required.`,
          value: null,
          source: "rule",
          fixable: true,
        });
      }
    });

    if (row.product && MULTI_VALUE_RE.test(row.product)) {
      issues.push({
        row: rowNum,
        column: col("product"),
        severity: "MEDIUM",
        confidence: "HIGH",
        code: "MULTIPLE_PRODUCTS_IN_CELL",
        message: `"${row.product}" appears to list multiple products in one cell — these should be separate rows.`,
        value: row.product,
        source: "rule",
        fixable: false,
      });
    }

    let onset: Date | null = null;
    if (!row.onset_date) {
      issues.push({
        row: rowNum,
        column: col("onset_date"),
        severity: "MEDIUM",
        confidence: "HIGH",
        code: "MISSING_ONSET_DATE",
        message: "Onset date was not provided.",
        value: null,
        source: "rule",
        fixable: true,
      });
    } else if (!DATE_RE.test(row.onset_date)) {
      issues.push({
        row: rowNum,
        column: col("onset_date"),
        severity: "HIGH",
        confidence: "HIGH",
        code: "INVALID_DATE_FORMAT",
        message: `"${row.onset_date}" does not look like a valid date (expected YYYY-MM-DD or similar).`,
        value: row.onset_date,
        source: "rule",
        fixable: true,
      });
    } else {
      onset = parseDateLoose(row.onset_date);
      if (onset && onset > today) {
        issues.push({
          row: rowNum,
          column: col("onset_date"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "DATE_IN_FUTURE",
          message: "Onset date is in the future.",
          value: row.onset_date,
          source: "rule",
          fixable: false,
        });
      }
    }

    if (mappedFields.has("vaccination_date")) {
      let vaxDate: Date | null = null;
      if (row.vaccination_date && !DATE_RE.test(row.vaccination_date)) {
        issues.push({
          row: rowNum,
          column: col("vaccination_date"),
          severity: "HIGH",
          confidence: "HIGH",
          code: "INVALID_DATE_FORMAT",
          message: `"${row.vaccination_date}" does not look like a valid date.`,
          value: row.vaccination_date,
          source: "rule",
          fixable: true,
        });
      } else if (row.vaccination_date) {
        vaxDate = parseDateLoose(row.vaccination_date);
        if (vaxDate && vaxDate > today) {
          issues.push({
            row: rowNum,
            column: col("vaccination_date"),
            severity: "CRITICAL",
            confidence: "HIGH",
            code: "DATE_IN_FUTURE",
            message: "Vaccination date is in the future.",
            value: row.vaccination_date,
            source: "rule",
            fixable: false,
          });
        }
      }
      if (vaxDate && onset && vaxDate > onset) {
        issues.push({
          row: rowNum,
          column: col("vaccination_date"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "DATE_CHRONOLOGY_VIOLATION",
          message: "Vaccination date is after the reaction's onset date.",
          value: row.vaccination_date ?? null,
          source: "rule",
          fixable: false,
        });
      }
    }

    if (row.seriousness && !SERIOUSNESS_VALUES.has(row.seriousness.toUpperCase())) {
      issues.push({
        row: rowNum,
        column: col("seriousness"),
        severity: "MEDIUM",
        confidence: "HIGH",
        code: "UNRECOGNISED_SERIOUSNESS_VALUE",
        message: `"${row.seriousness}" is not a recognised seriousness value (expected SERIOUS or NON_SERIOUS).`,
        value: row.seriousness,
        source: "rule",
        fixable: true,
      });
    }

    if (mappedFields.has("outcome")) {
      if (!row.outcome) {
        issues.push({
          row: rowNum,
          column: col("outcome"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "MISSING_OUTCOME",
          message: "Outcome was not provided.",
          value: null,
          source: "rule",
          fixable: true,
        });
      } else if (!OUTCOME_VALUES.has(row.outcome.toUpperCase())) {
        issues.push({
          row: rowNum,
          column: col("outcome"),
          severity: "MEDIUM",
          confidence: "HIGH",
          code: "UNRECOGNISED_OUTCOME_VALUE",
          message: `"${row.outcome}" is not a recognised outcome value.`,
          value: row.outcome,
          source: "rule",
          fixable: true,
        });
      } else if (
        row.outcome.toUpperCase() === "FATAL" &&
        row.seriousness &&
        NON_SERIOUS_VALUES.has(row.seriousness.toUpperCase())
      ) {
        issues.push({
          row: rowNum,
          column: col("seriousness"),
          severity: "HIGH",
          confidence: "HIGH",
          code: "FATAL_OUTCOME_NOT_MARKED_SERIOUS",
          message: "Outcome is fatal but seriousness is not marked serious.",
          value: row.seriousness,
          source: "rule",
          fixable: true,
        });
      }
    }

    if (mappedFields.has("serious_code") && row.seriousness) {
      const hasSeriousCode =
        !!row.serious_code && !["0", "none", "n/a", "-", "nil"].includes(row.serious_code.trim().toLowerCase());
      const isNonSerious = NON_SERIOUS_VALUES.has(row.seriousness.toUpperCase());
      const isSerious = SERIOUS_TEXT_VALUES.has(row.seriousness.toUpperCase());
      if (isNonSerious && hasSeriousCode) {
        issues.push({
          row: rowNum,
          column: col("serious_code"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "SERIOUSNESS_CONTRADICTION",
          message: `Row is marked non-serious but carries a serious-criteria code ("${row.serious_code}").`,
          value: row.serious_code ?? null,
          source: "rule",
          fixable: false,
        });
      } else if (isSerious && !hasSeriousCode) {
        issues.push({
          row: rowNum,
          column: col("serious_code"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "SERIOUSNESS_CONTRADICTION",
          message: "Row is marked serious but no serious-criteria code is recorded.",
          value: null,
          source: "rule",
          fixable: false,
        });
      }
    }

    if (mappedFields.has("reaction_code") && row.reaction_code) {
      const codes = row.reaction_code
        .split(/[,&]|\bAND\b/i)
        .map((c) => c.trim())
        .filter(Boolean);
      const invalid =
        codes.length === 0 ||
        codes.some((c) => !/^\d{1,2}$/.test(c) || Number(c) < 1 || Number(c) > 28);
      if (invalid) {
        issues.push({
          row: rowNum,
          column: col("reaction_code"),
          severity: "HIGH",
          confidence: "HIGH",
          code: "INVALID_REACTION_CODE",
          message: `"${row.reaction_code}" is not a valid AEFI reaction code (expected 1-28).`,
          value: row.reaction_code,
          source: "rule",
          fixable: false,
        });
      }
    }

    if (mappedFields.has("dose") && !row.dose) {
      issues.push({
        row: rowNum,
        column: col("dose"),
        severity: "CRITICAL",
        confidence: "HIGH",
        code: "MISSING_DOSE",
        message: "Dose was not provided.",
        value: null,
        source: "rule",
        fixable: true,
      });
    }

    if (mappedFields.has("vaccine_batch")) {
      const batch = (row.vaccine_batch ?? "").trim();
      if (!batch || BATCH_PLACEHOLDER_VALUES.has(batch.toUpperCase())) {
        issues.push({
          row: rowNum,
          column: col("vaccine_batch"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "MISSING_VACCINE_BATCH",
          message: "Vaccine batch/lot number was not provided.",
          value: row.vaccine_batch ?? null,
          source: "rule",
          fixable: true,
        });
      } else if (MULTI_VALUE_RE.test(batch)) {
        issues.push({
          row: rowNum,
          column: col("vaccine_batch"),
          severity: "MEDIUM",
          confidence: "HIGH",
          code: "MULTIPLE_BATCH_NUMBERS_IN_CELL",
          message: `"${batch}" appears to list multiple batch numbers in one cell — these should be separate rows.`,
          value: batch,
          source: "rule",
          fixable: false,
        });
      }
    }

    if (mappedFields.has("reporter_phone")) {
      const digits = (row.reporter_phone ?? "").replace(/\D/g, "");
      if (!row.reporter_phone) {
        issues.push({
          row: rowNum,
          column: col("reporter_phone"),
          severity: "HIGH",
          confidence: "HIGH",
          code: "MISSING_REPORTER_PHONE",
          message: "Reporter phone number was not provided.",
          value: null,
          source: "rule",
          fixable: true,
        });
      } else if (digits.length < 10 || digits.length > 14) {
        issues.push({
          row: rowNum,
          column: col("reporter_phone"),
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "INVALID_REPORTER_PHONE",
          message: `"${row.reporter_phone}" does not look like a valid phone number (expected 10-14 digits).`,
          value: row.reporter_phone,
          source: "rule",
          fixable: false,
        });
      }
    }

    if (row.case_id) {
      const firstRow = seenCaseIds.get(row.case_id);
      if (firstRow !== undefined) {
        issues.push({
          row: rowNum,
          column: col("case_id"),
          severity: "HIGH",
          confidence: "HIGH",
          code: "DUPLICATE_CASE_ID",
          message: `case_id "${row.case_id}" also appears on row ${firstRow}.`,
          value: row.case_id,
          source: "rule",
          fixable: false,
        });
      } else {
        seenCaseIds.set(row.case_id, rowNum);
      }
    }
  });

  issues.push(...checkCaseIdConsistency(rows, col("case_id")));

  return issues;
}

export const linelist = {
  jobs: async (): Promise<LineListJob[]> => {
    const { data, error } = await supabase.from("pv_linelist_jobs").select("data");
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((r) => r.data as unknown as LineListJob)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  },

  upload: async (file: File): Promise<LineListJob> => {
    const actor = currentActor();
    let job: LineListJobRow;

    try {
      const { headers, rows, warnings: parseWarnings } = await parseTabularFile(file);
      const mapping = mapColumns(headers);
      const parsedRows = toParsedRows(headers, rows, mapping);
      const rawRows = toRawRows(headers, rows);
      job = {
        id: newId("ll"),
        filename: file.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy: actor.name,
        rows: parsedRows.length,
        stage: "UPLOADED",
        validCases: 0,
        invalidCases: 0,
        warnings: 0,
        columns: headers,
        mapping,
        parsedRows,
        rawRows,
        parseWarnings,
      };
    } catch (err) {
      job = {
        id: newId("ll"),
        filename: file.name,
        uploadedAt: new Date().toISOString(),
        uploadedBy: actor.name,
        rows: 0,
        stage: "FAILED",
        validCases: 0,
        invalidCases: 0,
        warnings: 0,
      };
      const { error } = await supabase
        .from("pv_linelist_jobs")
        .insert({ id: job.id, data: toJson(job) });
      if (error) throw new Error(error.message);
      await supabase.from("pv_linelist_issues").insert({
        id: newId("lli"),
        job_id: job.id,
        data: toJson({
          row: 0,
          column: "(file)",
          severity: "CRITICAL",
          confidence: "HIGH",
          code: "UNREADABLE_FILE",
          message:
            err instanceof Error
              ? err.message
              : "The uploaded file could not be parsed as CSV or XLSX.",
          value: null,
          source: "rule",
          fixable: false,
        } satisfies LineListIssue),
      });
      await recordAudit({
        action: "LINELIST_UPLOADED",
        entity: "LineListJob",
        entityId: job.id,
        newValue: `${file.name} — could not be parsed`,
      });
      return job;
    }

    const { error } = await supabase
      .from("pv_linelist_jobs")
      .insert({ id: job.id, data: toJson(job) });
    if (error) throw new Error(error.message);
    const parseNote = job.parseWarnings?.length ? ` — ${job.parseWarnings.join(" ")}` : "";
    await recordAudit({
      action: "LINELIST_UPLOADED",
      entity: "LineListJob",
      entityId: job.id,
      newValue: `${file.name} (${job.rows} rows, ${Object.keys(job.mapping ?? {}).length}/${TARGET_FIELDS.length} canonical columns matched, ${job.columns?.length ?? 0} total columns retained)${parseNote}`,
    });
    return job;
  },

  inspect: async (jobId: string): Promise<ColumnInspection> => {
    const job = await readJob(jobId);
    const columns = job.columns ?? [];
    return {
      jobId,
      detectedColumns: columns.map((name) => ({
        name,
        sample: (job.parsedRows ?? [])
          .slice(0, 3)
          .map((r) => (job.mapping?.[name] ? (r[job.mapping[name]] ?? "") : "")),
        suggestedField: job.mapping?.[name] ?? null,
      })),
      targetFields: [...TARGET_FIELDS],
    };
  },

  map: async (jobId: string, mapping: Record<string, string>): Promise<LineListJob> => {
    const job = await readJob(jobId);
    await recordAudit({
      action: "LINELIST_MAPPED",
      entity: "LineListJob",
      entityId: jobId,
      newValue: Object.keys(mapping).join(", "),
    });
    return saveJob({ ...job, stage: "MAPPED", mapping: mapping as Record<string, TargetField> });
  },

  normalize: async (jobId: string): Promise<LineListJob> => {
    const job = await readJob(jobId);
    await recordAudit({ action: "LINELIST_NORMALISED", entity: "LineListJob", entityId: jobId });
    return saveJob({ ...job, stage: "NORMALISED" });
  },

  /**
   * OpenAI is the primary validation engine here: for a real upload, its
   * findings are requested and merged in alongside the deterministic rule
   * checks (which always run regardless, and are what's shown alone if AI
   * is unavailable, times out, or returns something unusable — see
   * src/server/routes/ai_linelist.py, which never lets that surface as an
   * error, only as ai_used: false). Each issue is tagged with its source
   * so the UI never presents the two as indistinguishable. The AI call
   * always gets every original column (rawRows) when the job has one, not
   * just the ones the deterministic matcher recognised — a column outside
   * the app's canonical field list is never invisible to the AI pass.
   */
  validate: async (
    jobId: string,
  ): Promise<{
    job: LineListJob;
    issues: LineListIssue[];
    aiUsed: boolean;
    aiError?: string | undefined;
  }> => {
    const job = await readJob(jobId);
    let issues: LineListIssue[];
    let aiUsed = false;
    let aiError: string | undefined;
    let promptVersion: string | undefined = job.promptVersion;

    if (job.parsedRows) {
      // Real upload — re-run validation against the actual parsed content
      // every time, so the result always reflects the current data.
      await supabase.from("pv_linelist_issues").delete().eq("job_id", jobId);
      // RULE_BASED_DETECTION_ENABLED gates the entire deterministic rule
      // engine (including its NO_COLUMNS_MAPPED short-circuit) — flip the
      // flag in feature-flags.ts to bring it back, rest of validate() is
      // unaffected either way.
      const ruleIssues = RULE_BASED_DETECTION_ENABLED
        ? runValidation(job.columns ?? [], job.mapping ?? {}, job.parsedRows)
        : [];

      const analysisRows = (job.rawRows ?? job.parsedRows) as Record<string, string>[];
      let aiIssues: LineListIssue[] = [];
      try {
        const analysis = await ai.linelist.analyze({
          headers: job.columns ?? [],
          mapping: job.mapping ?? {},
          rows: analysisRows,
        });
        aiUsed = analysis.ai_used;
        aiError = analysis.error ?? undefined;
        promptVersion = analysis.prompt_version;
        aiIssues = analysis.findings.map((f) => ({
          row: f.row,
          column: f.column,
          severity: f.severity,
          confidence: f.confidence,
          code: f.code,
          message: f.message,
          value: f.value,
          fixable: f.fixable,
          source: "ai" as const,
        }));
      } catch (err) {
        // The AI endpoint itself is unreachable (network/deploy issue,
        // not just "no key") — rule-based findings still stand alone.
        aiUsed = false;
        aiError = err instanceof Error ? err.message : "AI analysis unavailable.";
      }

      issues = [...ruleIssues, ...aiIssues];
      if (issues.length > 0) {
        const { error } = await supabase
          .from("pv_linelist_issues")
          .insert(issues.map((i) => ({ id: newId("lli"), job_id: jobId, data: toJson(i) })));
        if (error) throw new Error(error.message);
      }
    } else {
      // Legacy/seeded demo job with no stored raw parse — preserve its
      // existing issues rather than silently erasing them.
      issues = await linelist.issues(jobId);
    }

    // invalidCases/warnings keep their original two-bucket meaning
    // (CRITICAL|HIGH vs MEDIUM|LOW) for backward compatibility; the full
    // four-tier breakdown is additive on criticalCount..lowCount and in
    // the executive summary, not a replacement for these.
    const blocking = issues.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
    const advisory = issues.filter((i) => i.severity === "MEDIUM" || i.severity === "LOW");
    const invalidCases = new Set(blocking.map((i) => i.row)).size;
    const next: LineListJobRow = {
      ...job,
      stage: "VALIDATED",
      invalidCases,
      warnings: advisory.length,
      criticalCount: issues.filter((i) => i.severity === "CRITICAL").length,
      highCount: issues.filter((i) => i.severity === "HIGH").length,
      mediumCount: issues.filter((i) => i.severity === "MEDIUM").length,
      lowCount: issues.filter((i) => i.severity === "LOW").length,
      validCases: Math.max(job.rows - invalidCases, 0),
      validatedAt: new Date().toISOString(),
      promptVersion,
    };
    await saveJob(next);
    await recordAudit({
      action: "LINELIST_VALIDATED",
      entity: "LineListJob",
      entityId: jobId,
      newValue: `${next.validCases} valid / ${invalidCases} invalid / ${advisory.length} warning(s)${aiUsed ? (RULE_BASED_DETECTION_ENABLED ? " (AI + rule-based)" : " (AI only — rule-based detection disabled)") : RULE_BASED_DETECTION_ENABLED ? " (rule-based only)" : " (no detection engine available)"}`,
    });
    return { job: next, issues, aiUsed, aiError };
  },

  issues: async (jobId: string): Promise<LineListIssue[]> => {
    const { data, error } = await supabase
      .from("pv_linelist_issues")
      .select("data")
      .eq("job_id", jobId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.data as unknown as LineListIssue);
  },

  /**
   * Sends every currently-fixable issue OpenAI can safely auto-apply to
   * the fix endpoint, applies the corrections it can confidently make to
   * both the job's raw (original-column) and canonical parsed data,
   * persists that as the new active dataset (E2B, the CSV download, and
   * any later validation pass then see only the corrected data — there is
   * no separate "fixed copy"), and re-validates so the UI immediately
   * reflects what's actually resolved versus still outstanding.
   *
   * A LOW-confidence AI finding (an inferred column role, a typo/judgment
   * call — see the analysis prompt) is never auto-applied even if marked
   * fixable: it's held out and reported as unresolved, requiring a human
   * to decide either way, rather than either silently applying an
   * uncertain guess or silently dropping it. Never fabricates a value:
   * anything OpenAI can't safely determine is left unchanged and reported
   * as unresolved too.
   */
  fixIssues: async (
    jobId: string,
  ): Promise<{
    job: LineListJob;
    issues: LineListIssue[];
    correctionsApplied: number;
    unresolved: { row: number; column: string; reason: string }[];
    aiUsed: boolean;
    aiError?: string | undefined;
  }> => {
    const job = await readJob(jobId);
    if (!job.parsedRows || !job.columns || !job.mapping) {
      throw new Error(
        "This job has no stored row data to fix (it predates AI-assisted line-list processing).",
      );
    }
    const currentIssues = await linelist.issues(jobId);
    const allFixable = currentIssues.filter((i) => i.fixable);
    const autoFixable = allFixable.filter((i) => i.source !== "ai" || i.confidence !== "LOW");
    const needsReview = allFixable.filter((i) => i.source === "ai" && i.confidence === "LOW");
    const needsReviewUnresolved = needsReview.map((i) => ({
      row: i.row,
      column: i.column,
      reason: "Low-confidence AI finding — requires human review before an automatic fix is applied.",
    }));

    if (autoFixable.length === 0) {
      const revalidated = await linelist.validate(jobId);
      await saveJob({
        ...(await readJob(jobId)),
        lastFixCorrections: [],
        lastFixUnresolved: needsReviewUnresolved,
      });
      return { ...revalidated, correctionsApplied: 0, unresolved: needsReviewUnresolved, aiUsed: false };
    }

    const fixRows = (job.rawRows ?? job.parsedRows) as Record<string, string>[];
    const fixResult = await ai.linelist.fix({
      headers: job.columns,
      mapping: job.mapping,
      rows: fixRows,
      issues: autoFixable,
    });
    const combinedUnresolved = [...fixResult.unresolved, ...needsReviewUnresolved];

    if (fixResult.ai_used && fixResult.corrections.length > 0) {
      const parsedRows = [...job.parsedRows];
      const rawRows = job.rawRows ? [...job.rawRows] : undefined;
      for (const correction of fixResult.corrections) {
        const idx = correction.row - 1;
        if (idx < 0) continue;
        if (rawRows && idx < rawRows.length && correction.column in rawRows[idx]!) {
          rawRows[idx] = { ...rawRows[idx]!, [correction.column]: correction.new_value };
        }
        const canonicalField = job.mapping[correction.column];
        if (canonicalField && idx < parsedRows.length) {
          parsedRows[idx] = { ...parsedRows[idx], [canonicalField]: correction.new_value };
        }
      }
      await saveJob({
        ...job,
        parsedRows,
        ...(rawRows ? { rawRows } : {}),
        fixedAt: new Date().toISOString(),
        lastFixCorrections: fixResult.corrections,
        lastFixUnresolved: combinedUnresolved,
      });
      await recordAudit({
        action: "LINELIST_AI_FIX_APPLIED",
        entity: "LineListJob",
        entityId: jobId,
        newValue: `${fixResult.corrections.length} field(s) corrected, ${combinedUnresolved.length} left unresolved`,
        reason: `Prompt ${fixResult.prompt_version}`,
      });
    } else {
      await saveJob({ ...job, lastFixCorrections: [], lastFixUnresolved: combinedUnresolved });
    }

    const revalidated = await linelist.validate(jobId);
    return {
      ...revalidated,
      correctionsApplied: fixResult.ai_used ? fixResult.corrections.length : 0,
      unresolved: combinedUnresolved,
      aiUsed: fixResult.ai_used,
      aiError: fixResult.error ?? undefined,
    };
  },

  /**
   * Creates a new line-list processing job directly from case data already
   * known to the app (used by the Case workbench's line-list export)
   * rather than from an uploaded file. Starts at UPLOADED stage exactly
   * like a real upload, so it shows up in Processing jobs ready to be
   * validated the same way — column mapping is fixed and known up front
   * since these headers are generated, not parsed from an arbitrary file,
   * so there's no original file to preserve as rawRows.
   */
  createFromCases: async (rows: ParsedRow[], sourceLabel: string): Promise<LineListJob> => {
    const actor = currentActor();
    const columns = [
      "Case ID",
      "Patient Identifier",
      "Product",
      "Reaction",
      "Onset Date",
      "Seriousness",
      "Outcome",
    ];
    const mapping: Record<string, TargetField> = {
      "Case ID": "case_id",
      "Patient Identifier": "patient_identifier",
      Product: "product",
      Reaction: "reaction",
      "Onset Date": "onset_date",
      Seriousness: "seriousness",
      Outcome: "outcome",
    };
    const job: LineListJobRow = {
      id: newId("ll"),
      filename: sourceLabel,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor.name,
      rows: rows.length,
      stage: "UPLOADED",
      validCases: 0,
      invalidCases: 0,
      warnings: 0,
      columns,
      mapping,
      parsedRows: rows,
    };
    const { error } = await supabase
      .from("pv_linelist_jobs")
      .insert({ id: job.id, data: toJson(job) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "LINELIST_CREATED_FROM_CASES",
      entity: "LineListJob",
      entityId: job.id,
      newValue: `${sourceLabel} (${rows.length} case(s) exported from the case workbench)`,
    });
    return job;
  },

  /** Rebuilds a CSV from the job's current (possibly AI-corrected) data,
   *  preserving the original column headers and order, and triggers a
   *  browser download. Reads from rawRows when the job has one (a real
   *  upload) so every original column comes back with its real, current
   *  value — including any that were corrected but aren't one of the
   *  canonical fields — rather than the old behaviour of writing blanks
   *  for anything outside the canonical field list. Falls back to the
   *  canonical-field reconstruction only for jobs with no raw parse at
   *  all (createFromCases jobs), which is still correct for those since
   *  they were never built from an arbitrary uploaded file. */
  downloadCsv: async (jobId: string): Promise<void> => {
    const job = await readJob(jobId);
    if (!job.columns || (!job.rawRows && !(job.mapping && job.parsedRows))) {
      throw new Error("This job has no stored row data to export.");
    }
    const { columns } = job;
    const escapeCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = job.rawRows
      ? [
          columns.map(escapeCell).join(","),
          ...job.rawRows.map((row) => columns.map((header) => escapeCell(row[header] ?? "")).join(",")),
        ]
      : [
          columns.map(escapeCell).join(","),
          ...job.parsedRows!.map((row) =>
            columns
              .map((header) => {
                const field = job.mapping![header];
                return escapeCell(field ? (row[field] ?? "") : "");
              })
              .join(","),
          ),
        ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = job.filename.replace(/\.[^.]+$/, "") + "-fixed.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  /**
   * A deterministic, printable summary assembled entirely from data the
   * app already has (the job record and its persisted issues) — not a new
   * AI call, and not free-text AI prose. Every number in it is computed
   * fresh from the same `job`/`issues` the on-screen table shows, so it
   * can never drift from what's displayed, and it always reflects the
   * job's current post-fix state if "Run Full Fix" has been used.
   */
  downloadExecutiveSummary: async (jobId: string): Promise<void> => {
    const job = await readJob(jobId);
    const issues = await linelist.issues(jobId);

    const bySeverity = {
      CRITICAL: issues.filter((i) => i.severity === "CRITICAL").length,
      HIGH: issues.filter((i) => i.severity === "HIGH").length,
      MEDIUM: issues.filter((i) => i.severity === "MEDIUM").length,
      LOW: issues.filter((i) => i.severity === "LOW").length,
    };

    const byCode = new Map<string, LineListIssue[]>();
    for (const issue of issues) {
      const list = byCode.get(issue.code) ?? [];
      list.push(issue);
      byCode.set(issue.code, list);
    }
    const codeGroups = [...byCode.entries()].sort((a, b) => b[1].length - a[1].length);
    const duplicateGroups = issues.filter(
      (i) => i.code === "DUPLICATE_CASE_ID" || i.code === "CASE_ID_FORMAT_INCONSISTENT",
    );

    const lines: string[] = [];
    const rule = "-".repeat(60);
    lines.push("LINE-LIST EXECUTIVE SUMMARY");
    lines.push("=".repeat(60));
    lines.push(`File: ${job.filename}`);
    lines.push(`Uploaded by: ${job.uploadedBy} on ${job.uploadedAt.slice(0, 16).replace("T", " ")} UTC`);
    if (job.validatedAt) {
      lines.push(`Last validated: ${job.validatedAt.slice(0, 16).replace("T", " ")} UTC`);
    }
    if (job.promptVersion) lines.push(`AI prompt version: ${job.promptVersion}`);
    lines.push("");

    lines.push("TOTALS");
    lines.push(rule);
    lines.push(`Rows scanned: ${job.rows}`);
    lines.push(`Valid rows: ${job.validCases}`);
    lines.push(`Invalid rows: ${job.invalidCases}`);
    lines.push(`  Critical findings: ${bySeverity.CRITICAL}`);
    lines.push(`  High findings: ${bySeverity.HIGH}`);
    lines.push(`  Medium findings: ${bySeverity.MEDIUM}`);
    lines.push(`  Low findings: ${bySeverity.LOW}`);
    lines.push("");

    lines.push("ISSUES BY TYPE");
    lines.push(rule);
    if (codeGroups.length === 0) {
      lines.push("No issues found.");
    }
    for (const [code, group] of codeGroups) {
      lines.push(`${code} — ${group.length} occurrence(s), severity ${group[0]?.severity ?? "?"}`);
      for (const example of group.slice(0, 3)) {
        lines.push(`  Row ${example.row}, ${example.column}: ${example.message}`);
      }
    }
    lines.push("");

    if (duplicateGroups.length > 0) {
      lines.push("DUPLICATE / ID-FORMAT FLAGS (review — never removed automatically)");
      lines.push(rule);
      for (const d of duplicateGroups) {
        lines.push(`Row ${d.row}, ${d.column}: ${d.message}`);
      }
      lines.push("");
    }

    if (job.lastFixCorrections || job.lastFixUnresolved) {
      lines.push(
        `RUN FULL FIX${job.fixedAt ? ` — last applied ${job.fixedAt.slice(0, 16).replace("T", " ")} UTC` : ""}`,
      );
      lines.push(rule);
      const corrections = job.lastFixCorrections ?? [];
      const unresolved = job.lastFixUnresolved ?? [];
      if (corrections.length === 0 && unresolved.length === 0) {
        lines.push("No fix has been run on this job yet.");
      }
      for (const c of corrections) {
        lines.push(`CORRECTED — Row ${c.row}, ${c.column}: "${c.new_value}" (${c.reason})`);
      }
      for (const u of unresolved) {
        lines.push(`UNRESOLVED — Row ${u.row}, ${u.column}: ${u.reason}`);
      }
      lines.push("");
    }

    lines.push("RECOMMENDATIONS");
    lines.push(rule);
    const top3 = codeGroups.slice(0, 3);
    if (top3.length === 0) {
      lines.push("No recurring issues detected — no specific recommendation.");
    } else {
      top3.forEach(([code, group], i) => {
        lines.push(
          `${i + 1}. ${group.length} row(s) flagged for ${code.replaceAll("_", " ").toLowerCase()} — review and reinforce reporting guidance for this field.`,
        );
      });
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = job.filename.replace(/\.[^.]+$/, "") + "-executive-summary.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};
