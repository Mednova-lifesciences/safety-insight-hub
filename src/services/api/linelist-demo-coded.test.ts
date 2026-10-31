import { describe, expect, it } from "vitest";
// The two coded demo files are generated from these same rows (scripts/seed).
import {
  DEMO_CASES,
  DEMO_LEGEND,
  EXPECTED_DEMO_DUPLICATES,
  LGA_CASES,
  NEAR_MISS_LGA_ROWS,
} from "../../../scripts/seed/demo-coded-data.mjs";
import { readRowsWithSeriousness, type ParsedRow } from "./linelist";
import { screenLineLists } from "./linelist-signals";
import { findCrossFileDuplicates, type CrossFileCase } from "./linelist-cross-duplicates";
import { findClusterFlags, type ClusterCase } from "./linelist-clusters";

// The file's columns after S/N, as the column mapping reads them.
const FIELDS = [
  "case_id",
  "patient_identifier",
  "sex",
  "age",
  "age_unit",
  null, // LGA
  "reporter_organization",
  "product",
  "vaccine_batch",
  "vaccination_date",
  "onset_date",
  "reaction_code",
  "seriousness",
  "serious_code",
  "outcome",
  "reporter_name",
  "reporter_designation",
  "reporter_phone",
  "report_date",
] as const;

/** Every row read the way the signal screen, flags and duplicate check read
 *  it: through the coded form and the legend under the table. */
function load(cases: string[][], jobId: string, filename: string) {
  const parsedRows = cases.map((c) => {
    const row: Record<string, string> = {};
    FIELDS.forEach((f, i) => {
      if (f && c[i]) row[f] = c[i]!;
    });
    return row as ParsedRow;
  });
  const read = readRowsWithSeriousness({
    filename,
    sourceProfileId: "ondo-aefi",
    discardedRows: DEMO_LEGEND.map((text, i) => ({ row: cases.length + 6 + i, text })),
    parsedRows,
  });
  type Loaded = CrossFileCase & ClusterCase & { reactions: string[] };
  return read.map(({ row, serious, reactions }, i): Loaded => ({
    jobId,
    filename,
    row: i + 1,
    caseId: row.case_id,
    patientIdentifier: row.patient_identifier,
    sex: row.sex,
    age: row.age,
    ageUnit: row.age_unit,
    product: row.product,
    batch: row.vaccine_batch,
    vaccinationDate: row.vaccination_date,
    onsetDate: row.onset_date,
    reaction: reactions.join(", "),
    facility: row.reporter_organization,
    serious,
    reactions,
  }));
}

const DEMO = load(DEMO_CASES as string[][], "D", "DEMO-ondo-aefi-line-list-25-cases.xlsx");
const LGA = load(LGA_CASES as string[][], "L", "DEMO-ondo-aefi-lga-return-8-cases.xlsx");

describe("the coded demo line lists", () => {
  it("decode reactions through the legend under the table", () => {
    expect(DEMO[0]!.reactions).toEqual(["Persistent cries (more than 3 hours)"]);
    expect(DEMO[1]!.reactions).toEqual([
      "Persistent cries (more than 3 hours)",
      "Hotness of body (fever 38oC and above)",
    ]);
    // The legend's closing "(insert appropriate number in column)" is not
    // part of the last code's meaning.
    expect(DEMO[12]!.reactions).toEqual(["Fainting/Syncope", "Weakness of the body"]);
  });

  it("count a death as serious even when the row says Non-serious", () => {
    // Row 21: outcome 4 = Died, written "Non-serious".
    expect(DEMO[20]!.serious).toBe(true);
  });

  it("find exactly the four true duplicates across the two files, and neither near-miss", () => {
    const found = findCrossFileDuplicates(LGA, DEMO).map((p) => [p.b.row, p.a.row]);
    expect(found.sort((x, y) => x[0]! - y[0]!)).toEqual(EXPECTED_DEMO_DUPLICATES);
    for (const row of NEAR_MISS_LGA_ROWS) expect(found.some(([, l]) => l === row)).toBe(false);
  });

  it("give the signal screen Pentavalent × persistent crying", () => {
    const screen = screenLineLists(DEMO);
    const penta = screen.candidates.find(
      (p) => p.product === "Pentavalent" && p.reaction === "Persistent cries (more than 3 hours)",
    );
    expect(penta).toMatchObject({ a: 4 });
    expect(screen.smallPool).toBe(true);
    // Two abscesses after BCG: below N = 3, so not a candidate.
    expect(
      screen.pairs.find((p) => p.reaction === "Abscess at injection site (boil)"),
    ).toMatchObject({ a: 2, candidate: false });
  });

  it("flag batch MR-7712 at three facilities, with the vaccine failure as a warning sign", () => {
    const flag = findClusterFlags(DEMO).find((f) => f.kind === "BATCH" && f.label === "MR-7712")!;
    expect(flag).toMatchObject({ pattern: "PRODUCT_QUALITY" });
    expect(flag.facilities).toHaveLength(3);
    expect(flag.warningSigns.map((w) => w.sign)).toContain("LACK_OF_EFFECT");
  });
});
