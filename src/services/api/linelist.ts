import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
import { mapColumnsByKeywords, parseTabularFile } from "./tabular-parse";
import type { LineListIssue, LineListJob } from "@/types/pv";

export interface ColumnInspection {
  jobId: string;
  detectedColumns: { name: string; sample: string[]; suggestedField: string | null }[];
  targetFields: string[];
}

const TARGET_FIELDS = [
  "case_id",
  "patient_identifier",
  "product",
  "reaction",
  "onset_date",
  "seriousness",
  "outcome",
] as const;
type TargetField = (typeof TARGET_FIELDS)[number];

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

/** A parsed, column-mapped row from an uploaded file — the input to validation. */
type ParsedRow = Partial<Record<TargetField, string>>;

/** Extends the public LineListJob shape with the raw parse the job was
 *  built from, so validation can run against real content. Legacy/demo
 *  jobs seeded directly in the database won't have this — validate()
 *  falls back to their pre-existing issues rather than erasing them. */
interface LineListJobRow extends LineListJob {
  columns?: string[];
  mapping?: Record<string, TargetField>;
  parsedRows?: ParsedRow[];
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
const FIELD_KEYWORDS: Record<TargetField, [string, number][]> = {
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
    ["medicinalproduct", 85],
    ["product", 25],
    ["drug", 20],
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{1,2}-\d{1,2}-\d{2,4}$/;

/** Deterministic, rule-based validation — no AI involved. Every uploaded
 *  file gets the same checks run against its actual mapped content. */
function runValidation(
  headers: string[],
  mapping: Record<string, TargetField>,
  rows: ParsedRow[],
): LineListIssue[] {
  const issues: LineListIssue[] = [];

  if (Object.keys(mapping).length === 0 && rows.length > 0) {
    issues.push({
      row: 0,
      column: "(all columns)",
      severity: "ERROR",
      code: "NO_COLUMNS_MAPPED",
      message: `None of the columns (${headers.join(", ")}) could be automatically matched to an expected field (${TARGET_FIELDS.join(", ")}). Manual column mapping is required before this file can be validated.`,
      value: null,
    });
    return issues;
  }

  const seenCaseIds = new Map<string, number>();

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;

    (["patient_identifier", "product", "reaction"] as const).forEach((field) => {
      if (!row[field]) {
        issues.push({
          row: rowNum,
          column: field,
          severity: "ERROR",
          code: `MISSING_${field.toUpperCase()}`,
          message: `${field.replaceAll("_", " ")} is required.`,
          value: null,
        });
      }
    });

    if (!row.onset_date) {
      issues.push({
        row: rowNum,
        column: "onset_date",
        severity: "WARNING",
        code: "MISSING_ONSET_DATE",
        message: "Onset date was not provided.",
        value: null,
      });
    } else if (!DATE_RE.test(row.onset_date)) {
      issues.push({
        row: rowNum,
        column: "onset_date",
        severity: "ERROR",
        code: "INVALID_DATE_FORMAT",
        message: `"${row.onset_date}" does not look like a valid date (expected YYYY-MM-DD or similar).`,
        value: row.onset_date,
      });
    }

    if (row.seriousness && !SERIOUSNESS_VALUES.has(row.seriousness.toUpperCase())) {
      issues.push({
        row: rowNum,
        column: "seriousness",
        severity: "WARNING",
        code: "UNRECOGNISED_SERIOUSNESS_VALUE",
        message: `"${row.seriousness}" is not a recognised seriousness value (expected SERIOUS or NON_SERIOUS).`,
        value: row.seriousness,
      });
    }

    if (row.outcome && !OUTCOME_VALUES.has(row.outcome.toUpperCase())) {
      issues.push({
        row: rowNum,
        column: "outcome",
        severity: "WARNING",
        code: "UNRECOGNISED_OUTCOME_VALUE",
        message: `"${row.outcome}" is not a recognised outcome value.`,
        value: row.outcome,
      });
    }

    if (row.case_id) {
      const firstRow = seenCaseIds.get(row.case_id);
      if (firstRow !== undefined) {
        issues.push({
          row: rowNum,
          column: "case_id",
          severity: "WARNING",
          code: "DUPLICATE_CASE_ID",
          message: `case_id "${row.case_id}" also appears on row ${firstRow}.`,
          value: row.case_id,
        });
      } else {
        seenCaseIds.set(row.case_id, rowNum);
      }
    }
  });

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
      const { headers, rows } = await parseTabularFile(file);
      const mapping = mapColumns(headers);
      const parsedRows = toParsedRows(headers, rows, mapping);
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
          severity: "ERROR",
          code: "UNREADABLE_FILE",
          message:
            err instanceof Error
              ? err.message
              : "The uploaded file could not be parsed as CSV or XLSX.",
          value: null,
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
    await recordAudit({
      action: "LINELIST_UPLOADED",
      entity: "LineListJob",
      entityId: job.id,
      newValue: `${file.name} (${job.rows} rows, ${Object.keys(job.mapping ?? {}).length}/${TARGET_FIELDS.length} columns matched)`,
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

  validate: async (jobId: string): Promise<{ job: LineListJob; issues: LineListIssue[] }> => {
    const job = await readJob(jobId);
    let issues: LineListIssue[];

    if (job.parsedRows) {
      // Real upload — re-run validation against the actual parsed content
      // every time, so the result always reflects the current data.
      await supabase.from("pv_linelist_issues").delete().eq("job_id", jobId);
      issues = runValidation(job.columns ?? [], job.mapping ?? {}, job.parsedRows);
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

    const errors = issues.filter((i) => i.severity === "ERROR");
    const warnings = issues.filter((i) => i.severity === "WARNING");
    const invalidCases = new Set(errors.map((i) => i.row)).size;
    const next: LineListJobRow = {
      ...job,
      stage: "VALIDATED",
      invalidCases,
      warnings: warnings.length,
      validCases: Math.max(job.rows - invalidCases, 0),
    };
    await saveJob(next);
    await recordAudit({
      action: "LINELIST_VALIDATED",
      entity: "LineListJob",
      entityId: jobId,
      newValue: `${next.validCases} valid / ${invalidCases} invalid / ${warnings.length} warning(s)`,
    });
    return { job: next, issues };
  },

  issues: async (jobId: string): Promise<LineListIssue[]> => {
    const { data, error } = await supabase
      .from("pv_linelist_issues")
      .select("data")
      .eq("job_id", jobId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.data as unknown as LineListIssue);
  },
};
