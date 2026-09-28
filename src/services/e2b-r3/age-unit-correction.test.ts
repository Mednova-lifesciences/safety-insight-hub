import { describe, expect, it } from "vitest";
import {
  AGE_UNIT_CHOICES,
  applyAgeUnitCorrection,
  isAgeUnitCode,
  needsAgeUnitConfirmation,
} from "./age-unit-correction";
import { mapSourceRecordToPVCase } from "./mapping";
import { serializeBatchToXml } from "./serializer";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";
import { AGE_UNIT_UCUM } from "./types";

/**
 * D.2.2b — the user correction path and its audit trail.
 *
 * The property under test throughout: the source's own value is never
 * overwritten, and an exported age unit always says where it came from
 * and whether a person agreed to it.
 */

const CONFIG: E2bTransmissionConfig = {
  ...UNCONFIRMED_DEFAULT_CONFIG,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND" },
  receiver: { identifier: "NAFDAC-RCV" },
};

async function caseFor(row: Record<string, string | undefined>) {
  return mapSourceRecordToPVCase(
    {
      case_id: "OG-901",
      patient_identifier: "A.B.",
      product: "Penta",
      reaction: "Fever",
      outcome: "Recovered",
      ...row,
    },
    genericVerbatimProfile,
    CONFIG,
    { jobId: "j", sourceFile: "f.csv", sourceRow: 1, processedAt: "2026-09-28T00:00:00Z" },
    { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
  );
}

describe("the unit choices offered to a reviewer", () => {
  it("are the E2B age units, each with the UCUM symbol it serializes to", () => {
    expect(AGE_UNIT_CHOICES.map((c) => c.code)).toEqual(["801", "802", "803", "804", "805", "800"]);
    for (const choice of AGE_UNIT_CHOICES) {
      expect(choice.ucum).toBe(AGE_UNIT_UCUM[choice.code]);
    }
  });

  it("recognises only real unit codes", () => {
    expect(isAgeUnitCode("802")).toBe(true);
    expect(isAgeUnitCode("years")).toBe(false);
    expect(isAgeUnitCode("806")).toBe(false);
  });
});

describe("the audit trail the mapper lays down", () => {
  it("records a unit the source stated, as stated, with no assumption", async () => {
    const { pvCase } = await caseFor({ age: "6", age_unit: "months" });
    expect(pvCase.patient.ageUnitCorrection).toMatchObject({
      original: "months",
      proposed: "802",
      final: "802",
      basis: "source",
      confidence: "high",
      confirmedByUser: false,
    });
    expect(pvCase.patient.ageUnitAssumed).toBeUndefined();
  });

  it("records a unit read out of the age cell itself", async () => {
    const { pvCase } = await caseFor({ age: "18 months" });
    expect(pvCase.patient.ageUnitCorrection).toMatchObject({
      proposed: "802",
      final: "802",
      basis: "age-cell",
      confidence: "high",
    });
    // No age-unit COLUMN existed, so there is no original cell to quote.
    expect(pvCase.patient.ageUnitCorrection?.original).toBeUndefined();
  });

  it("marks the years default as low-confidence and unconfirmed", async () => {
    const { pvCase } = await caseFor({ age: "2" });
    expect(pvCase.patient.ageUnitCorrection).toMatchObject({
      proposed: "801",
      final: "801",
      basis: "default",
      confidence: "low",
      confirmedByUser: false,
    });
    expect(pvCase.patient.ageUnitCorrection?.reason).toContain("years default");
  });

  it("lays down no trail when there is no age to qualify", async () => {
    const { pvCase } = await caseFor({});
    expect(pvCase.patient.ageUnitCorrection).toBeUndefined();
  });
});

describe("which cases a reviewer is asked about", () => {
  it("asks about an assumed unit", async () => {
    const { pvCase } = await caseFor({ age: "2" });
    expect(needsAgeUnitConfirmation(pvCase.patient)).toBe(true);
  });

  it("does not ask when the source stated the unit", async () => {
    const { pvCase } = await caseFor({ age: "2", age_unit: "years" });
    expect(needsAgeUnitConfirmation(pvCase.patient)).toBe(false);
  });

  it("does not ask again once someone has answered", async () => {
    const { pvCase } = await caseFor({ age: "2" });
    const corrected = applyAgeUnitCorrection(pvCase.patient, "801", {
      confirmedAt: "2026-09-28T10:00:00Z",
    });
    expect(needsAgeUnitConfirmation(corrected)).toBe(false);
  });
});

describe("applying a reviewer's decision", () => {
  it("changes the unit and records the change, keeping what was proposed", async () => {
    const { pvCase } = await caseFor({ age: "2" });
    const corrected = applyAgeUnitCorrection(pvCase.patient, "802", {
      confirmedAt: "2026-09-28T10:00:00Z",
    });
    expect(corrected.ageUnit).toBe("802");
    expect(corrected.ageUnitAssumed).toBe(false);
    expect(corrected.ageUnitCorrection).toMatchObject({
      proposed: "801",
      final: "802",
      basis: "user",
      confidence: "high",
      confirmedByUser: true,
      confirmedAt: "2026-09-28T10:00:00Z",
    });
    expect(corrected.ageUnitCorrection?.reason).toContain("Years to Months");
  });

  it("treats agreeing with the proposal as a real confirmation", async () => {
    const { pvCase } = await caseFor({ age: "2" });
    const corrected = applyAgeUnitCorrection(pvCase.patient, "801", {
      confirmedAt: "2026-09-28T10:00:00Z",
    });
    // Same value, but no longer an assumption nobody checked.
    expect(corrected.ageUnit).toBe("801");
    expect(corrected.ageUnitCorrection?.confirmedByUser).toBe(true);
    expect(corrected.ageUnitCorrection?.reason).toContain("confirmed");
  });

  it("never overwrites what the source said", async () => {
    // The source said "years"; a reviewer overrides to months. The
    // source's own word must survive the override.
    const { pvCase } = await caseFor({ age: "2", age_unit: "years" });
    const corrected = applyAgeUnitCorrection(pvCase.patient, "802", {
      confirmedAt: "2026-09-28T10:00:00Z",
      reason: "The register records under-fives in months.",
    });
    expect(corrected.ageUnitCorrection?.original).toBe("years");
    expect(corrected.ageUnitCorrection?.final).toBe("802");
    expect(corrected.ageUnitCorrection?.reason).toBe("The register records under-fives in months.");
    // And the age VALUE is untouched by a unit correction.
    expect(corrected.age).toBe("2");
  });

  it("does not mutate the patient it was given", async () => {
    const { pvCase } = await caseFor({ age: "2" });
    const before = JSON.stringify(pvCase.patient);
    applyAgeUnitCorrection(pvCase.patient, "804", { confirmedAt: "2026-09-28T10:00:00Z" });
    expect(JSON.stringify(pvCase.patient)).toBe(before);
  });

  it("does nothing for a patient with no age", async () => {
    const { pvCase } = await caseFor({});
    expect(applyAgeUnitCorrection(pvCase.patient, "802", { confirmedAt: "x" })).toBe(
      pvCase.patient,
    );
  });

  it("carries the corrected unit through to the XML as UCUM", async () => {
    const { pvCase } = await caseFor({ age: "2" });
    const corrected = {
      ...pvCase,
      patient: applyAgeUnitCorrection(pvCase.patient, "802", {
        confirmedAt: "2026-09-28T10:00:00Z",
      }),
    };
    const xml = serializeBatchToXml([corrected], {
      batchId: "B1",
      senderId: "MEDNOVA-SND",
      receiverId: "NAFDAC-RCV",
      transmissionTimestamp: new Date("2026-09-28T00:00:00Z"),
    });
    expect(xml).toContain('<value xsi:type="PQ" value="2" unit="mo"/>');
    expect(xml).not.toContain('unit="a"');
  });
});
