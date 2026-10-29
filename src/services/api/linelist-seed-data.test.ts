import { describe, expect, it } from "vitest";
// The demo files are generated from these same rows (scripts/seed).
import {
  A_CASES,
  B_CASES,
  EXPECTED_DUPLICATES,
  NEAR_MISS_B_ROWS,
} from "../../../scripts/seed/linelist-seed-data.mjs";
import { findCrossFileDuplicates, type CrossFileCase } from "./linelist-cross-duplicates";
import { findClusterFlags, type ClusterCase } from "./linelist-clusters";

const aCase = (c: string[], i: number): CrossFileCase & ClusterCase => ({
  jobId: "A",
  filename: "TEST-facility-return-A.xlsx",
  row: i + 1,
  caseId: c[0],
  patientIdentifier: c[1],
  sex: c[3],
  age: c[4],
  ageUnit: c[5],
  product: c[6],
  batch: c[7],
  vaccinationDate: c[8],
  onsetDate: c[9],
  reaction: c[10],
  facility: c[14],
  serious: c[11] === "Serious",
});
const bCase = (c: string[], i: number): CrossFileCase & ClusterCase => ({
  jobId: "B",
  filename: "TEST-state-return-B.csv",
  row: i + 1,
  caseId: c[0],
  patientIdentifier: c[1],
  sex: c[2],
  age: c[3],
  ageUnit: c[4],
  product: c[5],
  batch: c[6],
  vaccinationDate: c[7],
  onsetDate: c[8],
  reaction: c[9],
  facility: c[12],
  serious: c[10] === "Y",
});

const A = (A_CASES as string[][]).map(aCase);
const B = (B_CASES as string[][]).map(bCase);

describe("the synthetic demo line lists", () => {
  it("find exactly the six true duplicates and none of the near-misses", () => {
    const found = findCrossFileDuplicates(A, B).map((p) => [p.a.row, p.b.row]);
    expect(found.sort((x, y) => x[0]! - y[0]!)).toEqual(EXPECTED_DUPLICATES);
    for (const row of NEAR_MISS_B_ROWS) expect(found.some(([, b]) => b === row)).toBe(false);
  });

  it("flag the PCV-7781 batch and Pentavalent at PHC Igbatoro once duplicates are dropped", () => {
    const duplicateB = new Set((EXPECTED_DUPLICATES as number[][]).map(([, b]) => b));
    const flags = findClusterFlags([...A, ...B.filter((b) => !duplicateB.has(b.row))]);
    const batch = flags.find((f) => f.kind === "BATCH" && f.label === "PCV-7781");
    expect(batch?.cases.map((c) => c.caseId)).toEqual([
      "TST-A-004",
      "TST-A-005",
      "TST-A-006",
      "ODS-26-109",
    ]);
    expect(
      flags.some((f) => f.kind === "FACILITY" && f.label === "Pentavalent at PHC Igbatoro"),
    ).toBe(true);
  });
});
