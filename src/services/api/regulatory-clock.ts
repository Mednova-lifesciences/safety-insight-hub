import type { CaseSummary, Seriousness, WorkflowStep } from "@/types/pv";

/**
 * The NAFDAC reporting clock for a case. Day 0 is the date the report was
 * received. Serious cases are due in 15 calendar days and non-serious in 90,
 * the windows most regulators use (confirm against current NAFDAC guidance).
 * A case not yet assessed runs on the serious clock until someone decides.
 */
export const REPORTING_DAYS: Record<Seriousness, number> = {
  SERIOUS: 15,
  UNASSESSED: 15,
  NON_SERIOUS: 90,
};

/** Steps at which the case is ready for, or past, submission: the clock stops. */
const CLOCK_STOPPED: WorkflowStep[] = ["REGULATORY_READY", "CLOSED"];

/** Due within this many days counts as "due soon". */
export const DUE_SOON_DAYS = 3;

export type ClockStatus = "OVERDUE" | "DUE_SOON" | "ON_TRACK" | "STOPPED" | "NO_DATE";

export interface ReportingClock {
  status: ClockStatus;
  /** ISO date the report is due to NAFDAC. */
  deadline?: string | undefined;
  /** Days from today to the deadline; negative once overdue. */
  daysLeft?: number | undefined;
  windowDays: number;
  label: string;
}

const DAY_MS = 86_400_000;

function utcDay(iso: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return undefined;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? undefined : t;
}

/** Today's date as YYYY-MM-DD in local time — the date staff see. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number | undefined {
  const a = utcDay(from);
  const b = utcDay(to);
  return a === undefined || b === undefined ? undefined : Math.round((b - a) / DAY_MS);
}

export function addDaysIso(iso: string, days: number): string | undefined {
  const t = utcDay(iso);
  return t === undefined ? undefined : new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

function plural(n: number) {
  return `${n} day${n === 1 ? "" : "s"}`;
}

export function reportingClock(
  c: Pick<CaseSummary, "receivedDate" | "seriousness" | "workflowStep">,
  today = todayIso(),
): ReportingClock {
  const windowDays = REPORTING_DAYS[c.seriousness] ?? REPORTING_DAYS.UNASSESSED;
  const deadline = addDaysIso(c.receivedDate, windowDays);
  if (!deadline) return { status: "NO_DATE", windowDays, label: "No received date" };
  if (CLOCK_STOPPED.includes(c.workflowStep)) {
    return { status: "STOPPED", deadline, windowDays, label: "Ready / closed" };
  }
  const daysLeft = daysBetween(today, deadline) ?? 0;
  if (daysLeft < 0) {
    return {
      status: "OVERDUE",
      deadline,
      daysLeft,
      windowDays,
      label: `Overdue by ${plural(-daysLeft)}`,
    };
  }
  if (daysLeft === 0)
    return { status: "DUE_SOON", deadline, daysLeft, windowDays, label: "Due today" };
  return {
    status: daysLeft <= DUE_SOON_DAYS ? "DUE_SOON" : "ON_TRACK",
    deadline,
    daysLeft,
    windowDays,
    label: `Due in ${plural(daysLeft)}`,
  };
}

export const CLOCK_TONE: Record<ClockStatus, "critical" | "warning" | "neutral" | "success"> = {
  OVERDUE: "critical",
  DUE_SOON: "warning",
  ON_TRACK: "neutral",
  STOPPED: "success",
  NO_DATE: "neutral",
};

/** Internal due date check that replaces the old fixed-date comparison. */
export function isPastDue(
  c: Pick<CaseSummary, "dueDate" | "workflowStep">,
  today = todayIso(),
): boolean {
  return c.workflowStep !== "CLOSED" && !!c.dueDate && c.dueDate < today;
}

export function matchesClockFilter(clock: ReportingClock, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "ATTENTION") return clock.status === "OVERDUE" || clock.status === "DUE_SOON";
  return clock.status === filter;
}
