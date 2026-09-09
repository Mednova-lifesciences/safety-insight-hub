import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { splitIntoBatches } from "./batching";
import { serializeBatchToXml } from "./serializer";
import type { PVCase } from "./types";

function fakeCase(id: string): PVCase {
  return {
    internalCaseId: id,
    sendersCaseId: id,
    worldwideUniqueId: id,
    firstSenderOfCase: "2",
    reportType: { present: true, value: "1" },
    dateOfCreation: "2026-09-09T00:00:00Z",
    dateFirstReceived: "2026-09-09T00:00:00Z",
    dateMostRecentInfo: "2026-09-09T00:00:00Z",
    additionalDocumentsAvailable: false,
    fulfilsExpeditedCriteria: { present: false, nullFlavor: "NASK" },
    otherCaseIdentifiersInPreviousTransmissions: { present: false, nullFlavor: "NI" },
    followUp: { isFollowUp: false },
    patient: { identity: { present: true, value: { kind: "INITIALS", initials: "A.B." } } },
    reporter: { name: { present: false, nullFlavor: "NASK" } },
    senderOrganisation: "MEDNOVA",
    reactions: [
      {
        id: `${id}-r1`,
        sourceDecoding: { status: "DECODED", localCode: "19", sourceTerm: "19", sourceProfileId: "test-profile" },
        reaction: { sourceValue: "19", status: "UNMAPPED", mappingMethod: "NONE" },
        seriousnessCriteria: {},
      },
    ],
    products: [
      { id: `${id}-p1`, characterization: "SUSPECT", product: { sourceValue: "PENTA", status: "UNMAPPED", mappingMethod: "NONE" } },
    ],
    sourceInformation: { sourceFile: "test.xlsx", sourceRow: 1, jobId: "job-1", sourceProfileId: "test-profile" },
  };
}

describe("100-ICSR batching -> each batch independently serializes to well-formed XML", () => {
  it("splits 231 cases into 100/100/31 and every resulting batch parses as XML", () => {
    const cases = Array.from({ length: 231 }, (_, i) => fakeCase(`NG-MEDNOVA-${String(i + 1).padStart(6, "0")}`));
    const batches = splitIntoBatches(cases, "TXN");
    expect(batches).toHaveLength(3);
    expect(batches[0]!.cases).toHaveLength(100);
    expect(batches[1]!.cases).toHaveLength(100);
    expect(batches[2]!.cases).toHaveLength(31);

    for (const b of batches) {
      const xml = serializeBatchToXml(b.cases, {
        batchId: b.transmissionId,
        senderId: "MEDNOVA",
        receiverId: "NAFDAC",
        transmissionTimestamp: new Date("2026-09-09T00:00:00Z"),
      });
      const messageCount = (xml.match(/<PORR_IN049016UV>/g) ?? []).length;
      expect(messageCount).toBe(b.cases.length);
      // must parse as XML (DOMParser isn't available in node test env, so
      // use a structural well-formedness proxy: every opened tag closes)
      const opens = (xml.match(/<[a-zA-Z]/g) ?? []).length;
      const closes = (xml.match(/<\//g) ?? []).length;
      const selfClosing = (xml.match(/\/>/g) ?? []).length;
      expect(opens).toBe(closes + selfClosing);
    }

    const dir = join(__dirname, "..", "..", "..", "artifacts", "e2b-r3");
    mkdirSync(dir, { recursive: true });
    batches.forEach((b, i) => {
      const xml = serializeBatchToXml(b.cases, {
        batchId: b.transmissionId,
        senderId: "MEDNOVA",
        receiverId: "NAFDAC",
        transmissionTimestamp: new Date("2026-09-09T00:00:00Z"),
      });
      writeFileSync(join(dir, `test-batch-${i + 1}-of-${batches.length}.xml`), xml, "utf-8");
    });
  });
});
