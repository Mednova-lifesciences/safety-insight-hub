#!/usr/bin/env node
/**
 * Writes the two SYNTHETIC demo line lists (patient names are invented;
 * case IDs start TST-/ODS-26-1xx and both files are headed as test data) used by the end-to-end runs and
 * the meeting demo. Every name, number and phone below is invented; the
 * files say so in their letterhead. Deterministic: running it twice writes
 * the same files.
 *
 *   node scripts/seed/generate-linelists.mjs [outDir]
 *
 * File A — facility return (XLSX): letterhead rows, a merged title cell,
 *   a code legend under the table, and messy values for Fix to work on.
 * File B — state return (CSV), different header spellings. It overlaps A:
 *   - 6 TRUE duplicates of A's cases (dates ±1-2 days, initials instead of
 *     names, an age off by one), which cross-file duplicate detection must
 *     find;
 *   - 2 NEAR-MISSES: same vaccine, day and facility as an A case but a
 *     different child, which it must NOT match.
 * Serious cases share batch PCV-7781 (3 in A, 1 in B) and Penta at PHC
 *   Igbatoro (2 in A), for the batch/facility flag.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const outDir = process.argv[2] || path.join(process.cwd(), "scripts", "seed", "out");
fs.mkdirSync(outDir, { recursive: true });

import { A_CASES, A_HEADER, B_CASES, B_HEADER, LEGEND } from "./linelist-seed-data.mjs";

function writeFileA() {
  const rows = [
    ["SYNTHETIC TEST DATA — NOT REAL PATIENTS"],
    ["ONDO STATE MINISTRY OF HEALTH (TEST) — AEFI LINE LIST, FACILITY RETURN, SEPTEMBER 2026"],
    [],
    A_HEADER,
    ...A_CASES.map((c, i) => [String(i + 1), ...c]),
    [],
    ...LEGEND,
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: A_HEADER.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: A_HEADER.length - 1 } },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "AEFI Line List");
  const file = path.join(outDir, "TEST-facility-return-A.xlsx");
  XLSX.writeFile(wb, file);
  return file;
}

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function writeFileB() {
  const lines = [
    "SYNTHETIC TEST DATA - NOT REAL PATIENTS - ONDO STATE (TEST) AEFI STATE RETURN",
    B_HEADER.map(csvCell).join(","),
    ...B_CASES.map((c) => c.map(csvCell).join(",")),
  ];
  const file = path.join(outDir, "TEST-state-return-B.csv");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

const a = writeFileA();
const b = writeFileB();
console.log(`Wrote ${a}\nWrote ${b}`);
console.log(
  "Expected cross-file duplicates (A row ↔ B row): 1↔1, 3↔2, 4↔3, 6↔4, 8↔5, 18↔6; near-misses B7, B8 must not match.",
);
