import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { DEMO_CASES, DEMO_HEADER, DEMO_LEGEND } from "../../../scripts/seed/demo-coded-data.mjs";
import { parseTabularFile } from "./tabular-parse";
import { codeListAsText, fileOwnCodes } from "./linelist-code-list";
import { readCodeListText } from "@/services/e2b-r3/source-profiles/code-list-text";

/**
 * A coded line list's key ("KEY TO SUMMARY FINDINGS") is read from the text
 * the parser keeps outside the case table. Forms print it in different
 * places and shapes; each layout below must give the same 22 codes
 * (13 reactions, 5 serious criteria, 4 outcomes) and the same case rows.
 */
const TITLE = [
  ["ONDO STATE MINISTRY OF HEALTH (DEMO) — EXPANDED PROGRAMME ON IMMUNIZATION"],
  ["AEFI LINE LIST — OCTOBER 2026 (25 cases)"],
];
const table = () => [DEMO_HEADER, ...DEMO_CASES.map((c, i) => [String(i + 1), ...c])];

/** The same key, one code per row under each heading. */
const VERTICAL_KEY: string[][] = [
  ["KEY TO SUMMARY FINDINGS:"],
  ["REACTION TYPE"],
  ...[
    "Anaphylaxis",
    "Fainting/Syncope",
    "Seizures/convulsion",
    "Hotness of body (fever 38oC and above)",
    "Persistent cries (more than 3 hours)",
    "Swelling at injection site",
    "Abscess at injection site (boil)",
    "Rash/Urticaria",
    "Lymph node enlargement",
    "Vomiting",
    "Diarrhoea",
    "Vaccine failure (measles after vaccination)",
    "Weakness of the body",
  ].map((m, i) => [`${i + 1} = ${m}`]),
  ["SERIOUS CASE"],
  ...["Life threatening", "Disability", "Hospitalisation", "Congenital anomaly", "Death"].map(
    (m, i) => [`${i + 1} = ${m}`],
  ),
  ["OUTCOME"],
  ...["Recovered", "Recovering", "Still on admission", "Died"].map((m, i) => [`${i + 1} = ${m}`]),
];
const LINE_KEY = DEMO_LEGEND.map((l) => [l]);
/** The same key as a two-column table: code in one cell, meaning in the next. */
const TWO_COLUMN_KEY: string[][] = VERTICAL_KEY.map((r) => {
  const m = /^(\d+) = (.*)$/.exec(r[0]!);
  return m ? [m[1]!, m[2]!] : r;
});

async function parse(rows: string[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Line list");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const file = new File([buf], "key.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const parsed = await parseTabularFile(file);
  const codes = fileOwnCodes(parsed.discardedRows);
  const byField = (f: string) => codes.filter((c) => c.field === f).length;
  return {
    rows: parsed.rows.length,
    header: parsed.headers[1],
    counts: {
      reaction: byField("reaction"),
      seriousness: byField("seriousness"),
      outcome: byField("outcome"),
    },
    codes,
  };
}

const layouts: [string, string[][]][] = [
  [
    "key below the table, one line per field (the demo)",
    [...TITLE, [], ...table(), [], ...LINE_KEY],
  ],
  ["key above the table, one line per field", [...TITLE, ...LINE_KEY, [], ...table()]],
  ["key below the table, one code per row", [...TITLE, [], ...table(), [], ...VERTICAL_KEY]],
  ["key above the table, one code per row", [...TITLE, ...VERTICAL_KEY, [], ...table()]],
  ["key above the table, as a two-column table", [...TITLE, ...TWO_COLUMN_KEY, [], ...table()]],
  ["key below the table, as a two-column table", [...TITLE, [], ...table(), [], ...TWO_COLUMN_KEY]],
];

describe("the file's own key is read wherever the form prints it", () => {
  for (const [name, rows] of layouts) {
    it(name, async () => {
      const r = await parse(rows);
      expect(r.header).toBe("Case ID (EPID No.)");
      expect(r.rows).toBe(25);
      expect(r.counts).toEqual({ reaction: 13, seriousness: 5, outcome: 4 });
      const meaning = (field: string, code: string) =>
        r.codes.find((c) => c.field === field && c.sourceCode === code)?.meaning;
      expect(meaning("reaction", "5")).toMatch(/Persistent cries/);
      expect(meaning("outcome", "4")).toMatch(/^Died/);
    });
  }
});

describe("the file's codes written out for the code list box", () => {
  it("read back to exactly the same codes", async () => {
    const { codes } = await parse([...TITLE, [], ...table(), [], ...LINE_KEY]);
    const text = codeListAsText(codes);
    expect(text.split("\n")[0]).toBe("Reaction:");
    const back = readCodeListText(text).entries.map(({ field, sourceCode, meaning }) => ({
      field,
      sourceCode,
      meaning,
    }));
    const sortKey = (e: { field: string; sourceCode: string }) =>
      `${e.field}|${e.sourceCode.padStart(3, "0")}`;
    const tidy = (list: { field: string; sourceCode: string; meaning: string }[]) =>
      [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    expect(back).toHaveLength(22);
    expect(tidy(back)).toEqual(tidy(codes));
  });
});

describe("a key's rows are never taken from the cases", () => {
  it("a nearly empty case row after the cases, with no key heading, is still a case", async () => {
    const r = await parse([...TITLE, [], ...table(), ["26", "ON/OWO/26/026"]]);
    expect(r.rows).toBe(26);
  });
});
