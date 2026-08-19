import { supabase } from "@/integrations/supabase/client";
import { recordAudit, toJson } from "./db";
import type { LineListJob } from "@/types/pv";

export interface E2bReadiness {
  jobId: string;
  caseCount: number;
  validCases: number;
  invalidCases: number;
  warnings: number;
  readyForExport: boolean;
  blockingIssues: string[];
  schema: string;
}

export interface E2bArtifact {
  jobId: string;
  artifactId: string;
  filename: string;
  generatedAt: string;
  caseCount: number;
  /** Prepared file only. Regulatory transmission requires a separate,
   *  validated gateway integration that this product does not perform. */
  transmitted: false;
  xml: string;
}

interface ParsedRow {
  case_id?: string;
  patient_identifier?: string;
  product?: string;
  reaction?: string;
  onset_date?: string;
  seriousness?: string;
  outcome?: string;
}

interface LineListJobRow extends LineListJob {
  e2bArtifact?: E2bArtifact;
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

function buildReadiness(job: LineListJobRow): E2bReadiness {
  const blockingIssues: string[] = [];
  if (job.stage !== "VALIDATED" && job.stage !== "E2B_GENERATED") {
    blockingIssues.push("Line-list validation has not completed for this job.");
  }
  if (job.invalidCases > 0) {
    blockingIssues.push(`${job.invalidCases} invalid case(s) must be resolved before export.`);
  }
  return {
    jobId: job.id,
    caseCount: job.rows,
    validCases: job.validCases,
    invalidCases: job.invalidCases,
    warnings: job.warnings,
    readyForExport: blockingIssues.length === 0,
    blockingIssues,
    schema: "ICH E2B(R3) ICSR — preparation draft",
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds an E2B(R3)-shaped ICSR XML from the job's actual parsed line-list
 * rows when they're available (real uploads always have them). Field
 * values are real, not fabricated — but this is still explicitly a
 * preparation artifact (see the DEMO/SANDBOX comment in the file itself):
 * reaction/drug terms here are verbatim text, not coded against a licensed
 * MedDRA/WHODrug dictionary, and this is NOT a submission-ready regulatory
 * file. Legacy jobs seeded without stored row data fall back to a
 * summary-only report.
 */
function buildE2bXml(job: LineListJobRow, artifactId: string, generatedAt: string): string {
  const messageDate = generatedAt.replace(/[-:]/g, "").slice(0, 14);
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  DEMO/SANDBOX OUTPUT — MedNova PV Assist
  This is a structural E2B(R3) preparation draft generated from line-list
  processing results. Reaction and drug terms are verbatim text from the
  source file, NOT validated against a licensed MedDRA/WHODrug dictionary,
  and this is NOT a submission-ready regulatory file. Regulatory
  transmission requires a separately validated gateway integration.
-->
<ichicsr lang="en">
  <ichicsrmessageheader>
    <messagetype>ichicsr</messagetype>
    <messageformatversion>2.1</messageformatversion>
    <messageformatrelease>R3</messageformatrelease>
    <messagenumb>${artifactId}</messagenumb>
    <messagesenderidentifier>MedNova PV Assist</messagesenderidentifier>
    <messagedateformat>204</messagedateformat>
    <messagedate>${messageDate}</messagedate>
  </ichicsrmessageheader>`;

  const footer = `</ichicsr>\n`;

  if (!job.parsedRows || job.parsedRows.length === 0) {
    return `${header}
  <safetyreport>
    <sourcejobid>${escapeXml(job.id)}</sourcejobid>
    <sourcefilename>${escapeXml(job.filename)}</sourcefilename>
    <casecount>${job.rows}</casecount>
    <validcasecount>${job.validCases}</validcasecount>
    <invalidcasecount>${job.invalidCases}</invalidcasecount>
    <preparedby>SafetyCore MVP — preparation draft, not submission-ready</preparedby>
  </safetyreport>
${footer}`;
  }

  const reports = job.parsedRows
    .map((row, i) => {
      const safetyReportId = escapeXml(row.case_id || `${job.id}-${i + 1}`);
      return `  <safetyreport>
    <safetyreportid>${safetyReportId}</safetyreportid>
    <sourcejobid>${escapeXml(job.id)}</sourcejobid>
    <patient>
      <patientinitials>${escapeXml(row.patient_identifier ?? "")}</patientinitials>
    </patient>
    <drug>
      <medicinalproduct>${escapeXml(row.product ?? "")}</medicinalproduct>
    </drug>
    <reaction>
      <reactionmeddrapt_verbatim>${escapeXml(row.reaction ?? "")}</reactionmeddrapt_verbatim>
      <reactionstartdate>${escapeXml(row.onset_date ?? "")}</reactionstartdate>
      <reactionoutcome_verbatim>${escapeXml(row.outcome ?? "")}</reactionoutcome_verbatim>
    </reaction>
    <serious_verbatim>${escapeXml(row.seriousness ?? "")}</serious_verbatim>
    <preparedby>SafetyCore MVP — preparation draft, not submission-ready</preparedby>
  </safetyreport>`;
    })
    .join("\n");

  return `${header}
${reports}
${footer}`;
}

export const e2b = {
  readiness: async (jobId: string): Promise<E2bReadiness> => {
    const job = await readJob(jobId);
    return buildReadiness(job);
  },

  generate: async (jobId: string): Promise<E2bArtifact> => {
    const job = await readJob(jobId);
    const readiness = buildReadiness(job);
    if (!readiness.readyForExport) {
      throw new Error(readiness.blockingIssues.join(" "));
    }

    const artifactId = `e2b-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const generatedAt = new Date().toISOString();
    const artifact: E2bArtifact = {
      jobId,
      artifactId,
      filename: `${job.filename.replace(/\.[^.]+$/, "")}-e2b-${artifactId}.xml`,
      generatedAt,
      caseCount: job.rows,
      transmitted: false,
      xml: buildE2bXml(job, artifactId, generatedAt),
    };

    const nextJob: LineListJobRow = { ...job, stage: "E2B_GENERATED", e2bArtifact: artifact };
    const { error } = await supabase
      .from("pv_linelist_jobs")
      .update({ data: toJson(nextJob) })
      .eq("id", jobId);
    if (error) throw new Error(error.message);

    await recordAudit({
      action: "E2B_GENERATED",
      entity: "LineListJob",
      entityId: jobId,
      newValue: `${artifact.filename} (${artifact.caseCount} cases, not transmitted)`,
    });

    return artifact;
  },

  /** Triggers a browser download of the most recently generated artifact for a job. */
  download: async (jobId: string): Promise<void> => {
    const job = await readJob(jobId);
    if (!job.e2bArtifact)
      throw new Error("No E2B(R3) artifact has been generated for this job yet.");
    const blob = new Blob([job.e2bArtifact.xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = job.e2bArtifact.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};
