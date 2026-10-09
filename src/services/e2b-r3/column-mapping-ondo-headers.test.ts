import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapColumnsByKeywords } from "../api/tabular-parse";
import { FIELD_KEYWORDS, runValidation, type ParsedRow, type TargetField } from "../api/linelist";
import { resolveOnset } from "../api/linelist-onset";
import { combineAgeWithMonths, mapSourceRecordToPVCase, meaningfulText } from "./mapping";
import { serializeBatchToXml } from "./serializer";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";

// The real Ondo AEFI headers as the parser names them (merged sub-headers
// included); every VALUE below is invented — no patient data.
const ROW: Record<string, string> = {
  ID: "NIE-TST-001",
  "PATIENT'S NAME": "TEST CHILD",
  SEX: "FEMALE",
  "Age Years": "0",
  "Age Months": "8",
  "Medical History(Allergy Presentation)": "Allergy to penicillin",
  "Date of Last immunisation Date (dd/mm/yy)": "3/2/26",
  "Date of Last immunisation Time": "11:00",
  "Type of AEFI (Non-serious or Serious)": "NON SERIOUS",
  "Primary Suspect Vaccine(Name)": "Pentavalent",
  "Vaccine Batch/lot No": "PEN-TEST-1",
  "Diluent Batch/Lot No": "DIL-TEST-9",
  "Onset Time interval (hours, days, weeks)": "15 hours",
  "Other vaccines given just prior to AEFI": "BCG, OPV",
  "Name of initial reporter": "Test Reporter",
  "Designation of the reporting officer": "CHEW",
  "Adress of reporting health facility": "BHC Testville",
  "Phone number of the reporting officer": "2348000000000",
  "e-mail address of the reporter": "Main Street, Testville",
  "Date of Reporting to LGA (dd/mm/yy)": "5/2/26",
  "Date report recived at the state level": "6/2/26",
  "Date report recived at the national level": "9/2/26",
};

const CONFIG: E2bTransmissionConfig = {
  ...UNCONFIRMED_DEFAULT_CONFIG,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND" },
  receiver: { identifier: "NAFDAC-RCV" },
};

async function ingest(overrides: Record<string, string> = {}) {
  const row = { ...ROW, ...overrides };
  const mapping = mapColumnsByKeywords(Object.keys(row), FIELD_KEYWORDS);
  const canonical: Record<string, string | undefined> = {};
  for (const [header, value] of Object.entries(row)) {
    const field = mapping[header];
    if (field) canonical[field] = value;
  }
  const { pvCase } = await mapSourceRecordToPVCase(
    canonical,
    genericVerbatimProfile,
    CONFIG,
    { jobId: "job-t", sourceFile: "t.xlsx", sourceRow: 1, processedAt: "2026-10-09T00:00:00Z" },
    { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
  );
  const xml = serializeBatchToXml([pvCase], {
    batchId: "B1",
    senderId: "MEDNOVA-SND",
    receiverId: "NAFDAC-RCV",
    transmissionTimestamp: new Date("2026-10-09T00:00:00Z"),
  });
  return { mapping, canonical, pvCase, xml };
}

describe("Ondo columns that used to be dropped now map", () => {
  it("maps each sub-project-1 header to its field", async () => {
    const { mapping } = await ingest();
    expect(mapping).toMatchObject<Partial<Record<string, TargetField>>>({
      "Age Years": "age",
      "Age Months": "age_months",
      "Medical History(Allergy Presentation)": "medical_history",
      "Date of Last immunisation Date (dd/mm/yy)": "vaccination_date",
      "Date of Last immunisation Time": "vaccination_time",
      "Diluent Batch/Lot No": "diluent_batch",
      "Vaccine Batch/lot No": "vaccine_batch",
      "Other vaccines given just prior to AEFI": "other_vaccines",
      "Name of initial reporter": "reporter_name",
      "Adress of reporting health facility": "reporter_address",
      "e-mail address of the reporter": "reporter_email",
      "Date of Reporting to LGA (dd/mm/yy)": "report_date",
      "Date report recived at the state level": "state_received_date",
      "Date report recived at the national level": "national_received_date",
    });
  });
});

describe("C.1.4 — the national received date", () => {
  it("uses the national date", async () => {
    const { pvCase } = await ingest();
    expect(pvCase.dateFirstReceived).toBe("2026-02-09");
  });
  it("falls back to the state date, then the report date", async () => {
    expect(
      (await ingest({ "Date report recived at the national level": "" })).pvCase.dateFirstReceived,
    ).toBe("2026-02-06");
    expect(
      (
        await ingest({
          "Date report recived at the national level": "",
          "Date report recived at the state level": "",
        })
      ).pvCase.dateFirstReceived,
    ).toBe("2026-02-05");
  });
});

describe("D.2.2 — Years and Months sub-columns", () => {
  it.each([
    ["0", "8", "8"],
    ["1", "8", "20"],
    ["", "8", "8"],
    ["", "14", "14"],
  ])("Years %s + Months %s = %s months", (years, months, expected) => {
    expect(combineAgeWithMonths(years, months, undefined)).toEqual({
      value: expected,
      unit: "802",
    });
  });
  it("from two years the Years value stands; no usable months changes nothing", () => {
    expect(combineAgeWithMonths("5", "3", undefined)).toBeUndefined();
    expect(combineAgeWithMonths("1", "nil", undefined)).toBeUndefined();
    expect(combineAgeWithMonths("8", "", undefined)).toBeUndefined();
  });
  it("an infant reaches the XML in months, never as 0 years", async () => {
    const { pvCase, xml } = await ingest();
    expect(pvCase.patient.age).toBe("8");
    expect(pvCase.patient.ageUnit).toBe("802");
    expect(xml).toContain('value="8" unit="mo"');
  });
});

describe("medical history, diluent, other vaccines, facility address", () => {
  it("D.7.2 carries the history; placeholders carry nothing", async () => {
    const { xml } = await ingest();
    expect(xml).toContain(
      'displayName="historyAndConcurrentConditionText"/><value xsi:type="ED">Allergy to penicillin</value>',
    );
    for (const placeholder of ["UNKNOWN", "nil", "-", "N/A"]) {
      const { pvCase } = await ingest({ "Medical History(Allergy Presentation)": placeholder });
      expect(pvCase.patient.medicalHistoryText, placeholder).toBeUndefined();
    }
  });
  it("G.k.11 carries the diluent batch on the suspect vaccine", async () => {
    const { pvCase, xml } = await ingest();
    expect(pvCase.products[0]!.additionalInformation).toBe("Diluent batch/lot: DIL-TEST-9");
    expect(xml).toContain(
      'displayName="additionalInformation"/><value xsi:type="ST">Diluent batch/lot: DIL-TEST-9</value>',
    );
  });
  it("other vaccines become concomitant products; 'nil' adds none", async () => {
    const { pvCase } = await ingest();
    const concomitant = pvCase.products.filter((p) => p.characterization === "CONCOMITANT");
    expect(concomitant.map((p) => p.product.sourceValue)).toEqual(["BCG", "OPV"]);
    expect(pvCase.products.filter((p) => p.characterization === "SUSPECT")).toHaveLength(1);
    const none = await ingest({ "Other vaccines given just prior to AEFI": "nil" });
    expect(none.pvCase.products).toHaveLength(1);
  });
  it("C.2.r.2.3 carries the facility address", async () => {
    const { xml } = await ingest();
    expect(xml).toContain("<streetAddressLine>BHC Testville</streetAddressLine>");
  });
  it("placeholder words are recognised", () => {
    expect(meaningfulText(" nil ")).toBeUndefined();
    expect(meaningfulText("Asthma")).toBe("Asthma");
  });
  it("writes an artifact so the ICH XSD checks D.7.2, G.k.11, concomitants and the street", async () => {
    const { xml } = await ingest();
    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "test-ondo-column-mapping.xml"), xml, "utf-8");
    expect(xml).toContain("<streetAddressLine>");
  });
});

describe("the vaccination time in the onset date", () => {
  it("11:00 + 15 hours crosses midnight", () => {
    expect(resolveOnset("3/2/26", "15 hours", "11:00")?.date).toBe("2026-02-04");
    expect(resolveOnset("3/2/26", "15 hours", "11:00")?.note).toContain('"3/2/26" at 11:00');
  });
  it("without a time, or with an unreadable one, the date alone is used", () => {
    expect(resolveOnset("3/2/26", "15 hours")?.date).toBe("2026-02-03");
    expect(resolveOnset("3/2/26", "15 hours", "morning")?.date).toBe("2026-02-03");
  });
  it("a 2pm time reads correctly", () => {
    expect(resolveOnset("3/2/26", "12 hours", "2:00PM")?.date).toBe("2026-02-04");
  });
});

describe("line-list notes", () => {
  const mapping = {
    "National date": "national_received_date",
    "State date": "state_received_date",
    Email: "reporter_email",
  } as Record<string, TargetField>;
  const rows: ParsedRow[] = [
    { national_received_date: "9/2/26", reporter_email: "a.reporter@example.org" },
    { state_received_date: "6/2/26", reporter_email: "Main Street, Testville" },
    { reporter_email: "nil" },
  ];
  const issues = runValidation(Object.keys(mapping), mapping, rows);
  it("says once how C.1.4 was filled where the national date is missing", () => {
    const note = issues.filter((i) => i.code === "NATIONAL_RECEIVED_DATE_MISSING");
    expect(note).toHaveLength(1);
    expect(note[0]!.row).toBe(0);
    expect(note[0]!.message).toContain("2 case(s) have no national received date");
    expect(note[0]!.message).toContain("state-level received date was used for 1");
    expect(note[0]!.message).toContain("1 have neither");
  });
  it("flags an address in the e-mail column, not a real e-mail or 'nil'", () => {
    expect(
      issues.filter((i) => i.code === "REPORTER_EMAIL_NOT_AN_EMAIL").map((i) => i.row),
    ).toEqual([2]);
  });
});
