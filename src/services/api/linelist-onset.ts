/**
 * The reaction onset date, as an AEFI line list implies it.
 *
 * AEFI forms such as the NAFDAC/Ondo one have no onset-date column. They
 * record "Date of Last immunisation" and "Onset Time interval (hours, days,
 * weeks)", and E2B(R3) needs the reaction start date (E.i.4), so the date
 * is worked out from the two.
 *
 * Reporters do not always write an interval in that column. On the real
 * Ondo file some wrote the onset date itself ("28/1/2026"), or the date
 * and time ("05/02/2026, 12:00"), or misspelled the unit ("10 MINITES").
 * Those are read. Anything that would need a guess — a unit with no number,
 * a number with no unit, a time with no date — is left underived and
 * explained, never approximated: a guessed onset date moves a reaction.
 *
 * Kept in its own module so the cell writer can recompute the onset date
 * when a correction changes either input, without importing linelist.ts.
 */

export function stripSpreadsheetTextMarkers(value: string): string {
  return value.trim().replace(/^'+/, "").replace(/'+$/, "").trim();
}

/** Best-effort parse of yyyy-mm-dd, d/m/y and d-m-y — day-first (common on
 *  African AEFI forms), swapping to month-first only when day-first is out
 *  of range. */
export function parseDateLoose(value: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const [, y, m, d] = iso;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const slashOrDash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  if (slashOrDash) {
    const [, a, b, y] = slashOrDash;
    const year = y!.length === 2 ? Number(y) + 2000 : Number(y);
    let day = Number(a);
    let month = Number(b);
    if (day <= 12 && month > 12) {
      [day, month] = [month, day];
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Every spelling seen for each unit. The misspellings are the ones real
 *  reporters wrote; "house" is how one wrote hours ("24 house"). */
const UNITS: {
  ms: number;
  singular: string;
  plural: string;
  spellings: RegExp;
  standard: RegExp;
}[] = [
  {
    ms: MIN,
    singular: "minute",
    plural: "minutes",
    spellings:
      /^(m|mn|mns|min|mins|minute|minutes|minit|minits|minite|minites|minut|minuts|minuite|minuites|mint|mints|mnt|mnts)$/,
    standard: /^(m|min|mins|minute|minutes)$/,
  },
  {
    ms: HOUR,
    singular: "hour",
    plural: "hours",
    spellings: /^(h|hr|hrs|hour|hours|hor|hors|hous|house|houres|hourse)$/,
    standard: /^(h|hr|hrs|hour|hours)$/,
  },
  {
    ms: DAY,
    singular: "day",
    plural: "days",
    spellings: /^(d|dy|dys|day|days|dayz)$/,
    standard: /^(d|day|days)$/,
  },
  {
    ms: 7 * DAY,
    singular: "week",
    plural: "weeks",
    spellings: /^(w|wk|wks|week|weeks|weekz)$/,
    standard: /^(w|wk|wks|week|weeks)$/,
  },
];

export interface ReadInterval {
  ms: number;
  /** "10 minutes", "5 hours 30 minutes" — what the value was read as. */
  readAs: string;
  /** True when reading it took more than a standard spelling of one unit:
   *  a misspelling, or two units together. Worth telling the reader. */
  interpreted: boolean;
}

/** Reads an onset interval: "30 mins", "2 days", "10HRS", "5hrs 30min",
 *  "10 MINITES", "24 house". Null when any part cannot be read. */
export function readOnsetInterval(raw: string): ReadInterval | null {
  const v = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!v) return null;
  const part = /(\d+(?:\.\d+)?)\s*([a-z]+)\.?/g;
  let consumed = "";
  let ms = 0;
  let interpreted = false;
  const pieces: string[] = [];
  for (const m of v.matchAll(part)) {
    const n = Number(m[1]);
    const word = m[2]!;
    const unit = UNITS.find((u) => u.spellings.test(word));
    if (!unit || !Number.isFinite(n) || n < 0) return null;
    if (!unit.standard.test(word)) interpreted = true;
    ms += n * unit.ms;
    pieces.push(`${m[1]} ${n === 1 ? unit.singular : unit.plural}`);
    consumed += m[0];
  }
  // Every character must belong to a number+unit pair (separators aside),
  // so "2 days later maybe" is not read as "2 days".
  const leftover = v.replace(part, "").replace(/[\s,&]|and/g, "");
  if (pieces.length === 0 || leftover) return null;
  if (pieces.length > 1) interpreted = true;
  return { ms, readAs: pieces.join(" "), interpreted };
}

/** Milliseconds in an onset interval, or null — see readOnsetInterval. */
export function parseOnsetIntervalMs(raw: string): number | null {
  return readOnsetInterval(raw)?.ms ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A calendar date, optionally followed by a time, written where an
 *  interval was expected: "28/1/2026", "05/02/2026, 12:00",
 *  "06/02/2026, 9:30AM", "13/01/2026: 4;00", "14;25" style times included. */
export function readDateInIntervalCell(
  raw: string,
): { date: string; time?: string; unreadTime?: string } | null {
  const v = stripSpreadsheetTextMarkers(raw);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s*[,:;]?\s+|\s*[,:;]\s*)?(.*)$/.exec(v);
  if (!m) return null;
  const date = parseDateLoose(`${m[1]}/${m[2]}/${m[3]}`);
  if (!date) return null;
  const rest = (m[4] ?? "").trim();
  if (!rest) return { date: isoDate(date) };
  const t = /^(\d{1,2})\s*[:;.]\s*(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(rest);
  if (t) {
    let h = Number(t[1]);
    const min = Number(t[2]);
    const meridiem = t[3]?.toLowerCase().replace(/\./g, "");
    const validHour = meridiem ? h >= 1 && h <= 12 : h >= 0 && h <= 23;
    if (validHour && min <= 59) {
      if (meridiem === "pm" && h < 12) h += 12;
      if (meridiem === "am" && h === 12) h = 0;
      return { date: isoDate(date), time: `${pad(h)}:${pad(min)}` };
    }
  }
  return { date: isoDate(date), unreadTime: rest };
}

export interface ResolvedOnset {
  /** ISO yyyy-mm-dd — the shape of a directly supplied onset date. */
  date: string;
  /** How it was arrived at, for the fixed file's "Changes made" column. */
  note: string;
}

/**
 * The onset date a row implies, and how — or null when it cannot be
 * worked out without guessing. A date written in the interval column is
 * used as it stands (no vaccination date needed); otherwise the interval
 * is added to the vaccination date.
 */
/** A time of day as a form writes it ("11:00", "9:30AM", "14;25", "4.00
 *  pm"), as hours and minutes; null when it cannot be read. */
export function readTimeOfDay(raw: string | undefined): { h: number; m: number } | null {
  const t = /^(\d{1,2})\s*[:;.]\s*(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec((raw ?? "").trim());
  if (!t) return null;
  let h = Number(t[1]);
  const m = Number(t[2]);
  const meridiem = t[3]?.toLowerCase().replace(/\./g, "");
  if (m > 59 || (meridiem ? h < 1 || h > 12 : h > 23)) return null;
  if (meridiem === "pm" && h < 12) h += 12;
  if (meridiem === "am" && h === 12) h = 0;
  return { h, m };
}

export function resolveOnset(
  vaccinationDate: string | undefined,
  onsetInterval: string | undefined,
  vaccinationTime?: string | undefined,
): ResolvedOnset | null {
  if (!onsetInterval?.trim()) return null;
  const written = readDateInIntervalCell(onsetInterval);
  if (written) {
    const what = written.time ? "the onset date and time" : "the onset date";
    const unread = written.unreadTime
      ? ` The rest ("${written.unreadTime}") could not be read as a time and was not used.`
      : "";
    return {
      date: written.date,
      note: `Onset date ${written.date}${written.time ? ` ${written.time}` : ""} taken from the onset interval "${onsetInterval.trim()}", which held ${what} rather than an interval.${unread}`,
    };
  }
  if (!vaccinationDate) return null;
  const base = parseDateLoose(stripSpreadsheetTextMarkers(vaccinationDate));
  if (!base) return null;
  const interval = readOnsetInterval(onsetInterval);
  if (!interval) return null;
  // The time of vaccination, when the form records it, so an interval in
  // hours can carry the onset into the next day.
  const time = readTimeOfDay(vaccinationTime);
  if (time) base.setHours(time.h, time.m, 0, 0);
  const d = new Date(base.getTime() + interval.ms);
  if (Number.isNaN(d.getTime())) return null;
  const readAs = interval.interpreted ? ` (read as ${interval.readAs})` : "";
  const at = time ? ` at ${pad(time.h)}:${pad(time.m)}` : "";
  return {
    date: isoDate(d),
    note: `Onset date ${isoDate(d)} worked out from vaccination date "${stripSpreadsheetTextMarkers(vaccinationDate)}"${at} + onset interval "${onsetInterval.trim()}"${readAs}.`,
  };
}

/** The onset date alone — see resolveOnset. */
export function deriveOnsetDate(
  vaccinationDate: string | undefined,
  onsetInterval: string | undefined,
  vaccinationTime?: string | undefined,
): string | null {
  return resolveOnset(vaccinationDate, onsetInterval, vaccinationTime)?.date ?? null;
}

/** Why an onset interval that is present cannot be used, in words the
 *  officer can take back to the reporter. */
export function explainUnreadableInterval(raw: string): string {
  const v = stripSpreadsheetTextMarkers(raw);
  if (/^[a-z]+\.?$/i.test(v)) {
    return `The onset interval "${v}" has a unit but no number, so how long after vaccination the reaction began is not known. Ask the reporter for the number.`;
  }
  if (/^\d+(\.\d+)?$/.test(v)) {
    return `The onset interval "${v}" has no unit (minutes, hours or days?), so the onset date cannot be worked out without guessing. Ask the reporter.`;
  }
  if (/^\d{1,2}\s*[:;.]\s*\d{2}\s*(am|pm)?$/i.test(v)) {
    return `The onset interval "${v}" is a time of day with no date. It may be the vaccination day, but the form does not say so. Ask the reporter for the onset date.`;
  }
  return `The onset interval "${v}" could not be read as a duration or a date, so the onset date cannot be derived.`;
}
