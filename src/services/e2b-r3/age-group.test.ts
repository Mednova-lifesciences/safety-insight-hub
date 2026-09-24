import { describe, expect, it } from "vitest";
import {
  AGE_GROUP_CODELIST,
  ageInDays,
  deriveAgeGroup,
  resolveAgeGroup,
  type AgeGroupCodelist,
} from "./age-group";
import { mapSourceRecordToPVCase } from "./mapping";
import { serializeBatchToXml } from "./serializer";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";

/**
 * D.2.3.
 *
 * The derivation, the unit conversion and the boundary behaviour are all
 * implemented and exercised here against a FIXTURE codelist — deliberately
 * labelled as a fixture, so nobody mistakes it for ICH's real one. The
 * application itself ships with no codelist and emits nothing; see
 * age-group.ts for exactly which document is missing.
 */

/**
 * NOT the ICH codelist. Invented for this test alone, with codes chosen
 * to look nothing like a plausible ICH list ("T1".."T5") precisely so
 * that a copy-paste of this fixture into production would be obvious.
 */
const FIXTURE: AgeGroupCodelist = {
  provenance: "TEST FIXTURE — not an ICH codelist",
  codeSystem: "2.16.840.1.113883.3.989.2.1.1.9",
  bands: [
    { code: "T1", label: "Neonate", minDays: 0, maxDaysExclusive: 28 },
    { code: "T2", label: "Infant", minDays: 28, maxDaysExclusive: 365.25 * 2 },
    { code: "T3", label: "Child", minDays: 365.25 * 2, maxDaysExclusive: 365.25 * 12 },
    { code: "T4", label: "Adolescent", minDays: 365.25 * 12, maxDaysExclusive: 365.25 * 18 },
    { code: "T5", label: "Adult", minDays: 365.25 * 18 },
  ],
};

describe("the application ships with the official D.2.3 codelist and MedNova boundary rule", () => {
  it("has the official ICH OID configured", () => {
    expect(AGE_GROUP_CODELIST).toBeDefined();
    expect(AGE_GROUP_CODELIST?.codeSystem).toBe("2.16.840.1.113883.3.989.2.1.1.9");
  });

  it("derives the correct group from a normalized age and unit", () => {
    expect(resolveAgeGroup({ age: "50", ageUnit: "801", allowDerivation: true })?.band.code).toBe("5");
    expect(resolveAgeGroup({ reportedVerbatim: "Adult" })?.band.code).toBe("5");
  });
});

describe("age in days", () => {
  it.each([
    ["1", "801" as const, 365.25],
    ["18", "802" as const, 547.875],
    ["14", "803" as const, 98],
    ["5", "804" as const, 5],
    ["12", "805" as const, 0.5],
    ["1", "800" as const, 3652.5],
  ])("%s in unit %s is %s days", (age, unit, days) => {
    expect(ageInDays(age, unit)).toBeCloseTo(days, 6);
  });

  it("returns nothing rather than a number for a non-numeric or absent age", () => {
    expect(ageInDays("about two", "801")).toBeUndefined();
    expect(ageInDays(undefined, "801")).toBeUndefined();
    expect(ageInDays("-3", "801")).toBeUndefined();
  });

  it("refuses to convert an age whose unit is unknown", () => {
    // The whole point: 2 could be 2 years or 2 months, and the difference
    // decides the band.
    expect(ageInDays("2", undefined)).toBeUndefined();
  });
});

describe("derivation against a supplied codelist", () => {
  it.each([
    ["3", "801" as const, "T3"], // 3 years -> Child
    ["18", "802" as const, "T2"], // 18 months -> Infant
    ["14", "803" as const, "T2"], // 14 weeks -> Infant
    ["5", "804" as const, "T1"], // 5 days -> Neonate
    ["50", "801" as const, "T5"], // 50 years -> Adult
  ])("age %s in unit %s falls in band %s", (age, unit, code) => {
    expect(deriveAgeGroup(age, unit, FIXTURE)?.code).toBe(code);
  });

  // Every boundary in the fixture, from just below to exactly on it.
  // Bands are [min, max) so the boundary value belongs to the HIGHER band.
  it.each([
    [27, "T1"],
    [28, "T2"],
    [Math.ceil(365.25 * 2) - 1, "T2"],
    [Math.ceil(365.25 * 2), "T3"],
    [Math.ceil(365.25 * 12) - 1, "T3"],
    [Math.ceil(365.25 * 12), "T4"],
    [Math.ceil(365.25 * 18) - 1, "T4"],
    [Math.ceil(365.25 * 18), "T5"],
  ])("%s days falls in %s", (days, code) => {
    expect(deriveAgeGroup(String(days), "804", FIXTURE)!.code).toBe(code);
  });

  it("is deterministic", () => {
    expect(deriveAgeGroup("3", "801", FIXTURE)).toEqual(deriveAgeGroup("3", "801", FIXTURE));
  });

  it("returns nothing for an age no band covers, rather than the nearest one", () => {
    const narrow: AgeGroupCodelist = {
      ...FIXTURE,
      bands: [{ code: "T1", label: "Neonate", minDays: 0, maxDaysExclusive: 28 }],
    };
    expect(deriveAgeGroup("50", "801", narrow)).toBeUndefined();
  });

  it("never derives without a codelist", () => {
    expect(deriveAgeGroup("3", "801", undefined)).toBeUndefined();
  });
});

describe("what the reporter said outranks what the age implies", () => {
  it("uses the reporter's own words when the codelist knows them", () => {
    const out = resolveAgeGroup({
      reportedVerbatim: "Adult",
      age: "3",
      ageUnit: "801",
      codelist: FIXTURE,
      allowDerivation: true,
    });
    // D.2.3 is "Patient Age Group (as per reporter)": a 3-year-old whose
    // reporter wrote "Adult" is a data-quality problem, not an invitation
    // to substitute the derived answer.
    expect(out).toEqual({ band: FIXTURE.bands[4], from: "reported" });
  });

  it("prefers an explicitly reported age group over the mathematically derived age", () => {
    const out = resolveAgeGroup({
      reportedVerbatim: "Adult",
      age: "17",
      ageUnit: "801",
      codelist: FIXTURE,
      allowDerivation: true,
    });
    expect(out).toEqual({ band: FIXTURE.bands[4], from: "reported" });
  });

  it("resolves nothing when the reporter said something the codelist lacks", () => {
    expect(
      resolveAgeGroup({
        reportedVerbatim: "Middle-aged",
        age: "50",
        ageUnit: "801",
        codelist: FIXTURE,
        allowDerivation: true,
      }),
    ).toBeUndefined();
  });

  it("derives only when explicitly allowed", () => {
    const args = { age: "50", ageUnit: "801" as const, codelist: FIXTURE };
    expect(resolveAgeGroup(args)).toBeUndefined();
    expect(resolveAgeGroup({ ...args, allowDerivation: true })).toEqual({
      band: FIXTURE.bands[4],
      from: "derived",
    });
  });
});

describe("the official MedNova D.2.3 boundary rules", () => {
  it.each([
    ["3", "803", "1"],
    ["4", "803", "2"],
    ["1", "802", "2"],
    ["11", "802", "2"],
    ["12", "802", "3"],
    ["18", "802", "3"],
    ["1", "801", "3"],
    ["11", "801", "3"],
    ["12", "801", "4"],
    ["17", "801", "4"],
    ["18", "801", "5"],
    ["64", "801", "5"],
    ["65", "801", "6"],
    ["144", "802", "4"],
    ["216", "802", "5"],
    ["780", "802", "6"],
  ])("age %s in unit %s resolves to code %s", (age, unit, code) => {
    expect(deriveAgeGroup(age, unit as any, AGE_GROUP_CODELIST)?.code).toBe(code);
  });

  it("does not infer Foetus from a positive age", () => {
    expect(deriveAgeGroup("0", "803", AGE_GROUP_CODELIST)).toBeUndefined();
    expect(deriveAgeGroup("1", "803", AGE_GROUP_CODELIST)?.code).toBe("1");
  });
});

describe("the serializer emits D.2.3 when the age and unit are valid", () => {
  const CONFIG: E2bTransmissionConfig = {
    ...UNCONFIRMED_DEFAULT_CONFIG,
    sender: { organization: "MedNova", identifier: "MEDNOVA-SND" },
    receiver: { identifier: "NAFDAC-RCV" },
  };

  it("serializes the derived D.2.3 value for an 18-year-old", async () => {
    const { pvCase } = await mapSourceRecordToPVCase(
      {
        case_id: "OG-STRESS-001",
        patient_identifier: "A.B.",
        age: "18",
        age_unit: "years",
        reaction: "Fever",
        outcome: "Recovered",
        product: "Penta",
      },
      genericVerbatimProfile,
      CONFIG,
      { jobId: "j", sourceFile: "f.csv", sourceRow: 1, processedAt: "2026-09-23T00:00:00Z" },
      { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
    );
    const xml = serializeBatchToXml([pvCase], {
      batchId: "B1",
      senderId: "MEDNOVA-SND",
      receiverId: "NAFDAC-RCV",
      transmissionTimestamp: new Date("2026-09-23T00:00:00Z"),
    });
    expect(xml).toContain('codeSystem="2.16.840.1.113883.3.989.2.1.1.9"');
    expect(xml).toContain('code="5"');
    expect(xml).toContain('<value xsi:type="PQ" value="18" unit="a"/>');
  });
});
