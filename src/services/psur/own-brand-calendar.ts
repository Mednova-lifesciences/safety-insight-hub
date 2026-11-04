import type { CaseSummary } from "@/types/pv";
import type { CatalogDrug, PsurSchedule } from "@/services/api/products";
import { SUBMISSION_WINDOW_DAYS } from "./screening-checklist";
import { daysBetween } from "@/services/api/regulatory-clock";
import { describeIntake } from "@/services/api/intake-channel";

/**
 * PSUR calendar for the organisation's OWN products — the ones it holds the
 * registration for. Date arithmetic only:
 *
 *   next DLP  = last DLP + interval; with no last DLP, the first birth-date
 *               anniversary (IBD + k × interval) whose deadline has not passed.
 *   deadline  = next DLP + 70 days (interval ≤ 12 months) or + 90 days (> 12),
 *               the same windows the NAFDAC screening checklist applies.
 */

export const PSUR_INTERVALS = [6, 12, 36] as const;
export const DUE_SOON_DAYS = 30;

export type CalendarStatus = "OVERDUE" | "DUE_SOON" | "IN_PREPARATION" | "UPCOMING" | "NOT_SET_UP";

export interface CalendarEntry {
  drug: CatalogDrug;
  status: CalendarStatus;
  /** Start and end (the DLP) of the reporting period now due. */
  periodStart?: string | undefined;
  nextDlp?: string | undefined;
  deadline?: string | undefined;
  windowDays?: number | undefined;
  daysToDeadline?: number | undefined;
  /** True when the next DLP was worked out from the birth date alone. */
  fromBirthDate?: boolean | undefined;
  label: string;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Adds calendar months, keeping the day where the month has it and
 *  otherwise using the month's last day (31 Aug + 6 months = 28/29 Feb). */
export function addMonthsIso(iso: string, months: number): string | undefined {
  const m = ISO.exec(iso);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + months;
  const d = Number(m[3]);
  const targetYear = y + Math.floor(mo / 12);
  const targetMonth = ((mo % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(targetYear, targetMonth, Math.min(d, lastDay)));
  return out.toISOString().slice(0, 10);
}

export function windowDaysFor(intervalMonths: number): number {
  return intervalMonths > 12
    ? SUBMISSION_WINDOW_DAYS.INTERVAL_OVER_12_MONTHS
    : SUBMISSION_WINDOW_DAYS.INTERVAL_UP_TO_12_MONTHS;
}

function deadlineOf(dlp: string, intervalMonths: number) {
  const window = windowDaysFor(intervalMonths);
  const t = Date.parse(`${dlp}T00:00:00Z`) + window * 86_400_000;
  return { deadline: new Date(t).toISOString().slice(0, 10), window };
}

export function isScheduleComplete(s: PsurSchedule | undefined): s is PsurSchedule & {
  intervalMonths: number;
} {
  return !!s && !!s.intervalMonths && (!!s.lastDlp || !!s.ibd);
}

export function calendarEntry(drug: CatalogDrug, today: string): CalendarEntry {
  const s = drug.psur;
  if (!isScheduleComplete(s)) {
    return { drug, status: "NOT_SET_UP", label: "Schedule not set up" };
  }
  const interval = s.intervalMonths;
  let nextDlp: string | undefined;
  let fromBirthDate = false;
  if (s.lastDlp) {
    nextDlp = addMonthsIso(s.lastDlp, interval);
  } else if (s.ibd) {
    fromBirthDate = true;
    for (let k = 1; k <= 400; k++) {
      const dlp = addMonthsIso(s.ibd, k * interval);
      if (!dlp) break;
      if (deadlineOf(dlp, interval).deadline >= today) {
        nextDlp = dlp;
        break;
      }
    }
  }
  if (!nextDlp) return { drug, status: "NOT_SET_UP", label: "Schedule dates not readable" };

  const { deadline, window } = deadlineOf(nextDlp, interval);
  const daysToDeadline = daysBetween(today, deadline) ?? 0;
  const periodStart = addMonthsIso(nextDlp, -interval);
  const base = {
    drug,
    periodStart,
    nextDlp,
    deadline,
    windowDays: window,
    daysToDeadline,
    fromBirthDate,
  };

  if (daysToDeadline < 0) {
    return { ...base, status: "OVERDUE", label: `Overdue by ${-daysToDeadline} day(s)` };
  }
  if (daysToDeadline <= DUE_SOON_DAYS) {
    return { ...base, status: "DUE_SOON", label: `Due in ${daysToDeadline} day(s)` };
  }
  if (nextDlp <= today) {
    return {
      ...base,
      status: "IN_PREPARATION",
      label: `Data locked — due in ${daysToDeadline} days`,
    };
  }
  return {
    ...base,
    status: "UPCOMING",
    label: `Data lock in ${daysBetween(today, nextDlp)} days`,
  };
}

const ORDER: Record<CalendarStatus, number> = {
  OVERDUE: 0,
  DUE_SOON: 1,
  IN_PREPARATION: 2,
  UPCOMING: 3,
  NOT_SET_UP: 4,
};

/** Own-brand products only, most urgent first. */
export function buildCalendar(catalog: CatalogDrug[], today: string): CalendarEntry[] {
  return catalog
    .filter((d) => d.ownBrand)
    .map((d) => calendarEntry(d, today))
    .sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] ||
        (a.deadline ?? "").localeCompare(b.deadline ?? "") ||
        a.drug.name.localeCompare(b.drug.name),
    );
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** Cases about this product received in the reporting period (start
 *  exclusive, DLP inclusive). */
export function casesInPeriod(
  cases: CaseSummary[],
  drug: CatalogDrug,
  periodStart: string,
  dlp: string,
): CaseSummary[] {
  return cases
    .filter((c) => c.productId === drug.id || (!c.productId && norm(c.product) === norm(drug.name)))
    .filter((c) => c.receivedDate > periodStart && c.receivedDate <= dlp)
    .sort((a, b) => a.receivedDate.localeCompare(b.receivedDate) || a.id.localeCompare(b.id));
}

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function lineListingCsv(rows: CaseSummary[]): string {
  const header = [
    "Case ID",
    "Received",
    "Product",
    "Reaction",
    "Seriousness",
    "Outcome",
    "Channel",
    "Workflow step",
  ];
  const lines = rows.map((c) =>
    [
      c.id,
      c.receivedDate,
      c.product,
      c.reaction,
      c.seriousness,
      c.outcome,
      describeIntake(c),
      c.workflowStep,
    ]
      .map((v) => cell(v ?? ""))
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}
