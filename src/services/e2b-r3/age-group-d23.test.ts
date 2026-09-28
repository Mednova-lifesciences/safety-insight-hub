import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGE_GROUP_CODELIST,
  AGE_GROUP_CODE_SYSTEM,
  normalizeReportedAgeGroup,
  resolveAgeGroupForExport,
} from "./age-group";
import { mapSourceRecordToPVCase } from "./mapping";
import { serializeBatchToXml } from "./serializer";
import { genericVerbatimProfile } from "./source-profiles/generic-verbatim";
import { unavailableMedDraProvider, unavailableWhoDrugProvider } from "./coding-provider";
import { UNCONFIRMED_DEFAULT_CONFIG, type E2bTransmissionConfig } from "./transmission-config";

/**
 * D.2.3 — Patient Age Group, against the ICH E2B(R3) IG v5.03 codelist
 * supplied by the organisation.
 *
 * Two ICH rules drive every assertion here, and both are restrictions:
 * D.2.3 is what the REPORTER said (never computed), and it is the least
 * precise of the three age elements, so it yields to D.2.1 and D.2.2.
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

async function xmlFor(row: Record<string, string | undefined>) {
  const { pvCase } = await caseFor(row);
  return serializeBatchToXml([pvCase], {
    batchId: "B1",
    senderId: "MEDNOVA-SND",
    receiverId: "NAFDAC-RCV",
    transmissionTimestamp: new Date("2026-09-28T00:00:00Z"),
  });
}

describe("the D.2.3 codelist", () => {
  it("carries all seven ICH codes on the ICH OID", () => {
    expect(AGE_GROUP_CODE_SYSTEM).toBe("2.16.840.1.113883.3.989.2.1.1.9");
    expect(AGE_GROUP_CODELIST?.bands.map((b) => [b.code, b.label])).toEqual([
      ["0", "Foetus"],
      ["1", "Neonate"],
      ["2", "Infant"],
      ["3", "Child"],
      ["4", "Adolescent"],
      ["5", "Adult"],
      ["6", "Elderly"],
    ]);
  });

  it("records where the codes came from", () => {
    // A regulatory code with no stated provenance is not auditable.
    expect(AGE_GROUP_CODELIST?.provenance).toContain("v5.03");
  });
});

describe("reporter terminology normalization", () => {
  it.each([
    ["Foetus", "0"],
    ["fetus", "0"],
    ["Unborn", "0"],
    ["Neonate", "1"],
    ["newborn", "1"],
    ["NEW-BORN", "1"],
    ["Infant", "2"],
    ["baby", "2"],
    ["Toddler", "2"],
    ["Child", "3"],
    ["children", "3"],
    ["Adolescent", "4"],
    ["teenager", "4"],
    ["Teen", "4"],
    ["Adult", "5"],
    ["adulthood", "5"],
    ["Elderly", "6"],
    ["senior", "6"],
    ["Geriatric", "6"],
    ["old age", "6"],
  ])("%s means D.2.3 code %s", (written, code) => {
    expect(normalizeReportedAgeGroup(written)?.code).toBe(code);
  });

  it("accepts a bare code from a source that already speaks E2B", () => {
    for (const code of ["0", "1", "2", "3", "4", "5", "6"]) {
      expect(normalizeReportedAgeGroup(code)?.code).toBe(code);
    }
  });

  it("refuses a word that names no single group", () => {
    // "Paediatric" spans neonate through adolescent. A reporter who wrote
    // it has not told us which, and picking one would be inventing it.
    for (const ambiguous of ["Paediatric", "Pediatric", "Minor", "Young", "Middle-aged", ""]) {
      expect(normalizeReportedAgeGroup(ambiguous)).toBeUndefined();
    }
  });

  it("does not accept a code outside the list", () => {
    expect(normalizeReportedAgeGroup("7")).toBeUndefined();
    expect(normalizeReportedAgeGroup("9")).toBeUndefined();
  });
});

describe("precision precedence: D.2.1 and D.2.2 outrank D.2.3", () => {
  it("emits the reporter's group when no precise age exists", () => {
    expect(resolveAgeGroupForExport({ reportedVerbatim: "Infant" })).toEqual({
      band: AGE_GROUP_CODELIST!.bands[2],
      from: "reported",
    });
  });

  it("suppresses it when a date of birth is present", () => {
    expect(
      resolveAgeGroupForExport({ reportedVerbatim: "Infant", hasDateOfBirth: true }),
    ).toBeUndefined();
  });

  it("suppresses it when a usable age is present", () => {
    expect(
      resolveAgeGroupForExport({ reportedVerbatim: "Infant", hasPreciseAge: true }),
    ).toBeUndefined();
  });

  it("never converts a numeric age into a group", () => {
    // No reporter-stated group means nothing to emit, whatever the age.
    expect(resolveAgeGroupForExport({ hasPreciseAge: true })).toBeUndefined();
    expect(resolveAgeGroupForExport({})).toBeUndefined();
  });
});

describe("D.2.3 end to end", () => {
  it("reaches the XML when the reporter stated a group and no age is given", async () => {
    const xml = await xmlFor({ age_group: "Infant" });
    expect(xml).toContain(
      `<code code="4" codeSystem="2.16.840.1.113883.3.989.2.1.1.19" codeSystemVersion="1.1" displayName="ageGroup"/><value xsi:type="CE" code="2" codeSystem="${AGE_GROUP_CODE_SYSTEM}" codeSystemVersion="1.0"/>`,
    );
  });

  it.each([
    ["Foetus", "0"],
    ["Neonate", "1"],
    ["Infant", "2"],
    ["Child", "3"],
    ["Adolescent", "4"],
    ["Adult", "5"],
    ["Elderly", "6"],
  ])("serializes %s as code %s", async (written, code) => {
    const xml = await xmlFor({ age_group: written });
    expect(xml).toContain(`code="${code}" codeSystem="${AGE_GROUP_CODE_SYSTEM}"`);
  });

  it("is absent when the case also carries a usable age", async () => {
    const xml = await xmlFor({ age_group: "Child", age: "3", age_unit: "years" });
    expect(xml).not.toContain('displayName="ageGroup"');
    // The precise value is what travels instead.
    expect(xml).toContain('<value xsi:type="PQ" value="3" unit="a"/>');
  });

  it("is absent when the case carries a date of birth", async () => {
    const xml = await xmlFor({ age_group: "Child", date_of_birth: "2022-01-01" });
    expect(xml).not.toContain('displayName="ageGroup"');
    expect(xml).toContain('<birthTime value="20220101"/>');
  });

  it("keeps the reporter's words for review even when it suppresses the element", async () => {
    const { pvCase } = await caseFor({ age_group: "Child", age: "3", age_unit: "years" });
    expect(pvCase.patient.ageGroupVerbatim).toBe("Child");
  });

  it("emits nothing for a group nobody can interpret", async () => {
    const xml = await xmlFor({ age_group: "Paediatric" });
    expect(xml).not.toContain('displayName="ageGroup"');
  });

  it("writes an artifact so the ICH XSD can be run against D.2.3", async () => {
    // Every other artifact states a precise age, which correctly
    // SUPPRESSES D.2.3 — so without this file the ageGroup observation
    // would never be schema-checked at all. One case per code, each with
    // a reporter-stated group and no age, which is the only shape in
    // which the element is ever emitted.
    const cases = await Promise.all(
      ["Foetus", "Neonate", "Infant", "Child", "Adolescent", "Adult", "Elderly"].map(
        async (group, i) => {
          const { pvCase } = await mapSourceRecordToPVCase(
            {
              case_id: `OG-D23-${i}`,
              patient_identifier: "A.B.",
              product: "Penta",
              reaction: "Fever",
              outcome: "Recovered",
              age_group: group,
            },
            genericVerbatimProfile,
            CONFIG,
            {
              jobId: "j",
              sourceFile: "f.csv",
              sourceRow: i + 1,
              processedAt: "2026-09-28T00:00:00Z",
            },
            { meddra: unavailableMedDraProvider, whodrug: unavailableWhoDrugProvider },
          );
          return pvCase;
        },
      ),
    );
    const xml = serializeBatchToXml(cases, {
      batchId: "MEDNOVA-D23-0001",
      senderId: "MEDNOVA-SND",
      receiverId: "NAFDAC-RCV",
      transmissionTimestamp: new Date("2026-09-28T00:00:00Z"),
    });
    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "test-age-group-d23.xml"), xml, "utf-8");

    // All seven codes present exactly once.
    for (const code of ["0", "1", "2", "3", "4", "5", "6"]) {
      expect(xml).toContain(
        `<value xsi:type="CE" code="${code}" codeSystem="${AGE_GROUP_CODE_SYSTEM}"`,
      );
    }
    expect([...xml.matchAll(/displayName="ageGroup"/g)]).toHaveLength(7);
  });
});
