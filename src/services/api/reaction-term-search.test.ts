import { describe, expect, it, vi } from "vitest";

vi.mock("./coding", () => ({
  coding: {
    searchDictionary: vi.fn(async (_d: string, q: string) => {
      const dict: Record<string, { term: string; code: string }[]> = {
        fever: [
          { term: "Fever", code: "10016558" },
          { term: "Fever neonatal", code: "10016565" },
        ],
        crying: [
          { term: "Persistent crying", code: "10069592" },
          { term: "Crying", code: "10011469" },
        ],
      };
      return (dict[q.toLowerCase()] ?? []).map((h) => ({ ...h, source: "dictionary" }));
    }),
  },
}));

import { rankHits, searchMedDra, searchWordsOf, startingQuery } from "./reaction-term-search";

describe("searching MedDRA from a local reaction phrase", () => {
  it("picks the words worth looking up, the bracketed explanation first", () => {
    expect(searchWordsOf("Hotness of body (fever 38oC and above)")).toEqual(["fever", "hotness"]);
    expect(searchWordsOf("Persistent cries (more than 3 hours)")).toEqual(["persistent", "cries"]);
  });

  it("starts the box with the AI's term, or the phrase without its brackets", () => {
    expect(startingQuery("Hotness of body (fever 38oC and above)", { term: "Pyrexia" })).toBe(
      "Pyrexia",
    );
    expect(startingQuery("Hotness of body (fever 38oC and above)", null)).toBe("Hotness of body");
  });

  it("puts the exact term first", () => {
    const ranked = rankHits(
      [
        { term: "Persistent crying", code: "1" },
        { term: "Crying", code: "2" },
      ],
      "Crying",
    );
    expect(ranked[0]!.term).toBe("Crying");
  });

  it("a whole local phrase that matches nothing still finds terms by its words", async () => {
    const r = await searchMedDra("Hotness of body (fever 38oC and above)");
    expect(r.byWords).toEqual(["fever"]);
    expect(r.hits.map((h) => h.term)).toEqual(["Fever", "Fever neonatal"]);
  });

  it("a direct hit is used as is", async () => {
    const r = await searchMedDra("Crying");
    expect(r.byWords).toEqual([]);
    expect(r.hits[0]!.term).toBe("Crying");
  });

  it("nothing at all is an empty result, not an error", async () => {
    expect(await searchMedDra("zzzz qqqq")).toEqual({ hits: [], byWords: [] });
  });
});
