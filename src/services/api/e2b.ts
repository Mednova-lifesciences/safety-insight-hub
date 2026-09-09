import { supabase } from "@/integrations/supabase/client";
import { currentActor, recordAudit, toJson } from "./db";
import type { LineListJob } from "@/types/pv";

export interface E2bReadiness {
  jobId: string;
  caseCount: number;
  validCases: number;
  invalidCases: number;
  warnings: number;
  readyForExport: boolean;
  blockingIssues: string[];
  /** True when invalidCases > 0 but a reviewer explicitly dismissed the
   *  export gate — readyForExport is true despite outstanding issues. */
  overridden: boolean;
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
  sex?: string;
  age?: string;
  vaccination_date?: string;
  reaction_code?: string;
  serious_code?: string;
  vaccine_batch?: string;
  dose?: string;
  reporter_designation?: string;
  reporter_phone?: string;
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
  const overridden = job.invalidCases > 0 && !!job.e2bOverride;
  if (job.invalidCases > 0 && !job.e2bOverride) {
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
    overridden,
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

/** "ADEBOLA ESTHER" -> "A.E." — the E2B(R3) patientinitials element is
 *  specifically pseudonymised initials, never a real name. Any value that
 *  doesn't look like a full name (already just initials, a single token,
 *  empty) passes through unchanged rather than being mangled. */
function deriveInitials(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return trimmed.toUpperCase();
  return parts.map((p) => p[0]!.toUpperCase()).join(".") + ".";
}

/** Parses the common date shapes real AEFI/line-list exports actually use
 *  (dd/mm/yy, dd/mm/yyyy, yyyy-mm-dd, and their "-" variants) into E2B's
 *  required YYYYMMDD numeric form. Returns null rather than a guess when
 *  the format can't be confidently determined — an omitted date element is
 *  correct E2B; a wrong one is not. */
function formatE2bDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v); // yyyy-mm-dd
  if (m) return `${m[1]}${m[2]!.padStart(2, "0")}${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(v); // dd/mm/yy(yy)
  if (m) {
    let year = m[3]!;
    if (year.length === 2) year = (Number(year) < 50 ? "20" : "19") + year;
    return `${year}${m[2]!.padStart(2, "0")}${m[1]!.padStart(2, "0")}`;
  }
  return null;
}

/** E2B(R3) patientsex code list: 1=Male, 2=Female. Returns null (element
 *  omitted) for anything not confidently one of those two — never guesses. */
function mapSex(raw: string | undefined): "1" | "2" | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "M" || v === "MALE") return "1";
  if (v === "F" || v === "FEMALE") return "2";
  return null;
}

/** E2B(R3) top-level seriousness flag: 1=Serious, 2=Not serious. Reuses the
 *  exact same source vocabulary the line-list validator already normalises
 *  against (see normalizeSeriousness in linelist.ts), so this only ever
 *  fires on a value already known to mean one or the other — a raw,
 *  un-normalised code (e.g. an AEFI form's own numeric serious_code) is
 *  left out rather than guessed. */
function mapSeriousness(raw: string | undefined): "1" | "2" | null {
  const v = (raw ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (v === "SERIOUS" || v === "YES" || v === "Y") return "1";
  if (v === "NONSERIOUS" || v === "NO" || v === "N") return "2";
  return null;
}

/** E2B(R3) reactionoutcome code list: 1=Recovered/resolved,
 *  2=Recovering/resolving, 3=Not recovered/not resolved,
 *  4=Recovered with sequelae, 5=Fatal, 6=Unknown. Only matches the
 *  already-normalised text values this app's own line-list outcome field
 *  uses (see OUTCOME_VALUES in linelist.ts) — a raw, un-decoded source
 *  code (e.g. a bare "1" from the original form, which is NOT this code
 *  list) is left as verbatim text instead of silently re-interpreted
 *  under a different code list than it actually belongs to. */
function mapOutcome(raw: string | undefined): "1" | "2" | "3" | "4" | "5" | "6" | null {
  const v = (raw ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
  switch (v) {
    case "RECOVERED":
    case "RESOLVED":
      return "1";
    case "RECOVERING":
    case "RESOLVING":
      return "2";
    case "NOTRECOVERED":
    case "NOTRESOLVED":
      return "3";
    case "RECOVEREDWITHSEQUELAE":
      return "4";
    case "FATAL":
      return "5";
    case "UNKNOWN":
      return "6";
    default:
      return null;
  }
}

function xmlEl(tag: string, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `      <${tag}>${escapeXml(value)}</${tag}>\n`;
}

/**
 * Builds an E2B(R3)-shaped ICSR XML from the job's actual parsed line-list
 * rows when they're available (real uploads always have them).
 *
 * Every value here is either real captured data or a fixed structural
 * constant (safetyreportversion, drugcharacterization for a vaccine/AEFI
 * row) — nothing is invented. Two categories of real E2B(R3) fields are
 * deliberately left out rather than guessed at:
 *   - Reaction/drug TERMS stay verbatim text. Real MedDRA/WHODrug coding
 *     requires a licensed dictionary this product does not have access to;
 *     a fabricated code would misrepresent the report as coded when it
 *     isn't, which is worse than an honest verbatim term.
 *   - Any field whose only source is a raw, un-decoded numeric code from
 *     the original AEFI form's own legend (reaction_code, serious_code,
 *     and any outcome/age value that isn't already one of this app's own
 *     normalised words) is carried through as-is with an explicit
 *     "codingstatus" marker rather than silently assigned a meaning under
 *     a different code list (E2B's) than the one it actually belongs to.
 *
 * This is still, honestly, a preparation draft: real submission requires
 * a validated regulatory gateway this product does not perform. See the
 * DEMO/SANDBOX comment in the file itself. Legacy jobs seeded without
 * stored row data fall back to a summary-only report.
 */
function buildE2bXml(job: LineListJobRow, artifactId: string, generatedAt: string): string {
  const messageDate = generatedAt.replace(/[-:]/g, "").slice(0, 14);
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  DEMO/SANDBOX OUTPUT — MedNova PV Assist
  This is a structural E2B(R3) preparation draft generated from line-list
  processing results. Every value is real captured data (nothing is
  fabricated), but reaction/drug terms are verbatim text, NOT coded
  against a licensed MedDRA/WHODrug dictionary, and this is NOT a
  submission-ready regulatory file. Regulatory transmission requires a
  separately validated gateway integration. Elements with a
  codingstatus="RAW_SOURCE_CODE_UNMAPPED" attribute carry a real value
  from the source form's own numeric code legend, not yet decoded to
  text — check the original form's key before relying on that value.
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
      const sexCode = mapSex(row.sex);
      const reactionStart = formatE2bDate(row.onset_date);
      const drugStart = formatE2bDate(row.vaccination_date);
      const seriousCode = mapSeriousness(row.seriousness);
      const outcomeCode = mapOutcome(row.outcome);

      // Raw AEFI-form numeric codes (no licensed dictionary, no local
      // legend available) — kept, but explicitly marked as unmapped
      // rather than presented as if they were already-coded terms.
      const rawCodeAttrs = ' codingstatus="RAW_SOURCE_CODE_UNMAPPED"';
      const reactionCodeEl = row.reaction_code
        ? `      <reactionmeddrapt_sourcecode${rawCodeAttrs}>${escapeXml(row.reaction_code)}</reactionmeddrapt_sourcecode>\n`
        : "";
      const seriousSourceCodeEl =
        row.serious_code && !seriousCode
          ? `    <serious_sourcecode${rawCodeAttrs}>${escapeXml(row.serious_code)}</serious_sourcecode>\n`
          : "";
      // outcome only falls back to a raw/verbatim element when it isn't
      // one of this app's own normalised outcome words — see mapOutcome.
      const outcomeVerbatimEl = !outcomeCode
        ? xmlEl("reactionoutcome_verbatim", row.outcome)
        : "";

      return `  <safetyreport>
    <safetyreportversion>1</safetyreportversion>
    <safetyreportid>${safetyReportId}</safetyreportid>
    <sourcejobid>${escapeXml(job.id)}</sourcejobid>
    <primarysource>
${row.reporter_designation ? `      <reporterqualification_verbatim>${escapeXml(row.reporter_designation)}</reporterqualification_verbatim>\n` : ""}${xmlEl("reportertel", row.reporter_phone)}    </primarysource>
    <patient>
      <patientinitials>${escapeXml(deriveInitials(row.patient_identifier ?? ""))}</patientinitials>
${sexCode ? `      <patientsex>${sexCode}</patientsex>\n` : ""}${row.age ? `      <patientonsetage codingstatus="UNIT_NOT_CONFIRMED">${escapeXml(row.age)}</patientonsetage>\n` : ""}    </patient>
    <drug>
      <drugcharacterization>1</drugcharacterization>
      <medicinalproduct>${escapeXml(row.product ?? "")}</medicinalproduct>
${xmlEl("drugbatchnumb", row.vaccine_batch)}${xmlEl("drugdosagetext", row.dose)}${drugStart ? `      <drugstartdate>${drugStart}</drugstartdate>\n      <drugstartdateformat>102</drugstartdateformat>\n` : ""}    </drug>
    <reaction>
      <reactionmeddrapt_verbatim>${escapeXml(row.reaction ?? "")}</reactionmeddrapt_verbatim>
${reactionCodeEl}${reactionStart ? `      <reactionstartdate>${reactionStart}</reactionstartdate>\n      <reactionstartdateformat>102</reactionstartdateformat>\n` : ""}${outcomeCode ? `      <reactionoutcome>${outcomeCode}</reactionoutcome>\n` : ""}${outcomeVerbatimEl}    </reaction>
${seriousCode ? `    <serious>${seriousCode}</serious>\n` : xmlEl("serious_verbatim", row.seriousness)}${seriousSourceCodeEl}    <preparedby>SafetyCore MVP — preparation draft, not submission-ready</preparedby>
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

  /**
   * Records an explicit human override of the "no outstanding errors" gate
   * on E2B(R3) generation — for situations where the remaining line-list
   * findings are judged intentional or incorrect for this dataset, not
   * because the data actually changed. Never clears invalidCases or the
   * underlying issues (they stay exactly as-is on the line-list page);
   * only this job's export gate is bypassed, and the override is written
   * to the audit trail (who, when) like every other consequential decision
   * in this app. The caller (the E2B page) is responsible for confirming
   * with the user before calling this — it takes effect immediately.
   */
  dismissErrors: async (jobId: string): Promise<LineListJob> => {
    const job = await readJob(jobId);
    const actor = currentActor();
    const nextJob: LineListJobRow = {
      ...job,
      e2bOverride: { by: actor.name, at: new Date().toISOString() },
    };
    const { error } = await supabase
      .from("pv_linelist_jobs")
      .update({ data: toJson(nextJob) })
      .eq("id", jobId);
    if (error) throw new Error(error.message);

    await recordAudit({
      action: "E2B_ERRORS_OVERRIDDEN",
      entity: "LineListJob",
      entityId: jobId,
      newValue: `${job.invalidCases} invalid case(s) dismissed for export by ${actor.name}`,
    });

    return nextJob;
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
