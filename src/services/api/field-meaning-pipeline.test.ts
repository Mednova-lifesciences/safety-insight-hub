import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mapColumns, mergeColumnMapping, toParsedRows, type TargetField } from "./linelist";
import { formatFindings } from "./linelist-format-findings";
import { buildFixedCsv } from "./linelist-fixed-csv";
import { mapSourceRecordToPVCase } from "@/services/e2b-r3/mapping";
import { serializeBatchToXml } from "@/services/e2b-r3/serializer";
import { getSourceProfile } from "@/services/e2b-r3/source-profiles/registry";
import { UNCONFIRMED_DEFAULT_CONFIG } from "@/services/e2b-r3/transmission-config";
import {
  unavailableMedDraProvider,
  unavailableWhoDrugProvider,
} from "@/services/e2b-r3/coding-provider";

// One file through the steps a real upload takes — column mapping (keyword
// table, and the model when it answers), stored row, findings, the
// downloaded CSV, the E2B XML — so a column's meaning is checked where it
// lands, not only where it is decided. Synthetic values only.

type Proposal = { column: string; field: string | null; confidence: number; reason: string };
const ai = (column: string, field: string): Proposal => ({
  column,
  field,
  confidence: 0.99,
  reason: "",
});

function pipeline(headers: string[], cells: string[], model: Proposal[] | null) {
  const keyword = mapColumns(headers);
  const { mapping, notes } = mergeColumnMapping(keyword, model ?? [], model !== null, headers);
  const [parsed] = toParsedRows(headers, [cells], mapping);
  const raw = Object.fromEntries(headers.map((h, i) => [h, cells[i]!]));
  const findings = formatFindings(headers, mapping, [raw]);
  const csv = buildFixedCsv({
    columns: headers,
    rows: [raw],
    changeLog: [],
    decisions: [],
    issues: findings,
    unresolved: [],
    preservedSourceText: [],
  });
  const downloaded = XLSX.utils.sheet_to_json<string[]>(
    XLSX.read(csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv, { type: "string", raw: true })
      .Sheets["Sheet1"]!,
    { header: 1, raw: false, defval: "" },
  );
  return { mapping, notes, parsed: parsed!, findings, downloaded };
}

async function xmlFor(parsed: Record<string, string | undefined>) {
  const { pvCase } = await mapSourceRecordToPVCase(
    { reaction: "Fever", product: "Td", ...parsed },
    getSourceProfile("ondo-aefi"),
    UNCONFIRMED_DEFAULT_CONFIG,
    {
      jobId: "ll-pipeline",
      sourceFile: "synthetic.csv",
      sourceRow: 1,
      processedAt: "2026-10-14T00:00:00Z",
    },
    { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
  );
  const xml = serializeBatchToXml([pvCase], {
    batchId: "PIPELINE-1",
    senderId: "SND",
    receiverId: "RCV",
    transmissionTimestamp: new Date("2026-10-14T00:00:00Z"),
  });
  return { pvCase, xml };
}

const PATIENT: ReadonlySet<string> = new Set([
  "patient_identifier",
  "patient_id",
  "sex",
  "age",
  "age_months",
  "age_weeks",
  "age_days",
]);
const ageInXml = (xml: string) =>
  /displayName="age"\/><value xsi:type="PQ" value="([^"]*)" unit="([^"]*)"/.exec(xml)?.slice(1) ??
  null;

describe("staff columns never become patient data", () => {
  const STAFF = [
    "Supervisor initials",
    "Nurse",
    "Vaccinator",
    "Verified by",
    "Checked by (initials)",
    "Enumerator",
    "Team lead name",
    "Supervisor's phone",
  ];
  for (const staff of STAFF) {
    for (const path of ["keyword", "model"] as const) {
      it(`${JSON.stringify(staff)} via the ${path} path: no patient field, absent from E2B`, async () => {
        const headers = ["Patient initials", staff, "Sex"];
        const model =
          path === "model"
            ? [
                ai(staff, "patient_identifier"),
                ai("Patient initials", "patient_identifier"),
                ai("Sex", "sex"),
              ]
            : null;
        const { mapping, parsed } = pipeline(headers, ["A.B.", "QZX", "F"], model);
        expect(PATIENT.has(mapping[staff] ?? "")).toBe(false);
        expect(Object.entries(parsed).filter(([f, v]) => PATIENT.has(f) && v === "QZX")).toEqual(
          [],
        );
        const { xml, pvCase } = await xmlFor(parsed);
        // Never in the patient (D.1–D.2) — neither the case nor the XML block.
        expect(JSON.stringify(pvCase.patient)).not.toContain("QZX");
        const patientBlock = /<player1 classCode="PSN"[\s\S]*?<\/player1>/.exec(xml)?.[0] ?? "";
        expect(patientBlock).not.toContain("QZX");
        // A staff member's phone may legitimately be the reporter's (C.2.r);
        // nothing else about staff reaches the file at all.
        if (!/phone/i.test(staff)) expect(xml).not.toContain("QZX");
        // The real patient's initials still reach D.1.
        expect(patientBlock).toContain("A.B.");
      });
    }
  }
  it("each model-only veto is explained to the user", () => {
    const { notes, mapping } = pipeline(
      ["Verified by"],
      ["QZX"],
      [ai("Verified by", "patient_identifier")],
    );
    expect(mapping["Verified by"]).toBeUndefined();
    expect(notes["Verified by"]).toMatch(/member of staff/);
  });
});

describe("an age travels in its column's unit: header → stored field → CSV → E2B XML", () => {
  it.each([
    ["Client Age (months)", "18", "age_months", "18", "mo"],
    ["Infant age (weeks)", "8", "age_weeks", "8", "wk"],
    ["Age at onset (days)", "10", "age_days", "10", "d"],
    ["Age (years)", "34", "age", "34", "a"],
  ])("%j %j", async (header, value, field, xmlValue, unit) => {
    for (const model of [null, [ai(header, "age")]]) {
      const { mapping, parsed, findings, downloaded } = pipeline([header], [value], model);
      expect(mapping[header]).toBe(field as TargetField);
      expect(parsed[field as TargetField]).toBe(value);
      expect(findings).toEqual([]);
      // The downloaded file keeps the value and the header as written.
      expect(downloaded[0]![0]).toBe(header);
      expect(downloaded[1]![0]).toBe(value);
      const { xml } = await xmlFor(parsed);
      expect(ageInXml(xml)).toEqual([xmlValue, unit]);
    }
  });

  it.each([
    ["Infant age (weeks)", "3 months"],
    ["Infant age (weeks)", "1 year"],
    ["Age at onset (days)", "2 weeks"],
    ["Client Age (months)", "1 year"],
    ["Age (years)", "8 months"],
  ])(
    "%j holding %j: flagged, unchanged in the CSV, and NOT exported as the column's unit",
    async (header, value) => {
      const { parsed, findings, downloaded } = pipeline([header], [value], [ai(header, "age")]);
      expect(findings.map((f) => [f.code, f.fixable, f.suggestion ?? null])).toEqual([
        ["AGE_UNIT_MISMATCH", false, null],
      ]);
      expect(downloaded[1]![0]).toBe(value);
      const { xml } = await xmlFor(parsed);
      const [, columnUnit] = {
        "Infant age (weeks)": [0, "wk"],
        "Age at onset (days)": [0, "d"],
        "Client Age (months)": [0, "mo"],
        "Age (years)": [0, "a"],
      }[header] as [number, string];
      const age = ageInXml(xml);
      // Either no age at all, or the unit the cell itself states — never the
      // column's unit applied to a value written in another one.
      if (age) expect(age[1]).not.toBe(columnUnit);
    },
  );

  it("a header in a unit no field holds (hours) is not mapped and exports no age", async () => {
    const { mapping, notes, parsed } = pipeline(
      ["Age (hours)"],
      ["36"],
      [ai("Age (hours)", "age")],
    );
    expect(mapping["Age (hours)"]).toBeUndefined();
    expect(notes["Age (hours)"]).toMatch(/hours/);
    const { xml } = await xmlFor(parsed);
    expect(ageInXml(xml)).toBeNull();
  });
});

describe("volume: the header's mL is the only licence to read a bare number as a volume", () => {
  const vol = (header: string, value: string) =>
    pipeline([header], [value], null).findings.map((f) => [f.code, f.suggestion?.value ?? null]);

  it.each([
    ["0,5", [["DOSE_DECIMAL_COMMA", "0.5"]]],
    ["1,0", [["DOSE_DECIMAL_COMMA", "1.0"]]],
  ])("mL header: %j is fixed", (v, want) =>
    expect(vol("Volume administered (mL)", v)).toEqual(want),
  );

  it.each([["0.05"], ["0.5"], ["1.5"], ["2"], ["2 drops"]])(
    "mL header: %j is a legitimate volume and raises nothing",
    (v) => expect(vol("Volume administered (mL)", v)).toEqual([]),
  );

  it("an implausible volume is flagged, never changed — a flag is a question, not a rejection", () => {
    expect(vol("Volume administered (mL)", "15")).toEqual([["DOSE_IMPLAUSIBLE", null]]);
  });

  it.each([["Dose"], ["Dose volume"], ["Volume given"]])(
    "no mL in header %j: a bare 0,5 is never rewritten",
    (h) => expect(vol(h, "0,5").filter(([, s]) => s !== null)).toEqual([]),
  );

  it("a fixed volume reaches E2B as a number, with no unit invented", async () => {
    const { parsed } = pipeline(["Volume administered (mL)"], ["0.5"], null);
    const { pvCase } = await xmlFor(parsed);
    const dose = JSON.stringify(pvCase.products[0]);
    expect(dose).toContain("0.5");
    expect(dose).not.toMatch(/"unit":"(mg|ug|g)"/);
  });
});

describe("a mapping saved directly obeys the same header rules", () => {
  it("names each contradiction", async () => {
    const { mappingViolations } = await import("./linelist");
    expect(
      mappingViolations({
        "Supervisor initials": "patient_identifier",
        "Infant age (weeks)": "age",
        "Patient initials": "patient_identifier",
        "Age (years)": "age",
      }).map((v) => v.column),
    ).toEqual(["Supervisor initials", "Infant age (weeks)"]);
  });
});

describe("set H gaps: hours, abbreviated weeks, Vol.", () => {
  const models = (h: string, fields: string[]) => [null, ...fields.map((f) => [ai(h, f)])];

  it("an age in hours (with values) is never the age-unit column, never years: unmapped, explained, not exported", async () => {
    const h = "Age in hours since birth";
    for (const model of models(h, ["age_unit", "age", "age_days"])) {
      const { mapping, notes, parsed, downloaded } = pipeline([h], ["36"], model);
      expect(mapping[h]).toBeUndefined();
      expect(notes[h]).toMatch(/no field for an age in hours/);
      expect(downloaded[1]![0]).toBe("36");
      const { xml } = await xmlFor(parsed);
      expect(ageInXml(xml)).toBeNull();
    }
  });

  it.each([["Age unit"], ["Unit of age"], ["Age unit (years/months)"]])(
    "a real unit column %j still maps to age_unit",
    (h) => expect(pipeline([h], ["years"], null).mapping[h]).toBe("age_unit"),
  );

  it.each([["Age (wk)"], ["Age (wks)"], ["Age wk"]])(
    "%j is an age in weeks, to the XML",
    async (h) => {
      for (const model of models(h, ["age"])) {
        const { mapping, parsed } = pipeline([h], ["9"], model);
        expect(mapping[h]).toBe("age_weeks");
        const { xml } = await xmlFor(parsed);
        expect(ageInXml(xml)).toEqual(["9", "wk"]);
      }
    },
  );

  it.each([
    ["Dosage (wk)"],
    ["Gestational age (wk)"],
    ["Epi wk"],
    ["Wk of vaccination"],
    ["Stage (wks)"],
  ])("%j is not the patient's age, by keyword or by the model", (h) => {
    for (const model of models(h, ["age_weeks", "age"])) {
      const f = pipeline([h], ["9"], model).mapping[h] ?? "";
      expect(["age", "age_months", "age_weeks", "age_days", "age_unit"]).not.toContain(f);
    }
  });

  it("Vol. is the vaccine volume: a unit in the cell is used, the header never supplies one", () => {
    const run = (v: string) =>
      pipeline(["Vol."], [v], [{ column: "Vol.", field: null, confidence: 0.99, reason: "" }]);
    expect(run("0.5ml").mapping["Vol."]).toBe("dose");
    expect(run("0,5ml").findings.map((f) => [f.code, f.suggestion?.value ?? null])).toEqual([
      ["DOSE_DECIMAL_COMMA", "0.5ml"],
    ]);
    expect(run("5ml").findings.map((f) => f.code)).toEqual(["DOSE_IMPLAUSIBLE"]);
    // "Vol." states no unit: a bare 0,5 may be two values and is not rewritten.
    expect(run("0,5").findings.filter((f) => f.suggestion)).toEqual([]);
    expect(run("0.5ml").findings).toEqual([]);
  });

  it.each([["Volunteer"], ["Involved"], ["Diluent volume"], ["Vol. of register"]])(
    "%j is not read as the vaccine volume",
    (h) => expect(pipeline([h], ["0.5ml"], null).mapping[h]).not.toBe("dose"),
  );

  it("Vol. does not take the dose field from a column already named for it", () => {
    const { mapping } = pipeline(["Dose", "Vol."], ["1st", "0.5ml"], null);
    expect(mapping["Dose"]).toBe("dose");
    expect(mapping["Vol."]).toBeUndefined();
  });
});
