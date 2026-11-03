import type { CaseSummary, HolderForward } from "@/types/pv";
import type { CatalogDrug } from "@/services/api/products";
import { INTAKE_CHANNEL_LABELS } from "@/services/api/intake-channel";
import { reportingClock } from "@/services/api/regulatory-clock";
import { needsForward, primaryForwardState } from "@/services/api/holder-forwarding";
import { buildCalendar, type CalendarEntry } from "@/services/psur/own-brand-calendar";
import { allAlerts, type Registration, type RegulatoryAlert } from "@/services/api/registrations";
import { cleanBranch } from "@/services/api/intake-channel";

/**
 * The monthly activity report and quarterly safety dashboard: counts over
 * the organisation's own cases for a period, plus where its regulatory
 * deadlines stand today. Counting only — nothing here is assessed.
 */

export interface Period {
  from: string;
  to: string;
  label: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** `month` is YYYY-MM. */
export function monthPeriod(month: string): Period {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1;
  return { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)), label: `${MONTHS[m]} ${y}` };
}

/** `quarter` is 1–4. */
export function quarterPeriod(year: number, quarter: number): Period {
  const m0 = (quarter - 1) * 3;
  return {
    from: iso(year, m0, 1),
    to: iso(year, m0 + 2, lastDay(year, m0 + 2)),
    label: `Q${quarter} ${year}`,
  };
}

export function monthsIn(p: Period): string[] {
  const out: string[] = [];
  let y = Number(p.from.slice(0, 4));
  let m = Number(p.from.slice(5, 7)) - 1;
  while (iso(y, m, 1) <= p.to) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
}

export interface Count {
  name: string;
  count: number;
}

function tally(values: string[]): Count[] {
  const map = new Map<string, Count>();
  for (const v of values) {
    const key = v.trim().toLowerCase();
    const c = map.get(key) ?? { name: v.trim(), count: 0 };
    c.count++;
    map.set(key, c);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface ActivityReport {
  period: Period;
  today: string;
  received: number;
  serious: number;
  nonSerious: number;
  unassessed: number;
  fatal: number;
  byMonth: Count[];
  byChannel: Count[];
  byBranch: Count[];
  topProducts: Count[];
  topReactions: Count[];
  /** Open cases (any period) past their NAFDAC deadline today. */
  overdueNow: number;
  dueSoonNow: number;
  /** Cases from the period now ready for submission or closed. */
  readyOrClosed: number;
  forwardsInPeriod: HolderForward[];
  awaitingForward: number;
  unlistedInPeriod: number;
  psur: CalendarEntry[];
  registrationAlerts: RegulatoryAlert[];
}

export function buildActivityReport(input: {
  period: Period;
  today: string;
  cases: CaseSummary[];
  catalog: CatalogDrug[];
  registrations: Registration[];
}): ActivityReport {
  const { period, today, cases, catalog, registrations } = input;
  const inPeriod = cases.filter(
    (c) => c.receivedDate >= period.from && c.receivedDate <= period.to,
  );
  const open = cases.filter((c) => c.workflowStep !== "CLOSED");
  const clocks = open.map((c) => reportingClock(c, today));

  return {
    period,
    today,
    received: inPeriod.length,
    serious: inPeriod.filter((c) => c.seriousness === "SERIOUS").length,
    nonSerious: inPeriod.filter((c) => c.seriousness === "NON_SERIOUS").length,
    unassessed: inPeriod.filter((c) => c.seriousness === "UNASSESSED").length,
    fatal: inPeriod.filter((c) => c.outcome === "FATAL").length,
    byMonth: monthsIn(period).map((m) => ({
      name: m,
      count: inPeriod.filter((c) => c.receivedDate.startsWith(m)).length,
    })),
    byChannel: tally(
      inPeriod.map((c) =>
        c.intakeChannel ? INTAKE_CHANNEL_LABELS[c.intakeChannel] : "Not recorded",
      ),
    ),
    byBranch: tally(inPeriod.map((c) => cleanBranch(c.branch)).filter((b): b is string => !!b)),
    topProducts: tally(inPeriod.map((c) => c.product)).slice(0, 10),
    topReactions: tally(inPeriod.map((c) => c.reaction)).slice(0, 10),
    overdueNow: clocks.filter((k) => k.status === "OVERDUE").length,
    dueSoonNow: clocks.filter((k) => k.status === "DUE_SOON").length,
    readyOrClosed: inPeriod.filter(
      (c) => c.workflowStep === "REGULATORY_READY" || c.workflowStep === "CLOSED",
    ).length,
    forwardsInPeriod: cases
      .flatMap((c) => c.holderForwards ?? [])
      .filter((f) => f.sentOn >= period.from && f.sentOn <= period.to),
    awaitingForward: cases.filter((c) => needsForward(primaryForwardState(c, catalog))).length,
    unlistedInPeriod: inPeriod.filter((c) => c.unlistedProduct).length,
    psur: buildCalendar(catalog, today),
    registrationAlerts: allAlerts(registrations, today),
  };
}

export const pct = (part: number, whole: number) =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
