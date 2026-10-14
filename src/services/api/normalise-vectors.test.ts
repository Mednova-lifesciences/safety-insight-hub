import { describe, expect, it } from "vitest";
import vectors from "./normalise-vectors.json";
import { normalise } from "./linelist-normalise";

// The same cases the server's copy of the rules is tested against
// (test_normalise_vectors.py): the two can never disagree about a rule fix.
describe("normalisation rules match the shared cases", () => {
  it.each(vectors.map((v) => [v.field, v.value, v.expected, v.rule] as const))(
    "%s %j → %j (%s)",
    (field, value, expected, rule) => {
      const n = normalise(field, value);
      expect(n?.value ?? null).toBe(expected);
      expect(n?.rule ?? null).toBe(rule);
    },
  );
});
