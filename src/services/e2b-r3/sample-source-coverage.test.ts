import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapColumnsByKeywords } from "../api/tabular-parse";
import { FIELD_KEYWORDS, type TargetField } from "../api/linelist";
import { mapSourceRecordToPVCase } from "./mapping";
import { serializeBatchToXml } from "./serializer";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";

/**
 * Source coverage against the representative sample line list (task
 * section 26).
 *
 * This reads the real file in the repository root — the same one used for
 * walkthroughs — and asserts that every meaningful column reaches an
 * E2B(R3) destination or is explicitly classified with a reason.
 *
 * The regression it exists to prevent: someone adds a column to a source
 * file (or a field to TARGET_FIELDS) and forgets one of the four places
 * it has to be wired — keywords, column map, mapper, serializer. Age
 * failed at the mapper; route failed at the column map. Both were
 * invisible because the model still type-checked.
 */

const SAMPLE = join(__dirname, "..", "..", "..", "sample-linelist-50-cases.csv");

/** Minimal CSV read: the sample has no quoted commas. */
function readSample(): { headers: string[]; rows: Record<string, string>[] } {
  const lines = readFileSync(SAMPLE, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  // Line 1 is a human title banner, line 2 is the header row.
  const headers = lines[1]!.split(",");
  const rows = lines.slice(2).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
  return { headers, rows };
}

/**
 * How each column of the sample is expected to be treated. Every column
 * must appear here: an unlisted column fails the completeness test below,
 * which is the whole point.
 */
const EXPECTED: Record<string, { field: TargetField | null; why?: string }> = {
  "Case ID": { field: "case_id" },
  Patient: { field: "patient_identifier" },
  "Hospital Number": { field: "patient_id" },
  Sex: { field: "sex" },
  Age: { field: "age" },
  Vaccine: { field: "product" },
  Batch: { field: "vaccine_batch" },
  "Date of Vaccination": { field: "vaccination_date" },
  "Date of Onset": { field: "onset_date" },
  Reaction: { field: "reaction" },
  Outcome: { field: "outcome" },
  Seriousness: { field: "seriousness" },
  "Report Date": { field: "report_date" },
  Reporter: {
    field: null,
    why:
      "Deliberately unmapped by the deterministic matcher: this column holds ROLES " +
      "(Nurse, CHEW, Doctor), but the identically-headed column on other forms holds a " +
      "person's name. The AI column mapper decides it from the sample values.",
  },
};

const CONFIG: E2bTransmissionConfig = {
  ...UNCONFIRMED_DEFAULT_CONFIG,
  sender: { organization: "MedNova", identifier: "MEDNOVA-SND" },
  receiver: { identifier: "NAFDAC-RCV" },
};

describe("the sample line list is fully accounted for", () => {
  const { headers, rows } = readSample();

  it("has every column classified", () => {
    const unclassified = headers.filter((h) => !(h in EXPECTED));
    expect(unclassified, "a column was added to the sample without saying where it goes").toEqual(
      [],
    );
  });

  it("maps every column exactly as classified", () => {
    const mapping = mapColumnsByKeywords(headers, FIELD_KEYWORDS);
    for (const header of headers) {
      const expected = EXPECTED[header]!;
      expect(mapping[header] ?? null, `column "${header}"`).toBe(expected.field);
    }
  });

  it("gives a reason for every column it does not map", () => {
    for (const [header, e] of Object.entries(EXPECTED)) {
      if (e.field === null) expect(e.why, `"${header}" must explain itself`).toBeTruthy();
    }
  });

  it("carries all 50 rows through to XML with each mapped value present", async () => {
    const mapping = mapColumnsByKeywords(headers, FIELD_KEYWORDS);
    expect(rows).toHaveLength(50);

    const cases = await Promise.all(
      rows.map(async (row, i) => {
        const canonical: Record<string, string | undefined> = {};
        for (const [header, value] of Object.entries(row)) {
          const field = mapping[header];
          if (field && value) canonical[field] = value;
        }
        const { pvCase } = await mapSourceRecordToPVCase(
          canonical,
          { ...genericVerbatimProfile, patientRecordNumberSource: "HOSPITAL" },
          CONFIG,
          {
            jobId: "job-sample",
            sourceFile: "sample-linelist-50-cases.csv",
            sourceRow: i + 1,
            processedAt: "2026-09-23T00:00:00Z",
          },
          { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
        );
        return pvCase;
      }),
    );

    const xml = serializeBatchToXml(cases, {
      batchId: "MEDNOVA-SAMPLE-0001",
      senderId: "MEDNOVA-SND",
      receiverId: "NAFDAC-RCV",
      transmissionTimestamp: new Date("2026-09-23T00:00:00Z"),
    });

    // Every source case id, exactly as the file wrote it.
    for (const row of rows) {
      expect(xml).toContain(
        `<id extension="${row["Case ID"]}" root="2.16.840.1.113883.3.989.2.1.3.1"/>`,
      );
    }
    // Every hospital number, under the hospital record OID.
    for (const row of rows) {
      expect(xml).toContain(`extension="${row["Hospital Number"]}"`);
    }
    // Every age reaches D.2.2a. This is the assertion that would have
    // failed before D.2.2b existed: all 50 ages were dropped.
    const ages = [...xml.matchAll(/displayName="age"\/><value xsi:type="PQ" value="(\d+)"/g)].map(
      (m) => m[1],
    );
    expect(ages).toHaveLength(50);
    expect(ages).toEqual(rows.map((r) => r["Age"]));
    // Sex reaches D.5 for every row that states one.
    expect([...xml.matchAll(/<administrativeGenderCode code="(\d)"/g)]).toHaveLength(50);
    // Every reaction's verbatim survives.
    for (const row of rows) {
      const first = row["Reaction"]!.split(" / ")[0]!;
      expect(xml).toContain(`<originalText>${first}</originalText>`);
    }
    // Every batch number reaches G.k.4.r.7.
    for (const row of rows) {
      expect(xml).toContain(`<lotNumberText>${row["Batch"]}</lotNumberText>`);
    }
  });

  it("warns about the missing age unit and nothing else", async () => {
    // Section 22: an absent OPTIONAL field must not generate noise. The
    // sample has no DOB, no age-group, no route and no reporter contact
    // columns, and none of those may produce a warning. A stated age with
    // no stated unit is different — that is uncertainty about a value
    // that IS present, and it is reported.
    const mapping = mapColumnsByKeywords(headers, FIELD_KEYWORDS);
    const canonical: Record<string, string | undefined> = {};
    for (const [header, value] of Object.entries(rows[0]!)) {
      const field = mapping[header];
      if (field && value) canonical[field] = value;
    }
    const { warnings } = await mapSourceRecordToPVCase(
      canonical,
      { ...genericVerbatimProfile, patientRecordNumberSource: "HOSPITAL" },
      CONFIG,
      {
        jobId: "job-sample",
        sourceFile: "sample-linelist-50-cases.csv",
        sourceRow: 1,
        processedAt: "2026-09-23T00:00:00Z",
      },
      { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
    );
    expect(warnings.map((w) => w.field)).toEqual(["age"]);
  });
});
