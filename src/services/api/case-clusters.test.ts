import { describe, expect, it } from "vitest";
import {
  branchPatternNote,
  caseClusters,
  isSeriousCase,
  type CaseForClusters,
} from "./case-clusters";

const c = (
  id: string,
  extra: Partial<CaseForClusters> & { batch?: string; onset?: string } = {},
): CaseForClusters => {
  const { batch, onset, ...rest } = extra;
  return {
    id,
    patientIdentifier: "P",
    product: "Modia Paracetamol",
    reaction: "Rash",
    seriousness: "SERIOUS",
    outcome: "RECOVERED",
    workflowStep: "TRIAGE",
    assignedTo: "x",
    receivedDate: "2026-10-20",
    dueDate: "2026-10-20",
    priority: "HIGH",
    flags: [],
    source: "MANUAL",
    suspectProducts: [{ reportedName: "Modia Paracetamol", batchNumber: batch }],
    reactions: [{ reportedTerm: "Rash", outcome: "RECOVERED", onsetDate: onset }],
    ...rest,
  };
};

describe("isSeriousCase", () => {
  it("counts serious and fatal cases", () => {
    expect(isSeriousCase({ seriousness: "SERIOUS", outcome: "RECOVERED" })).toBe(true);
    expect(isSeriousCase({ seriousness: "UNASSESSED", outcome: "FATAL" })).toBe(true);
    expect(isSeriousCase({ seriousness: "NON_SERIOUS", outcome: "RECOVERED" })).toBe(false);
  });
});

describe("caseClusters", () => {
  it("flags a batch shared by serious cases at two branches within 30 days", () => {
    const flags = caseClusters(
      [
        c("A", { batch: "MP-2201", branch: "Lekki", onset: "2026-10-01" }),
        c("B", { batch: "MP 2201", branch: "Ikeja", onset: "2026-10-20" }),
        c("C", { batch: "OTHER-9", branch: "Yaba", onset: "2026-10-05" }),
      ],
      false,
    );
    const batch = flags.find((f) => f.kind === "BATCH");
    expect(batch?.cases.map((x) => x.caseId)).toEqual(["A", "B"]);
    expect(batch?.facilities.sort()).toEqual(["Ikeja", "Lekki"]);
    expect(branchPatternNote(batch!)).toMatch(/more than one branch/);
  });

  it("flags the same product at one branch across batches", () => {
    const flags = caseClusters(
      [
        c("A", { batch: "MP-1", branch: "Lekki", onset: "2026-10-01" }),
        c("B", { batch: "MP-2", branch: "lekki", onset: "2026-10-10" }),
      ],
      false,
    );
    const branch = flags.find((f) => f.kind === "FACILITY");
    expect(branch?.cases).toHaveLength(2);
    expect(branchPatternNote(branch!)).toMatch(/One branch across more than one batch/);
  });

  it("leaves non-serious cases out unless asked, and ignores cases 30+ days apart", () => {
    const cases = [
      c("A", { batch: "MP-1", seriousness: "NON_SERIOUS", onset: "2026-10-01" }),
      c("B", { batch: "MP-1", seriousness: "NON_SERIOUS", onset: "2026-10-05" }),
    ];
    expect(caseClusters(cases, false)).toEqual([]);
    expect(caseClusters(cases, true)).toHaveLength(1);
    expect(
      caseClusters(
        [
          c("A", { batch: "MP-1", onset: "2026-08-01" }),
          c("B", { batch: "MP-1", onset: "2026-10-01" }),
        ],
        false,
      ),
    ).toEqual([]);
  });

  it("falls back to the received date when there is no onset date", () => {
    const flags = caseClusters(
      [c("A", { batch: "MP-1", receivedDate: "2026-10-01" }), c("B", { batch: "MP-1" })],
      false,
    );
    expect(flags).toHaveLength(1);
  });
});
