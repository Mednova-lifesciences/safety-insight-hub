#!/usr/bin/env node
/**
 * Writes a 25-case DEMONSTRATION line list (invented patients, invented
 * phone numbers) laid out like a real state AEFI return: letterhead rows,
 * coded reaction / seriousness / outcome columns, and the form's own
 * "KEY TO SUMMARY FINDINGS" codebook under the table. Upload it with the
 * source form "Coded line list — reactions are local codes with a codebook".
 * Each feature it is meant to show is planted on purpose:
 *
 *  - Codebook detection: every reaction, serious code and outcome is a
 *    number that only the legend under the table explains.
 *  - MedDRA coding: several legend wordings are not MedDRA terms ("Hotness
 *    of body", "Fainting/Syncope", "Persistent cries (more than 3 hours)"),
 *    so each gets a suggested term for a person to accept.
 *  - Reporter designations to map in Settings: Nursing Sister, RN/RM, SMO,
 *    Pharm. Tech, Mother of child (Nurse, CHEW, Doctor, CHO are known).
 *  - An outcome word with no E2B equivalent ("Still on admission").
 *  - Fix, one of each correction it makes without a person or the AI:
 *    a letter O in a date (18/1O/2026), a five-digit year (22/10/20226), a
 *    doubled date separator (19//10/2026), a stray comma after a date, a
 *    stray asterisk on a batch, "Serius", "Mnths", "Femal", "11 years" in
 *    an age column with its own unit column, a trailing separator after
 *    reaction codes ("2, 13,"), and a death not marked serious.
 *  - Mixed-up columns: row 23 has sex and age swapped and the reporter's
 *    name and phone swapped; Fix puts each value back in its column.
 *  - Decisions: an anaphylaxis with no seriousness or onset date (Hold),
 *    and EPID ON/OWE/26/014 entered twice (Drop the second).
 *  - Signal screen: 4 reports of persistent crying after Pentavalent, none
 *    after anything else.
 *  - Quality flag: batch MR-7712, 3 serious cases at 3 facilities, one a
 *    vaccine failure.
 *  - A phone number that lost its leading 0, for a person to check.
 *
 * Also writes an 8-case LGA return for the same month (same form), which
 * repeats 4 of these cases, for cross-file duplicate detection.
 * The rows are in demo-coded-data.mjs.
 *
 *   node scripts/seed/generate-demo-25.mjs [outDir]
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { DEMO_CASES, DEMO_HEADER, DEMO_LEGEND, LGA_CASES } from "./demo-coded-data.mjs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const outDir = process.argv[2] || path.join(process.cwd(), "scripts", "seed", "out");
fs.mkdirSync(outDir, { recursive: true });

if (DEMO_CASES.length !== 25) throw new Error(`expected 25 cases, have ${DEMO_CASES.length}`);
for (const c of [...DEMO_CASES, ...LGA_CASES]) {
  if (c.length !== DEMO_HEADER.length - 1) throw new Error(`row ${c[0]} has ${c.length} cells`);
}

function writeCoded(filename, title, cases) {
  const rows = [
    ["ONDO STATE MINISTRY OF HEALTH (DEMO) — EXPANDED PROGRAMME ON IMMUNIZATION"],
    [title],
    [],
    DEMO_HEADER,
    ...cases.map((c, i) => [String(i + 1), ...c]),
    [],
    ...DEMO_LEGEND.map((line) => [line]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: DEMO_HEADER.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: DEMO_HEADER.length - 1 } },
  ];
  ws["!cols"] = DEMO_HEADER.map((h) => ({ wch: Math.max(10, Math.min(28, h.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "AEFI Line List");
  const file = path.join(outDir, filename);
  XLSX.writeFile(wb, file);
  console.log(`Wrote ${file}`);
}

writeCoded(
  "DEMO-ondo-aefi-line-list-25-cases.xlsx",
  "AEFI LINE LIST — OCTOBER 2026 — DEMONSTRATION DATA, INVENTED PATIENTS",
  DEMO_CASES,
);
writeCoded(
  "DEMO-ondo-aefi-lga-return-8-cases.xlsx",
  "AEFI LINE LIST, LGA RETURN — OCTOBER 2026 — DEMONSTRATION DATA, INVENTED PATIENTS",
  LGA_CASES,
);
