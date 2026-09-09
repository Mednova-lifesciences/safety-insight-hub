import { readJob, type ParsedRow } from "@/services/api/e2b";
import { currentActor, recordAudit } from "@/services/api/db";
import { mapRowToPVCase, type MappingConfig, type MappingWarning } from "./mapping";
import { runPreflight, validateBusinessRules, type PreflightSummary, type ValidationError } from "./validation";
import { splitIntoBatches, batchFilename } from "./batching";
import { serializeBatchToXml } from "./serializer";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import {
  isTransmissionConfigConfirmed,
  describeUnconfirmedTransmissionConfig,
  type E2bTransmissionConfig,
} from "./transmission-config";
import type { PVCase } from "./types";

/**
 * The real, validated E2B(R3) pipeline for one line-list job — as opposed
 * to src/services/api/e2b.ts's legacy preview-draft generator. Runs the
 * actual normalize -> map -> validate -> batch -> serialize chain this
 * module was built for, using whatever mapping decisions (D2 reporter
 * qualification, D3 report type, D4 sender/receiver identifiers) have
 * actually been configured via transmission-config.ts — an unconfirmed
 * config is not a bug, it's today's honest state: those decisions haven't
 * been made yet (see docs/E2B-R3-NAFDAC-VIGIFLOW.md).
 */
export interface ValidatedExportResult {
  jobId: string;
  totalCases: number;
  cases: PVCase[];
  businessRuleErrors: ValidationError[];
  preflight: PreflightSummary;
  mappingWarnings: MappingWarning[];
  /** True only when every case passed both business-rule and VigiFlow
   *  preflight validation — the sole condition under which a caller may
   *  offer a download. Never inferred any other way. */
  readyForValidatedExport: boolean;
  /** True only when transmission-config.ts's sender/receiver identifiers
   *  have actually been confirmed (not the unconfirmed sentinel). A
   *  result can be readyForValidatedExport:true on every VigiFlow check
   *  and still not be transmittable, if this is false — technical
   *  validity and configuration completeness are checked separately, on
   *  purpose, so a caller can't accidentally treat one as proof of the
   *  other. */
  transmissionConfigConfirmed: boolean;
  transmissionConfigGaps: string[];
}

function toMappingConfig(config: E2bTransmissionConfig): MappingConfig {
  return {
    reportType: config.reportType,
    senderOrganisation: config.senderOrganisation,
    reporterQualificationMap: config.reporterQualificationMap,
  };
}

export async function runValidatedPreflightForJob(
  jobId: string,
  transmissionConfig: E2bTransmissionConfig,
): Promise<ValidatedExportResult> {
  const job = await readJob(jobId);
  const rows: ParsedRow[] = job.parsedRows ?? [];
  const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };
  const processedAt = new Date().toISOString();
  const mappingConfig = toMappingConfig(transmissionConfig);

  const cases: PVCase[] = [];
  const mappingWarnings: MappingWarning[] = [];
  for (let i = 0; i < rows.length; i++) {
    const { pvCase, warnings } = await mapRowToPVCase(
      rows[i]!,
      { jobId, sourceFile: job.filename, sourceRow: i + 1, processedAt },
      providers,
      mappingConfig,
    );
    cases.push(pvCase);
    mappingWarnings.push(...warnings);
  }

  const businessRuleErrors = cases.flatMap((c) => validateBusinessRules(c));
  const preflight = runPreflight(cases);
  const readyForValidatedExport = preflight.status === "READY_FOR_VALIDATED_IMPORT";

  const actor = currentActor();
  await recordAudit({
    action: readyForValidatedExport ? "E2B_R3_PREFLIGHT_PASSED" : "E2B_R3_PREFLIGHT_BLOCKED",
    entity: "LineListJob",
    entityId: jobId,
    newValue: `${preflight.readyCases}/${preflight.totalCases} case(s) ready for validated import, run by ${actor.name}`,
  });

  return {
    jobId,
    totalCases: cases.length,
    cases,
    businessRuleErrors,
    preflight,
    mappingWarnings,
    readyForValidatedExport,
    transmissionConfigConfirmed: isTransmissionConfigConfirmed(transmissionConfig),
    transmissionConfigGaps: describeUnconfirmedTransmissionConfig(transmissionConfig),
  };
}

export interface ValidatedBatchArtifact {
  filename: string;
  xml: string;
  caseCount: number;
}

/**
 * Serializes real E2B(R3) XML for a job — but ONLY when every case in it
 * has already passed VigiFlow preflight AND the transmission config has
 * actually been confirmed (not the unconfirmed sentinel from
 * transmission-config.ts). This is the fail-closed gate the audit
 * demanded: a blocked case, or an unconfirmed sender/receiver identifier,
 * must never reach a download link, regardless of what the caller does
 * with the result.
 */
export async function generateValidatedExportForJob(
  jobId: string,
  transmissionConfig: E2bTransmissionConfig,
): Promise<ValidatedBatchArtifact[]> {
  const result = await runValidatedPreflightForJob(jobId, transmissionConfig);

  if (!result.transmissionConfigConfirmed) {
    throw new Error(
      `Transmission configuration not confirmed — cannot generate real export. Missing: ${result.transmissionConfigGaps.join(" | ")}`,
    );
  }

  if (!result.readyForValidatedExport) {
    const reasons = result.preflight.results
      .filter((r) => r.blocked)
      .flatMap((r) => r.errors.filter((e) => e.severity === "BLOCKING").map((e) => `${r.caseId}: ${e.message}`));
    throw new Error(
      `Not ready for validated E2B(R3) export — ${result.preflight.blockedCases}/${result.preflight.totalCases} case(s) blocked. ${reasons.slice(0, 3).join(" | ")}${reasons.length > 3 ? ` (+${reasons.length - 3} more)` : ""}`,
    );
  }

  const now = new Date();
  const batches = splitIntoBatches(result.cases, `MEDNOVA-${jobId}`);
  const artifacts = batches.map((batch) => ({
    filename: batchFilename(batch, now),
    xml: serializeBatchToXml(batch.cases, {
      batchId: batch.transmissionId,
      senderId: transmissionConfig.senderIdentifier,
      receiverId: transmissionConfig.receiverIdentifier,
      transmissionTimestamp: now,
    }),
    caseCount: batch.cases.length,
  }));

  const actor = currentActor();
  await recordAudit({
    action: "E2B_R3_VALIDATED_EXPORT_GENERATED",
    entity: "LineListJob",
    entityId: jobId,
    newValue: `${artifacts.length} batch file(s), ${result.totalCases} case(s), all passed VigiFlow preflight, generated by ${actor.name} (sender=${transmissionConfig.senderIdentifier}, receiver=${transmissionConfig.receiverIdentifier})`,
  });
  for (const b of batches) {
    await recordAudit({
      action: "E2B_R3_BATCH_GENERATED",
      entity: "LineListJob",
      entityId: jobId,
      newValue: `${b.transmissionId}: ${b.cases.length} case(s) (batch ${b.batchNumber}/${b.totalBatches})`,
    });
  }

  return artifacts;
}

/** Triggers a browser download of one already-generated batch artifact,
 *  and records that a download actually happened (distinct from the
 *  export having been *generated* — a generated artifact that's never
 *  downloaded should still be visible as such in the audit trail). Never
 *  logs patient PII: only the filename and case count, both already
 *  free of patient data by construction (see batching.ts). */
export async function downloadValidatedBatch(jobId: string, artifact: ValidatedBatchArtifact): Promise<void> {
  const blob = new Blob([artifact.xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = artifact.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }

  const actor = currentActor();
  await recordAudit({
    action: "E2B_R3_VALIDATED_EXPORT_DOWNLOADED",
    entity: "LineListJob",
    entityId: jobId,
    newValue: `${artifact.filename} (${artifact.caseCount} case(s)) downloaded by ${actor.name}`,
  });
}
