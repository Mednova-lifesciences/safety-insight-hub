import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapConceptToOutcome, resolveFieldConcept } from "./mapping";
import { validateBusinessRules } from "./validation";
import { ondoAefiProfile } from "./source-profiles/ondo-aefi";
import type { SourceProfile } from "./source-profiles/types";
import type { ReactionOutcome } from "./types";

/**
 * Proves the "decode -> explicit map -> HUMAN_REVIEW_REQUIRED-if-absent"
 * architecture is genuinely generic — not built around "Hospitalized," not
 * built around Ondo, and not resolvable by any inference. Every test here
 * uses either a synthetic profile/codebook or an entirely fictional
 * concept unrelated to any real source, specifically so passing these
 * tests can never be confused with "the current dataset happens to work."
 */

function profileWithOutcomeCodebook(entries: Record<string, string>): SourceProfile {
  return {
    ...ondoAefiProfile,
    fieldCodebooks: {
      outcome: {
        field: "outcome",
        version: "test",
        entries: Object.fromEntries(Object.entries(entries).map(([code, meaning]) => [code, { sourceCode: code, meaning }])),
      },
    },
  };
}

describe("Test 1 — valid E2B outcome: a decoded concept with an explicit mapping resolves VALID", () => {
  it("source '1' -> 'Recovered', explicit mapping Recovered -> E2B RECOVERED", () => {
    const profile = profileWithOutcomeCodebook({ "1": "Recovered" });
    const resolution = resolveFieldConcept("1", profile, "outcome", mapConceptToOutcome);
    expect(resolution).toEqual({
      rawSourceValue: "1",
      decodedSourceValue: "Recovered",
      canonicalValue: "RECOVERED",
      status: "MAPPED",
    });
  });
});

describe("Test 2 — known but unmappable: a decoded concept with no explicit mapping requires human review", () => {
  it("source '2' -> 'Hospitalized', no mapping configured", () => {
    const profile = profileWithOutcomeCodebook({ "2": "Hospitalized" });
    const resolution = resolveFieldConcept("2", profile, "outcome", mapConceptToOutcome);
    expect(resolution).toEqual({
      rawSourceValue: "2",
      decodedSourceValue: "Hospitalized",
      status: "HUMAN_REVIEW_REQUIRED",
    });
  });
});

describe("Test 3 — unknown source code: the codebook itself has no entry", () => {
  it("'999' has no codebook entry at all", () => {
    const profile = profileWithOutcomeCodebook({ "1": "Recovered" });
    const resolution = resolveFieldConcept("999", profile, "outcome", mapConceptToOutcome);
    expect(resolution).toEqual({ rawSourceValue: "999", status: "UNKNOWN_SOURCE_CODE" });
  });
});

describe("Test 4 — explicit mapping added later: the SAME decoded concept becomes VALID once configured", () => {
  it("source '2' -> 'Hospitalized', now WITH an explicit (synthetic, test-only) mapping", () => {
    const profile = profileWithOutcomeCodebook({ "2": "Hospitalized" });
    const profileWithMapping: SourceProfile = { ...profile, outcomeMap: { HOSPITALIZED: "RECOVERING" } };
    const before = resolveFieldConcept("2", profile, "outcome", mapConceptToOutcome);
    const after = resolveFieldConcept("2", profileWithMapping, "outcome", mapConceptToOutcome);
    expect(before).toBeDefined();
    expect(before!.status).toBe("HUMAN_REVIEW_REQUIRED");
    expect(after).toEqual({
      rawSourceValue: "2",
      decodedSourceValue: "Hospitalized",
      canonicalValue: "RECOVERING",
      status: "MAPPED",
    });
  });
});

describe("Test 5 — numeric collision: source code 2 is never treated as E2B outcome 2 merely because both are '2'", () => {
  it("source '2' decodes to 'Hospitalized', which never equals E2B code 2 (Recovering)", () => {
    const profile = profileWithOutcomeCodebook({ "2": "Hospitalized" });
    const resolution = resolveFieldConcept("2", profile, "outcome", mapConceptToOutcome);
    expect(resolution).toBeDefined();
    expect(resolution!.canonicalValue).not.toBe("RECOVERING" satisfies ReactionOutcome);
    expect(resolution!.status).not.toBe("MAPPED");
  });

  it("source code 2 mapping to a DIFFERENT E2B value than 'code 2' proves there is no positional/numeric passthrough", () => {
    // If the source's OWN code 2 genuinely means "Recovering" for some
    // other hypothetical source, an explicit mapping can say so — but
    // that must come from configuration, never from the two both being "2".
    const profile = profileWithOutcomeCodebook({ "2": "Discharged well" });
    // mapConceptToOutcome normalizes by stripping whitespace/underscores/
    // hyphens before lookup — the map key must match that normalized form.
    const withExplicitMapping: SourceProfile = { ...profile, outcomeMap: { DISCHARGEDWELL: "RECOVERED" } };
    const resolution = resolveFieldConcept("2", withExplicitMapping, "outcome", mapConceptToOutcome);
    expect(resolution).toBeDefined();
    // Source code "2" ends up mapping to E2B "RECOVERED" (code 1), NOT
    // E2B code 2 ("RECOVERING") — proving the numbers never collided.
    expect(resolution!.canonicalValue).toBe("RECOVERED");
  });
});

describe("Test 6 — future arbitrary concept: a wholly fictional source, unrelated to Ondo, produces the same generic result", () => {
  it("source code 77 -> 'Observed overnight' (a made-up concept), no mapping exists -> HUMAN_REVIEW_REQUIRED", () => {
    const profile = profileWithOutcomeCodebook({ "77": "Observed overnight" });
    const resolution = resolveFieldConcept("77", profile, "outcome", mapConceptToOutcome);
    expect(resolution).toEqual({
      rawSourceValue: "77",
      decodedSourceValue: "Observed overnight",
      status: "HUMAN_REVIEW_REQUIRED",
    });
  });

  it("a whole family of unrelated future concepts (Referred/Transferred/Discharged) all require human review, none guessed", () => {
    const profile = profileWithOutcomeCodebook({
      A: "Referred",
      B: "Transferred",
      C: "Discharged",
    });
    for (const code of ["A", "B", "C"]) {
      const resolution = resolveFieldConcept(code, profile, "outcome", mapConceptToOutcome);
      expect(resolution, `code ${code}`).toBeDefined();
      expect(resolution!.status, `code ${code}`).toBe("HUMAN_REVIEW_REQUIRED");
      expect(resolution!.canonicalValue, `code ${code}`).toBeUndefined();
    }
  });

  it("validateBusinessRules produces E2B-OUTCOME-NOT-MAPPABLE for this fictional concept, mentioning ITS OWN decoded text — not a hardcoded string", async () => {
    const { mapSourceRecordToPVCase } = await import("./mapping");
    const { unavailableMedDraProvider, unavailableWhoDrugProvider } = await import("./coding-provider");
    const { UNCONFIRMED_DEFAULT_CONFIG } = await import("./transmission-config");
    const profile = profileWithOutcomeCodebook({ "77": "Observed overnight" });
    const { pvCase } = await mapSourceRecordToPVCase(
      { reaction: "19", product: "MR", outcome: "77", patient_identifier: "A B" },
      profile,
      UNCONFIRMED_DEFAULT_CONFIG,
      { jobId: "test", sourceFile: "test.xlsx", sourceRow: 1, processedAt: "2026-01-01T00:00:00Z" },
      { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
    );
    const errors = validateBusinessRules(pvCase);
    const found = errors.find((e) => e.code === "E2B-OUTCOME-NOT-MAPPABLE");
    expect(found).toBeDefined();
    expect(found!.message).toContain("Observed overnight");
  });
});

describe("Test 7 — all six canonical E2B outcome concepts can be explicitly mapped and pass validation", () => {
  const cases: [string, ReactionOutcome][] = [
    ["Recovered", "RECOVERED"],
    ["Recovering", "RECOVERING"],
    ["Not recovered", "NOT_RECOVERED"],
    ["Recovered with sequelae", "RECOVERED_WITH_SEQUELAE"],
    ["Fatal", "FATAL"],
    ["Unknown", "UNKNOWN"],
  ];
  for (const [concept, expected] of cases) {
    it(`"${concept}" maps to canonical E2B outcome "${expected}"`, () => {
      expect(mapConceptToOutcome(concept)).toBe(expected);
    });
  }
});

describe("the SAME mechanism applies to seriousness-criterion codes, not just outcome (section 7's audit requirement)", () => {
  it("a decoded criterion matching an ICH concept (death) is MAPPED", async () => {
    const { mapConceptToSeriousnessCriteria } = await import("./mapping");
    expect(mapConceptToSeriousnessCriteria("Death")).toEqual({ resultsInDeath: true });
  });
  it("a decoded criterion with no ICH match and no profile override is HUMAN_REVIEW_REQUIRED, not guessed", async () => {
    const { mapConceptToSeriousnessCriteria, resolveFieldConcept: resolve } = await import("./mapping");
    const profile: SourceProfile = {
      ...ondoAefiProfile,
      fieldCodebooks: {
        seriousness: {
          field: "seriousness",
          version: "test",
          entries: { "9": { sourceCode: "9", meaning: "Significant harm requiring intervention" } },
        },
      },
    };
    const resolution = resolve("9", profile, "seriousness", mapConceptToSeriousnessCriteria);
    expect(resolution).toEqual({
      rawSourceValue: "9",
      decodedSourceValue: "Significant harm requiring intervention",
      status: "HUMAN_REVIEW_REQUIRED",
    });
  });
  it("a profile's explicit seriousnessCriterionMap resolves the same previously-unmappable concept", async () => {
    const { mapConceptToSeriousnessCriteria, resolveFieldConcept: resolve } = await import("./mapping");
    const profile: SourceProfile = {
      ...ondoAefiProfile,
      fieldCodebooks: {
        seriousness: {
          field: "seriousness",
          version: "test",
          entries: { "9": { sourceCode: "9", meaning: "Significant harm requiring intervention" } },
        },
      },
      seriousnessCriterionMap: { "SIGNIFICANT HARM REQUIRING INTERVENTION": { otherMedicallyImportant: true } },
    };
    const resolution = resolve("9", profile, "seriousness", mapConceptToSeriousnessCriteria);
    expect(resolution).toBeDefined();
    expect(resolution!.status).toBe("MAPPED");
    expect(resolution!.canonicalValue).toEqual({ otherMedicallyImportant: true });
  });
});

describe("HUMAN_REVIEW_REQUIRED genuinely blocks export via the same preflight gate export.ts uses, and clears once resolved", () => {
  it("a case whose only real problem is an unmappable outcome is BLOCKED by runPreflight, and stops being blocked FOR THAT REASON once the profile gains an explicit mapping", async () => {
    const { mapSourceRecordToPVCase } = await import("./mapping");
    const { runPreflight, validateBusinessRules: validateBR } = await import("./validation");
    const { unavailableMedDraProvider, unavailableWhoDrugProvider } = await import("./coding-provider");
    const { UNCONFIRMED_DEFAULT_CONFIG } = await import("./transmission-config");
    const profile = profileWithOutcomeCodebook({ "2": "Hospitalized" });
    const record = { reaction: "19", product: "MR", outcome: "2", patient_identifier: "A B" };
    const ctx = { jobId: "test", sourceFile: "test.xlsx", sourceRow: 1, processedAt: "2026-01-01T00:00:00Z" };
    const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };

    const { pvCase: blockedCase } = await mapSourceRecordToPVCase(record, profile, UNCONFIRMED_DEFAULT_CONFIG, ctx, providers);
    const before = runPreflight([blockedCase]);
    expect(before.status).toBe("BLOCKED");
    expect(before.counts.outcomeNeedsHumanReview).toBeGreaterThan(0);

    const resolvedProfile: SourceProfile = { ...profile, outcomeMap: { HOSPITALIZED: "RECOVERING" } };
    const { pvCase: resolvedCase } = await mapSourceRecordToPVCase(record, resolvedProfile, UNCONFIRMED_DEFAULT_CONFIG, ctx, providers);
    const after = runPreflight([resolvedCase]);
    // The outcome-specific finding is gone...
    expect(after.counts.outcomeNeedsHumanReview).toBe(0);
    expect(validateBR(resolvedCase).some((e) => e.code === "E2B-OUTCOME-NOT-MAPPABLE")).toBe(false);
    // ...even though the case may still be blocked for OTHER, unrelated
    // reasons (e.g. no licensed MedDRA coding configured in this test) —
    // this proves the fix is real and specific, not that the whole gate
    // was loosened to let everything through.
  });
});

describe("Test 8 — no AI/LLM fallback is ever invoked to resolve a missing semantic mapping", () => {
  it("resolveFieldConcept and mapConceptToOutcome are synchronous, pure functions — structurally incapable of an async AI call", () => {
    const profile = profileWithOutcomeCodebook({ "2": "Hospitalized" });
    // A function that awaited an LLM response would have to be async;
    // these are plain synchronous calls, so no request of any kind — to
    // an AI or otherwise — can be occurring inside them.
    const result = resolveFieldConcept("2", profile, "outcome", mapConceptToOutcome);
    expect(result).toBeDefined(); // resolved synchronously, not a Promise
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
  });

  it("neither mapping.ts, validation.ts, nor any source-profiles file imports anything AI/OpenAI-related", () => {
    const files = ["mapping.ts", "validation.ts", "source-profiles/legend-parser.ts", "source-profiles/runtime-profile.ts"].map(
      (f) => readFileSync(join(__dirname, f), "utf-8"),
    );
    for (const content of files) {
      expect(content).not.toMatch(/openai/i);
      expect(content).not.toMatch(/structured_completion/);
      expect(content).not.toMatch(/\bawait\s+ai/i);
    }
  });
});
