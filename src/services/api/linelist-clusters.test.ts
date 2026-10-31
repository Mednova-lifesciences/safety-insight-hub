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

describe("what the pattern suggests", () => {
  it("reads one batch at several facilities as a possible product quality concern", () => {
    const [flag] = findClusterFlags([
      c({ batch: "MR2231A", facility: "PHC Akure", product: "MR" }),
      c({ batch: "MR2231A", facility: "PHC Owo", product: "MR", vaccinationDate: "2026-03-05" }),
      c({ batch: "MR2231A", facility: "PHC Ondo", product: "MR", vaccinationDate: "2026-03-09" }),
    ]);
    expect(flag).toMatchObject({ kind: "BATCH", pattern: "PRODUCT_QUALITY" });
    expect(flag!.facilities).toEqual(["PHC Akure", "PHC Owo", "PHC Ondo"]);
    expect(flag!.batches).toEqual(["MR2231A"]);
  });

  it("reads one facility across batches as a possible storage or administration error", () => {
    const flags = findClusterFlags([
      c({ batch: "PV-1", facility: "PHC Ijapo" }),
      c({ batch: "PV-2", facility: "PHC Ijapo", vaccinationDate: "2026-03-04" }),
      c({ batch: "PV-3", facility: "PHC Ijapo", vaccinationDate: "2026-03-08" }),
    ]);
    const facility = flags.find((f) => f.kind === "FACILITY")!;
    expect(facility.pattern).toBe("STORAGE_OR_ADMINISTRATION");
    expect(facility.batches).toHaveLength(3);
  });

  it("keeps one batch at one facility open as either", () => {
    const [flag] = findClusterFlags([c({}), c({ vaccinationDate: "2026-03-02" })]);
    expect(flag!.pattern).toBe("ONE_BATCH_ONE_FACILITY");
  });
});

describe("quality warning signs", () => {
  it("finds lack of effect, abscess and unusual-product words in the cases", () => {
    const [flag] = findClusterFlags([
      c({ caseId: "A1", facility: "PHC A", reactions: ["Injection site abscess"] }),
      c({ caseId: "A2", facility: "PHC B", reactions: ["Vaccine failure", "Fever"] }),
      c({ caseId: "A3", facility: "PHC C", reactions: ["Discoloured vial contents noted"] }),
    ]);
    expect(flag!.warningSigns.map((w) => w.sign)).toEqual([
      "LACK_OF_EFFECT",
      "INJECTION_SITE_ABSCESS",
      "UNUSUAL_PRODUCT",
    ]);
    expect(flag!.warningSigns.find((w) => w.sign === "INJECTION_SITE_ABSCESS")!.cases).toEqual([
      "A1",
    ]);
  });

  it("notes a missing or odd batch number in a facility flag", () => {
    const flags = findClusterFlags([
      c({ caseId: "B1", batch: "NIL", facility: "PHC Owo" }),
      c({ caseId: "B2", batch: "AB", facility: "PHC Owo", vaccinationDate: "2026-03-03" }),
    ]);
    const facility = flags.find((f) => f.kind === "FACILITY")!;
    expect(facility.warningSigns).toEqual([{ sign: "MISSING_OR_ODD_BATCH", cases: ["B1", "B2"] }]);
  });

  it("reports no signs when there are none", () => {
    const [flag] = findClusterFlags([
      c({ reactions: ["Fever"] }),
      c({ reactions: ["Rash"], vaccinationDate: "2026-03-02" }),
    ]);
    expect(flag!.warningSigns).toEqual([]);
  });
});

describe("flag labels", () => {
  it("use the spelling most cases use, whichever file is read first", () => {
    const cases = [
      c({ batch: "PCV 7781", facility: "PHC A" }),
      c({ batch: "PCV-7781", facility: "PHC B", vaccinationDate: "2026-03-02" }),
      c({ batch: "PCV-7781", facility: "PHC C", vaccinationDate: "2026-03-03" }),
    ];
    const label = (list: ClusterCase[]) =>
      findClusterFlags(list).find((f) => f.kind === "BATCH")!.label;
    expect(label(cases)).toBe("PCV-7781");
    expect(label([...cases].reverse())).toBe("PCV-7781");
  });
});
