import { readJob, type ParsedRow } from "@/services/api/e2b";
import { currentActor, recordAudit } from "@/services/api/db";
import { mapSourceRecordToPVCase, type MappingWarning } from "./mapping";
import { runPreflight, validateBusinessRules, type PreflightSummary, type ValidationError } from "./validation";
import { splitIntoBatches, batchFilename } from "./batching";
import { serializeBatchToXml } from "./serializer";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import {
  isTransmissionConfigConfirmed,
  describeUnconfirmedTransmissionConfig,
  type E2bTransmissionConfig,
} from "./transmission-config";
import { getSourceProfile } from "./source-profiles/registry";
import type { SourceProfile } from "./source-profiles/types";
import type { PVCase } from "./types";

/**
 * The real, validated E2B(R3) pipeline for one line-list job — as opposed
 * to src/services/api/e2b.ts's legacy preview-draft generator. Runs the
 * actual normalize -> map -> validate -> batch -> serialize chain,
 * parameterized entirely by a SourceProfile (defaults to Ondo, the only
 * real source configured today) and an E2bTransmissionConfig (decisions
 * D2-D4) — this function never references "Ondo" or any source-specific
 * assumption directly; see src/services/e2b-r3/source-profiles/.
 */
export interface ValidatedExportResult {
  jobId: string;
  sourceProfileId: string;
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

/** ParsedRow (the legacy generator's row shape) already has the same
 *  field names Ondo's source profile maps FROM — this coerces it to the
 *  generic Record<string, string|undefined> shape mapSourceRecordToPVCase
 *  expects, so any SourceProfile's columnMap can be applied uniformly. */
function toSourceRecord(row: ParsedRow): Record<string, string | undefined> {
  return { ...row } as Record<string, string | undefined>;
}

export async function runValidatedPreflightForJob(
  jobId: string,
  transmissionConfig: E2bTransmissionConfig,
  sourceProfile: SourceProfile = getSourceProfile("ondo-aefi"),
): Promise<ValidatedExportResult> {
  const job = await readJob(jobId);
  const rows: ParsedRow[] = job.parsedRows ?? [];
  const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };
  const processedAt = new Date().toISOString();

  const cases: PVCase[] = [];
  const mappingWarnings: MappingWarning[] = [];
  for (let i = 0; i < rows.length; i++) {
    const { pvCase, warnings } = await mapSourceRecordToPVCase(
      toSourceRecord(rows[i]!),
      sourceProfile,
      transmissionConfig,
      { jobId, sourceFile: job.filename, sourceRow: i + 1, processedAt },
      providers,
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
    newValue: `source=${sourceProfile.id}: ${preflight.readyCases}/${preflight.totalCases} case(s) ready for validated import, run by ${actor.name}`,
  });

  return {
    jobId,
    sourceProfileId: sourceProfile.id,
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
 * transmission-config.ts). This is the fail-closed gate: a blocked case,
 * or an unconfirmed sender/receiver identifier, must never reach a
 * download link, regardless of what the caller does with the result.
 */
export async function generateValidatedExportForJob(
  jobId: string,
  transmissionConfig: E2bTransmissionConfig,
  sourceProfile: SourceProfile = getSourceProfile("ondo-aefi"),
): Promise<ValidatedBatchArtifact[]> {
  const result = await runValidatedPreflightForJob(jobId, transmissionConfig, sourceProfile);

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
      senderId: transmissionConfig.sender.identifier,
      receiverId: transmissionConfig.receiver.identifier,
      transmissionTimestamp: now,
    }),
    caseCount: batch.cases.length,
  }));

  const actor = currentActor();
  await recordAudit({
    action: "E2B_R3_VALIDATED_EXPORT_GENERATED",
    entity: "LineListJob",
    entityId: jobId,
    newValue: `source=${sourceProfile.id}: ${artifacts.length} batch file(s), ${result.totalCases} case(s), all passed VigiFlow preflight, generated by ${actor.name} (sender=${transmissionConfig.sender.identifier}, receiver=${transmissionConfig.receiver.identifier})`,
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
