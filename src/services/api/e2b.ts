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

interface LineListJobRow extends LineListJob {
  e2bArtifact?: E2bArtifact;
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

/**
 * Builds an E2B(R3)-shaped ICSR XML skeleton from what's actually known
 * about the job at this stage of the MVP (no licensed MedDRA/WHODrug coding
 * or field-level case data is wired in yet). This is explicitly a
 * preparation artifact — see the DEMO/SANDBOX comment in the file itself —
 * not a submission-ready regulatory file, matching the product's own
 * "prepares and generates, does not transmit" description on this page.
 */
function buildE2bXml(job: LineListJobRow, artifactId: string, generatedAt: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  DEMO/SANDBOX OUTPUT — MedNova PV Assist
  This is a structural E2B(R3) preparation draft generated from line-list
  processing results. It is NOT validated against a licensed MedDRA/WHODrug
  dictionary and is NOT a submission-ready regulatory file. Regulatory
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
    <messagedate>${generatedAt.replace(/[-:]/g, "").slice(0, 14)}</messagedate>
  </ichicsrmessageheader>
  <safetyreport>
    <sourcejobid>${job.id}</sourcejobid>
    <sourcefilename>${job.filename}</sourcefilename>
    <casecount>${job.rows}</casecount>
    <validcasecount>${job.validCases}</validcasecount>
    <invalidcasecount>${job.invalidCases}</invalidcasecount>
    <preparedby>SafetyCore MVP — preparation draft, not submission-ready</preparedby>
  </safetyreport>
</ichicsr>
`;
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
