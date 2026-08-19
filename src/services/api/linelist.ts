import { supabase } from "@/integrations/supabase/client";
import { currentActor, newId, recordAudit, toJson } from "./db";
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
];

async function readJob(jobId: string): Promise<LineListJob> {
  const { data, error } = await supabase
    .from("pv_linelist_jobs")
    .select("data")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Line-list job not found");
  return data.data as unknown as LineListJob;
}

async function saveJob(job: LineListJob): Promise<LineListJob> {
  const { error } = await supabase
    .from("pv_linelist_jobs")
    .update({ data: toJson(job) })
    .eq("id", job.id);
  if (error) throw new Error(error.message);
  return job;
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
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const rows = Math.max(lines.length - 1, 0);
    const job: LineListJob = {
      id: newId("ll"),
      filename: file.name,
      uploadedAt: new Date().toISOString(),
      uploadedBy: currentActor().name,
      rows,
      stage: "UPLOADED",
      validCases: 0,
      invalidCases: 0,
      warnings: 0,
    };
    const { error } = await supabase
      .from("pv_linelist_jobs")
      .insert({ id: job.id, data: toJson(job) });
    if (error) throw new Error(error.message);
    await recordAudit({
      action: "LINELIST_UPLOADED",
      entity: "LineListJob",
      entityId: job.id,
      newValue: `${file.name} (${rows} rows)`,
    });
    return job;
  },

  inspect: async (jobId: string): Promise<ColumnInspection> => {
    const issues = await linelist.issues(jobId);
    const columns = Array.from(new Set(issues.map((i) => i.column)));
    return {
      jobId,
      detectedColumns: columns.map((name) => ({
        name,
        sample: issues.filter((i) => i.column === name).map((i) => i.value ?? "").slice(0, 3),
        suggestedField: TARGET_FIELDS.find((f) => name.toLowerCase().includes(f.split("_")[0]!)) ?? null,
      })),
      targetFields: TARGET_FIELDS,
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
    return saveJob({ ...job, stage: "MAPPED" });
  },

  normalize: async (jobId: string): Promise<LineListJob> => {
    const job = await readJob(jobId);
    await recordAudit({ action: "LINELIST_NORMALISED", entity: "LineListJob", entityId: jobId });
    return saveJob({ ...job, stage: "NORMALISED" });
  },

  validate: async (jobId: string): Promise<{ job: LineListJob; issues: LineListIssue[] }> => {
    const job = await readJob(jobId);
    const issues = await linelist.issues(jobId);
    const errors = issues.filter((i) => i.severity === "ERROR");
    const warnings = issues.filter((i) => i.severity === "WARNING");
    const invalidCases = new Set(errors.map((i) => i.row)).size;
    const next: LineListJob = {
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
      newValue: `${next.validCases} valid / ${invalidCases} invalid`,
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
