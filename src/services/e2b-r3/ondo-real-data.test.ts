import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mapSourceRecordToPVCase } from "./mapping";
import { runPreflight, validateBusinessRules } from "./validation";
import { splitIntoBatches } from "./batching";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { ondoAefiProfile } from "./source-profiles/ondo-aefi";
import {
  isTransmissionConfigConfirmed,
  UNCONFIRMED_DEFAULT_CONFIG,
  type E2bTransmissionConfig,
} from "./transmission-config";
import type { PVCase } from "./types";

/**
 * Runs the ACTUAL 231-row Ondo AEFI line-list (pulled from the real
 * production job ll-4896f674-e6a9-4734-b27f-4ab8e3ed144d in Supabase) —
 * anonymized before being committed, see __fixtures__/ondo-real-rows.json
 * — through the real profile-driven pipeline: mapSourceRecordToPVCase (with
 * the ondoAefiProfile source profile) -> validateBusinessRules ->
 * runPreflight -> splitIntoBatches. Not a synthetic/minimal test fixture —
 * the genuine uploaded dataset, unedited, so the resulting numbers are the
 * honest current state of this pipeline against real data.
 *
 * Uses UNCONFIRMED_DEFAULT_CONFIG (the shipped, honest default — sender/
 * receiver/report-type are NOT confirmed) so the diagnostic accurately
 * reflects today's real state, not an artificially completed one.
 */
describe("real Ondo dataset through the source-profile-driven pipeline (231 rows, job ll-4896f674-e6a9-4734-b27f-4ab8e3ed144d)", () => {
  it("produces the exact diagnostic report requested by the audit", async () => {
    const fixturePath = join(__dirname, "__fixtures__", "ondo-real-rows.json");
    const raw = JSON.parse(readFileSync(fixturePath, "utf-8")) as Record<string, string | undefined>[];
    expect(raw.length).toBe(231);

    const transmissionConfig: E2bTransmissionConfig = UNCONFIRMED_DEFAULT_CONFIG;
    const context = { jobId: "ll-4896f674-e6a9-4734-b27f-4ab8e3ed144d", sourceFile: "ondo_aefi_linelist.xlsx", processedAt: "2026-09-09T00:00:00Z" };
    const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };

    const cases: PVCase[] = [];
    for (let i = 0; i < raw.length; i++) {
      const { pvCase } = await mapSourceRecordToPVCase(
        raw[i]!,
        ondoAefiProfile,
        transmissionConfig,
        { ...context, sourceRow: i + 2 },
        providers,
      );
      cases.push(pvCase);
    }

    const businessErrors = cases.map((c) => validateBusinessRules(c));
    const preflight = runPreflight(cases);
    const batches = splitIntoBatches(cases, "ONDO-AUDIT");

    // --- Diagnostic aggregates, section 21's exact requested breakdown ---
    const reactionValuesEncountered = new Set<string>();
    const unknownReactionCodes = new Set<string>();
    let blankReactions = 0;
    let quarantinedReactionFields = 0;
    const reporterDesignationsEncountered = new Set<string>();
    const unmappedReporterDesignations = new Set<string>();
    const productValuesEncountered = new Set<string>();
    const outcomeValuesEncountered = new Set<string>();
    const seriousnessValuesEncountered = new Set<string>();

    for (let i = 0; i < raw.length; i++) {
      const row = raw[i]!;
      if (!row["reaction"] || !row["reaction"].trim()) blankReactions++;
      else reactionValuesEncountered.add(row["reaction"]);
      if (row["product"]) productValuesEncountered.add(row["product"]);
      if (row["outcome"]) outcomeValuesEncountered.add(row["outcome"]);
      if (row["seriousness"]) seriousnessValuesEncountered.add(row["seriousness"]);
      if (row["reporter_designation"]) reporterDesignationsEncountered.add(row["reporter_designation"]);
    }
    for (const c of cases) {
      for (const r of c.reactions) {
        if (r.sourceDecoding.status === "UNKNOWN_CODE") unknownReactionCodes.add(r.sourceDecoding.localCode);
        if (r.sourceDecoding.status === "DELIMITER_QUARANTINED") quarantinedReactionFields++;
      }
      if (c.reporter.qualificationVerbatim && !c.reporter.qualificationCode) {
        unmappedReporterDesignations.add(c.reporter.qualificationVerbatim);
      }
    }

    const casesQuarantined = businessErrors.filter((errs) =>
      errs.some((e) => e.code === "E2B-REACTION-CODEBOOK-UNRESOLVED" || e.code === "E2B-REACTION-DELIMITER-QUARANTINED"),
    ).length;
    const casesBlocked = businessErrors.filter((errs) => errs.some((e) => e.severity === "BLOCKING")).length;

    const codeCounts: Record<string, number> = {};
    for (const errs of businessErrors) for (const e of errs) codeCounts[e.code] = (codeCounts[e.code] ?? 0) + 1;

    const report = {
      // Exact machine-readable shape from the prior audit, kept.
      inputCases: raw.length,
      normalizedCases: cases.length,
      exportableCases: preflight.readyCases,
      blockedCases: preflight.blockedCases,
      batchCount: batches.length,
      batchSizes: batches.map((b) => b.cases.length),
      blockingReasons: codeCounts,

      // Section 21's exact diagnostic breakdown.
      totalInputCases: raw.length,
      casesSuccessfullyNormalized: cases.length,
      casesBlocked: casesBlocked,
      casesQuarantined: casesQuarantined,
      reactionValuesEncountered: [...reactionValuesEncountered].sort(),
      unknownReactionCodes: [...unknownReactionCodes].sort(),
      blankReactions,
      quarantinedReactionFields,
      reporterDesignationValuesEncountered: [...reporterDesignationsEncountered].sort(),
      unmappedReporterDesignations: [...unmappedReporterDesignations].sort(),
      productValuesEncountered: [...productValuesEncountered].sort(),
      outcomeValuesEncountered: [...outcomeValuesEncountered].sort(),
      seriousnessValuesEncountered: [...seriousnessValuesEncountered].sort(),
      senderReceiverConfigurationStatus: isTransmissionConfigConfirmed(transmissionConfig) ? "CONFIRMED" : "NOT_CONFIRMED",
      medDraStatus: "NOT_CONFIGURED",
      whoDrugStatus: "NOT_CONFIGURED (Option A: verbatim product name still exports)",
      resultingBatchCount: batches.length,
      resultingBatchSizes: batches.map((b) => b.cases.length),
    };

    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ondo-real-dataset-report.json"), JSON.stringify(report, null, 2), "utf-8");

    // --- Sanity: batching never drops or duplicates a case ---
    const allBatchedIds = batches.flatMap((b) => b.cases.map((c) => c.sendersCaseId));
    expect(allBatchedIds.length).toBe(231);
    expect(new Set(allBatchedIds).size).toBe(231);
    expect(batches.map((b) => b.cases.length)).toEqual([100, 100, 31]);

    // Honest expectations, unchanged by this session's refactor: Ondo's
    // reaction codebook was never supplied, so every real reaction code
    // still correctly fails to decode, and no real case is exportable yet.
    expect(preflight.status).toBe("BLOCKED");
    expect(unknownReactionCodes.size).toBeGreaterThan(0);
  });
});
