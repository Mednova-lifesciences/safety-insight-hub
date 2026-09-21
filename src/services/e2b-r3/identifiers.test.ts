import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapSourceRecordToPVCase } from "./mapping";
import { serializeBatchToXml } from "./serializer";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { inferPatientRecordNumberSource } from "@/services/api/linelist";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";
import type { SourceProfile } from "./source-profiles/types";
import type { PVCase } from "./types";

/**
 * Patient and reporter identification, source column to serialized XML.
 *
 * Two different questions, answered by two different ICH elements:
 *
 *  - D.1     the patient's name or initials, and D.1.1.1-D.1.1.4 their
 *            medical record number(s) — which ICH carries together, not as
 *            alternatives.
 *  - C.2.r.1 the reporter's own name. E2B(R3) defines NO reporter
 *            identifier element: the reporter block holds a name, an
 *            address, a telephone, a country and a qualification, and the
 *            ICH reference instance has no id element in it anywhere. So
 *            an identifiable reporter means a named one.
 *
 * Neither is ever derived from the case identifier, which identifies the
 * report rather than a person.
 */
const TRANSMISSION: E2bTransmissionConfig = {
  ...UNCONFIRMED_DEFAULT_CONFIG,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND-01" },
  receiver: { identifier: "NAFDAC-RCV-01" },
};

/** A profile whose patient-id column is the facility's hospital number,
 *  and which knows what a "Nurse" is (C.2.r.4) — so these tests can tell
 *  "the reporter is described but not named" apart from "no reporter". */
const HOSPITAL_PROFILE: SourceProfile = {
  ...genericVerbatimProfile,
  id: "test-hospital-records",
  country: "NG",
  patientRecordNumberSource: "HOSPITAL",
  reporterQualificationMap: { NURSE: "3", DOCTOR: "1" },
};

async function caseFor(
  row: Record<string, string | undefined>,
  profile: SourceProfile = HOSPITAL_PROFILE,
  sourceRow = 1,
): Promise<PVCase> {
  const { pvCase } = await mapSourceRecordToPVCase(
    {
      case_id: `OG/AEFI/2026/04${10 + sourceRow}`,
      patient_identifier: "ADEOLA BAMIDELE",
      product: "Pentavalent (DTP-HepB-Hib)",
      reaction: "Fever",
      outcome: "Recovered",
      reporter_designation: "Nurse",
      ...row,
    },
    profile,
    TRANSMISSION,
    {
      jobId: "job-identifiers",
      sourceFile: "ogun_aefi.csv",
      sourceRow,
      processedAt: "2026-08-27T09:15:00Z",
    },
    { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
  );
  return pvCase;
}

const xmlFor = (cases: PVCase[]) =>
  serializeBatchToXml(cases, {
    batchId: "MEDNOVA-IDENT-0001",
    senderId: TRANSMISSION.sender.identifier,
    receiverId: TRANSMISSION.receiver.identifier,
    transmissionTimestamp: new Date("2026-08-27T09:15:00Z"),
  });

const patientIdIn = (xml: string) =>
  [
    ...xml.matchAll(
      /<asIdentifiedEntity classCode="IDENT"><id extension="([^"]+)" root="([^"]+)"\/>/g,
    ),
  ].map((m) => ({ number: m[1]!, oid: m[2]! }));

const reporterNameIn = (xml: string) =>
  [...xml.matchAll(/<assignedPerson[^>]*><name><family>([^<]+)<\/family><\/name>/g)].map(
    (m) => m[1]!,
  );

describe("D.1.1 — the patient's medical record number", () => {
  it("reaches the XML on the record source's own namespace OID", async () => {
    const pvCase = await caseFor({ patient_id: "PAT-2026-000413" });
    expect(pvCase.patient.recordNumbers).toEqual([
      { number: "PAT-2026-000413", source: "HOSPITAL" },
    ]);
    const xml = xmlFor([pvCase]);
    expect(patientIdIn(xml)).toEqual([
      { number: "PAT-2026-000413", oid: "2.16.840.1.113883.3.989.2.1.3.9" },
    ]);
    // ...naming which record it is, per D.1.1's own codelist.
    expect(xml).toContain(
      '<code code="3" codeSystem="2.16.840.1.113883.3.989.2.1.1.4" codeSystemVersion="1.0" displayName="Hospital"/>',
    );
  });

  it("is carried alongside D.1, not instead of it", async () => {
    const xml = xmlFor([await caseFor({ patient_id: "PAT-2026-000413" })]);
    expect(xml).toContain("<name>A.B.</name>"); // D.1, from the patient's name
    expect(patientIdIn(xml)).toHaveLength(1); // D.1.1.3, the hospital number
  });

  it.each([
    ["00012345", "leading zeroes survive"],
    ["0000413", "an all-but-one-zero number is not turned into a number"],
    ["PAT/2026/0413", "slashes are kept"],
    ["HOSP-OG-00981-A", "hyphens and letters are kept"],
    ["1234567890123456789012345", "a long identifier is not truncated"],
  ])("keeps %s exactly as the source wrote it — %s", async (number) => {
    const xml = xmlFor([await caseFor({ patient_id: number })]);
    expect(patientIdIn(xml)[0]!.number).toBe(number);
  });

  it("uses whichever record source the profile declares", async () => {
    const gp: SourceProfile = { ...HOSPITAL_PROFILE, patientRecordNumberSource: "GP" };
    const xml = xmlFor([await caseFor({ patient_id: "GP-77" }, gp)]);
    expect(patientIdIn(xml)[0]!.oid).toBe("2.16.840.1.113883.3.989.2.1.3.7");
    expect(xml).toContain('displayName="GP"');
  });

  it("is absent — never invented — when the source has no such column", async () => {
    const pvCase = await caseFor({});
    expect(pvCase.patient.recordNumbers).toBeUndefined();
    const xml = xmlFor([pvCase]);
    expect(patientIdIn(xml)).toEqual([]);
    expect(xml).not.toContain("asIdentifiedEntity");
  });

  it("is never the case identifier wearing a different hat", async () => {
    const pvCase = await caseFor({ patient_id: "PAT-2026-000413" });
    const xml = xmlFor([pvCase]);
    expect(patientIdIn(xml)[0]!.number).not.toBe(pvCase.caseSafetyReportId);
    expect(patientIdIn(xml)[0]!.number).not.toBe(pvCase.sendersCaseId);
  });
});

describe("C.2.r.1 — the reporter's name", () => {
  it("reaches the XML when the source names a reporter", async () => {
    const pvCase = await caseFor({ reporter_name: "Dr Amaka Nwosu" });
    expect(pvCase.reporter.name).toEqual({ present: true, value: "Dr Amaka Nwosu" });
    expect(reporterNameIn(xmlFor([pvCase]))).toEqual(["Dr Amaka Nwosu"]);
  });

  it("sits alongside the qualification and country, in ICH's order", async () => {
    const xml = xmlFor([await caseFor({ reporter_name: "Dr Amaka Nwosu" })]);
    const block = xml.match(/<assignedPerson[^>]*>[\s\S]*?<\/assignedPerson>/)![0];
    expect(block.indexOf("<name>")).toBeLessThan(block.indexOf("asQualifiedEntity"));
    expect(block.indexOf("asQualifiedEntity")).toBeLessThan(block.indexOf("asLocatedEntity"));
  });

  it("is absent — never invented — when the source names nobody", async () => {
    const pvCase = await caseFor({});
    expect(pvCase.reporter.name).toEqual({ present: false, nullFlavor: "NASK" });
    const xml = xmlFor([pvCase]);
    expect(reporterNameIn(xml)).toEqual([]);
    // The reporter is still described by what the source did say.
    expect(xml).toContain("asQualifiedEntity");
  });

  it("is never derived from the case id, the patient, or the designation", async () => {
    const pvCase = await caseFor({
      patient_id: "PAT-2026-000413",
      reporter_name: "Dr Amaka Nwosu",
    });
    const xml = xmlFor([pvCase]);
    const reporter = reporterNameIn(xml)[0]!;
    expect(reporter).not.toBe(pvCase.caseSafetyReportId);
    expect(reporter).not.toBe(pvCase.sendersCaseId);
    expect(reporter).not.toBe("PAT-2026-000413");
    expect(reporter).not.toBe(pvCase.reporter.qualificationVerbatim);
  });
});

describe("both identifiers missing", () => {
  it("reports both absences honestly and fabricates neither", async () => {
    const pvCase = await caseFor({});
    const xml = xmlFor([pvCase]);
    expect(pvCase.patient.recordNumbers).toBeUndefined();
    expect(pvCase.reporter.name.present).toBe(false);
    expect(xml).not.toContain("asIdentifiedEntity");
    expect(reporterNameIn(xml)).toEqual([]);
    // What the source DID give is still there: D.1 and the qualification.
    expect(xml).toContain("<name>A.B.</name>");
    expect(xml).toContain('codeSystem="2.16.840.1.113883.3.989.2.1.1.6"');
  });
});

describe("a batch carrying both identifiers, end to end", () => {
  it("writes a fixture and keeps every identifier distinct", async () => {
    const rows = [
      { patient_id: "PAT-2026-000413", reporter_name: "Dr Amaka Nwosu" },
      { patient_id: "0000413", reporter_name: "Nurse Grace Eze" },
      { patient_id: "HOSP/OG/00981", reporter_name: "Dr Tunde Alabi" },
      {}, // neither: both absences preserved
    ];
    const cases = await Promise.all(rows.map((row, i) => caseFor(row, HOSPITAL_PROFILE, i + 1)));
    const xml = xmlFor(cases);
    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "test-identifiers.xml"), xml, "utf-8");

    expect(patientIdIn(xml).map((p) => p.number)).toEqual([
      "PAT-2026-000413",
      "0000413",
      "HOSP/OG/00981",
    ]);
    expect(reporterNameIn(xml)).toEqual(["Dr Amaka Nwosu", "Nurse Grace Eze", "Dr Tunde Alabi"]);

    // C.1.1 / N.2.r.1 are the report's identity and are nobody's identifier.
    const messageIds = [...xml.matchAll(/<PORR_IN049016UV><id extension="([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(messageIds).toEqual(cases.map((c) => c.caseSafetyReportId));
    for (const id of messageIds) {
      expect(patientIdIn(xml).map((p) => p.number)).not.toContain(id);
      expect(reporterNameIn(xml)).not.toContain(id);
    }
  });
});

/**
 * The whole chain for a line list that names its record-number column
 * something nobody configured: header -> column mapping -> source profile
 * -> mapper -> PVCase -> serializer -> D.1.1 in the XML.
 *
 * The column is chosen by the existing mapping layer; the VALUE always
 * comes from the row.
 */
describe("a line list whose record-number column nobody configured", () => {
  it("carries the row's own value into D.1.1, and only that value", async () => {
    // What the upload path produces for this file: the header is read as
    // patient_id, and "Hospital Number" says whose record it is.
    const recordSource = inferPatientRecordNumberSource("Hospital Number");
    expect(recordSource).toBe("HOSPITAL");

    const discovered: SourceProfile = {
      ...genericVerbatimProfile,
      id: "test-discovered",
      country: "NG",
      patientRecordNumberSource: recordSource,
    };

    const pvCase = await caseFor(
      { patient_id: "OGH/2026/04130", patient_identifier: "A.A." },
      discovered,
    );
    // The value is the row's, character for character.
    expect(pvCase.patient.recordNumbers).toEqual([
      { number: "OGH/2026/04130", source: "HOSPITAL" },
    ]);

    const xml = xmlFor([pvCase]);
    expect(patientIdIn(xml)).toEqual([
      { number: "OGH/2026/04130", oid: "2.16.840.1.113883.3.989.2.1.3.9" },
    ]);
    // D.1 still holds who the patient is; C.1.1 still identifies the report.
    expect(xml).toContain("<name>A.A.</name>");
    expect(pvCase.caseSafetyReportId).not.toBe("OGH/2026/04130");
  });

  it("exports nothing when the file has no such column", async () => {
    const pvCase = await caseFor({ patient_identifier: "A.A." }, genericVerbatimProfile);
    expect(pvCase.patient.recordNumbers).toBeUndefined();
    expect(patientIdIn(xmlFor([pvCase]))).toEqual([]);
  });

  it.each(["Patient ID", "Record Number", "Reference"])(
    "keeps the number but exports no D.1.1 while %s leaves the category undecided",
    async (header) => {
      // The column IS the patient's record number; what nobody has said is
      // whether it is a GP's, a specialist's, a hospital's or an
      // investigation's record. Four different elements, so: no guess.
      const undecided: SourceProfile = {
        ...genericVerbatimProfile,
        id: "test-undecided",
        country: "NG",
        patientRecordNumberSource: inferPatientRecordNumberSource(header),
      };
      expect(undecided.patientRecordNumberSource).toBeUndefined();

      const pvCase = await caseFor({ patient_id: "OGH/2026/04130" }, undecided);
      expect(pvCase.patient.recordNumbers).toBeUndefined();
      const xml = xmlFor([pvCase]);
      expect(patientIdIn(xml)).toEqual([]);
      expect(xml).not.toContain("asIdentifiedEntity");
      // ...and nothing else about the case is affected.
      expect(xml).toContain("<name>A.B.</name>");
    },
  );

  it("exports it as soon as someone says which record it is", async () => {
    const decided: SourceProfile = {
      ...genericVerbatimProfile,
      id: "test-decided",
      country: "NG",
      // What the line-list panel writes when a person chooses.
      patientRecordNumberSource: "SPECIALIST",
    };
    const xml = xmlFor([await caseFor({ patient_id: "OGH/2026/04130" }, decided)]);
    expect(patientIdIn(xml)).toEqual([
      { number: "OGH/2026/04130", oid: "2.16.840.1.113883.3.989.2.1.3.8" },
    ]);
    expect(xml).toContain('displayName="Specialist"');
  });

  it.each([
    ["GP", "2.16.840.1.113883.3.989.2.1.3.7", "1"],
    ["SPECIALIST", "2.16.840.1.113883.3.989.2.1.3.8", "2"],
    ["HOSPITAL", "2.16.840.1.113883.3.989.2.1.3.9", "3"],
    ["INVESTIGATION", "2.16.840.1.113883.3.989.2.1.3.10", "4"],
  ])("puts a %s record on its own element", async (source, oid, code) => {
    const profile: SourceProfile = {
      ...genericVerbatimProfile,
      id: `test-${source}`,
      country: "NG",
      patientRecordNumberSource: source as SourceProfile["patientRecordNumberSource"],
    };
    const xml = xmlFor([await caseFor({ patient_id: "REC-1" }, profile)]);
    expect(patientIdIn(xml)[0]!.oid).toBe(oid);
    expect(xml).toContain(`<code code="${code}" codeSystem="2.16.840.1.113883.3.989.2.1.1.4"`);
  });

  it("lets an explicit configuration outrank what the header suggests", async () => {
    // The header says hospital; the profile says investigation. The
    // configured answer wins — a person outranks a guess from a word.
    expect(inferPatientRecordNumberSource("Hospital Number")).toBe("HOSPITAL");
    const configured: SourceProfile = {
      ...genericVerbatimProfile,
      id: "test-configured",
      country: "NG",
      patientRecordNumberSource: "INVESTIGATION",
    };
    const xml = xmlFor([await caseFor({ patient_id: "OGH/2026/04130" }, configured)]);
    expect(patientIdIn(xml)[0]!.oid).toBe("2.16.840.1.113883.3.989.2.1.3.10");
  });
});
