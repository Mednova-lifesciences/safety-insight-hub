import { describe, expect, it } from "vitest";
import { mapConceptToOutcome, resolveFieldConcept } from "./mapping";
import { getSourceProfile } from "./source-profiles/registry";
import type { MedDraCodingProvider } from "./coding-provider";
import {
  applyOrgOutcomeTerms,
  outcomeTermKey,
  reactionTermKey,
  withOrgReactionTerms,
  type OrgTermMapping,
} from "./term-mappings";
import {
  mergeOrgRegulatoryConfigIntoProfile,
  normalizeDesignationKey,
  unconfiguredOrgRegulatoryConfig,
} from "./regulatory-config";

const verbatim = getSourceProfile("generic-verbatim");
const coded = getSourceProfile("ondo-aefi");

function mapping(partial: Partial<OrgTermMapping>): OrgTermMapping {
  return {
    id: "t1",
    kind: "OUTCOME",
    term: "x",
    termKey: "X",
    createdAt: "2026-09-19T00:00:00Z",
    ...partial,
  };
}

describe("organization outcome terms", () => {
  it("normalizes spacing, underscores and hyphens like the outcome dictionary does", () => {
    expect(outcomeTermKey(" hospitalised  ")).toBe("HOSPITALISED");
    expect(outcomeTermKey("Not-yet recovered")).toBe(outcomeTermKey("not_yet_recovered"));
  });

  it("a decided word resolves in every source profile; an undecided one still blocks", () => {
    const decided = mapping({
      term: "Hospitalized",
      termKey: outcomeTermKey("Hospitalized"),
      mappedValue: "UNKNOWN",
    });
    const pending = mapping({ id: "t2", term: "Recoverd", termKey: outcomeTermKey("Recoverd") });
    for (const profile of [verbatim, coded]) {
      const withTerms = applyOrgOutcomeTerms(profile, [decided, pending]);
      expect(
        resolveFieldConcept("Hospitalized", withTerms, "outcome", mapConceptToOutcome),
      ).toMatchObject({
        status: "MAPPED",
        canonicalValue: "UNKNOWN",
      });
      expect(
        resolveFieldConcept("Recoverd", withTerms, "outcome", mapConceptToOutcome)?.status,
      ).toBe("HUMAN_REVIEW_REQUIRED");
    }
  });

  it("reaches profiles through the organization config", () => {
    const config = {
      ...unconfiguredOrgRegulatoryConfig(),
      termMappings: [
        mapping({
          term: "Fully better",
          termKey: outcomeTermKey("Fully better"),
          mappedValue: "RECOVERED",
        }),
      ],
    };
    const profile = mergeOrgRegulatoryConfigIntoProfile(verbatim, config);
    expect(mapConceptToOutcome("fully better", profile)).toBe("RECOVERED");
  });

  it("never overrides the profile's own explicit outcome map", () => {
    const profile = { ...verbatim, outcomeMap: { HOSPITALIZED: "NOT_RECOVERED" as const } };
    const withTerms = applyOrgOutcomeTerms(profile, [
      mapping({ termKey: "HOSPITALIZED", mappedValue: "UNKNOWN" }),
    ]);
    expect(mapConceptToOutcome("Hospitalized", withTerms)).toBe("NOT_RECOVERED");
  });
});

describe("organization reaction corrections", () => {
  const dictionary: MedDraCodingProvider = {
    getVersion: () => "29.1",
    resolveReaction: async (text) => ({
      sourceValue: text,
      status: "UNMAPPED",
      mappingMethod: "NONE",
    }),
    resolvePreferredTerm: async () => null,
  };

  it("answers a confirmed typo from the decision, whatever its spacing or case", async () => {
    const provider = withOrgReactionTerms(dictionary, [
      mapping({
        kind: "REACTION",
        term: "Feverr",
        termKey: reactionTermKey("Feverr"),
        mappedValue: "10016558",
        mappedLabel: "Fever",
      }),
    ]);
    await expect(provider.resolveReaction("  feverr ")).resolves.toMatchObject({
      status: "MAPPED",
      code: "10016558",
      codedTerm: "Fever",
      mappingMethod: "AUTHORIZED_MAPPING_TABLE",
      sourceValue: "  feverr ",
    });
  });

  it("leaves undecided and unknown words to the dictionary", async () => {
    const provider = withOrgReactionTerms(dictionary, [
      mapping({ kind: "REACTION", term: "Rashh", termKey: reactionTermKey("Rashh") }),
    ]);
    await expect(provider.resolveReaction("Rashh")).resolves.toMatchObject({ status: "UNMAPPED" });
    await expect(provider.resolveReaction("Headache")).resolves.toMatchObject({
      status: "UNMAPPED",
    });
  });
});

describe("reporter designations match across line lists", () => {
  it("ignores case, repeated spaces and trailing punctuation", () => {
    expect(normalizeDesignationKey(" nurse. ")).toBe("NURSE");
    expect(normalizeDesignationKey("Community   Health Officer")).toBe("COMMUNITY HEALTH OFFICER");
  });

  it("an org mapping saved once applies to any spelling variant", () => {
    const config = {
      ...unconfiguredOrgRegulatoryConfig(),
      reporterQualificationMappings: [
        {
          id: "m1",
          designation: "Community Health Officer",
          designationKey: "COMMUNITY HEALTH OFFICER",
          code: "3" as const,
        },
      ],
    };
    const profile = mergeOrgRegulatoryConfigIntoProfile(verbatim, config);
    expect(
      profile.reporterQualificationMap[normalizeDesignationKey("community  health officer.")],
    ).toBe("3");
  });
});
