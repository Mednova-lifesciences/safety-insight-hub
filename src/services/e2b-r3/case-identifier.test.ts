import { describe, expect, it } from "vitest";
import { buildCaseSafetyReportId, MAX_CASE_SAFETY_REPORT_ID_LENGTH } from "./case-identifier";

describe("C.1.1 — sender's case safety report identifier", () => {
  it("is country–organisation–report number, as the spec states", () => {
    expect(
      buildCaseSafetyReportId({ country: "NG", organisation: "MedNova", caseNumber: "000112" }),
    ).toBe("NG-MEDNOVA-000112");
  });

  it("keeps the source's own case number readable inside it", () => {
    expect(
      buildCaseSafetyReportId({ country: "NG", organisation: "MedNova", caseNumber: "OG-901" }),
    ).toBe("NG-MEDNOVA-OG-901");
  });

  it("belongs to whichever organization and country the configuration names", () => {
    expect(
      buildCaseSafetyReportId({ country: "ke", organisation: "Pharma Kenya Ltd", caseNumber: "7" }),
    ).toBe("KE-PHARMAKENYALTD-7");
  });

  it("never puts a hyphen inside the organisation segment", () => {
    expect(
      buildCaseSafetyReportId({ country: "NG", organisation: "Med-Nova", caseNumber: "5" }),
    ).toBe("NG-MEDNOVA-5");
  });

  it("gives the same case the same identifier every time it is generated", () => {
    const parts = { country: "NG", organisation: "MedNova", caseNumber: "OG-901" };
    expect(buildCaseSafetyReportId(parts)).toBe(buildCaseSafetyReportId({ ...parts }));
  });

  it("does not qualify a number that is already qualified", () => {
    // The mapping layer's caseIdPrefix already produces qualified numbers
    // for rows with no case id of their own; applying this twice must not
    // produce NG-NG-MEDNOVA-1.
    const once = buildCaseSafetyReportId({
      country: "NG",
      organisation: "MedNova",
      caseNumber: "NG-MEDNOVA-LLTEST-1",
    });
    expect(once).toBe("NG-MEDNOVA-LLTEST-1");
    expect(
      buildCaseSafetyReportId({ country: "NG", organisation: "MedNova", caseNumber: once }),
    ).toBe(once);
  });

  it("adds only the segments that are missing", () => {
    expect(
      buildCaseSafetyReportId({
        country: "NG",
        organisation: "MedNova",
        caseNumber: "NG-OG-901",
      }),
    ).toBe("NG-MEDNOVA-NG-OG-901");
  });

  it("leaves out a country it does not have rather than inventing one", () => {
    expect(buildCaseSafetyReportId({ organisation: "MedNova", caseNumber: "OG-901" })).toBe(
      "MEDNOVA-OG-901",
    );
    expect(
      buildCaseSafetyReportId({ country: "Nigeria", organisation: "MedNova", caseNumber: "1" }),
    ).toBe("MEDNOVA-1");
  });

  it("never lets unconfirmed configuration into a regulatory identifier", () => {
    expect(
      buildCaseSafetyReportId({
        country: "NG",
        organisation: "__UNCONFIRMED__",
        caseNumber: "OG-901",
      }),
    ).toBe("NG-OG-901");
  });

  it("drops characters an identifier cannot carry", () => {
    expect(
      buildCaseSafetyReportId({ country: "NG", organisation: "MedNova", caseNumber: "OG 901/B" }),
    ).toBe("NG-MEDNOVA-OG901B");
  });

  it("returns the case number alone when there is nothing to qualify it with", () => {
    expect(buildCaseSafetyReportId({ caseNumber: "OG-901" })).toBe("OG-901");
  });

  it("stays within 100AN by shortening the organisation, never the case number", () => {
    const caseNumber = "OG-" + "9".repeat(60);
    const id = buildCaseSafetyReportId({
      country: "NG",
      organisation: "A".repeat(80),
      caseNumber,
    });
    expect(id.length).toBeLessThanOrEqual(MAX_CASE_SAFETY_REPORT_ID_LENGTH);
    expect(id.endsWith(caseNumber)).toBe(true);
    expect(id.startsWith("NG-")).toBe(true);
  });

  it("gives different cases different identifiers", () => {
    const of = (caseNumber: string) =>
      buildCaseSafetyReportId({ country: "NG", organisation: "MedNova", caseNumber });
    const ids = ["OG-901", "OG-902", "OG-903"].map(of);
    expect(new Set(ids).size).toBe(3);
  });
});
