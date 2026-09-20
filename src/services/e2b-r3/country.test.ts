import { describe, expect, it } from "vitest";
import {
  isIsoCountryCode,
  MEDNOVA_COUNTRY_FALLBACK,
  resolveCountryCode,
  resolveReactionCountry,
  resolveReporterCountry,
} from "./country";

describe("ISO 3166-1 alpha-2 resolution", () => {
  it.each([
    ["NG", "NG"],
    ["KE", "KE"],
    ["GH", "GH"],
    ["GB", "GB"],
    ["US", "US"],
  ])("accepts the assigned code %s", (input, expected) => {
    expect(resolveCountryCode(input)).toBe(expected);
  });

  it.each([
    ["ng", "NG"],
    ["ke", "KE"],
    [" gh ", "GH"],
    ["Gb", "GB"],
  ])("normalises %s to upper case", (input, expected) => {
    expect(resolveCountryCode(input)).toBe(expected);
  });

  it.each([
    ["Nigeria", "NG"],
    ["NIGERIA", "NG"],
    ["Kenya", "KE"],
    ["Ghana", "GH"],
    ["United Kingdom", "GB"],
    ["UK", "GB"],
    ["United States of America", "US"],
    ["USA", "US"],
    ["Cote d'Ivoire", "CI"],
  ])("understands the country name %s", (input, expected) => {
    expect(resolveCountryCode(input)).toBe(expected);
  });

  it.each(["XX", "ZZ", "QQ", "OO"])("rejects %s — two letters that name no country", (input) => {
    expect(resolveCountryCode(input)).toBeUndefined();
    expect(isIsoCountryCode(input)).toBe(false);
  });

  it.each([undefined, null, "", "   ", "N", "NGA", "12", "Atlantis", "Lagos", "MedNova"])(
    "resolves %s to nothing rather than guessing",
    (input) => {
      expect(resolveCountryCode(input)).toBeUndefined();
    },
  );
});

describe("C.2.r.3 — the reporter's country", () => {
  it("takes what the row says, when the line list has such a column", () => {
    expect(resolveReporterCountry({ row: "Kenya", profile: "NG" })).toEqual({
      code: "KE",
      from: "row",
    });
  });

  it("falls back to the source profile's country when the row is silent", () => {
    expect(resolveReporterCountry({ row: undefined, profile: "NG" })).toEqual({
      code: "NG",
      from: "profile",
    });
  });

  it("applies the application fallback when nothing answers", () => {
    expect(resolveReporterCountry({})).toEqual({ code: "NG", from: "fallback" });
    expect(MEDNOVA_COUNTRY_FALLBACK).toBe("NG");
  });

  it("applies the fallback rather than trusting a value that names no country", () => {
    expect(resolveReporterCountry({ row: "XX" })).toEqual({ code: "NG", from: "fallback" });
    expect(resolveReporterCountry({ row: "ZZ", profile: "ZZ" })).toEqual({
      code: "NG",
      from: "fallback",
    });
  });

  it("says where the answer came from, so a fallback is never mistaken for data", () => {
    expect(resolveReporterCountry({ row: "GH" }).from).toBe("row");
    expect(resolveReporterCountry({ profile: "GH" }).from).toBe("profile");
    expect(resolveReporterCountry({}).from).toBe("fallback");
  });
});

describe("E.i.9 — the country the reaction occurred in", () => {
  it("is only ever what the source says", () => {
    expect(resolveReactionCountry("Ghana")).toBe("GH");
    expect(resolveReactionCountry("gh")).toBe("GH");
  });

  it("has no fallback: an unknown place of occurrence stays unknown", () => {
    expect(resolveReactionCountry(undefined)).toBeUndefined();
    expect(resolveReactionCountry("")).toBeUndefined();
    expect(resolveReactionCountry("XX")).toBeUndefined();
  });

  it("is not the reporter's country", () => {
    // The two resolvers share no state and no defaulting: a reporter in
    // Kenya reporting an event in Nigeria yields both facts, unmerged.
    const reporter = resolveReporterCountry({ row: "KE" });
    const reaction = resolveReactionCountry("NG");
    expect(reporter.code).toBe("KE");
    expect(reaction).toBe("NG");
  });
});
