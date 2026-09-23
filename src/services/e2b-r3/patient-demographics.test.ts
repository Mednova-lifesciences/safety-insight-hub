import { describe, expect, it } from "vitest";
import { mapColumnsByKeywords } from "../api/tabular-parse";
import { FIELD_KEYWORDS } from "../api/linelist";
import {
  applyColumnMap,
  mapAgeUnit,
  mapSex,
  mapSourceRecordToPVCase,
  splitAgeValue,
} from "./mapping";
import { serializeBatchToXml } from "./serializer";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";

/**
 * D.1 / D.2 / D.5 — patient demographics, from the header a real
 * spreadsheet writes all the way to the bytes that leave the system.
 *
 * The concepts here are deliberately independent: a name is not a record
 * number, an age is not an age group, a date of birth is not an age, and
 * a sex is not derivable from any of them. Most of what follows exists to
 * prove one of those separations still holds.
 */

const CONFIG: E2bTransmissionConfig = {
  ...UNCONFIRMED_DEFAULT_CONFIG,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND" },
  receiver: { identifier: "NAFDAC-RCV" },
};

const providers = { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider };

async function caseFor(row: Record<string, string | undefined>, sourceRow = 1) {
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
    { jobId: "job-d", sourceFile: "d.csv", sourceRow, processedAt: "2026-09-22T00:00:00Z" },
    providers,
  );
}

async function xmlFor(row: Record<string, string | undefined>) {
  const { pvCase } = await caseFor(row);
  return serializeBatchToXml([pvCase], {
    batchId: "B1",
    senderId: "MEDNOVA-SND",
    receiverId: "NAFDAC-RCV",
    transmissionTimestamp: new Date("2026-09-22T00:00:00Z"),
  });
}

describe("header variants reach the right demographic concept", () => {
  // The header normalizer folds case, spaces, punctuation and diacritics
  // before matching, so many of these are one substring by the time the
  // keyword table sees them. They are listed anyway because they are the
  // spellings real files use, and a regression here stays invisible until
  // an export is quietly missing a field.
  it.each([
    ["Sex", "sex"],
    ["SEX", "sex"],
    ["sex", "sex"],
    ["Patient Sex", "sex"],
    ["Patient's Sex", "sex"],
    ["Pt. Sex", "sex"],
    ["PT SEX", "sex"],
    ["Sex of Patient", "sex"],
    ["Biological Sex", "sex"],
    ["PatientSex", "sex"],
    ["Gender", "sex"],
    ["Patient Gender", "sex"],
    ["Pt Gender", "sex"],
    ["Gender of Patient", "sex"],
    ["Age", "age"],
    ["AGE", "age"],
    ["Patient Age", "age"],
    ["Patient's Age", "age"],
    ["Pt Age", "age"],
    ["PatientAge", "age"],
    ["Age at Onset", "age"],
    ["Age at Reaction", "age"],
    ["Age at Event", "age"],
    ["Age Unit", "age_unit"],
    ["Age Units", "age_unit"],
    ["Unit of Age", "age_unit"],
    ["Age Group", "age_group"],
    ["Age group", "age_group"],
    ["Age Band", "age_group"],
    ["Age Category", "age_group"],
    ["DOB", "date_of_birth"],
    ["Date of Birth", "date_of_birth"],
    ["Birth Date", "date_of_birth"],
    ["Patient DOB", "date_of_birth"],
    ["Date Born", "date_of_birth"],
  ])("%s maps to %s", (header, field) => {
    expect(mapColumnsByKeywords([header], FIELD_KEYWORDS)[header]).toBe(field);
  });

  it("keeps the four age concepts apart when one file carries all of them", () => {
    const headers = ["Age", "Age Unit", "Age Group", "Date of Birth"];
    expect(mapColumnsByKeywords(headers, FIELD_KEYWORDS)).toEqual({
      Age: "age",
      "Age Unit": "age_unit",
      "Age Group": "age_group",
      "Date of Birth": "date_of_birth",
    });
  });

  it("does not read a dosage column as an age, though 'dosage' contains 'age'", () => {
    expect(mapColumnsByKeywords(["Dosage"], FIELD_KEYWORDS)["Dosage"]).not.toBe("age");
  });
});

describe("sex values", () => {
  it.each([
    ["M", "MALE"],
    ["m", "MALE"],
    ["Male", "MALE"],
    ["MALE", "MALE"],
    ["Man", "MALE"],
    ["F", "FEMALE"],
    ["Female", "FEMALE"],
    ["female", "FEMALE"],
    ["Woman", "FEMALE"],
    ["Unknown", "UNKNOWN_NOT_SPECIFIED"],
    ["Not known", "UNKNOWN_NOT_SPECIFIED"],
    ["Not reported", "UNKNOWN_NOT_SPECIFIED"],
    ["Unspecified", "UNKNOWN_NOT_SPECIFIED"],
  ])("%s maps to %s", (raw, code) => {
    expect(mapSex(raw)).toBe(code);
  });

  it("serializes D.5 on ISO 5218, including 0 for a reported unknown", async () => {
    expect(await xmlFor({ sex: "F" })).toContain(
      '<administrativeGenderCode code="2" codeSystem="1.0.5218"/>',
    );
    expect(await xmlFor({ sex: "M" })).toContain(
      '<administrativeGenderCode code="1" codeSystem="1.0.5218"/>',
    );
    expect(await xmlFor({ sex: "Unknown" })).toContain(
      '<administrativeGenderCode code="0" codeSystem="1.0.5218"/>',
    );
  });

  it("omits D.5 entirely — never an empty element — when the file has no sex", async () => {
    expect(await xmlFor({})).not.toContain("administrativeGenderCode");
  });

  it("keeps an unrecognised value for review instead of guessing at it", async () => {
    const { pvCase, warnings } = await caseFor({ sex: "Intersex" });
    expect(pvCase.patient.sex).toBeUndefined();
    expect(pvCase.patient.sexVerbatim).toBe("Intersex");
    expect(warnings.some((w) => w.field === "sex")).toBe(true);
    // Unresolved means absent from the export, not guessed into it.
    expect(await xmlFor({ sex: "Intersex" })).not.toContain("administrativeGenderCode");
  });
});

describe("age, its unit, and what happens when the unit is missing", () => {
  it.each([
    ["years", "801"],
    ["Year", "801"],
    ["Y", "801"],
    ["yrs", "801"],
    ["months", "802"],
    ["Month", "802"],
    ["mo", "802"],
    ["weeks", "803"],
    ["W", "803"],
    ["days", "804"],
    ["D", "804"],
    ["hours", "805"],
    ["H", "805"],
  ])("%s maps to the E2B age unit %s", (raw, code) => {
    expect(mapAgeUnit(raw)).toBe(code);
  });

  it("reads a unit written inside the age cell itself", () => {
    expect(splitAgeValue("18 months")).toEqual({ value: "18", unit: "802" });
    expect(splitAgeValue("3yrs")).toEqual({ value: "3", unit: "801" });
    expect(splitAgeValue("6")).toEqual({ value: "6" });
  });

  it("hands back an unparseable age cell untouched rather than inventing a number", () => {
    expect(splitAgeValue("about two")).toEqual({ value: "about two" });
    expect(splitAgeValue("2 kids")).toEqual({ value: "2 kids" });
  });

  it("uses a stated unit and records no assumption against it", async () => {
    const { pvCase, warnings } = await caseFor({ age: "6", age_unit: "months" });
    expect(pvCase.patient.ageUnit).toBe("802");
    expect(pvCase.patient.ageUnitAssumed).toBeUndefined();
    expect(warnings.some((w) => w.field === "age")).toBe(false);
  });

  it("defaults to years when nothing states a unit, warns, and does not block", async () => {
    const { pvCase, warnings } = await caseFor({ age: "2" });
    expect(pvCase.patient.ageUnit).toBe("801");
    expect(pvCase.patient.ageUnitAssumed).toBe(true);
    expect(warnings.map((w) => w.field)).toContain("age");
    // The case is still exportable: a missing unit is a review notice,
    // never a barrier.
    expect(await xmlFor({ age: "2" })).toContain('displayName="age"');
  });

  it("puts the age on the wire as UCUM, not as the internal E2B code", async () => {
    // PQ/@unit is typed `cs` in the ICH schema set and documented there as
    // a UCUM expression; "801" and "802" would be neither.
    const xml = await xmlFor({ age: "18", age_unit: "months" });
    expect(xml).toContain('<value xsi:type="PQ" value="18" unit="mo"/>');
    expect(xml).not.toContain('unit="802"');
    expect(await xmlFor({ age: "2" })).toContain('<value xsi:type="PQ" value="2" unit="a"/>');
  });

  it("emits no age element at all when the file has no age", async () => {
    expect(await xmlFor({})).not.toContain('displayName="age"');
  });
});

describe("date of birth", () => {
  it("serializes D.2.1 as <birthTime> in HL7 form", async () => {
    expect(await xmlFor({ date_of_birth: "2024-03-07" })).toContain(
      '<birthTime value="20240307"/>',
    );
  });

  it("accepts the date shapes a real line list writes", async () => {
    for (const written of ["2024-03-07", "07/03/2024", "7-3-2024"]) {
      const { pvCase } = await caseFor({ date_of_birth: written });
      expect(pvCase.patient.dateOfBirth).toBe("2024-03-07");
    }
  });

  it("omits it rather than guessing when the cell is not a date it can read", async () => {
    const { pvCase } = await caseFor({ date_of_birth: "circa 2024" });
    expect(pvCase.patient.dateOfBirth).toBeUndefined();
    expect(await xmlFor({ date_of_birth: "circa 2024" })).not.toContain("birthTime");
  });

  it("is absent from the XML when the file has no DOB column", async () => {
    expect(await xmlFor({})).not.toContain("birthTime");
  });

  it("never invents a date of birth from an age", async () => {
    const { pvCase } = await caseFor({ age: "2", age_unit: "years" });
    expect(pvCase.patient.dateOfBirth).toBeUndefined();
  });

  it("never derives an age from a date of birth", async () => {
    const { pvCase } = await caseFor({ date_of_birth: "2024-01-01" });
    expect(pvCase.patient.age).toBeUndefined();
    expect(pvCase.patient.dateOfBirth).toBe("2024-01-01");
  });
});

describe("age group", () => {
  it("preserves what the source itself said, verbatim", async () => {
    const { pvCase } = await caseFor({ age_group: "Infant" });
    expect(pvCase.patient.ageGroupVerbatim).toBe("Infant");
  });

  it("derives D.2.3 from a normalized age and unit when no source-reported group is present", async () => {
    const { pvCase } = await caseFor({ age: "18", age_unit: "years" });
    expect(pvCase.patient.age).toBe("18");
    expect(pvCase.patient.ageUnit).toBe("801");
    expect(pvCase.patient.ageGroupVerbatim).toBeUndefined();
  });

  it("emits the official D.2.3 code when the age and unit are valid", async () => {
    const xml = await xmlFor({ age: "18", age_unit: "years" });
    expect(xml).toContain('displayName="ageGroup"');
    expect(xml).toContain("2.16.840.1.113883.3.989.2.1.1.9");
    expect(xml).toContain('code="5"');
  });
});

describe("demographic concepts stay independent of one another", () => {
  it("keeps name, record number and case id in three separate places", async () => {
    const { pvCase } = await caseFor({
      case_id: "OG-901",
      patient_identifier: "A.A.",
      patient_id: "OGH/2026/04130",
    });
    expect(pvCase.caseSafetyReportId).toBe("OG-901");
    expect(pvCase.patient.identity).toEqual({
      present: true,
      value: { kind: "INITIALS", initials: "A.A." },
    });
    // The record number never becomes the patient's name.
    expect(JSON.stringify(pvCase.patient.identity)).not.toContain("OGH/2026/04130");
  });

  it("never infers sex from a name, initials or an age", async () => {
    const { pvCase } = await caseFor({ patient_identifier: "Mary Grace", age: "30" });
    expect(pvCase.patient.sex).toBeUndefined();
  });

  it("carries a row that has only the minimum, with no invented demographics", async () => {
    const { pvCase } = await caseFor({
      patient_identifier: undefined,
      age: undefined,
      sex: undefined,
    });
    expect(pvCase.patient.sex).toBeUndefined();
    expect(pvCase.patient.age).toBeUndefined();
    expect(pvCase.patient.ageUnit).toBeUndefined();
    expect(pvCase.patient.dateOfBirth).toBeUndefined();
    expect(pvCase.patient.ageGroupVerbatim).toBeUndefined();
    expect(pvCase.patient.recordNumbers).toBeUndefined();
  });

  it("routes every new column through the profile's column map", () => {
    // applyColumnMap is the boundary where a source's own header names
    // stop mattering. A field missing from it is a field that silently
    // never arrives, which is exactly how age was lost before.
    const row = applyColumnMap(
      {
        age: "2",
        age_unit: "months",
        date_of_birth: "2024-01-01",
        age_group: "Infant",
        sex: "F",
      },
      genericVerbatimProfile,
    );
    expect(row.age).toBe("2");
    expect(row.age_unit).toBe("months");
    expect(row.date_of_birth).toBe("2024-01-01");
    expect(row.age_group).toBe("Infant");
    expect(row.sex).toBe("F");
  });
});
