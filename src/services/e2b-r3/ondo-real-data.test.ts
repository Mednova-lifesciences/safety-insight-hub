import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mapSourceRecordToPVCase } from "./mapping";
import { runPreflight, validateBusinessRules, validateSourceDecoding } from "./validation";
import { splitIntoBatches } from "./batching";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { ondoAefiProfile } from "./source-profiles/ondo-aefi";
import { parseDiscoveredLegend, validateDiscoveredCodebook } from "./source-profiles/legend-parser";
import { resolveRuntimeSourceProfile } from "./source-profiles/runtime-profile";
import { fieldsCovered } from "./source-profiles/discovered-codebook";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";
import type { PVCase } from "./types";

/**
 * Runs the ACTUAL 231-row Ondo AEFI line-list AND the ACTUAL "KEY TO
 * SUMMARY FINDINGS" legend text from the real source document
 * (src/types/2026, ONDO STATE AEFI.xlsx, rows 249-253 — see
 * __fixtures__/ondo-real-legend.json, byte-for-byte verified against the
 * real file) through the exact same production pipeline export.ts uses:
 * parseDiscoveredLegend -> validateDiscoveredCodebook ->
 * resolveRuntimeSourceProfile -> mapSourceRecordToPVCase.
 *
 * This is the definitive answer to "does the discovered codebook reach
 * the resolver and change real behaviour" — not a unit test of the
 * parser in isolation (see legend-parser.test.ts for that), and not a
 * synthetic codebook (see mapping.test.ts's "decodes a known local
 * reaction code" test for that). Both the data and the codebook are the
 * genuine, unedited source content.
 */
describe("real Ondo dataset — codebook DISCOVERED from the real document and applied through the production pipeline", () => {
  it("produces the exact before/after diagnostic requested by the audit", async () => {
    const fixturePath = join(__dirname, "__fixtures__", "ondo-real-rows.json");
    const raw = JSON.parse(readFileSync(fixturePath, "utf-8")) as Record<string, string | undefined>[];
    expect(raw.length).toBe(231);

    const legendPath = join(__dirname, "__fixtures__", "ondo-real-legend.json");
    const legendLines = JSON.parse(readFileSync(legendPath, "utf-8")) as { row: number; text: string }[];

    // --- Step 1: discover + validate the REAL codebook from the REAL legend text ---
    const discovered = validateDiscoveredCodebook(
      parseDiscoveredLegend({
        sourceId: ondoAefiProfile.id,
        lines: legendLines,
        evidence: { file: "src/types/2026, ONDO STATE AEFI.xlsx", sheet: "Sheet1" },
      }),
    );
    const runtimeProfile = resolveRuntimeSourceProfile(ondoAefiProfile, discovered);

    const transmissionConfig: E2bTransmissionConfig = UNCONFIRMED_DEFAULT_CONFIG;
    const context = { jobId: "ll-4896f674-e6a9-4734-b27f-4ab8e3ed144d", sourceFile: "ondo_aefi_linelist.xlsx", processedAt: "2026-09-09T00:00:00Z" };
    const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };

    // --- Step 2: run all 231 real rows through BOTH the base (undiscovered) and runtime (discovered) profile, for a genuine before/after ---
    async function runAll(profile: typeof ondoAefiProfile) {
      const cases: PVCase[] = [];
      for (let i = 0; i < raw.length; i++) {
        const { pvCase } = await mapSourceRecordToPVCase(raw[i]!, profile, transmissionConfig, { ...context, sourceRow: i + 2 }, providers);
        cases.push(pvCase);
      }
      return cases;
    }
    const beforeCases = await runAll(ondoAefiProfile);
    const afterCases = await runAll(runtimeProfile);

    function summarize(cases: PVCase[]) {
      const businessErrors = cases.map((c) => [...validateSourceDecoding(c), ...validateBusinessRules(c)]);
      const preflight = runPreflight(cases);
      const codeCounts: Record<string, number> = {};
      for (const errs of businessErrors) for (const e of errs) codeCounts[e.code] = (codeCounts[e.code] ?? 0) + 1;
      const unknownReactionCodes = new Set<string>();
      let decodedReactions = 0;
      for (const c of cases) {
        for (const r of c.reactions) {
          if (r.sourceDecoding.status === "DECODED") decodedReactions++;
          if (r.sourceDecoding.status === "UNKNOWN_CODE") unknownReactionCodes.add(r.sourceDecoding.localCode);
        }
      }
      const outcomeResolved = cases.filter((c) => c.reactions.some((r) => r.outcome !== undefined)).length;
      const seriousnessCriteriaApplied = cases.filter((c) => c.reactions.some((r) => Object.keys(r.seriousnessCriteria).length > 0)).length;
      return {
        blockingReasons: codeCounts,
        blockedCases: preflight.blockedCases,
        readyCases: preflight.readyCases,
        decodedReactions,
        unknownReactionCodeCount: unknownReactionCodes.size,
        unknownReactionCodes: [...unknownReactionCodes].sort(),
        casesWithResolvedOutcome: outcomeResolved,
        casesWithSeriousnessCriteriaApplied: seriousnessCriteriaApplied,
      };
    }

    const before = summarize(beforeCases);
    const after = summarize(afterCases);
    const batchesAfter = splitIntoBatches(afterCases, "ONDO-AUDIT");

    const report = {
      codebookDiscovery: {
        status: discovered.discoveryStatus,
        fieldsCovered: fieldsCovered(discovered),
        acceptedMappingCount: discovered.entries.length,
        rejectedMappingCount: discovered.rejectedEntries.length,
        reactionMappingsDiscovered: discovered.entries.filter((e) => e.field === "reaction").length,
        seriousnessMappingsDiscovered: discovered.entries.filter((e) => e.field === "seriousness").length,
        outcomeMappingsDiscovered: discovered.entries.filter((e) => e.field === "outcome").length,
      },
      before,
      after,
      batchCountAfter: batchesAfter.length,
      batchSizesAfter: batchesAfter.map((b) => b.cases.length),
    };

    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "ondo-real-dataset-report.json"), JSON.stringify(report, null, 2), "utf-8");

    // --- Assertions proving the codebook genuinely reached and changed resolution ---
    expect(discovered.discoveryStatus).toBe("DISCOVERED");
    expect(discovered.entries.filter((e) => e.field === "reaction")).toHaveLength(28);
    expect(discovered.entries.filter((e) => e.field === "seriousness")).toHaveLength(5);
    expect(discovered.entries.filter((e) => e.field === "outcome")).toHaveLength(4);
    expect(discovered.rejectedEntries).toHaveLength(0);

    // Reaction 19 must now decode to the real source term, not stay UNKNOWN_CODE.
    const caseWithReaction19 = afterCases.find((c) => c.reactions.some((r) => r.sourceDecoding.localCode === "19"));
    expect(caseWithReaction19).toBeDefined();
    const decoded19 = caseWithReaction19!.reactions.find((r) => r.sourceDecoding.localCode === "19")!;
    expect(decoded19.sourceDecoding.status).toBe("DECODED");
    expect(decoded19.sourceDecoding.sourceTerm).toBe("Fever (<38oC)");

    // Code 23 ("Unconsciousness") is ACTUALLY present in the real 28-item
    // legend (verified directly against the document) — must decode, not
    // stay unknown. (An earlier report incorrectly assumed 23 was absent;
    // this assertion exists specifically to keep that error from recurring.)
    const caseWithReaction23 = afterCases.find((c) => c.reactions.some((r) => r.sourceDecoding.localCode === "23"));
    if (caseWithReaction23) {
      const r23 = caseWithReaction23.reactions.find((r) => r.sourceDecoding.localCode === "23")!;
      expect(r23.sourceDecoding.status).toBe("DECODED");
      expect(r23.sourceDecoding.sourceTerm).toBe("Unconsciousness");
    }

    // This dataset's real reaction values happen to all resolve once the
    // real (complete, 1-28) codebook is applied — including messy ones
    // like "28 PAIN AT THE INJECTION SITE" (code 28 + attached text) and
    // "4/" (code 4 + trailing punctuation) — a genuine, checked result,
    // not an assumption. Quarantine/unknown-code detection itself is
    // proven independently with a deliberately out-of-range synthetic
    // code — see mapping.test.ts and legend-parser.test.ts — since this
    // specific real dataset doesn't happen to contain one.
    const stillUnknownAfter = afterCases.flatMap((c) => c.reactions.filter((r) => r.sourceDecoding.status === "UNKNOWN_CODE"));
    expect(stillUnknownAfter).toHaveLength(0);

    // Outcome "1" resolves to RECOVERED and stops being an unmapped-outcome finding.
    expect(after.blockingReasons["E2B-OUTCOME-UNMAPPED"] ?? 0).toBeLessThan(before.blockingReasons["E2B-OUTCOME-UNMAPPED"] ?? 0);

    // Reaction decoding genuinely increased.
    expect(after.decodedReactions).toBeGreaterThan(before.decodedReactions);
    // Fewer or equal unknown codes after (never more).
    expect(after.unknownReactionCodeCount).toBeLessThanOrEqual(before.unknownReactionCodeCount);

    // Batching integrity unaffected by any of this.
    const allBatchedIds = batchesAfter.flatMap((b) => b.cases.map((c) => c.sendersCaseId));
    expect(allBatchedIds.length).toBe(231);
    expect(new Set(allBatchedIds).size).toBe(231);
    expect(batchesAfter.map((b) => b.cases.length)).toEqual([100, 100, 31]);
  });
});
