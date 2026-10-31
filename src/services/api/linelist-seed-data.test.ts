import { describe, expect, it } from "vitest";
// The demo files are generated from these same rows (scripts/seed).
import {
  A_CASES,
  B_CASES,
  C_CASES,
  EXPECTED_DUPLICATES,
  NEAR_MISS_B_ROWS,
} from "../../../scripts/seed/linelist-seed-data.mjs";
import { screenLineLists } from "./linelist-signals";
import { findCrossFileDuplicates, type CrossFileCase } from "./linelist-cross-duplicates";
import { findClusterFlags, type ClusterCase } from "./linelist-clusters";

// The generic profile's reaction separators (generic-verbatim.ts).
const split = (r: string | undefined) =>
  (r ?? "")
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean);

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
  reactions: split(c[10]),
});
const bCase = (
  c: string[],
  i: number,
  jobId = "B",
  filename = "TEST-state-return-B.csv",
): CrossFileCase & ClusterCase => ({
  jobId,
  filename,
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
  reactions: split(c[9]),
});

const A = (A_CASES as string[][]).map(aCase);
const B = (B_CASES as string[][]).map((c, i) => bCase(c, i));
const C = (C_CASES as string[][]).map((c, i) => bCase(c, i, "C", "TEST-surveillance-return-C.csv"));
const duplicateB = new Set((EXPECTED_DUPLICATES as number[][]).map(([, b]) => b));
/** What the line lists hold once the six confirmed duplicates are dropped. */
const kept = [...A, ...B.filter((b) => !duplicateB.has(b.row)), ...C];

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

  it("add no duplicates from file C", () => {
    expect(findCrossFileDuplicates(C, [...A, ...B])).toEqual([]);
  });

  it("give the signal screen exactly one candidate: HPV × Syncope", () => {
    const screen = screenLineLists(kept.map((c) => ({ ...c, reactions: c.reactions ?? [] })));
    expect(screen.candidates.map((p) => `${p.product} × ${p.reaction}`)).toEqual(["HPV × Syncope"]);
    expect(screen.candidates[0]!.a).toBe(6); // 5 in C, TST-A-010 in A
    expect(screen.smallPool).toBe(true);
    const under = screen.pairs.find((p) => p.reaction === "Thrombocytopenia")!;
    expect(under).toMatchObject({ a: 2, candidate: false });
    expect(under.prr.value).toBeGreaterThanOrEqual(2);
  });

  it("keep that one candidate while the duplicates are still in the pool", () => {
    // The end-to-end run opens the screen with A's drop and holds made
    // (TST-A-012 dropped, TST-A-011 and TST-A-007 held) and B's duplicates
    // not yet resolved, so they count twice.
    const out = new Set(["TST-A-012", "TST-A-011", "TST-A-007"]);
    const pool = [...A.filter((c) => !out.has(c.caseId!)), ...B, ...C];
    const screen = screenLineLists(pool.map((c) => ({ ...c, reactions: c.reactions ?? [] })));
    expect(screen.candidates.map((p) => `${p.product} × ${p.reaction}`)).toEqual(["HPV × Syncope"]);
  });

  it("flag batch BCG-0420 at three facilities as a possible product quality concern", () => {
    const flag = findClusterFlags(kept).find((f) => f.kind === "BATCH" && f.label === "BCG-0420")!;
    expect(flag).toMatchObject({ pattern: "PRODUCT_QUALITY" });
    expect(flag.facilities).toHaveLength(3);
    expect(flag.warningSigns.map((w) => w.sign)).toEqual([
      "LACK_OF_EFFECT",
      "INJECTION_SITE_ABSCESS",
    ]);
  });

  it("flag OPV at PHC Ilara across three batches as a possible site problem", () => {
    const flag = findClusterFlags(kept).find(
      (f) => f.kind === "FACILITY" && f.label === "OPV at PHC Ilara",
    )!;
    expect(flag).toMatchObject({ pattern: "STORAGE_OR_ADMINISTRATION" });
    expect(flag.batches).toHaveLength(3);
  });
});
