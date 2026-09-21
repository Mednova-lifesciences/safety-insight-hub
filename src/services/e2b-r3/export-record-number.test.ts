import { describe, expect, it, vi } from "vitest";

/**
 * The path that actually produces the file.
 *
 * mapJobToCases resolves its OWN source profile — it does not borrow the one
 * the line-list checks build — so a decision that only reached the checks
 * shows in the UI and is missing from the XML. That is exactly what
 * happened: the control read "Hospital record number (D.1.1.3)", the page
 * agreed, and the exported 50-case batch carried no D.1.1 at all. Both
 * paths now call one resolver, and this drives the export path to prove it.
 *
 * MedDRA coding is stubbed out because that is the only thing in this path
 * that needs a server; nothing here is about coding.
 */
vi.mock("./coding-provider", async () => {
  const actual = await vi.importActual<typeof import("./coding-provider")>("./coding-provider");
  return { ...actual, meddra29Provider: actual.unavailableMedDraProvider };
});

const { mapJobToCases } = await import("./export");
const { unconfiguredOrgRegulatoryConfig } = await import("./regulatory-config");
const { serializeBatchToXml } = await import("./serializer");

const TRANSMISSION = {
  environment: "uat" as const,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND-01" },
  receiver: { identifier: "NAFDAC-RCV-01" },
  reportType: "1" as const,
  reportTypeConfirmed: true,
};

const jobFor = (parsingOptions: Record<string, unknown>) => ({
  id: "job-export",
  filename: "ogun_aefi.csv",
  sourceProfileId: "generic-verbatim",
  mapping: {
    "Case ID": "case_id",
    Patient: "patient_identifier",
    "Hospital Number": "patient_id",
  },
  parsingOptions,
  parsedRows: [
    {
      case_id: "OG-901",
      patient_identifier: "A.A.",
      patient_id: "OGH/2026/04130",
      product: "Penta",
      reaction: "Fever",
      outcome: "Recovered",
      reporter_designation: "Nurse",
    },
  ],
});

const config = () => ({ ...unconfiguredOrgRegulatoryConfig(), transmission: TRANSMISSION });

const recordNumbersIn = (xml: string) =>
  [...xml.matchAll(/<asIdentifiedEntity[^>]*><id extension="([^"]+)" root="([^"]+)"\/>/g)].map(
    (m) => ({ number: m[1]!, oid: m[2]! }),
  );

const xmlFor = (cases: Parameters<typeof serializeBatchToXml>[0]) =>
  serializeBatchToXml(cases, {
    batchId: "B",
    senderId: "S",
    receiverId: "R",
    transmissionTimestamp: new Date("2026-08-27T09:15:00Z"),
  });

describe("the job's own decision reaches the exported cases", () => {
  it("exports the record number once a person has chosen the record", async () => {
    const { cases } = await mapJobToCases(
      jobFor({ patientRecordNumberSource: "HOSPITAL" }),
      config(),
    );
    expect(cases[0]!.patient.recordNumbers).toEqual([
      { number: "OGH/2026/04130", source: "HOSPITAL" },
    ]);
    expect(recordNumbersIn(xmlFor(cases))[0]).toEqual({
      number: "OGH/2026/04130",
      oid: "2.16.840.1.113883.3.989.2.1.3.9",
    });
  });

  it("reads the record from the column's own name when nobody has chosen", async () => {
    const { cases } = await mapJobToCases(jobFor({}), config());
    expect(cases[0]!.patient.recordNumbers).toEqual([
      { number: "OGH/2026/04130", source: "HOSPITAL" },
    ]);
  });

  it("exports none when a person said not to", async () => {
    const { cases } = await mapJobToCases(jobFor({ patientRecordNumberDeclined: true }), config());
    expect(cases[0]!.patient.recordNumbers).toBeUndefined();
    expect(recordNumbersIn(xmlFor(cases))).toEqual([]);
  });

  it("uses the record a person chose over the one the header suggests", async () => {
    const { cases } = await mapJobToCases(
      jobFor({ patientRecordNumberSource: "INVESTIGATION" }),
      config(),
    );
    expect(cases[0]!.patient.recordNumbers).toEqual([
      { number: "OGH/2026/04130", source: "INVESTIGATION" },
    ]);
    expect(recordNumbersIn(xmlFor(cases))[0]!.oid).toBe("2.16.840.1.113883.3.989.2.1.3.10");
  });

  it("keeps the patient's own identity and the case's identity untouched", async () => {
    const { cases } = await mapJobToCases(
      jobFor({ patientRecordNumberSource: "HOSPITAL" }),
      config(),
    );
    const xml = xmlFor(cases);
    expect(xml).toContain("<name>A.A.</name>");
    expect(cases[0]!.caseSafetyReportId).not.toBe("OGH/2026/04130");
  });
});
