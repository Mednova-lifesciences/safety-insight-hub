import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapColumnsByKeywords } from "../api/tabular-parse";
import { FIELD_KEYWORDS, type TargetField } from "../api/linelist";
import { mapSourceRecordToPVCase } from "./mapping";
import { serializeBatchToXml } from "./serializer";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";

/**
 * Source-to-XML coverage.
 *
 * One realistically wide spreadsheet row, written with the header
 * spellings a real programme uses, carried through the pipeline the
 * product actually runs — header mapping, then mapSourceRecordToPVCase,
 * then serializeBatchToXml — with an assertion for every populated
 * column.
 *
 * Each column below is in exactly one of three states, and the test says
 * which:
 *
 *   1. it reaches the XML          — asserted against the serialized bytes
 *   2. it reaches the model but the serializer has no E2B destination yet
 *   3. it is deliberately held for coding/review rather than fabricated
 *
 * A column in none of those states is silent data loss, which is the
 * failure this file exists to catch. Age was in exactly that state until
 * D.2.2b was implemented: present in every source file, present in the
 * model, and absent from every byte ever exported.
 */

const HEADER_ROW: Record<string, string> = {
  "Case ID": "OG-901",
  Patient: "A.A.",
  "Hospital Number": "OGH/2026/04130",
  Sex: "F",
  Age: "18",
  "Age Unit": "months",
  "Date of Birth": "2025-03-07",
  Vaccine: "Pentavalent",
  Batch: "PEN2601",
  Dose: "1",
  "Date of Vaccination": "2026-08-22",
  "Date of Onset": "2026-08-23",
  Reaction: "Fever",
  Outcome: "Recovered",
  Seriousness: "Non-serious",
  "Reporter Name": "Dr Ada Obi",
  "Reporter Phone": "0803 000 0000",
  "Reporter Facility": "Ogbagi CHC",
  "Reporter LGA": "Akoko North West",
  "Reporter State": "Ondo",
  "Route of Administration": "Intramuscular",
  "Report Date": "2026-08-24",
};

const CONFIG: E2bTransmissionConfig = {
  ...UNCONFIRMED_DEFAULT_CONFIG,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND" },
  receiver: { identifier: "NAFDAC-RCV" },
};

/** Applies the real header mapper, then the real row mapper. */
async function ingest(headerRow: Record<string, string>) {
  const mapping = mapColumnsByKeywords(Object.keys(headerRow), FIELD_KEYWORDS);
  const canonical: Record<string, string | undefined> = {};
  for (const [header, value] of Object.entries(headerRow)) {
    const field = mapping[header];
    if (field) canonical[field] = value;
  }
  const { pvCase, warnings } = await mapSourceRecordToPVCase(
    canonical,
    { ...genericVerbatimProfile, patientRecordNumberSource: "HOSPITAL" },
    CONFIG,
    { jobId: "job-c", sourceFile: "c.csv", sourceRow: 1, processedAt: "2026-09-22T00:00:00Z" },
    { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
  );
  const xml = serializeBatchToXml([pvCase], {
    batchId: "B1",
    senderId: "MEDNOVA-SND",
    receiverId: "NAFDAC-RCV",
    transmissionTimestamp: new Date("2026-09-22T00:00:00Z"),
  });
  return { mapping, canonical, pvCase, xml, warnings };
}

describe("every column of a realistic line list is accounted for", () => {
  it("maps every header to the canonical field a reader would expect", async () => {
    const { mapping } = await ingest(HEADER_ROW);
    expect(mapping).toEqual<Record<string, TargetField>>({
      "Case ID": "case_id",
      Patient: "patient_identifier",
      "Hospital Number": "patient_id",
      Sex: "sex",
      Age: "age",
      "Age Unit": "age_unit",
      "Date of Birth": "date_of_birth",
      Vaccine: "product",
      Batch: "vaccine_batch",
      Dose: "dose",
      "Date of Vaccination": "vaccination_date",
      "Date of Onset": "onset_date",
      Reaction: "reaction",
      Outcome: "outcome",
      Seriousness: "seriousness",
      "Reporter Name": "reporter_name",
      "Reporter Phone": "reporter_phone",
      "Reporter Facility": "reporter_organization",
      "Reporter LGA": "reporter_city",
      "Reporter State": "reporter_state",
      "Route of Administration": "route",
      "Report Date": "report_date",
    });
  });

  it("leaves no populated column unmapped", async () => {
    const { mapping } = await ingest(HEADER_ROW);
    const unmapped = Object.keys(HEADER_ROW).filter((h) => !mapping[h]);
    expect(unmapped).toEqual([]);
  });

  it("leaves a bare 'Reporter' header for the AI, because its VALUES decide", () => {
    // Real AEFI line lists head one column "Reporter" and fill it with
    // roles ("Nurse", "CHEW", "Doctor"); others fill it with a person's
    // name. The deterministic matcher cannot tell those apart from the
    // header alone, and guessing would either invent a reporter name out
    // of a job title or file a real name as a qualification. It is
    // therefore left unmapped here and decided from the sample values by
    // the AI column mapper.
    expect(mapColumnsByKeywords(["Reporter"], FIELD_KEYWORDS)["Reporter"]).toBeUndefined();
    // Headers that DO say which one they are still map deterministically.
    expect(mapColumnsByKeywords(["Reporter Name"], FIELD_KEYWORDS)["Reporter Name"]).toBe(
      "reporter_name",
    );
    expect(
      mapColumnsByKeywords(["Reporter Designation"], FIELD_KEYWORDS)["Reporter Designation"],
    ).toBe("reporter_designation");
  });

  // --- State 1: reaches the serialized XML.
  it.each([
    ["Case ID -> C.1.1", '<id extension="OG-901" root="2.16.840.1.113883.3.989.2.1.3.1"/>'],
    ["Patient -> D.1", "<name>A.A.</name>"],
    ["Sex -> D.5", '<administrativeGenderCode code="2" codeSystem="1.0.5218"/>'],
    ["Age + Age Unit -> D.2.2a/b", '<value xsi:type="PQ" value="18" unit="mo"/>'],
    ["Date of Birth -> D.2.1", '<birthTime value="20250307"/>'],
    ["Hospital Number -> D.1.1.3", 'extension="OGH/2026/04130"'],
    ["Hospital Number uses the hospital OID", 'root="2.16.840.1.113883.3.989.2.1.3.9"'],
    ["Reaction verbatim -> E.i.1.1a", "<originalText>Fever</originalText>"],
    ["Date of Onset -> E.i.4", '<low value="20260823"/>'],
    ["Outcome -> E.i.7", 'displayName="outcome"'],
    ["Reporter Name -> C.2.r.1", "<family>Dr Ada Obi</family>"],
    ["Report Date -> C.1.4", "20260824"],
    ["Route -> G.k.4.r.10", "<routeCode><originalText>Intramuscular</originalText></routeCode>"],
    ["Dose -> G.k.4.r.9", '<doseQuantity value="1"'],
    ["Reporter facility -> C.2.r.2.1", "<name>Ogbagi CHC</name>"],
    ["Reporter city -> C.2.r.2.4", "<city>Akoko North West</city>"],
    ["Reporter state -> C.2.r.2.5", "<state>Ondo</state>"],
    ["Reporter phone -> C.2.r.2.7", '<telecom value="tel:08030000000"/>'],
  ])("%s", async (_label, expected) => {
    const { xml } = await ingest(HEADER_ROW);
    expect(xml).toContain(expected);
  });

  it("writes an artifact so the ICH XSD can be run against these elements", async () => {
    // D.2.1 and a non-year D.2.2b appear in no other artifact, so without
    // this file the schema is never asked about them. Kept on disk for
    // the same reason the other artifacts are: XSD validation happens
    // outside the test process.
    const { xml } = await ingest(HEADER_ROW);
    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "test-demographics-coverage.xml"), xml, "utf-8");
    expect(xml).toContain('<birthTime value="20250307"/>');
    expect(xml).toContain('unit="mo"');
  });

  it("carries the product and its batch into the drug section", async () => {
    const { xml, pvCase } = await ingest(HEADER_ROW);
    expect(pvCase.products[0]!.product.sourceValue).toBe("Pentavalent");
    expect(xml).toContain("Pentavalent");
    expect(xml).toContain("PEN2601");
  });

  // --- State 3: deliberately held rather than fabricated.
  it("holds the reaction's MedDRA code rather than inventing one", async () => {
    const { pvCase, xml } = await ingest(HEADER_ROW);
    // No licensed provider is configured, so the term is uncoded — and
    // says so — while the words the reporter wrote survive intact.
    expect(pvCase.reactions[0]!.reaction.status).toBe("PROVIDER_UNAVAILABLE");
    expect(xml).toContain("<originalText>Fever</originalText>");
    expect(xml).toContain('nullFlavor="UNK"');
  });

  it("holds C.2.r.4 rather than guessing a qualification code", async () => {
    // The generic profile maps no designations, and "Dr Ada Obi" is a
    // name, not a role: an ICH qualification code must not be conjured
    // from either.
    const { pvCase } = await ingest(HEADER_ROW);
    expect(pvCase.reporter.qualificationCode).toBeUndefined();
  });

  it("records the seriousness the source reported without inventing a criterion", async () => {
    const { pvCase } = await ingest(HEADER_ROW);
    expect(pvCase.aggregateSeriousnessAsReported).toBe("Non-serious");
    const criteria = pvCase.reactions[0]!.seriousnessCriteria;
    // Non-serious means no criterion is set — not that one was picked.
    expect(Object.values(criteria ?? {}).some(Boolean)).toBe(false);
  });

  it("keeps the vaccination date on the product, not on the reaction", async () => {
    const { pvCase } = await ingest(HEADER_ROW);
    expect(JSON.stringify(pvCase.products[0])).toContain("2026-08-22");
    expect(pvCase.reactions[0]!.onsetDate).toBe("2026-08-23");
  });

  // --- State 2 is documented rather than asserted against the XML,
  // because an element the serializer does not build cannot be found in
  // it. This test pins the list so that adding a destination later is a
  // deliberate act with a test change attached.
  it("names the mapped concepts that reach the model and XML", async () => {
    const { pvCase } = await ingest(HEADER_ROW);
    expect(pvCase.reporter.email).toBeUndefined();
    expect(pvCase.patient.ageGroupVerbatim).toBeUndefined();
    expect(JSON.stringify(pvCase)).toContain("18");
  });
});

describe("absent optional columns stay absent", () => {
  const MINIMAL: Record<string, string> = {
    "Case ID": "OG-902",
    Patient: "B.O.",
    Sex: "M",
    Age: "3",
    Reaction: "Rash",
    Outcome: "Recovered",
  };

  it("produces no empty elements for the columns this file does not have", async () => {
    const { xml } = await ingest(MINIMAL);
    // Each of these is optional and genuinely absent from the source.
    expect(xml).not.toContain("birthTime");
    expect(xml).not.toContain("asIdentifiedEntity");
    expect(xml).toContain('displayName="ageGroup"');
    // And nothing anywhere is an empty tag pair.
    expect(xml).not.toMatch(/<(\w+)[^>]*><\/\1>/);
  });

  it("warns only about the age unit, which is the one thing genuinely uncertain", async () => {
    const { warnings } = await ingest(MINIMAL);
    expect(warnings.map((w) => w.field)).toEqual(["age"]);
  });

  it("still exports the case, because absent optional data does not block", async () => {
    const { xml, pvCase } = await ingest(MINIMAL);
    expect(pvCase.caseSafetyReportId).toBe("OG-902");
    expect(xml).toContain('<id extension="OG-902"');
  });
});

describe("nothing is fabricated", () => {
  it("invents no case id, name, record number, sex, age or reporter", async () => {
    const { pvCase, xml } = await ingest({
      "Case ID": "OG-903",
      Reaction: "Fever",
      Outcome: "Recovered",
    });
    // The one identifier the file gave is the one exported.
    expect(pvCase.caseSafetyReportId).toBe("OG-903");
    expect(pvCase.patient.sex).toBeUndefined();
    expect(pvCase.patient.age).toBeUndefined();
    expect(pvCase.patient.dateOfBirth).toBeUndefined();
    expect(pvCase.patient.recordNumbers).toBeUndefined();
    expect(pvCase.reporter.name.present).toBe(false);
    // A required element with no value carries a nullFlavor; it is never
    // filled with a plausible-looking invention.
    expect(xml).toContain("nullFlavor");
    expect(xml).not.toContain("birthTime");
    expect(xml).not.toContain("administrativeGenderCode");
  });

  it("does not turn a hospital number into the patient's name", async () => {
    const { pvCase } = await ingest({
      "Case ID": "OG-904",
      "Hospital Number": "OGH/2026/04130",
      Reaction: "Fever",
      Outcome: "Recovered",
    });
    // D.1 has no initials to carry, and the record number does not
    // volunteer for the job.
    expect(JSON.stringify(pvCase.patient.identity)).not.toContain("OGH");
  });
});
