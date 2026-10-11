/**
 * The organisation's register of International Birth Dates, and the checks
 * that compare a PSUR's stated IBD (and DLP) against it.
 *
 * The IBD is the date of the first marketing authorisation for the ACTIVE
 * SUBSTANCE anywhere in the world (ICH E2C(R2)); PSUR intervals and data
 * lock points are counted from it, and NAFDAC's screening item 5 requires
 * the interval to be calculated from it. One substance has one IBD, so the
 * register is keyed by active substance; brand names and NAFDAC
 * registration numbers on an entry only help find it.
 *
 * Pure: storage lives in services/api/psur-ibd.ts.
 */

export interface IbdRegisterEntry {
  id: string;
  activeSubstance: string;
  /** ISO yyyy-mm-dd. */
  ibd: string;
  productNames: string[];
  nafdacRegNos: string[];
  /** Where the IBD came from, e.g. "Company declaration", "EU reference
   *  date list". Shown beside it so a reader can weigh it. */
  source: string;
  by: string;
  at: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null; // 31 Feb
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * A date as PSURs write it, as ISO — or null. Day-first for numeric dates
 * (Nigerian and international documents write 17/03/2014 for 17 March);
 * month-first only when day-first is impossible (03/17/2014).
 */
export function readDocumentDate(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/,/g, " ").replace(/\s+/g, " ");
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) {
    const a = +m[1]!, b = +m[2]!, y = +m[3]!;
    return a > 12 ? iso(y, b, a) : b > 12 ? iso(y, a, b) : iso(y, b, a);
  }
  m = /^(\d{1,2}) ([A-Za-z]{3,}) (\d{4})$/.exec(v); // 17 March 2014
  if (m && MONTHS[m[2]!.slice(0, 3).toLowerCase()]) return iso(+m[3]!, MONTHS[m[2]!.slice(0, 3).toLowerCase()]!, +m[1]!);
  m = /^([A-Za-z]{3,}) (\d{1,2}) (\d{4})$/.exec(v); // March 17 2014
  if (m && MONTHS[m[1]!.slice(0, 3).toLowerCase()]) return iso(+m[3]!, MONTHS[m[1]!.slice(0, 3).toLowerCase()]!, +m[2]!);
  return null;
}

/** "17 Mar 2014" — how the pages show an ISO date. */
export function showDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const name = Object.keys(MONTHS).find((k) => MONTHS[k] === m)!;
  return `${d} ${name[0]!.toUpperCase()}${name.slice(1)} ${y}`;
}

const substanceKey = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).sort().join(" ");
const regKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface IbdMatch {
  entry: IbdRegisterEntry;
  /** What the report was matched on — shown so the person can judge it. */
  matchedOn: "NAFDAC registration number" | "active substance" | "product name";
}

/**
 * The register entry for a report: by NAFDAC registration number, then
 * active substance (word order and punctuation ignored), then product
 * name. Null when nothing matches, or when the strongest rule that matches
 * finds more than one entry — two candidates are not guessed between.
 */
export function findRegisterEntry(
  register: IbdRegisterEntry[],
  details: { productName?: string; activeSubstance?: string; nafdacRegNo?: string },
): IbdMatch | null {
  const one = (hits: IbdRegisterEntry[], matchedOn: IbdMatch["matchedOn"]) =>
    hits.length === 1 ? { entry: hits[0]!, matchedOn } : null;
  const reg = regKey(details.nafdacRegNo ?? "");
  if (reg.length >= 3) {
    const hits = register.filter((e) => e.nafdacRegNos.some((r) => regKey(r) === reg));
    if (hits.length) return one(hits, "NAFDAC registration number");
  }
  const sub = substanceKey(details.activeSubstance ?? "");
  if (sub) {
    const hits = register.filter((e) => substanceKey(e.activeSubstance) === sub);
    if (hits.length) return one(hits, "active substance");
  }
  const name = nameKey(details.productName ?? "");
  if (name.length >= 3) {
    const hits = register.filter((e) =>
      e.productNames.some((p) => {
        const k = nameKey(p);
        return k.length >= 3 && (name.includes(k) || k.includes(name));
      }),
    );
    if (hits.length) return one(hits, "product name");
  }
  return null;
}

export type IbdComparison =
  | { status: "ALIGNS"; registered: string; match: IbdMatch }
  | { status: "DIFFERS"; stated: string; statedText: string; registered: string; match: IbdMatch }
  | { status: "NOT_STATED"; registered: string; match: IbdMatch }
  | { status: "UNREADABLE"; statedText: string; registered: string; match: IbdMatch }
  | { status: "NOT_IN_REGISTER"; stated: string | null };

/** The PSUR's stated IBD against the register. */
export function compareIbd(
  register: IbdRegisterEntry[],
  details: { productName?: string; activeSubstance?: string; nafdacRegNo?: string; ibd?: string },
): IbdComparison {
  const match = findRegisterEntry(register, details);
  const statedText = (details.ibd ?? "").trim();
  const stated = readDocumentDate(statedText);
  if (!match) return { status: "NOT_IN_REGISTER", stated };
  const registered = match.entry.ibd;
  if (!statedText) return { status: "NOT_STATED", registered, match };
  if (!stated) return { status: "UNREADABLE", statedText, registered, match };
  return stated === registered
    ? { status: "ALIGNS", registered, match }
    : { status: "DIFFERS", stated, statedText, registered, match };
}

export interface DlpCheck {
  aligned: boolean;
  /** The two DLP days a year the IBD implies, e.g. ["16 Mar", "16 Sep"]. */
  expected: [string, string];
}

/**
 * Whether a DLP falls on the cycle the IBD implies. Periodic reports run
 * in six-month multiples from the IBD, so a DLP falls on the day before a
 * six-monthly anniversary of the IBD (IBD 17 Mar → DLP 16 Mar or 16 Sep).
 * One day either side is accepted for month-length differences. For
 * information: the assessor decides what a misaligned DLP means.
 */
export function checkDlpAgainstIbd(ibdIso: string, dlpText: string): DlpCheck | null {
  const dlp = readDocumentDate(dlpText);
  if (!dlp || !/^\d{4}-\d{2}-\d{2}$/.test(ibdIso)) return null;
  const [, im, id] = ibdIso.split("-").map(Number) as [number, number, number];
  const dayBefore = (month: number) => {
    // The day before the IBD's day in that month (a non-leap year; the
    // calendar rolls 31 Sep over to 1 Oct, and the day before is 30 Sep).
    const d = new Date(Date.UTC(2001, month - 1, id));
    d.setUTCDate(d.getUTCDate() - 1);
    return { m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  };
  const other = ((im + 5) % 12) + 1;
  const a = dayBefore(im);
  const b = dayBefore(other);
  const [, dm, dd] = dlp.split("-").map(Number) as [number, number, number];
  const near = (t: { m: number; d: number }) => {
    if (dm !== t.m) return false;
    return Math.abs(dd - t.d) <= 1;
  };
  const fmt = (t: { m: number; d: number }) => {
    const name = Object.keys(MONTHS).find((k) => MONTHS[k] === t.m)!;
    return `${t.d} ${name[0]!.toUpperCase()}${name.slice(1)}`;
  };
  const expected = [a, b].sort((x, y) => x.m - y.m).map(fmt) as [string, string];
  return { aligned: near(a) || near(b), expected };
}

/** Rows of a CSV the register can import: active substance, IBD, and
 *  optionally product names, NAFDAC registration numbers ("; "-separated)
 *  and source. Rows it cannot read are returned with the reason. */
export function parseRegisterCsv(text: string): {
  rows: Omit<IbdRegisterEntry, "id" | "by" | "at">[];
  rejected: { line: number; reason: string }[];
} {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const cells = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]!;
      if (ch === '"') {
        if (q && l[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === "," && !q) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const header = cells(lines[0] ?? "").map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iSub = col("activesubstance", "substance", "ingredient", "inn");
  const iIbd = col("ibd", "internationalbirth", "birthdate");
  const iNames = col("product", "brand", "name");
  const iReg = col("nafdac", "regno", "registration");
  const iSrc = col("source", "reference");
  const rows: Omit<IbdRegisterEntry, "id" | "by" | "at">[] = [];
  const rejected: { line: number; reason: string }[] = [];
  if (iSub < 0 || iIbd < 0) {
    return { rows, rejected: [{ line: 1, reason: "The first row must name an active substance column and an IBD column." }] };
  }
  const list = (v: string | undefined) => (v ?? "").split(/;|\|/).map((s) => s.trim()).filter(Boolean);
  lines.slice(1).forEach((l, i) => {
    const c = cells(l);
    const activeSubstance = (c[iSub] ?? "").trim();
    const ibd = readDocumentDate(c[iIbd]);
    if (!activeSubstance) return rejected.push({ line: i + 2, reason: "No active substance." });
    if (!ibd) return rejected.push({ line: i + 2, reason: `"${c[iIbd] ?? ""}" is not a date.` });
    rows.push({
      activeSubstance,
      ibd,
      productNames: iNames >= 0 ? list(c[iNames]) : [],
      nafdacRegNos: iReg >= 0 ? list(c[iReg]) : [],
      source: iSrc >= 0 ? (c[iSrc] ?? "").trim() : "",
    });
  });
  return { rows, rejected };
}
