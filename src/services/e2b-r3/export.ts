import { readJob, type ParsedRow } from "@/services/api/e2b";
import { currentActor, recordAudit } from "@/services/api/db";
import { mapSourceRecordToPVCase, type MappingWarning } from "./mapping";
import {
  runPreflight,
  validateBusinessRules,
  validateSourceDecoding,
  computeCaseEligibility,
  type CaseExportEligibility,
  type PreflightSummary,
  type ValidationError,
} from "./validation";
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
import { parseDiscoveredLegend, validateDiscoveredCodebook } from "./source-profiles/legend-parser";
import { resolveRuntimeSourceProfile } from "./source-profiles/runtime-profile";
import {
  fieldsCovered,
  type DiscoveredSourceCodebook,
} from "./source-profiles/discovered-codebook";
import type { PVCase } from "./types";

/**
 * Discovers a source document's own codebook/legend from whatever text
 * its upload parser found outside the case table (see
 * tabular-parse.ts's discardedRows), validates it, and returns both the
 * validated codebook (for diagnostics) and the resulting runtime profile
 * (base profile + discovered codebook, never mutating the base). Purely
 * deterministic — no LLM call, no reference to any specific source; the
 * same function runs for Ondo or any other configured profile.
 */
export function discoverAndApplyCodebook(
  baseProfile: SourceProfile,
  discardedRows: { row: number; text: string }[] | undefined,
  evidence: { file?: string | undefined; sheet?: string | undefined },
): { runtimeProfile: SourceProfile; discovered: DiscoveredSourceCodebook } {
  const discovered = validateDiscoveredCodebook(
    parseDiscoveredLegend({
      sourceId: baseProfile.id,
      lines: (discardedRows ?? []).map((d) => ({ text: d.text, row: d.row })),
      evidence,
    }),
  );
  const runtimeProfile = resolveRuntimeSourceProfile(baseProfile, discovered);
  return { runtimeProfile, discovered };
}

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
   *  offer a download WITHOUT an override. Never inferred any other way,
   *  and never changed by the presence of an override — see
   *  exportableWithOverride for that. */
  readyForValidatedExport: boolean;
  /** The job's currently-recorded validated-export override, if any —
   *  read directly from the job record (never passed in by a caller).
   *  See api/e2b.ts's recordValidatedExportOverride. */
  override?: { by: string; at: string; reason: string } | undefined;
  /** Per-case export eligibility given the current override state.
   *  Always populated — with no override active, every case's
   *  `includable` just mirrors "not blocked". */
  caseEligibility: CaseExportEligibility[];
  /** True when an override is active AND it actually rescues at least
   *  one otherwise-blocked case. Distinct from readyForValidatedExport,
   *  which stays the honest "zero blocking issues, no override needed"
   *  signal — a caller must show both states differently. */
  exportableWithOverride: boolean;
  /** True only when transmission-config.ts's sender/receiver identifiers
   *  have actually been confirmed (not the unconfirmed sentinel). A
   *  result can be readyForValidatedExport:true on every VigiFlow check
   *  and still not be transmittable, if this is false — technical
   *  validity and configuration completeness are checked separately, on
   *  purpose, so a caller can't accidentally treat one as proof of the
   *  other. */
  transmissionConfigConfirmed: boolean;
  transmissionConfigGaps: string[];
  /** What the codebook-discovery step actually found in this specific
   *  job's own document — never a static claim about the source profile
   *  in general, since two different uploads of the "same" source could
   *  legitimately carry different codebooks (or none at all). */
  codebookDiscovery: {
    status: DiscoveredSourceCodebook["discoveryStatus"];
    fieldsCovered: string[];
    acceptedMappingCount: number;
    rejectedMappingCount: number;
  };
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

  // Discover this job's own codebook from whatever legend text its
  // upload actually contained (see tabular-parse.ts's discardedRows) —
  // never from a hand-authored mapping on the base profile — and use the
  // resulting runtime profile for every row in THIS job only.
  const { runtimeProfile, discovered } = discoverAndApplyCodebook(
    sourceProfile,
    job.discardedRows,
    {
      file: job.filename,
      sheet: job.sheetName,
    },
  );

  const cases: PVCase[] = [];
  const mappingWarnings: MappingWarning[] = [];
  for (let i = 0; i < rows.length; i++) {
    const { pvCase, warnings } = await mapSourceRecordToPVCase(
      toSourceRecord(rows[i]!),
      runtimeProfile,
      transmissionConfig,
      { jobId, sourceFile: job.filename, sourceRow: i + 1, processedAt },
      providers,
    );
    cases.push(pvCase);
    mappingWarnings.push(...warnings);
  }

  // Both layers — validateSourceDecoding (codebook-unresolved/quarantined
  // findings) is a separate function from validateBusinessRules; omitting
  // it here would understate what's actually blocking each case.
  const businessRuleErrors = cases.flatMap((c) => [
    ...validateSourceDecoding(c),
    ...validateBusinessRules(c),
  ]);
  const preflight = runPreflight(cases);
  const readyForValidatedExport = preflight.status === "READY_FOR_VALIDATED_IMPORT";

  // Read the job's own recorded override (if any) — never passed in by
  // the caller, so it can't drift from what's actually on record for
  // this job (same pattern as the legacy e2bOverride).
  const override = job.validatedE2bOverride;
  const caseEligibility: CaseExportEligibility[] = computeCaseEligibility(
    preflight.results,
    !!override,
  );
  const exportableWithOverride = !!override && caseEligibility.some((c) => c.rescuedByOverride);

  const actor = currentActor();
  await recordAudit({
    action: readyForValidatedExport ? "E2B_R3_PREFLIGHT_PASSED" : "E2B_R3_PREFLIGHT_BLOCKED",
    entity: "LineListJob",
    entityId: jobId,
    newValue: `source=${sourceProfile.id}: ${preflight.readyCases}/${preflight.totalCases} case(s) ready for validated import, run by ${actor.name}${override ? ` (override on record: ${override.by})` : ""}`,
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
    override,
    caseEligibility,
    exportableWithOverride,
    transmissionConfigConfirmed: isTransmissionConfigConfirmed(transmissionConfig),
    transmissionConfigGaps: describeUnconfirmedTransmissionConfig(transmissionConfig),
    codebookDiscovery: {
      status: discovered.discoveryStatus,
      fieldsCovered: fieldsCovered(discovered),
      acceptedMappingCount: discovered.entries.length,
      rejectedMappingCount: discovered.rejectedEntries.length,
    },
  };
}

export interface ValidatedBatchArtifact {
  filename: string;
  xml: string;
  caseCount: number;
}

/**
 * Serializes real E2B(R3) XML for a job. The transmission config must
 * always be actually confirmed (not the unconfirmed sentinel) — that
 * gate is never overridable, by anyone, for any reason. Case inclusion
 * is otherwise either:
 *  - the fail-closed default: every case must have passed VigiFlow
 *    preflight cleanly, or
 *  - if the job carries a recorded validatedE2bOverride (see
 *    api/e2b.ts's recordValidatedExportOverride), individual cases whose
 *    BLOCKING errors are all in the overridable set (see
 *    E2B_NON_OVERRIDABLE_CODES in validation.ts) are exported anyway —
 *    but a case failing the ICH structural minimum, or missing its own
 *    identity fields, is EXCLUDED from the batch regardless of the
 *    override; it is never silently smuggled through.
 * Either way, a case that makes it into the output is real, schema-
 * conformant E2B(R3) XML — an override changes WHICH cases are included,
 * never HOW a included case is serialized.
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

  let exportableCases = result.cases;
  let excludedCount = 0;

  if (!result.readyForValidatedExport) {
    if (!result.override) {
      const reasons = result.preflight.results
        .filter((r) => r.blocked)
        .flatMap((r) =>
          r.errors.filter((e) => e.severity === "BLOCKING").map((e) => `${r.caseId}: ${e.message}`),
        );
      throw new Error(
        `Not ready for validated E2B(R3) export — ${result.preflight.blockedCases}/${result.preflight.totalCases} case(s) blocked. ${reasons.slice(0, 3).join(" | ")}${reasons.length > 3 ? ` (+${reasons.length - 3} more)` : ""}`,
      );
    }

    // An override is on record — include only the cases it can actually
    // rescue (see runValidatedPreflightForJob's caseEligibility).
    const includableIds = new Set(
      result.caseEligibility.filter((c) => c.includable).map((c) => c.caseId),
    );
    exportableCases = result.cases.filter((c) => includableIds.has(c.sendersCaseId));
    excludedCount = result.totalCases - exportableCases.length;

    if (exportableCases.length === 0) {
      throw new Error(
        `Validated export override is on record, but every case is blocked by a non-overridable issue ` +
          `(missing identifiable patient/reporter, zero reactions, zero suspect products, or a case-identity ` +
          `field) — nothing can be exported even with the override.`,
      );
    }
  }

  const now = new Date();
  const batches = splitIntoBatches(exportableCases, `MEDNOVA-${jobId}`);
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
    newValue: result.override
      ? `source=${sourceProfile.id}: OVERRIDE ON RECORD (${result.override.by}: "${result.override.reason}") — ` +
        `${artifacts.length} batch file(s), ${exportableCases.length}/${result.totalCases} case(s) exported` +
        `${excludedCount > 0 ? ` (${excludedCount} case(s) excluded — non-overridable issues remained)` : ""}, ` +
        `generated by ${actor.name} (sender=${transmissionConfig.sender.identifier}, receiver=${transmissionConfig.receiver.identifier})`
      : `source=${sourceProfile.id}: ${artifacts.length} batch file(s), ${result.totalCases} case(s), all passed VigiFlow preflight, generated by ${actor.name} (sender=${transmissionConfig.sender.identifier}, receiver=${transmissionConfig.receiver.identifier})`,
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
export async function downloadValidatedBatch(
  jobId: string,
  artifact: ValidatedBatchArtifact,
): Promise<void> {
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
