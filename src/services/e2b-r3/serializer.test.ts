import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeBatchToXml, toHl7Ts } from "./serializer";
import type { PVCase } from "./types";

function baseCase(overrides: Partial<PVCase> = {}): PVCase {
  return {
    internalCaseId: "job-1",
    sendersCaseId: "NG-MEDNOVA-000001",
    caseSafetyReportId: "NG-MEDNOVA-000001",
    worldwideUniqueId: "NG-MEDNOVA-000001",
    firstSenderOfCase: "2",
    reportType: { present: true, value: "1" },
    dateOfCreation: "2026-09-09T08:19:00Z",
    dateFirstReceived: "2026-09-03T00:00:00Z",
    dateMostRecentInfo: "2026-09-09T00:00:00Z",
    additionalDocumentsAvailable: false,
    fulfilsExpeditedCriteria: { present: false, nullFlavor: "NASK" },
    otherCaseIdentifiersInPreviousTransmissions: { present: false, nullFlavor: "NI" },
    followUp: { isFollowUp: false },
    patient: {
      identity: { present: true, value: { kind: "INITIALS", initials: "A.E." } },
      sex: "FEMALE",
      age: "5",
      ageUnit: "801",
    },
    reporter: {
      name: { present: false, nullFlavor: "NASK" },
      country: "NG",
      qualificationVerbatim: "CHEW",
    },
    senderOrganisation: "MEDNOVA",
    reactions: [
      {
        id: "r1",
        sourceDecoding: {
          status: "DECODED",
          localCode: "19",
          sourceTerm: "19",
          sourceProfileId: "test-profile",
        },
        reaction: { sourceValue: "19", status: "UNMAPPED", mappingMethod: "NONE" },
        onsetDate: "2026-09-04",
        outcome: "RECOVERED",
        seriousnessCriteria: {
          resultsInDeath: false,
          lifeThreatening: false,
          hospitalization: false,
          disabling: false,
          congenitalAnomaly: false,
          otherMedicallyImportant: false,
        },
      },
    ],
    products: [
      {
        id: "p1",
        characterization: "SUSPECT",
        product: { sourceValue: "PENTA", status: "UNMAPPED", mappingMethod: "NONE" },
        batchNumber: "LOT-2026-0091",
        dose: "0.5ml",
        startDate: "2026-09-03",
      },
    ],
    narrative:
      "5-year-old female (initials A.E.) developed fever following PENTA vaccination administered 2026-09-03; reported recovered.",
    sourceInformation: {
      sourceFile: "ondo_aefi_linelist.xlsx",
      sourceRow: 2,
      jobId: "job-1",
      sourceProfileId: "test-profile",
    },
    ...overrides,
  };
}

describe("serializeBatchToXml", () => {
  it.each([
    ["RECOVERED", "1"],
    ["RECOVERING", "2"],
    ["NOT_RECOVERED", "3"],
    ["RECOVERED_WITH_SEQUELAE", "4"],
    ["FATAL", "5"],
    ["UNKNOWN", "0"],
  ] as const)(
    "serializes ICH E.i.7 %s as %s without administrator configuration",
    (outcome, code) => {
      const xml = serializeBatchToXml(
        [baseCase({ reactions: [{ ...baseCase().reactions[0]!, outcome }] })],
        {
          batchId: "B",
          senderId: "S",
          receiverId: "R",
          transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
          outcomeCodes: { UNKNOWN: "6" },
        },
      );
      expect(xml).toContain(`code="${code}"`);
      if (outcome === "UNKNOWN") expect(xml).not.toContain('code="6"');
    },
  );
});

/**
 * The batch wrapper (N.1) and the message header (N.2.r), checked against
 * the structure ICH itself publishes: MCCI_MT200100UV.Batch's content model
 * in ICH_ICSR_XML_Schema_Set_v2.5, and the field-to-element mapping spelled
 * out in ICH_ICSR_Reference_Instances_v3.1 — both under
 * regulatory-assets/e2b-r3/official-ich/.
 */
describe("batch wrapper (N.1) and message header (N.2.r)", () => {
  const batchOf = (cases: PVCase[]) =>
    serializeBatchToXml(cases, {
      batchId: "MEDNOVA-BATCH-0001",
      senderId: "MEDNOVA-SENDER",
      receiverId: "NAFDAC-RECEIVER",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });

  it("carries N.1.1 as the coded Type of Messages in Batch, once", () => {
    const xml = batchOf([baseCase(), baseCase({ caseSafetyReportId: "NG-MEDNOVA-000002" })]);
    const n11 = '<name code="1" codeSystem="2.16.840.1.113883.3.989.2.1.1.1"/>';
    expect(xml).toContain(n11);
    expect(xml.split(n11).length - 1).toBe(1);
    // "ichicsr" is E2B(R2)'s <messagetype> literal; R3 codes it as 1.
    expect(xml).not.toContain(">ichicsr<");
  });

  it("puts every N.1 element where the ICH schema's sequence puts it", () => {
    const xml = batchOf([baseCase()]);
    const at = (fragment: string) => xml.indexOf(fragment);
    const id = at('root="2.16.840.1.113883.3.989.2.1.3.22"'); // N.1.2
    const creationTime = at("<creationTime"); // N.1.5
    const interactionId = at('extension="MCCI_IN200100UV01"');
    const name = at('codeSystem="2.16.840.1.113883.3.989.2.1.1.1"'); // N.1.1
    const firstMessage = at("<PORR_IN049016UV>");
    const receiver = xml.lastIndexOf('root="2.16.840.1.113883.3.989.2.1.3.14"'); // N.1.4
    const sender = xml.lastIndexOf('root="2.16.840.1.113883.3.989.2.1.3.13"'); // N.1.3
    expect(id).toBeLessThan(creationTime);
    expect(creationTime).toBeLessThan(interactionId);
    expect(interactionId).toBeLessThan(name);
    expect(name).toBeLessThan(firstMessage);
    // MCCI_MT200100UV.Batch: ... choice(PORR_IN049016UV)[1..*], receiver,
    // respondTo?, sender. The batch's own sender/receiver follow the
    // messages — moving them ahead of the messages, as looks natural,
    // makes the document schema-invalid.
    expect(firstMessage).toBeLessThan(receiver);
    expect(receiver).toBeLessThan(sender);
  });

  it("uses one identifier for N.2.r.1 and C.1.1, so they cannot drift apart", () => {
    const cases = [
      baseCase({ caseSafetyReportId: "NG-MEDNOVA-000001" }),
      baseCase({ caseSafetyReportId: "NG-MEDNOVA-000002" }),
      baseCase({ caseSafetyReportId: "NG-MEDNOVA-000003" }),
    ];
    const xml = batchOf(cases);
    const messageIds = [...xml.matchAll(/<PORR_IN049016UV><id extension="([^"]+)"/g)].map(
      (m) => m[1],
    );
    const c11 = [
      ...xml.matchAll(
        /<investigationEvent classCode="INVSTG" moodCode="EVN"><id extension="([^"]+)"/g,
      ),
    ].map((m) => m[1]);
    expect(messageIds).toEqual(["NG-MEDNOVA-000001", "NG-MEDNOVA-000002", "NG-MEDNOVA-000003"]);
    expect(messageIds).toEqual(c11);
  });

  it("gives N.2.r.1 and C.1.1 the same ICH namespace OID", () => {
    const xml = batchOf([baseCase()]);
    expect(xml).toContain(
      '<PORR_IN049016UV><id extension="NG-MEDNOVA-000001" root="2.16.840.1.113883.3.989.2.1.3.1"/>',
    );
    expect(xml).toContain(
      '<investigationEvent classCode="INVSTG" moodCode="EVN"><id extension="NG-MEDNOVA-000001" root="2.16.840.1.113883.3.989.2.1.3.1"/>',
    );
  });

  it("routes the message to the configured sender and receiver, not to each other", () => {
    const xml = batchOf([baseCase()]);
    // N.2.r.2 sender ...3.11, N.2.r.3 receiver ...3.12 (message level);
    // N.1.3 sender ...3.13, N.1.4 receiver ...3.14 (batch level).
    expect(xml).toContain(
      '<id extension="MEDNOVA-SENDER" root="2.16.840.1.113883.3.989.2.1.3.11"/>',
    );
    expect(xml).toContain(
      '<id extension="NAFDAC-RECEIVER" root="2.16.840.1.113883.3.989.2.1.3.12"/>',
    );
    expect(xml).toContain(
      '<id extension="NAFDAC-RECEIVER" root="2.16.840.1.113883.3.989.2.1.3.14"/>',
    );
    expect(xml).toContain(
      '<id extension="MEDNOVA-SENDER" root="2.16.840.1.113883.3.989.2.1.3.13"/>',
    );
  });

  it("carries C.1.8.1 and C.1.8.2 on every case", () => {
    const xml = batchOf([baseCase()]);
    // C.1.8.1 — worldwide unique id, its own namespace OID ...3.2.
    expect(xml).toContain(
      '<id extension="NG-MEDNOVA-000001" root="2.16.840.1.113883.3.989.2.1.3.2"/>',
    );
    // C.1.8.2 — first sender of this case (1 = Regulator, 2 = Other).
    expect(xml).toMatch(
      /<code code="2" codeSystem="2\.16\.840\.1\.113883\.3\.989\.2\.1\.1\.3" codeSystemVersion="1\.0"\/>/,
    );
  });
});

describe("E.i.3.2a-f — the six seriousness criteria", () => {
  const CRITERION_CODES = ["34", "21", "33", "35", "12", "26"];
  const batchOf = (c: PVCase) =>
    serializeBatchToXml([c], {
      batchId: "B",
      senderId: "S",
      receiverId: "R",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
  const criterion = (xml: string, code: string) =>
    xml.match(
      new RegExp(
        `code="${code}" codeSystem="[^"]+" codeSystemVersion="1.1"[^>]*/><value xsi:type="BL" ([^/]+)/>`,
      ),
    )?.[1];

  const withCriteria = (criteria: PVCase["reactions"][number]["seriousnessCriteria"]) => {
    const c = baseCase();
    return { ...c, reactions: [{ ...c.reactions[0]!, seriousnessCriteria: criteria }] } as PVCase;
  };

  it("represents all six on every reaction", () => {
    const xml = batchOf(withCriteria({}));
    for (const code of CRITERION_CODES) expect(criterion(xml, code)).toBeDefined();
  });

  it("says NI — not NASK — for a criterion the case never establishes", () => {
    const xml = batchOf(withCriteria({}));
    for (const code of CRITERION_CODES) expect(criterion(xml, code)).toBe('nullFlavor="NI"');
    // Scoped to these six on purpose. C.1.7 is a different element with a
    // different rule (the spec restricts NI there to R2 retransmissions),
    // and export blocks on an undecided C.1.7 anyway.
    const reactionBlock = xml.slice(
      xml.indexOf('displayName="reaction"'),
      xml.indexOf('displayName="drugInformation"'),
    );
    expect(reactionBlock).not.toContain("NASK");
  });

  it("says true for a criterion the source records as met, and NI for the rest", () => {
    const xml = batchOf(withCriteria({ hospitalization: true }));
    expect(criterion(xml, "33")).toBe('value="true"');
    for (const code of ["34", "21", "35", "12", "26"]) {
      expect(criterion(xml, code)).toBe('nullFlavor="NI"');
    }
  });

  it("says false only where the source positively rules a criterion out", () => {
    const xml = batchOf(withCriteria({ resultsInDeath: false }));
    expect(criterion(xml, "34")).toBe('value="false"');
  });

  it("never invents a criterion from a case-level seriousness word", () => {
    const c = withCriteria({});
    const xml = batchOf({ ...c, aggregateSeriousnessAsReported: "Serious" } as PVCase);
    for (const code of CRITERION_CODES) expect(criterion(xml, code)).toBe('nullFlavor="NI"');
  });
});

describe("serializeBatchToXml — existing behaviour", () => {
  it("produces well-formed XML with the real E2B(R3) root, not the old flat <ichicsr> shape", () => {
    const xml = serializeBatchToXml([baseCase()], {
      batchId: "MEDNOVA-BATCH-TEST",
      senderId: "MEDNOVA",
      receiverId: "NAFDAC",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
    expect(xml).toContain("<MCCI_IN200100UV01");
    expect(xml).toContain('xmlns="urn:hl7-org:v3"');
    expect(xml).toContain("<PORR_IN049016UV>");
    expect(xml).not.toContain("<ichicsr>");
    expect(xml).not.toContain("<safetyreport>");
    expect(xml).not.toContain("<serious_verbatim>");
  });

  it("never emits an unparseable malformed timestamp like the old generator's bug", () => {
    expect(() => toHl7Ts("not-a-date")).toThrow();
    const xml = serializeBatchToXml([baseCase()], {
      batchId: "B",
      senderId: "S",
      receiverId: "R",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
    expect(xml).not.toMatch(/value="\d{8}T\d+"/); // never the old "20260909T08191" shape
  });

  it("never emits a raw source reaction/product code as if it were a MedDRA/WHODrug code", () => {
    const xml = serializeBatchToXml([baseCase()], {
      batchId: "B",
      senderId: "S",
      receiverId: "R",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
    // sourceValue "19" and "PENTA" must appear only as originalText/name (verbatim), never as a coded value
    expect(xml).toMatch(/<originalText>19<\/originalText>/);
    expect(xml).not.toMatch(/code="19" codeSystem="2\.16\.840\.1\.113883\.6\.163"/);
  });

  it("writes the required test artifact for the E2B(R3) audit", () => {
    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    const single = serializeBatchToXml([baseCase()], {
      batchId: "MEDNOVA-BATCH-0001",
      senderId: "MEDNOVA",
      receiverId: "NAFDAC",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
    writeFileSync(join(dir, "test-valid-icSR.xml"), single, "utf-8");

    const multi = serializeBatchToXml(
      [
        baseCase(),
        baseCase({
          internalCaseId: "job-2",
          sendersCaseId: "NG-MEDNOVA-000002",
          caseSafetyReportId: "NG-MEDNOVA-000002",
          worldwideUniqueId: "NG-MEDNOVA-000002",
          patient: {
            identity: { present: true, value: { kind: "INITIALS", initials: "E.T." } },
            sex: "MALE",
            age: "2",
            ageUnit: "801",
          },
          reactions: [
            {
              id: "r2a",
              sourceDecoding: {
                status: "DECODED",
                localCode: "8",
                sourceTerm: "8",
                sourceProfileId: "test-profile",
              },
              reaction: { sourceValue: "8", status: "UNMAPPED", mappingMethod: "NONE" },
              onsetDate: "2026-09-05",
              outcome: "RECOVERING",
              seriousnessCriteria: { hospitalization: true },
            },
            {
              id: "r2b",
              sourceDecoding: {
                status: "DECODED",
                localCode: "21",
                sourceTerm: "21",
                sourceProfileId: "test-profile",
              },
              reaction: { sourceValue: "21", status: "UNMAPPED", mappingMethod: "NONE" },
              seriousnessCriteria: {},
            },
          ],
          products: [
            {
              id: "p2a",
              characterization: "SUSPECT",
              product: { sourceValue: "IPV", status: "UNMAPPED", mappingMethod: "NONE" },
              batchNumber: "LOT-2026-0044",
            },
            {
              id: "p2b",
              characterization: "SUSPECT",
              product: { sourceValue: "PCV", status: "UNMAPPED", mappingMethod: "NONE" },
              batchNumber: "LOT-2026-0055",
            },
          ],
        }),
        baseCase({
          internalCaseId: "job-3",
          sendersCaseId: "NG-MEDNOVA-000003",
          caseSafetyReportId: "NG-MEDNOVA-000003",
          worldwideUniqueId: "NG-MEDNOVA-000003",
          followUp: { isFollowUp: true, previousTransmissionRef: "NG-MEDNOVA-000003-MSG1" },
        }),
      ],
      {
        batchId: "MEDNOVA-BATCH-0002",
        senderId: "MEDNOVA",
        receiverId: "NAFDAC",
        transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
      },
    );
    writeFileSync(join(dir, "test-multi-case.xml"), multi, "utf-8");

    expect(single.length).toBeGreaterThan(0);
    expect(multi).toMatch(/NG-MEDNOVA-000001[\s\S]*NG-MEDNOVA-000002[\s\S]*NG-MEDNOVA-000003/);
  });
});
