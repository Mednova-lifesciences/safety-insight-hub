import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeBatchToXml } from "./serializer";
import { validateBusinessRules } from "./validation";
import type { PVCase } from "./types";

/** Traces C.1.10 (follow-up) end to end: PVCase -> validation ->
 *  serializer -> generated XML, per the audit's explicit A-E scenarios.
 *  Structure confirmed against the official ICH reference instance — see
 *  serializer.ts's followUpBlock doc comment. */
function baseCase(overrides: Partial<PVCase> = {}): PVCase {
  return {
    internalCaseId: "job-followup",
    sendersCaseId: "NG-MEDNOVA-000010",
    worldwideUniqueId: "NG-MEDNOVA-000010",
    firstSenderOfCase: "2",
    reportType: { present: true, value: "1" },
    dateOfCreation: "2026-09-09T08:19:00Z",
    dateFirstReceived: "2026-09-03T00:00:00Z",
    dateMostRecentInfo: "2026-09-09T00:00:00Z",
    additionalDocumentsAvailable: false,
    fulfilsExpeditedCriteria: { present: false, nullFlavor: "NASK" },
    otherCaseIdentifiersInPreviousTransmissions: { present: false, nullFlavor: "NI" },
    followUp: { isFollowUp: false },
    patient: { identity: { present: true, value: { kind: "INITIALS", initials: "A.B." } } },
    reporter: { name: { present: false, nullFlavor: "NASK" }, country: "NG", qualificationVerbatim: "CHEW" },
    senderOrganisation: "MEDNOVA",
    reactions: [
      { id: "r1", reaction: { sourceValue: "19", status: "UNMAPPED", mappingMethod: "NONE" }, seriousnessCriteria: {} },
    ],
    products: [
      { id: "p1", characterization: "SUSPECT", product: { sourceValue: "PENTA", status: "UNMAPPED", mappingMethod: "NONE" } },
    ],
    sourceInformation: { sourceFile: "test.xlsx", sourceRow: 1, jobId: "job-followup" },
    ...overrides,
  };
}

describe("C.1.10 follow-up — end to end (mapping -> validation -> serializer -> XML)", () => {
  it("A. initial report: no linked-report block anywhere in the XML", () => {
    const c = baseCase({ followUp: { isFollowUp: false } });
    expect(validateBusinessRules(c).some((e) => e.code === "E2B-C1.10-FOLLOWUP-REF-MISSING")).toBe(false);
    const xml = serializeBatchToXml([c], { batchId: "B", senderId: "S", receiverId: "R", transmissionTimestamp: new Date("2026-09-09T00:00:00Z") });
    // The only C.1.8.1-OID id elements should be the case's own two (case id + worldwide id) — no third linked-report id.
    const linkedIds = (xml.match(/root="2\.16\.840\.1\.113883\.3\.989\.2\.1\.3\.2"/g) ?? []).length;
    expect(linkedIds).toBe(1); // just the case's own worldwideUniqueId <id>
  });

  it("D. follow-up with a valid original case identifier: linked-report block present, references the right id", () => {
    const c = baseCase({
      followUp: { isFollowUp: true, previousTransmissionRef: "NG-MEDNOVA-000010-MSG1" },
    });
    expect(validateBusinessRules(c).some((e) => e.code === "E2B-C1.10-FOLLOWUP-REF-MISSING")).toBe(false);
    const xml = serializeBatchToXml([c], { batchId: "B", senderId: "S", receiverId: "R", transmissionTimestamp: new Date("2026-09-09T00:00:00Z") });
    expect(xml).toContain('<code nullFlavor="NA"/>');
    expect(xml).toContain('<id extension="NG-MEDNOVA-000010-MSG1" root="2.16.840.1.113883.3.989.2.1.3.2"/>');
  });

  it("C. follow-up with a missing original case identifier: BLOCKED by business rules, serializer emits no broken/empty link", () => {
    const c = baseCase({ followUp: { isFollowUp: true } });
    const errors = validateBusinessRules(c);
    const blocking = errors.find((e) => e.code === "E2B-C1.10-FOLLOWUP-REF-MISSING");
    expect(blocking?.severity).toBe("BLOCKING");
    expect(blocking?.e2bField).toBe("C.1.10.r");
    // Even though the case is invalid, the serializer must never emit a
    // dangling/empty relatedInvestigation block for it — fail closed, not
    // "close enough."
    const xml = serializeBatchToXml([c], { batchId: "B", senderId: "S", receiverId: "R", transmissionTimestamp: new Date("2026-09-09T00:00:00Z") });
    expect(xml).not.toContain('<code nullFlavor="NA"/>');
  });

  it("B. a batch containing both an initial report and a follow-up report serializes both correctly, independently", () => {
    const initial = baseCase({ sendersCaseId: "NG-MEDNOVA-000011", worldwideUniqueId: "NG-MEDNOVA-000011" });
    const followUp = baseCase({
      sendersCaseId: "NG-MEDNOVA-000012",
      worldwideUniqueId: "NG-MEDNOVA-000012",
      followUp: { isFollowUp: true, previousTransmissionRef: "NG-MEDNOVA-000012-MSG1" },
    });
    const xml = serializeBatchToXml([initial, followUp], {
      batchId: "MEDNOVA-BATCH-FOLLOWUP-TEST",
      senderId: "MEDNOVA",
      receiverId: "NAFDAC",
      transmissionTimestamp: new Date("2026-09-09T08:19:00Z"),
    });
    expect((xml.match(/<PORR_IN049016UV>/g) ?? []).length).toBe(2);
    expect(xml).toContain('<id extension="NG-MEDNOVA-000012-MSG1"');

    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "test-followup-case.xml"), xml, "utf-8");
  });

  it("E. versioning: dateOfCreation (C.1.2) changes between the initial and follow-up transmission's creationTime", () => {
    const initial = baseCase({ dateOfCreation: "2026-09-03T00:00:00Z" });
    const followUp = baseCase({
      dateOfCreation: "2026-09-09T08:19:00Z",
      followUp: { isFollowUp: true, previousTransmissionRef: "NG-MEDNOVA-000010-MSG1" },
    });
    const xmlInitial = serializeBatchToXml([initial], { batchId: "B1", senderId: "S", receiverId: "R", transmissionTimestamp: new Date("2026-09-03T00:00:00Z") });
    const xmlFollowUp = serializeBatchToXml([followUp], { batchId: "B2", senderId: "S", receiverId: "R", transmissionTimestamp: new Date("2026-09-09T08:19:00Z") });
    expect(xmlInitial).toContain('effectiveTime value="20260903000000"');
    expect(xmlFollowUp).toContain('effectiveTime value="20260909081900"');
    expect(xmlInitial).not.toBe(xmlFollowUp);
  });
});
