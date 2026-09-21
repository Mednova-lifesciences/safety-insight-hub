import { describe, expect, it } from "vitest";
import {
  ASSUMED_PATIENT_RECORD_NUMBER_SOURCE,
  AI_MAPPING_CONFIDENCE_FLOOR,
  FIELD_KEYWORDS,
  inferPatientRecordNumberSource,
  mergeColumnMapping,
} from "./linelist";
import { mapColumnsByKeywords as matchHeaders } from "./tabular-parse";

/** The keyword layer as the upload path runs it. */
const mapColumnsByKeywords = (headers: string[]) => matchHeaders(headers, FIELD_KEYWORDS);

/**
 * Finding the patient's medical record number (D.1.1) in whatever a line
 * list happens to call it.
 *
 * Three layers, and every one of them can only ever CHOOSE A COLUMN — the
 * identifier's value always comes from the row:
 *
 *   1. the source profile, when an administrator configured it;
 *   2. header keywords, which cost nothing and catch the common spellings;
 *   3. the existing schema-level AI column mapper, which sees the headers
 *      AND sample values once per file and proposes a field per column.
 *
 * The traps below are the four identifiers that look like a patient record
 * number and are not one: the case/report number, the reporter, a vaccine
 * batch, and the patient's own initials.
 */
const proposal = (column: string, field: string, confidence: number) => ({
  column,
  field,
  confidence,
  reason: "test",
});

describe("finding the record-number column by header", () => {
  it.each([
    ["Hospital Number", "patient_id"],
    ["Hospital Record No", "patient_id"],
    ["Medical Record Number", "patient_id"],
    ["Patient ID", "patient_id"],
    ["Patient No", "patient_id"],
    ["Subject ID", "patient_id"],
    ["Folio Number", "patient_id"],
    ["Card Number", "patient_id"],
  ])("reads %s as the patient's record number", (header, field) => {
    expect(mapColumnsByKeywords([header])[header]).toBe(field);
  });

  it.each([
    ["Case ID", "case_id"],
    ["Report Number", "case_id"],
    ["Patient", "patient_identifier"],
    ["Patient Initials", "patient_identifier"],
    ["Batch Number", "vaccine_batch"],
    ["Reporter Name", "reporter_name"],
  ])("does not mistake %s for it — reads it as %s", (header, field) => {
    const mapping = mapColumnsByKeywords([header]);
    expect(mapping[header]).toBe(field);
    expect(mapping[header]).not.toBe("patient_id");
  });

  it.each(["Reporter", "Reported by", "Reference", "Serial No"])(
    "leaves %s for the AI layer rather than claiming it as a record number",
    (header) => {
      expect(mapColumnsByKeywords([header])[header]).not.toBe("patient_id");
    },
  );

  it("keeps the patient's name and the patient's number apart in one file", () => {
    const mapping = mapColumnsByKeywords(["Case ID", "Patient", "Hospital Number", "Reporter"]);
    expect(mapping).toMatchObject({
      "Case ID": "case_id",
      Patient: "patient_identifier",
      "Hospital Number": "patient_id",
    });
    expect(mapping["Reporter"]).not.toBe("patient_id");
  });
});

describe("what the AI mapper is allowed to decide", () => {
  it("accepts a confident proposal for a column keywords did not know", () => {
    const merged = mergeColumnMapping({}, [proposal("Folder Ref", "patient_id", 0.94)], true);
    expect(merged.mapping["Folder Ref"]).toBe("patient_id");
    expect(merged.source["Folder Ref"]).toBe("ai");
  });

  it("ignores a proposal it is not sure about", () => {
    const merged = mergeColumnMapping(
      {},
      [proposal("Reference", "patient_id", AI_MAPPING_CONFIDENCE_FLOOR - 0.01)],
      true,
    );
    expect(merged.mapping["Reference"]).toBeUndefined();
  });

  it.each([
    ["Case ID", 0.99],
    ["Report Number", 0.95],
    ["Reporter ID", 0.97],
    ["Batch Number", 0.96],
    ["Lot No", 0.93],
  ])(
    "refuses to read %s as the patient's record number however sure it is",
    (column, confidence) => {
      const merged = mergeColumnMapping({}, [proposal(column, "patient_id", confidence)], true);
      expect(merged.mapping[column]).not.toBe("patient_id");
    },
  );

  it("still allows a patient-named column the model is sure about", () => {
    const merged = mergeColumnMapping(
      {},
      [proposal("Patient case file no", "patient_id", 0.9)],
      true,
    );
    expect(merged.mapping["Patient case file no"]).toBe("patient_id");
  });

  it("cannot invent a field that does not exist", () => {
    const merged = mergeColumnMapping({}, [proposal("Mystery", "patient_uuid", 0.99)], true);
    expect(merged.mapping["Mystery"]).toBeUndefined();
  });

  it("gives one field to one column, not two", () => {
    const merged = mergeColumnMapping(
      {},
      [proposal("Hospital No", "patient_id", 0.95), proposal("Folio", "patient_id", 0.8)],
      true,
    );
    expect(merged.mapping["Hospital No"]).toBe("patient_id");
    expect(merged.mapping["Folio"]).toBeUndefined();
  });

  it("falls back to the keyword mapping when the model is unavailable", () => {
    const keywords = mapColumnsByKeywords(["Hospital Number"]);
    const merged = mergeColumnMapping(keywords, [], false);
    expect(merged.mapping["Hospital Number"]).toBe("patient_id");
    expect(merged.aiUsed).toBe(false);
  });

  it("records how each column was decided, for review", () => {
    const merged = mergeColumnMapping(
      mapColumnsByKeywords(["Patient"]),
      [proposal("Folder Ref", "patient_id", 0.94)],
      true,
    );
    expect(merged.source["Folder Ref"]).toBe("ai");
    expect(merged.notes["Folder Ref"]).toBeTruthy();
    expect(merged.source["Patient"]).toBe("rule");
  });
});

describe("whose record the number is (D.1.1.1-D.1.1.4)", () => {
  it.each([
    ["Hospital Number", "HOSPITAL"],
    ["Clinic record no", "HOSPITAL"],
    ["Admission number", "HOSPITAL"],
    ["GP record number", "GP"],
    ["Family doctor number", "GP"],
    ["Specialist record number", "SPECIALIST"],
    ["Consultant ref", "SPECIALIST"],
    ["Study number", "INVESTIGATION"],
    ["Trial subject no", "INVESTIGATION"],
  ])("reads it from the header %s", (header, source) => {
    expect(inferPatientRecordNumberSource(header)).toBe(source);
  });

  it.each(["Patient ID", "Registration No", "Folio number", "MRN"])(
    "says nothing when the header %s names no record source",
    (header) => {
      expect(inferPatientRecordNumberSource(header)).toBeUndefined();
    },
  );

  it("falls back to the reporting facility's own record, which validation reports", () => {
    expect(ASSUMED_PATIENT_RECORD_NUMBER_SOURCE).toBe("HOSPITAL");
  });
});
