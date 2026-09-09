import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeBatchToXml, toHl7Ts } from "./serializer";
import type { PVCase } from "./types";

function baseCase(overrides: Partial<PVCase> = {}): PVCase {
  return {
    internalCaseId: "job-1",
    sendersCaseId: "NG-MEDNOVA-000001",
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
    reporter: { name: { present: false, nullFlavor: "NASK" }, country: "NG", qualificationVerbatim: "CHEW" },
    senderOrganisation: "MEDNOVA",
    reactions: [
      {
        id: "r1",
        sourceDecoding: { status: "DECODED", localCode: "19", sourceTerm: "19", sourceProfileId: "test-profile" },
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
    narrative: "5-year-old female (initials A.E.) developed fever following PENTA vaccination administered 2026-09-03; reported recovered.",
    sourceInformation: { sourceFile: "ondo_aefi_linelist.xlsx", sourceRow: 2, jobId: "job-1", sourceProfileId: "test-profile" },
    ...overrides,
  };
}

describe("serializeBatchToXml", () => {
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
          worldwideUniqueId: "NG-MEDNOVA-000002",
          patient: { identity: { present: true, value: { kind: "INITIALS", initials: "E.T." } }, sex: "MALE", age: "2", ageUnit: "801" },
          reactions: [
            {
              id: "r2a",
              sourceDecoding: { status: "DECODED", localCode: "8", sourceTerm: "8", sourceProfileId: "test-profile" },
              reaction: { sourceValue: "8", status: "UNMAPPED", mappingMethod: "NONE" },
              onsetDate: "2026-09-05",
              outcome: "RECOVERING",
              seriousnessCriteria: { hospitalization: true },
            },
            {
              id: "r2b",
              sourceDecoding: { status: "DECODED", localCode: "21", sourceTerm: "21", sourceProfileId: "test-profile" },
              reaction: { sourceValue: "21", status: "UNMAPPED", mappingMethod: "NONE" },
              seriousnessCriteria: {},
            },
          ],
          products: [
            { id: "p2a", characterization: "SUSPECT", product: { sourceValue: "IPV", status: "UNMAPPED", mappingMethod: "NONE" }, batchNumber: "LOT-2026-0044" },
            { id: "p2b", characterization: "SUSPECT", product: { sourceValue: "PCV", status: "UNMAPPED", mappingMethod: "NONE" }, batchNumber: "LOT-2026-0055" },
          ],
        }),
        baseCase({
          internalCaseId: "job-3",
          sendersCaseId: "NG-MEDNOVA-000003",
          worldwideUniqueId: "NG-MEDNOVA-000003",
          followUp: { isFollowUp: true, previousTransmissionRef: "NG-MEDNOVA-000003-MSG1" },
        }),
      ],
      { batchId: "MEDNOVA-BATCH-0002", senderId: "MEDNOVA", receiverId: "NAFDAC", transmissionTimestamp: new Date("2026-09-09T08:19:00Z") },
    );
    writeFileSync(join(dir, "test-multi-case.xml"), multi, "utf-8");

    expect(single.length).toBeGreaterThan(0);
    expect(multi).toMatch(/NG-MEDNOVA-000001[\s\S]*NG-MEDNOVA-000002[\s\S]*NG-MEDNOVA-000003/);
  });
});
