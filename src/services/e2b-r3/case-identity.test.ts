import { describe, expect, it } from "vitest";
import { buildCaseSafetyReportId, resolveCaseSafetyReportId } from "./case-identifier";

/**
 * C.1.1 is the number a regulator and a reporting facility use to talk
 * about the same case. The organisation's rule is that a case identifier
 * the SOURCE issued travels unchanged; only an identifier this
 * application had to invent gets qualified, because there is no source
 * value to distort in that case.
 */
describe("C.1.1 from a source that issued its own case identifier", () => {
  const qualified = { country: "NG", organisation: "MedNova" };

  it("exports the source's identifier exactly as written", () => {
    expect(
      resolveCaseSafetyReportId({ sourceCaseId: "OG-901", generatedCaseNumber: "x", ...qualified }),
    ).toEqual({ id: "OG-901", from: "source" });
  });

  it("adds no country, organisation, regulator or configured prefix", () => {
    const { id } = resolveCaseSafetyReportId({
      sourceCaseId: "OG-901",
      generatedCaseNumber: "x",
      country: "NG",
      organisation: "NAFDAC",
    });
    expect(id).toBe("OG-901");
    for (const fragment of ["NG-", "NAFDAC", "MEDNOVA", "-NG"]) {
      expect(id).not.toContain(fragment);
    }
  });

  it("keeps punctuation a real AEFI register uses", () => {
    // buildCaseSafetyReportId strips these; preserving them is the whole
    // point of the source branch, since "OG/AEFI/2026/0413" is what is
    // written in the facility's book.
    for (const raw of ["OG/AEFI/2026/0413", "OG.901", "OG 901/B", "NIE-ODS-ANG-25-001"]) {
      expect(
        resolveCaseSafetyReportId({ sourceCaseId: raw, generatedCaseNumber: "x", ...qualified }).id,
      ).toBe(raw);
    }
  });

  it("trims surrounding whitespace and nothing else", () => {
    expect(
      resolveCaseSafetyReportId({
        sourceCaseId: "  OG-901  ",
        generatedCaseNumber: "x",
        ...qualified,
      }).id,
    ).toBe("OG-901");
  });

  it("is stable: the same source identifier always gives the same C.1.1", () => {
    const once = resolveCaseSafetyReportId({
      sourceCaseId: "OG-901",
      generatedCaseNumber: "x",
      ...qualified,
    });
    const twice = resolveCaseSafetyReportId({
      sourceCaseId: "OG-901",
      generatedCaseNumber: "y",
      ...qualified,
    });
    expect(once.id).toBe(twice.id);
  });

  it("does not re-qualify its own output", () => {
    const first = resolveCaseSafetyReportId({
      sourceCaseId: "OG-901",
      generatedCaseNumber: "x",
      ...qualified,
    }).id;
    expect(
      resolveCaseSafetyReportId({ sourceCaseId: first, generatedCaseNumber: "x", ...qualified }).id,
    ).toBe("OG-901");
  });

  it("treats a blank or whitespace-only cell as no identifier at all", () => {
    for (const empty of ["", "   ", undefined]) {
      const out = resolveCaseSafetyReportId({
        sourceCaseId: empty,
        generatedCaseNumber: "JOB1-7",
        ...qualified,
      });
      expect(out.from).toBe("generated");
      // Never fabricated: the generated number is built from the job and
      // row the caller supplied, not from thin air.
      expect(out.id).toContain("JOB1-7");
    }
  });
});

describe("C.1.1 for a row that had no case identifier of its own", () => {
  it("still qualifies the number this application invented", () => {
    // Nothing is being preserved here — the number exists only because
    // the row had none — so the qualification that makes it unique beyond
    // a single upload is kept.
    expect(
      resolveCaseSafetyReportId({
        sourceCaseId: undefined,
        generatedCaseNumber: "LL7-3",
        country: "NG",
        organisation: "MedNova",
      }),
    ).toEqual({ id: "NG-MEDNOVA-LL7-3", from: "generated" });
  });

  it("matches buildCaseSafetyReportId exactly, so the two cannot drift", () => {
    const parts = { country: "KE", organisation: "Pharma Kenya Ltd", caseNumber: "LL7-3" };
    expect(
      resolveCaseSafetyReportId({
        sourceCaseId: undefined,
        generatedCaseNumber: parts.caseNumber,
        country: parts.country,
        organisation: parts.organisation,
      }).id,
    ).toBe(buildCaseSafetyReportId(parts));
  });
});
