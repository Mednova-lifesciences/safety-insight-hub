import { describe, expect, it } from "vitest";
import {
  ALL_REACTION_OUTCOMES,
  mergeOrgRegulatoryConfigIntoProfile,
  normalizeDesignationKey,
  reporterQualificationLookup,
  unconfiguredOrgRegulatoryConfig,
  type OrgRegulatoryConfig,
} from "./regulatory-config";
import { UNCONFIRMED_SENTINEL } from "./transmission-config";
import { ondoAefiProfile } from "./source-profiles/ondo-aefi";

describe("unconfiguredOrgRegulatoryConfig", () => {
  it("is honestly unconfigured everywhere — never a working default", () => {
    const c = unconfiguredOrgRegulatoryConfig();
    expect(c.transmission.sender.organization).toBe(UNCONFIRMED_SENTINEL);
    expect(c.transmission.sender.identifier).toBe(UNCONFIRMED_SENTINEL);
    expect(c.transmission.receiver.identifier).toBe(UNCONFIRMED_SENTINEL);
    expect(c.transmission.reportTypeConfirmed).toBe(false);
    expect(c.outcomeCodes).toEqual({});
    expect(c.reporterQualificationMappings).toEqual([]);
  });

  it("never claims a code for any of the six outcomes", () => {
    const c = unconfiguredOrgRegulatoryConfig();
    for (const outcome of ALL_REACTION_OUTCOMES) {
      expect(c.outcomeCodes[outcome]).toBeUndefined();
    }
  });
});

describe("normalizeDesignationKey", () => {
  it("trims and uppercases, matching mapping.ts's own normalization", () => {
    expect(normalizeDesignationKey("  chew ")).toBe("CHEW");
    expect(normalizeDesignationKey("Community Informant")).toBe("COMMUNITY INFORMANT");
  });
});

describe("reporterQualificationLookup", () => {
  it("includes only mappings that have an actual configured code", () => {
    const lookup = reporterQualificationLookup([
      { id: "1", designation: "CHEW", designationKey: "CHEW", code: "3" },
      { id: "2", designation: "CHO", designationKey: "CHO", code: undefined },
      { id: "3", designation: "Midwife", designationKey: "MIDWIFE", code: "3" },
    ]);
    expect(lookup).toEqual({ CHEW: "3", MIDWIFE: "3" });
    expect(lookup["CHO"]).toBeUndefined();
  });
});

describe("mergeOrgRegulatoryConfigIntoProfile — the org-level reporter-qualification override", () => {
  it("keeps the base profile's own hardcoded map as a seed when the org has no mappings", () => {
    const config: OrgRegulatoryConfig = {
      ...unconfiguredOrgRegulatoryConfig(),
      reporterQualificationMappings: [],
    };
    const merged = mergeOrgRegulatoryConfigIntoProfile(ondoAefiProfile, config);
    expect(merged.reporterQualificationMap["CHEW"]).toBe(
      ondoAefiProfile.reporterQualificationMap["CHEW"],
    );
  });

  it("layers a NEW, non-Ondo-specific designation an org configured on top of the seed — proving this is not an Ondo-only converter", () => {
    // "OIC" and "DENTAL" are never mentioned anywhere in ondo-aefi.ts's
    // hardcoded map — this must still work via the org's own persisted
    // configuration, with no code change required to support it.
    const config: OrgRegulatoryConfig = {
      ...unconfiguredOrgRegulatoryConfig(),
      reporterQualificationMappings: [
        { id: "1", designation: "OIC", designationKey: "OIC", code: "3" },
        { id: "2", designation: "DENTAL", designationKey: "DENTAL", code: "1" },
      ],
    };
    const merged = mergeOrgRegulatoryConfigIntoProfile(ondoAefiProfile, config);
    expect(merged.reporterQualificationMap["OIC"]).toBe("3");
    expect(merged.reporterQualificationMap["DENTAL"]).toBe("1");
    // The seed's own entries are still present alongside the org's new ones.
    expect(merged.reporterQualificationMap["CHEW"]).toBe(
      ondoAefiProfile.reporterQualificationMap["CHEW"],
    );
  });

  it("an org's own persisted mapping wins over the profile's hardcoded seed on conflict", () => {
    const config: OrgRegulatoryConfig = {
      ...unconfiguredOrgRegulatoryConfig(),
      reporterQualificationMappings: [
        { id: "1", designation: "CHEW", designationKey: "CHEW", code: "5" },
      ],
    };
    const merged = mergeOrgRegulatoryConfigIntoProfile(ondoAefiProfile, config);
    expect(merged.reporterQualificationMap["CHEW"]).toBe("5");
  });

  it("a discovered-but-unconfigured designation (code undefined) never overrides the seed with an absent key", () => {
    const config: OrgRegulatoryConfig = {
      ...unconfiguredOrgRegulatoryConfig(),
      reporterQualificationMappings: [
        { id: "1", designation: "CHO", designationKey: "CHO", code: undefined },
      ],
    };
    const merged = mergeOrgRegulatoryConfigIntoProfile(ondoAefiProfile, config);
    // CHO already has a seed entry (from ondo-aefi.ts) — an unconfigured
    // org row must never blank it out.
    expect(merged.reporterQualificationMap["CHO"]).toBe(
      ondoAefiProfile.reporterQualificationMap["CHO"],
    );
  });

  it("never mutates the base profile object", () => {
    const before = { ...ondoAefiProfile.reporterQualificationMap };
    const config: OrgRegulatoryConfig = {
      ...unconfiguredOrgRegulatoryConfig(),
      reporterQualificationMappings: [
        { id: "1", designation: "MIDWIFE", designationKey: "MIDWIFE", code: "3" },
      ],
    };
    mergeOrgRegulatoryConfigIntoProfile(ondoAefiProfile, config);
    expect(ondoAefiProfile.reporterQualificationMap).toEqual(before);
  });
});
