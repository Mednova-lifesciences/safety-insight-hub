// Renders the 25-case demo workbook as an Excel-like page (as received), in
// two versions: plain, and with the planted problems highlighted.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_CASES, DEMO_HEADER, DEMO_LEGEND } from "../../../scripts/seed/demo-coded-data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const COL = (i) => String.fromCharCode(65 + i);
const LOCAL = new Set([
  "Nursing Sister",
  "RN/RM",
  "SMO",
  "Pharm. Tech",
  "Mother of child",
  "DSNO",
  "LIO",
]);
const H = Object.fromEntries(DEMO_HEADER.map((h, i) => [h, i]));

function problem(row, h, v) {
  const s = String(v);
  if (
    /\*$/.test(s) ||
    /^Serius$/.test(s) ||
    /Mnths/.test(s) ||
    /\dO|O\d/.test(s) ||
    /\/\d{5}$/.test(s)
  )
    return "bad";
  if (h === "Seriousness" && /Non-serious/i.test(s) && String(row[H["Outcome"]]) === "4")
    return "bad";
  if (h === "Reporter Designation" && LOCAL.has(s)) return "local";
  if (["Reaction", "Serious Code", "Outcome"].includes(h) && s.trim()) return "code";
  return "";
}

function page(highlight) {
  const rows = [];
  let r = 1;
  const blank = (txt = "", cls = "") =>
    `<tr><td class="rn">${r++}</td><td colspan="${DEMO_HEADER.length}" class="${cls}">${esc(txt)}</td></tr>`;
  rows.push(
    blank("ONDO STATE MINISTRY OF HEALTH (DEMO) — EXPANDED PROGRAMME ON IMMUNIZATION", "title"),
  );
  rows.push(blank("AEFI LINE LIST — OCTOBER 2026 (25 cases)", "title2"));
  rows.push(blank());
  rows.push(
    `<tr><td class="rn">${r++}</td>${DEMO_HEADER.map((h) => `<td class="hd">${esc(h)}</td>`).join("")}</tr>`,
  );
  DEMO_CASES.forEach((c, i) => {
    const row = [String(i + 1), ...c];
    rows.push(
      `<tr><td class="rn">${r++}</td>${row
        .map((v, j) => {
          const cls = highlight ? problem(row, DEMO_HEADER[j], v) : "";
          return `<td class="${cls}">${esc(v)}</td>`;
        })
        .join("")}</tr>`,
    );
  });
  rows.push(blank());
  DEMO_LEGEND.forEach((l, k) => rows.push(blank(l, highlight ? "legend hl" : "legend")));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:Calibri,"Segoe UI",Arial,sans-serif;background:#fff;}
  .bar{height:44px;background:#1f6e43;color:#fff;display:flex;align-items:center;padding:0 18px;font:15px "Segoe UI";gap:14px}
  .bar b{font-weight:600}
  .ribbon{height:38px;background:#f3f3f3;border-bottom:1px solid #d6d6d6;display:flex;align-items:center;gap:22px;padding:0 18px;font:13px "Segoe UI";color:#333}
  .fx{height:28px;border-bottom:1px solid #d6d6d6;display:flex;align-items:center;font:13px "Segoe UI";color:#555;padding-left:8px}
  .fx span{border-right:1px solid #d6d6d6;padding:0 30px 0 6px;margin-right:10px}
  table{border-collapse:collapse;font-size:13.5px;white-space:nowrap}
  td{border:1px solid #e1e1e1;padding:3px 7px;height:20px}
  .colh td{background:#f3f3f3;color:#555;text-align:center;font:12px "Segoe UI"}
  .rn{background:#f3f3f3;color:#555;text-align:center;font:12px "Segoe UI";min-width:30px}
  .hd{font-weight:700;background:#ddebf7}
  .title{font-weight:700;font-size:15px;border-color:transparent}
  .title2{font-weight:700;border-color:transparent}
  .legend{font-size:13px;border-color:transparent}
  .legend.hl{background:#fff4ce}
  .bad{background:#fde2e1;outline:2.5px solid #d93025;outline-offset:-2px;font-weight:700;color:#b3261e}
  .local{background:#fff1c2;outline:2px solid #e3a008;outline-offset:-2px}
  .code{background:#e3efff;font-weight:700;color:#1d4ed8}
  </style></head><body>
  <div class="bar"><b>DEMO-ondo-aefi-line-list-25-cases.xlsx</b><span style="opacity:.8">— Excel</span></div>
  <div class="ribbon"><span>File</span><span><u>Home</u></span><span>Insert</span><span>Page Layout</span><span>Formulas</span><span>Data</span><span>Review</span><span>View</span></div>
  <div class="fx"><span>A1</span>fx</div>
  <table><tr class="colh"><td></td>${DEMO_HEADER.map((_, i) => `<td>${COL(i)}</td>`).join("")}</tr>${rows.join("")}</table>
  </body></html>`;
}
fs.writeFileSync(path.join(here, "sheet-plain.html"), page(false));
fs.writeFileSync(path.join(here, "sheet-marked.html"), page(true));
console.log("written");
