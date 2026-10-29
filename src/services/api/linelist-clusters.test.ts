import { describe, expect, it } from "vitest";
import { findClusterFlags, type ClusterCase } from "./linelist-clusters";

let n = 0;
const c = (over: Partial<ClusterCase>): ClusterCase => ({
  jobId: "job-a",
  filename: "a.csv",
  row: ++n,
  product: "Pentavalent",
  batch: "PV-1001",
  facility: "PHC Ijapo",
  vaccinationDate: "2026-03-01",
  serious: true,
  ...over,
});

describe("findClusterFlags", () => {
  it("flags two serious cases sharing a real batch within 30 days, across files", () => {
    const flags = findClusterFlags([
      c({ facility: "PHC A" }),
      c({ jobId: "job-b", facility: "PHC B", vaccinationDate: "2026-03-20" }),
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      kind: "BATCH",
      label: "PV-1001",
      from: "2026-03-01",
      to: "2026-03-20",
    });
  });

  it("ignores non-serious cases", () => {
    expect(findClusterFlags([c({}), c({ serious: false })])).toEqual([]);
  });

  it("ignores placeholder batches", () => {
    const flags = findClusterFlags([
      c({ batch: "NIL", facility: "X" }),
      c({ batch: "nil", facility: "Y" }),
      c({ batch: "-", facility: "Z" }),
      c({ batch: "N/A", facility: "W" }),
    ]);
    expect(flags).toEqual([]);
  });

  it("does not group cases more than 30 days apart", () => {
    expect(
      findClusterFlags([c({ facility: "A" }), c({ facility: "B", vaccinationDate: "2026-04-05" })]),
    ).toEqual([]);
  });

  it("flags the same vaccine at the same facility even with different batches", () => {
    const flags = findClusterFlags([
      c({ batch: "B1" }),
      c({ batch: "B2", vaccinationDate: "10/03/2026" }),
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: "FACILITY", label: "Pentavalent at PHC Ijapo" });
  });

  it("does not repeat a facility group that holds exactly a batch group's cases", () => {
    const flags = findClusterFlags([c({}), c({ vaccinationDate: "2026-03-02" })]);
    expect(flags.map((f) => f.kind)).toEqual(["BATCH"]);
  });

  it("falls back to the onset date and skips undated cases", () => {
    const flags = findClusterFlags([
      c({ vaccinationDate: undefined, onsetDate: "2026-03-02", facility: "A" }),
      c({ facility: "B" }),
      c({ vaccinationDate: undefined, facility: "C" }),
    ]);
    expect(flags[0]!.cases).toHaveLength(2);
  });
});
