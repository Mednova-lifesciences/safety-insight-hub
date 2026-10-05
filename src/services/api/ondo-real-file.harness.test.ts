/**
 * Data-preparation harness against a REAL Ondo State AEFI line list.
 *
 * Not a pass/fail unit test: it runs the actual production preparation
 * chain over the real uploaded workbook and prints what the tool managed
 * without any human cleaning. Kept as a harness so the answer to "how much
 * does it prepare on its own" is measured rather than asserted.
 *
 * Skips itself when the file is absent, so it never breaks the suite — the
 * workbook is real submission data and is not committed.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { parseTabularFile, mapColumnsByKeywords } from "./tabular-parse";
import { FIELD_KEYWORDS, DEFAULT_SOURCE_PROFILE_ID } from "./linelist";
import { discoverAndApplyCodebook } from "@/services/e2b-r3/export";
import { getSourceProfile } from "@/services/e2b-r3/source-profiles/registry";

const FILE = path.resolve(process.cwd(), "2026, ONDO STATE AEFI.xlsx");
const present = existsSync(FILE);

describe.skipIf(!present)("real Ondo AEFI line list — data preparation", () => {
  it("prepares the file without any manual cleaning", async () => {
    const REPORT: string[] = [];
    const console = {
      log: (...a: unknown[]) =>
        REPORT.push(a.map((x) => (typeof x === "string" ? x : String(x))).join(" ")),
    };
    const buf = readFileSync(FILE);
    const file = new File([buf], path.basename(FILE), {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const parsed = await parseTabularFile(file);

    console.log("\n================ PARSE ================");
    console.log("sheet chosen      :", parsed.sheetName);
    console.log("header row found  : row", parsed.headerRowNumber);
    console.log("rows skipped above:", parsed.skippedRows);
    console.log("case rows kept    :", parsed.rows.length);
    console.log("columns detected  :", parsed.headers.length);
    console.log("\nheaders:");
    parsed.headers.forEach((h, i) => console.log(`  [${i}] ${JSON.stringify(h)}`));
    console.log("\nwarnings:");
    parsed.warnings.forEach((w) => console.log("  -", w));
    console.log("\npreserved non-case rows (legend/letterhead):", parsed.discardedRows.length);
    parsed.discardedRows.forEach((d) =>
      console.log(`  row ${d.row}: ${d.text.slice(0, 120)}${d.text.length > 120 ? "…" : ""}`),
    );

    console.log("\n================ COLUMN MAPPING ================");
    const mapping = mapColumnsByKeywords(parsed.headers, FIELD_KEYWORDS);
    const mapped = Object.entries(mapping).filter(([, v]) => !!v);
    console.log(`auto-mapped ${mapped.length} of ${parsed.headers.length} columns:`);
    for (const [header, field] of mapped) console.log(`  ${JSON.stringify(header)} -> ${field}`);
    const unmapped = parsed.headers.filter((h) => h && !mapping[h]);
    console.log(`\nunmapped (${unmapped.length}):`);
    unmapped.forEach((h) => console.log("  -", JSON.stringify(h)));

    console.log("\n================ CODEBOOK DISCOVERY ================");
    const base = getSourceProfile(DEFAULT_SOURCE_PROFILE_ID);
    const { discovered, runtimeProfile } = discoverAndApplyCodebook(
      base,
      parsed.discardedRows,
      { file: path.basename(FILE), sheet: parsed.sheetName },
    );
    console.log("codebooks discovered from the file's own legend:");
    const byField = new Map<string, { code: string; meaning: string }[]>();
    for (const e of discovered.entries) {
      const list = byField.get(e.field) ?? [];
      list.push({ code: e.sourceCode, meaning: e.meaning });
      byField.set(e.field, list);
    }
    console.log("total codes decoded:", discovered.entries.length);
    for (const [field, codes] of byField) {
      console.log(`  ${field}: ${codes.length} codes`);
      console.log("    " + codes.map((c) => `${c.code}=${c.meaning}`).join(", "));
    }
    const evidenced = discovered.entries.filter(
      (e) => !!e.sourceEvidence && !!e.sourceEvidence.row,
    ).length;
    console.log("codes carrying file+sheet+row provenance:", evidenced, "of", discovered.entries.length);
    console.log("\nruntime profile id:", runtimeProfile.id);

    console.log("\n================ FIRST 3 CASE ROWS ================");
    parsed.rows.slice(0, 3).forEach((r, i) => {
      console.log(`\nrow ${parsed.sourceRowNumbers[i]}:`);
      parsed.headers.forEach((h, c) => {
        if (r[c]) console.log(`  ${h || "(blank header)"} = ${JSON.stringify(r[c])}`);
      });
    });

    writeFileSync(process.env["ONDO_REPORT"] ?? "ondo-report.txt", REPORT.join("\n"), "utf8");
    expect(parsed.rows.length).toBeGreaterThan(0);
  });
});
