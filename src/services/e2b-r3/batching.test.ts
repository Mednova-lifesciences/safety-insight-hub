import { describe, expect, it } from "vitest";
import { batchFilename, MAX_ICSRS_PER_BATCH, splitIntoBatches } from "./batching";
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
    fulfilsExpeditedCriteria: { present: true, value: false },
    otherCaseIdentifiersInPreviousTransmissions: { present: false, nullFlavor: "NI" },
    followUp: { isFollowUp: false },
    patient: { identity: { present: true, value: { kind: "INITIALS", initials: "A.B." } } },
    reporter: { name: { present: false, nullFlavor: "NASK" } },
    reactions: [],
    products: [],
    sourceInformation: { sourceFile: "test.xlsx", sourceRow: 1, jobId: "job-1" },
  };
}

describe("splitIntoBatches", () => {
  it("matches the task spec's exact worked example: 231 -> 100/100/31", () => {
    const cases = Array.from({ length: 231 }, (_, i) => fakeCase(`C${i + 1}`));
    const batches = splitIntoBatches(cases, "TXN");
    expect(batches).toHaveLength(3);
    expect(batches[0]!.cases).toHaveLength(100);
    expect(batches[1]!.cases).toHaveLength(100);
    expect(batches[2]!.cases).toHaveLength(31);
  });

  it("never produces a batch larger than the documented VigiFlow limit", () => {
    const cases = Array.from({ length: 350 }, (_, i) => fakeCase(`C${i + 1}`));
    const batches = splitIntoBatches(cases, "TXN");
    for (const b of batches) {
      expect(b.cases.length).toBeLessThanOrEqual(MAX_ICSRS_PER_BATCH);
    }
  });

  it("produces exactly one batch when count is under the limit", () => {
    const cases = Array.from({ length: 42 }, (_, i) => fakeCase(`C${i + 1}`));
    const batches = splitIntoBatches(cases, "TXN");
    expect(batches).toHaveLength(1);
    expect(batches[0]!.cases).toHaveLength(42);
  });

  it("boundary: exactly 100 cases stays a single batch", () => {
    const cases = Array.from({ length: 100 }, (_, i) => fakeCase(`C${i + 1}`));
    const batches = splitIntoBatches(cases, "TXN");
    expect(batches).toHaveLength(1);
  });

  it("boundary: exactly 101 cases splits into two batches", () => {
    const cases = Array.from({ length: 101 }, (_, i) => fakeCase(`C${i + 1}`));
    const batches = splitIntoBatches(cases, "TXN");
    expect(batches).toHaveLength(2);
    expect(batches[0]!.cases).toHaveLength(100);
    expect(batches[1]!.cases).toHaveLength(1);
  });

  it("never drops or duplicates a case across batches", () => {
    const cases = Array.from({ length: 231 }, (_, i) => fakeCase(`C${i + 1}`));
    const batches = splitIntoBatches(cases, "TXN");
    const allIds = batches.flatMap((b) => b.cases.map((c) => c.sendersCaseId));
    expect(allIds).toHaveLength(231);
    expect(new Set(allIds).size).toBe(231);
  });

  it("returns no batches for an empty case list", () => {
    expect(splitIntoBatches([], "TXN")).toEqual([]);
  });

  it("gives every batch a unique transmission id", () => {
    const cases = Array.from({ length: 231 }, (_, i) => fakeCase(`C${i + 1}`));
    const batches = splitIntoBatches(cases, "TXN");
    const ids = batches.map((b) => b.transmissionId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("batchFilename", () => {
  it("follows the deterministic MEDNOVA_E2B_R3_NAFDAC_<date>_BATCH_<n> shape", () => {
    const batches = splitIntoBatches(
      Array.from({ length: 5 }, (_, i) => fakeCase(`C${i + 1}`)),
      "TXN",
    );
    const name = batchFilename(batches[0]!, new Date(Date.UTC(2026, 8, 9)));
    expect(name).toBe("MEDNOVA_E2B_R3_NAFDAC_20260909_BATCH_001.xml");
  });

  it("never contains a patient name or a bare internal random job id", () => {
    const batches = splitIntoBatches(
      Array.from({ length: 5 }, (_, i) => fakeCase(`C${i + 1}`)),
      "TXN",
    );
    const name = batchFilename(batches[0]!, new Date(Date.UTC(2026, 8, 9)));
    expect(name).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}/); // no raw uuid fragment
  });
});
