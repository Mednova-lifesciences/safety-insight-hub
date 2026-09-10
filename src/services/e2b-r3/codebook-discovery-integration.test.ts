import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapSourceRecordToPVCase } from "./mapping";
import { validateBusinessRules, validateSourceDecoding, validateVigiFlowPreflight } from "./validation";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { ondoAefiProfile } from "./source-profiles/ondo-aefi";
import { syntheticFacilityBProfile } from "./source-profiles/synthetic-facility-b";
import { parseDiscoveredLegend, validateDiscoveredCodebook } from "./source-profiles/legend-parser";
import { resolveRuntimeSourceProfile } from "./source-profiles/runtime-profile";
import { UNCONFIRMED_DEFAULT_CONFIG } from "./transmission-config";

// The real, verified "KEY TO SUMMARY FINDINGS" legend from
// src/types/2026, ONDO STATE AEFI.xlsx — see __fixtures__/ondo-real-legend.json.
const REAL_LEGEND = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "ondo-real-legend.json"), "utf-8"),
) as { row: number; text: string }[];

function ondoRuntimeProfile() {
  const discovered = validateDiscoveredCodebook(
    parseDiscoveredLegend({ sourceId: "ondo-aefi", lines: REAL_LEGEND, evidence: { file: "test", sheet: "Sheet1" } }),
  );
  return resolveRuntimeSourceProfile(ondoAefiProfile, discovered);
}

const context = { jobId: "test-job", sourceFile: "test.xlsx", sourceRow: 1, processedAt: "2026-09-09T00:00:00Z" };
const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };

describe("codebook discovery -> resolution — real Ondo legend, explicit per-value traces", () => {
  it("outcome '1' resolves to Recovered — E2B-OUTCOME-UNMAPPED no longer fires", async () => {
    const runtime = ondoRuntimeProfile();
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "19", product: "MR", outcome: "1", patient_identifier: "A B" },
      runtime,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions[0]!.outcome).toBe("RECOVERED");
    expect(pvCase.reactions[0]!.outcomeUnmapped).toBeUndefined();
    const errors = validateBusinessRules(pvCase);
    expect(errors.some((e) => e.code === "E2B-OUTCOME-UNMAPPED")).toBe(false);
  });

  it("reaction '8' resolves to 'Local reaction' — proceeds to MedDRA coding on the decoded term, never the raw '8'", async () => {
    const runtime = ondoRuntimeProfile();
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "8", product: "MR", patient_identifier: "A B" },
      runtime,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions[0]!.sourceDecoding.status).toBe("DECODED");
    expect(pvCase.reactions[0]!.sourceDecoding.sourceTerm).toBe("Local reaction");
    // MedDRA coding was attempted against the decoded term, not "8".
    expect(pvCase.reactions[0]!.reaction.sourceValue).toBe("Local reaction");
    expect(pvCase.reactions[0]!.reaction.sourceValue).not.toBe("8");
  });

  it("compound '5,14,23, 19' — a real cell from the actual dataset — resolves all four via the real codebook", async () => {
    const runtime = ondoRuntimeProfile();
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "5,14,23, 19", product: "MR", patient_identifier: "A B" },
      runtime,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions).toHaveLength(4);
    const terms = pvCase.reactions.map((r) => r.sourceDecoding.sourceTerm);
    expect(terms).toEqual(["Fainting/Syncope", "Vomiting", "Unconsciousness", "Fever (<38oC)"]);
    expect(pvCase.reactions.every((r) => r.sourceDecoding.status === "DECODED")).toBe(true);
  });

  it("compound '12 AND 20' — conditional AND now commits because BOTH real codes exist in the discovered codebook", async () => {
    const runtime = ondoRuntimeProfile();
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "12 AND 20", product: "MR", patient_identifier: "A B" },
      runtime,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions).toHaveLength(2);
    expect(pvCase.reactions.map((r) => r.sourceDecoding.sourceTerm)).toEqual([
      "Lymph node enlargement",
      "Fever (>=38oC)",
    ]);
  });

  it("attached text — '28 PAINS', '28pains', '28-pains', '28: pains' — all resolve to code 28's real meaning with the text preserved", async () => {
    const runtime = ondoRuntimeProfile();
    for (const raw of ["28 PAINS", "28pains", "28-pains", "28: pains"]) {
      const { pvCase } = await mapSourceRecordToPVCase(
        { reaction: raw, product: "MR", patient_identifier: "A B" },
        runtime,
        UNCONFIRMED_DEFAULT_CONFIG,
        context,
        providers,
      );
      expect(pvCase.reactions, `raw="${raw}"`).toHaveLength(1);
      const d = pvCase.reactions[0]!.sourceDecoding;
      expect(d.status, `raw="${raw}"`).toBe("DECODED");
      expect(d.sourceTerm, `raw="${raw}"`).toContain("Others (specify)");
      expect(d.attachedVerbatimText?.toUpperCase(), `raw="${raw}"`).toContain("PAINS");
    }
  });

  it("a genuinely unknown code (outside the real 1-28 legend) is still blocked — discovery does not disable quarantine", async () => {
    const runtime = ondoRuntimeProfile();
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "999", product: "MR", patient_identifier: "A B" },
      runtime,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    expect(pvCase.reactions[0]!.sourceDecoding.status).toBe("UNKNOWN_CODE");
    const errors = validateSourceDecoding(pvCase);
    expect(errors.some((e) => e.code === "E2B-REACTION-CODEBOOK-UNRESOLVED")).toBe(true);
  });

  it("VigiFlow preflight still requires MedDRA coding — a decoded source term is NOT itself a MedDRA code", async () => {
    const runtime = ondoRuntimeProfile();
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "19", product: "MR", patient_identifier: "A B" },
      runtime,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    const errors = validateVigiFlowPreflight(pvCase);
    // Still blocked — decoding to "Fever (<38oC)" is not the same as
    // having a licensed MedDRA code for it.
    expect(errors.some((e) => e.code === "VIGIFLOW-MEDDRA-MISSING")).toBe(true);
  });
});

describe("architecture: runtime profiles never leak between sources or mutate the base", () => {
  it("the base ondoAefiProfile singleton is never mutated by building a runtime profile", async () => {
    const before = JSON.stringify(ondoAefiProfile.reactionCodebook.entries);
    ondoRuntimeProfile(); // builds and discards a runtime profile
    const after = JSON.stringify(ondoAefiProfile.reactionCodebook.entries);
    expect(after).toBe(before);
    expect(ondoAefiProfile.reactionCodebook.entries).toEqual({});
  });

  it("a codebook discovered for one document cannot leak into another profile's runtime resolution", async () => {
    const ondoRuntime = ondoRuntimeProfile();
    // Facility B's OWN profile — never touched by Ondo's discovery — must
    // still only know its own small synthetic codebook (C01/C02/C03),
    // never Ondo's real 28-code legend.
    const { pvCase } = await mapSourceRecordToPVCase(
      { record_id: "FB-LEAK-TEST", event_category: "19", suspect_product: "TestVax A", subject_name: "A B" },
      syntheticFacilityBProfile,
      UNCONFIRMED_DEFAULT_CONFIG,
      context,
      providers,
    );
    // "19" means "Fever (<38oC)" under Ondo's discovered codebook — but
    // Facility B's profile has never seen that discovery, so it must
    // stay unresolved, not accidentally inherit Ondo's meaning.
    expect(pvCase.reactions[0]!.sourceDecoding.status).toBe("UNKNOWN_CODE");
    expect(ondoRuntime.reactionCodebook.entries["19"]?.sourceTerm).toBe("Fever (<38oC)"); // sanity: Ondo's own runtime profile DOES know it
  });

  it("two runtime profiles built from the same base at different times don't share mutable state", () => {
    const runtime1 = ondoRuntimeProfile();
    const runtime2 = resolveRuntimeSourceProfile(ondoAefiProfile, {
      sourceId: "ondo-aefi",
      discoveryStatus: "DISCOVERED",
      rejectedEntries: [],
      entries: [{ field: "reaction", sourceCode: "1", meaning: "A different, deliberately synthetic meaning for this second profile only" }],
    });
    expect(runtime1.reactionCodebook.entries["1"]?.sourceTerm).toBe("Anaphylaxis");
    expect(runtime2.reactionCodebook.entries["1"]?.sourceTerm).toBe("A different, deliberately synthetic meaning for this second profile only");
    // Neither mutated the shared base or each other.
    expect(ondoAefiProfile.reactionCodebook.entries).toEqual({});
  });
});
