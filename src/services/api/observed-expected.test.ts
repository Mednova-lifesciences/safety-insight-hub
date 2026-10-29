import { describe, expect, it } from "vitest";
import {
  EXPECTED_RATES,
  observedVsExpected,
  poissonExactInterval,
  gammaP,
} from "./observed-expected";
import type { LoadedCase } from "./linelist-cross-file";
import type { DuplicatePair } from "./linelist-cross-duplicates";

const rate = (id: string) => EXPECTED_RATES.find((r) => r.id === id)!;
let n = 0;
const c = (over: Partial<LoadedCase>): LoadedCase => ({
  jobId: "A",
  filename: "a.csv",
  row: ++n,
  product: "HPV",
  reaction: "Anaphylaxis",
  vaccinationDate: "2026-09-07",
  onsetDate: "2026-09-07",
  serious: true,
  ...over,
});

describe("exact Poisson interval", () => {
  it("matches published Garwood limits", () => {
    // Standard tables: 0 -> (0, 3.689); 1 -> (0.0253, 5.572); 5 -> (1.624, 11.668); 10 -> (4.795, 18.390)
    const close = (x: number, y: number) => expect(x).toBeCloseTo(y, 2);
    const [l0, u0] = poissonExactInterval(0);
    close(l0, 0);
    close(u0, 3.689);
    const [l1, u1] = poissonExactInterval(1);
    close(l1, 0.0253);
    close(u1, 5.572);
    const [l5, u5] = poissonExactInterval(5);
    close(l5, 1.624);
    close(u5, 11.668);
    const [l10, u10] = poissonExactInterval(10);
    close(l10, 4.795);
    close(u10, 18.39);
  });

  it("has a sound incomplete gamma", () => {
    expect(gammaP(1, 1)).toBeCloseTo(1 - Math.exp(-1), 10);
    expect(gammaP(3, 20)).toBeCloseTo(1, 6);
  });
});

describe("observed vs expected", () => {
  it("computes expected as doses × rate per million", () => {
    const r = observedVsExpected(rate("hpv-anaphylaxis"), 1_000_000, []);
    expect(r.expected).toBeCloseTo(1.7, 6);
    expect(r.observed).toBe(0);
    expect(r.status).toBe("NOT_ABOVE");
  });

  it("flags only when expected falls below the interval's lower bound", () => {
    // 5 cases among 100,000 HPV doses: expected 0.17, CI lower 1.62 -> flag.
    const five = [1, 2, 3, 4, 5].map(() => c({}));
    expect(observedVsExpected(rate("hpv-anaphylaxis"), 100_000, five).status).toBe(
      "ABOVE_EXPECTED",
    );
    // 1 case among 100,000: expected 0.17 < 1 but within chance (lower 0.025).
    expect(observedVsExpected(rate("hpv-anaphylaxis"), 100_000, [c({})]).status).toBe(
      "HIGHER_WITHIN_CHANCE",
    );
  });

  it("counts only the chosen vaccine and event", () => {
    const r = observedVsExpected(rate("hpv-anaphylaxis"), 10_000, [
      c({}),
      c({ product: "Measles-Rubella" }),
      c({ reaction: "Syncope" }),
    ]);
    expect(r.observed).toBe(1);
  });

  it("counts a possible duplicate once", () => {
    const a = c({});
    const b = c({ jobId: "B" });
    const pair = { a, b } as unknown as DuplicatePair;
    const r = observedVsExpected(rate("hpv-anaphylaxis"), 10_000, [a, b], [pair]);
    expect(r.observed).toBe(1);
    expect(r.excluded[0]!.reason).toMatch(/duplicate/);
  });

  it("keeps febrile seizures to WHO's 6–11 day window and says why others are left out", () => {
    const inWin = c({
      product: "MR",
      reaction: "Febrile convulsion",
      vaccinationDate: "2026-09-01",
      onsetDate: "2026-09-09",
    });
    const early = c({
      product: "MR",
      reaction: "Convulsion with fever",
      vaccinationDate: "2026-09-01",
      onsetDate: "2026-09-02",
    });
    const undated = c({ product: "MR", reaction: "Febrile seizure", onsetDate: undefined });
    const afebrile = c({
      product: "MR",
      reaction: "Seizure",
      vaccinationDate: "2026-09-01",
      onsetDate: "2026-09-08",
    });
    const r = observedVsExpected(rate("measles-febrile-seizure"), 30_000, [
      inWin,
      early,
      undated,
      afebrile,
    ]);
    expect(r.observed).toBe(1);
    expect(r.expected).toBeCloseTo(10, 6);
    expect(r.excluded.map((e) => e.reason)).toEqual([
      expect.stringMatching(/outside the 6–11 day window/),
      expect.stringMatching(/not readable/),
    ]);
  });

  it("refuses a missing dose count", () => {
    expect(() => observedVsExpected(rate("hpv-anaphylaxis"), 0, [])).toThrow(/doses/);
  });

  it("cites a WHO source with a date for every rate", () => {
    for (const r of EXPECTED_RATES) {
      expect(r.source.url).toMatch(/^https:\/\/www\.who\.int\//);
      expect(r.source.date).toMatch(/\d{4}/);
    }
  });
});
