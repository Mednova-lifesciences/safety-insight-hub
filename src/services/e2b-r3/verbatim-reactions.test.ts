import { describe, expect, it } from "vitest";
import { decodeReactionField, VERBATIM_NO_CODEBOOK } from "./mapping";
import { getSourceProfile, listSourceProfiles } from "./source-profiles/registry";
import { DEFAULT_SOURCE_PROFILE_ID } from "@/services/api/linelist";
import type { SourceProfile } from "./source-profiles/types";

const verbatim = getSourceProfile("generic-verbatim");
const coded = getSourceProfile("ondo-aefi");

describe("a source that writes reactions as words needs no codebook", () => {
  // Measured before this existed: a CRO-style file with plain-text
  // reactions produced 0 of 3 exportable cases, because "Abscess" was
  // looked up in Ondo's numeric codebook and quarantined as UNKNOWN_CODE.
  it("decodes plain text straight through instead of quarantining it", () => {
    const out = decodeReactionField("Abscess", verbatim);
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe("DECODED");
    expect(out[0]!.sourceTerm).toBe("Abscess");
    expect(out[0]!.localCode).toBe("Abscess");
  });

  it("records honestly that no codebook was consulted", () => {
    const out = decodeReactionField("Myalgia", verbatim);
    expect(out[0]!.codebookVersion).toBe(VERBATIM_NO_CODEBOOK);
    expect(out[0]!.sourceProfileId).toBe("generic-verbatim");
  });

  it("splits multi-value cells on the profile's declared separators only", () => {
    expect(decodeReactionField("Fever, Rash", verbatim).map((d) => d.sourceTerm)).toEqual([
      "Fever",
      "Rash",
    ]);
    expect(
      decodeReactionField("Fever; Rash / Swelling", verbatim).map((d) => d.sourceTerm),
    ).toEqual(["Fever", "Rash", "Swelling"]);
  });

  it("does not split on a period, which belongs inside real terms", () => {
    const out = decodeReactionField("1.5 cm induration", verbatim);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceTerm).toBe("1.5 cm induration");
  });

  it("still returns nothing for a blank cell", () => {
    expect(decodeReactionField("", verbatim)).toEqual([]);
    expect(decodeReactionField("   ", verbatim)).toEqual([]);
    expect(decodeReactionField(undefined, verbatim)).toEqual([]);
  });
});

describe("the coded path is untouched — no source loses its quarantine", () => {
  it("an unknown code in a CODED source still quarantines", () => {
    const out = decodeReactionField("Abscess", coded);
    expect(out[0]!.status).not.toBe("DECODED");
  });

  it("a CODED profile never silently becomes verbatim", () => {
    expect(coded.reactionEncoding === "VERBATIM").toBe(false);
  });

  it("a profile that omits the field defaults to CODED, preserving old behaviour", () => {
    const legacy = { ...coded } as SourceProfile;
    delete (legacy as { reactionEncoding?: unknown }).reactionEncoding;
    expect(decodeReactionField("Abscess", legacy)[0]!.status).not.toBe("DECODED");
  });
});

describe("the generic profile relaxes nothing else", () => {
  it("asserts no reporter-qualification mapping, so C.2.r.4 still quarantines", () => {
    // Five-value ICH codelist; no generic free-text mapping can be correct
    // for an unknown organisation, so being blocked is the right outcome.
    expect(verbatim.reporterQualificationMap).toEqual({});
  });

  it("carries no outcome or seriousness-criterion guesses", () => {
    expect(verbatim.outcomeMap).toBeUndefined();
    expect(verbatim.seriousnessCriterionMap).toBeUndefined();
  });

  it("carries an empty codebook rather than borrowing another source's", () => {
    expect(verbatim.reactionCodebook.entries).toEqual({});
    expect(verbatim.reactionCodebook.sourceId).toBe("generic-verbatim");
    expect(Object.keys(coded.reactionCodebook.entries).length).toBeGreaterThanOrEqual(0);
  });
});

describe("a job carries its own profile, and old jobs keep their behaviour", () => {
  it("the generic verbatim profile is registered and selectable", () => {
    const ids = listSourceProfiles().map((p) => p.id);
    expect(ids).toContain("generic-verbatim");
    expect(ids).toContain("ondo-aefi");
  });

  it("every registered profile declares a usable name for the picker", () => {
    for (const p of listSourceProfiles()) {
      expect(p.name.length, p.id).toBeGreaterThan(3);
    }
  });

  it("the default is the profile every existing job was processed against", () => {
    // Jobs stored before a profile could be chosen have no sourceProfileId.
    // Resolving them to anything else would silently reinterpret data that
    // has already been validated and, in some cases, exported.
    expect(DEFAULT_SOURCE_PROFILE_ID).toBe("ondo-aefi");
    expect(getSourceProfile(DEFAULT_SOURCE_PROFILE_ID).id).toBe("ondo-aefi");
  });

  it("an unregistered profile id throws rather than silently substituting", () => {
    // The callers catch this and fall back deliberately; the registry itself
    // must not paper over a bad id.
    expect(() => getSourceProfile("no-such-profile")).toThrow(/Unknown source profile/);
  });
});
