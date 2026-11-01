import type {
  PsurDocumentSummary,
  PsurForecastDismissal,
  PsurScreeningOutcomeDecision,
} from "@/types/pv";
import {
  OUTCOME_LABELS,
  returnsToMah,
  assessTimeliness,
  intervalBounds,
  SCREENING_CHECKS,
  screeningDate,
  submissionWindowDays,
} from "./screening-checklist";

/**
 * PSUR due-date forecast — a COMPLIANCE FORECAST, not AI.
 *
 * For each product and MAH it takes the latest SCREENED report (one whose
 * screening outcome an officer has recorded) and works out when the next
 * one is due, using only what is already stored:
 *
 *   next DLP  = the next-PSUR date the officer recorded, if there is one;
 *               otherwise the last DLP plus the same interval length.
 *   deadline  = next DLP + 70 days (interval ≤ 12 months) or + 90 days
 *               (> 12 months) — the same windows item 8 uses.
 *
 * When the interval cannot be read the window cannot be chosen, so the
 * status is "cannot forecast". It never guesses: a wrong window would call
 * an MAH late, or excuse one.
 */

export type ForecastStatus = "OVERDUE" | "DUE_NOW" | "DUE_IN" | "RECEIVED" | "CANNOT_FORECAST";

/**
 * How a report uploaded after the last screened one relates to it.
 *
 *   NEXT                its Data Lock Point is later: the next PSUR.
 *   RESUBMISSION        same Data Lock Point: a corrected or repeated copy of
 *                       the report already screened, not the next one.
 *   SAME_FILE           byte-for-byte the same file, whatever it is called.
 *   EARLIER_PERIOD      an older Data Lock Point than the one screened.
 *   PERIOD_UNCONFIRMED  its Data Lock Point could not be read, so it is not
 *                       assumed to be the next report.
 */
export type ArrivalKind =
  "NEXT" | "RESUBMISSION" | "SAME_FILE" | "EARLIER_PERIOD" | "PERIOD_UNCONFIRMED";

export interface Arrival {
  kind: ArrivalKind;
  documentId: string;
  filename: string;
  /** Its Data Lock Point as read at upload, when it could be read. */
  dlp?: string | undefined;
}

export interface ResubmissionDue {
  /** "Not accepted — resubmit" or "Compliance directive". */
  decision: string;
  returnedAt: string;
  /** ISO date the corrected report is due back, when the officer set one. */
  due?: string | undefined;
  /** Days until it is due (negative once late). */
  daysToDue?: number | undefined;
  /** A corrected version has arrived (linked or same DLP). */
  received: boolean;
}

export const ARRIVAL_LABELS: Record<ArrivalKind, string> = {
  NEXT: "Next report received",
  RESUBMISSION: "Corrected resubmission received",
  SAME_FILE: "Same file uploaded again",
  EARLIER_PERIOD: "Report for an earlier period received",
  PERIOD_UNCONFIRMED: "New report — period not confirmed",
};

export interface MahTimeliness {
  late: number;
  assessed: number;
}

export interface PsurForecast {
  key: string;
  product: string;
  mah: string;
  /** The latest screened report the forecast is built on. */
  basedOn: { documentId: string; filename: string; dlp: string; intervalCovered: string };
  /** ISO dates; absent when they cannot be worked out. */
  nextDlp?: string | undefined;
  deadline?: string | undefined;
  /** Where next DLP came from. */
  nextDlpSource?: "RECORDED" | "SAME_INTERVAL" | undefined;
  windowDays?: number | undefined;
  status: ForecastStatus;
  /** Days to the deadline (negative when overdue). */
  daysToDeadline?: number | undefined;
  /** Why it cannot be forecast, or which newer report arrived. */
  note: string;
  /** This MAH's record across every screened report with a readable date. */
  mahHistory: MahTimeliness;
  /** Items the officer cited at the last screening — what to watch for. */
  watchFor: { number: number; label: string }[];
  /** Reports uploaded since the last screening and not yet screened, each
   *  with how it relates to the screened one. Only a NEXT one stops the
   *  reminder; the others are shown beside it. */
  arrivals: Arrival[];
  /** When the report this forecast is built on was returned to the MAH:
   *  the corrected version they owe. Separate from the next periodic
   *  report, which is still forecast from the DLP and interval. */
  resubmission?: ResubmissionDue | undefined;
  /** Set when a person dismissed this reminder for this same deadline. */
  dismissal?: PsurForecastDismissal | undefined;
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const norm = (s: string | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function productOf(d: PsurDocumentSummary): string {
  return d.administrativeScreening?.submissionDetails.productName?.trim() || d.product || "";
}
function mahOf(d: PsurDocumentSummary): string {
  return d.administrativeScreening?.submissionDetails.mah?.trim() || d.mah || "";
}

/** Late / assessed for one screened report, from the officer's recorded
 *  item 8 when there is one, otherwise the same arithmetic item 8 uses. */
function wasLate(d: PsurDocumentSummary): boolean | null {
  const s = d.administrativeScreening;
  if (!s?.outcome) return null;
  const recorded = s.checks.find((c) => c.id === "RECEIVED_WITHIN_TIMEFRAME");
  if (
    recorded &&
    !recorded.assistGenerated &&
    (recorded.status === "YES" || recorded.status === "NO")
  ) {
    return recorded.status === "NO";
  }
  const t = assessTimeliness(s.submissionDetails);
  if (t.status === "YES") return false;
  if (t.status === "NO" && t.daysLate !== undefined) return true;
  return null;
}

export function forecastPsurs(
  docs: PsurDocumentSummary[],
  today: Date = new Date(),
): PsurForecast[] {
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  const history = new Map<string, MahTimeliness>();
  for (const d of docs) {
    const late = wasLate(d);
    if (late === null) continue;
    const h = history.get(norm(mahOf(d))) ?? { late: 0, assessed: 0 };
    h.assessed += 1;
    if (late) h.late += 1;
    history.set(norm(mahOf(d)), h);
  }

  const groups = new Map<string, PsurDocumentSummary[]>();
  for (const d of docs) {
    const product = productOf(d);
    if (!product) continue;
    const key = `${norm(product)}|${norm(mahOf(d))}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  const out: PsurForecast[] = [];
  for (const [key, list] of groups) {
    const screened = list
      .filter((d) => d.administrativeScreening?.outcome)
      .map((d) => ({ d, dlp: screeningDate(d.administrativeScreening!.submissionDetails.dlp) }))
      .sort(
        (x, y) =>
          (y.dlp?.getTime() ?? 0) - (x.dlp?.getTime() ?? 0) ||
          y.d.administrativeScreening!.outcome!.at.localeCompare(
            x.d.administrativeScreening!.outcome!.at,
          ),
      );
    const latest = screened[0];
    if (!latest) continue;
    const s = latest.d.administrativeScreening!;
    const details = s.submissionDetails;
    const base: Omit<PsurForecast, "status" | "note"> = {
      key,
      product: productOf(latest.d),
      mah: mahOf(latest.d),
      basedOn: {
        documentId: latest.d.id,
        filename: latest.d.filename,
        dlp: details.dlp,
        intervalCovered: details.intervalCovered,
      },
      mahHistory: history.get(norm(mahOf(latest.d))) ?? { late: 0, assessed: 0 },
      arrivals: [],
      watchFor: (s.outcome!.citedItems ?? [])
        .map((n) => {
          const def = SCREENING_CHECKS.find((c) => c.number === n);
          return def ? { number: n, label: def.label } : null;
        })
        .filter((x): x is { number: number; label: string } => x !== null),
    };

    // Reports for the same product uploaded since the last screening and
    // not screened yet. Only one with a later Data Lock Point is the next
    // report; a corrected copy of the same period is not.
    // Also any report uploaded as the corrected version of one of these,
    // even if its product or MAH was read differently.
    const ids = new Set(list.map((d) => d.id));
    const linked = docs.filter(
      (d) => !ids.has(d.id) && d.resubmissionOf && ids.has(d.resubmissionOf),
    );
    const arrivals: Arrival[] = [...list, ...linked]
      .filter(
        (d) =>
          d.id !== latest.d.id &&
          !d.administrativeScreening?.outcome &&
          d.uploadedAt > (s.outcome!.at ?? ""),
      )
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
      .map((d) => {
        const dlp = d.administrativeScreening?.submissionDetails.dlp?.trim();
        return {
          kind: arrivalKind(d, [...list, ...linked], latest.dlp, ids),
          documentId: d.id,
          filename: d.filename,
          ...(dlp ? { dlp } : {}),
        };
      });
    const newer = arrivals.find((a) => a.kind === "NEXT");
    base.arrivals = arrivals;

    // A returned report: the corrected version is owed by the date the
    // officer set ("PSUR/PBRER resubmission date" on the directive).
    if (returnsToMah(s.outcome!.decision)) {
      const due = screeningDate(s.outcome!.nextPsurDueDate);
      base.resubmission = {
        decision: OUTCOME_LABELS[s.outcome!.decision],
        returnedAt: s.outcome!.at,
        ...(due ? { due: iso(due), daysToDue: Math.round((due.getTime() - todayUtc) / DAY) } : {}),
        received: arrivals.some((a) => a.kind === "RESUBMISSION"),
      };
    }

    const windowDays = submissionWindowDays(details.intervalCovered);
    // The officer's date is the next-PSUR date only for an accepted report;
    // for a returned one it is when the corrected report is due back.
    const recorded =
      (returnsToMah(s.outcome!.decision) ? null : screeningDate(s.outcome!.nextPsurDueDate)) ??
      screeningDate(latest.d.regulatoryDecision?.nextPsurDueDate);
    let nextDlp: Date | null = recorded;
    let nextDlpSource: PsurForecast["nextDlpSource"] = recorded ? "RECORDED" : undefined;
    if (!nextDlp && latest.dlp) {
      const bounds = intervalBounds(details.intervalCovered);
      if (bounds) {
        nextDlp = addInterval(latest.dlp, bounds.from, bounds.to);
        nextDlpSource = "SAME_INTERVAL";
      }
    }

    if (!nextDlp || windowDays === null) {
      out.push({
        ...base,
        status: "CANNOT_FORECAST",
        ...(nextDlp ? { nextDlp: iso(nextDlp), nextDlpSource } : {}),
        note:
          !latest.dlp && !recorded
            ? "The last report's Data Lock Point could not be read and no next-PSUR date was recorded."
            : `The reporting interval "${details.intervalCovered || "not stated"}" could not be read, so neither the next Data Lock Point nor the 70/90-day window can be worked out.`,
      });
      continue;
    }

    const deadline = new Date(nextDlp.getTime() + windowDays * DAY);
    const daysToDeadline = Math.round((deadline.getTime() - todayUtc) / DAY);
    const common = {
      ...base,
      nextDlp: iso(nextDlp),
      deadline: iso(deadline),
      nextDlpSource,
      windowDays,
      daysToDeadline,
    };
    if (newer) {
      out.push({
        ...common,
        status: "RECEIVED",
        note: `The next report (${newer.filename}${newer.dlp ? `, DLP ${newer.dlp}` : ""}) has been received and is awaiting screening.`,
      });
    } else if (daysToDeadline < 0) {
      out.push({
        ...common,
        status: "OVERDUE",
        note: `${-daysToDeadline} day(s) past the deadline and no newer report has been received.`,
      });
    } else if (todayUtc >= nextDlp.getTime()) {
      out.push({
        ...common,
        status: "DUE_NOW",
        note: `The submission window is open: due within ${daysToDeadline} day(s).`,
      });
    } else {
      out.push({ ...common, status: "DUE_IN", note: `Due in ${daysToDeadline} day(s).` });
    }
  }

  const rank: Record<ForecastStatus, number> = {
    OVERDUE: 0,
    DUE_NOW: 1,
    DUE_IN: 2,
    CANNOT_FORECAST: 3,
    RECEIVED: 4,
  };
  // A dismissal holds for the deadline it was made against: once a newer
  // report is screened (another basis) or the deadline moves, it lapses.
  const byId = new Map(docs.map((d) => [d.id, d]));
  for (const f of out) {
    const dismissal = byId.get(f.basedOn.documentId)?.forecastDismissal;
    if (
      dismissal &&
      dismissal.deadline === (f.deadline ?? null) &&
      (f.deadline !== undefined || dismissal.status === f.status)
    )
      f.dismissal = dismissal;
  }
  return out.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.daysToDeadline ?? Infinity) - (b.daysToDeadline ?? Infinity) ||
      a.product.localeCompare(b.product),
  );
}

/**
 * The DLP moved on by the interval's length. An interval of whole calendar
 * months (1 Jan – 31 Dec) is added as months, keeping a month-end DLP on
 * the month end, so leap years do not drift it by a day; anything else is
 * added as its exact number of days.
 */
function addInterval(dlp: Date, from: Date, to: Date): Date {
  const dayAfter = new Date(to.getTime() + DAY);
  const months =
    (dayAfter.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (dayAfter.getUTCMonth() - from.getUTCMonth());
  if (dayAfter.getUTCDate() === from.getUTCDate() && months > 0) {
    const monthEnd = new Date(dlp.getTime() + DAY).getUTCDate() === 1;
    const y = dlp.getUTCFullYear();
    const m = dlp.getUTCMonth() + months;
    if (monthEnd) return new Date(Date.UTC(y, m + 1, 0));
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(dlp.getUTCDate(), lastDay)));
  }
  return new Date(dlp.getTime() + (to.getTime() - from.getTime()) + DAY);
}

export const FORECAST_STATUS_LABELS: Record<ForecastStatus, string> = {
  OVERDUE: "Overdue",
  DUE_NOW: "Due now",
  DUE_IN: "Due",
  RECEIVED: "Next report received",
  CANNOT_FORECAST: "Cannot forecast",
};

/** "2 of 3 late", or "" when nothing could be assessed. */
export function describeMahHistory(h: MahTimeliness): string {
  return h.assessed ? `${h.late} of ${h.assessed} late` : "";
}

const sameDay = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY) === 0;
const groupKey = (d: PsurDocumentSummary) => `${norm(productOf(d))}|${norm(mahOf(d))}`;

/** How an unscreened report relates to the last screened one (see Arrival). */
function arrivalKind(
  d: PsurDocumentSummary,
  sameProduct: PsurDocumentSummary[],
  screenedDlp: Date | null,
  screenedIds: ReadonlySet<string> = new Set(),
): ArrivalKind {
  if (
    d.fileSha256 &&
    sameProduct.some(
      (o) => o.id !== d.id && o.fileSha256 === d.fileSha256 && o.uploadedAt < d.uploadedAt,
    )
  )
    return "SAME_FILE";
  // The officer uploaded it as the corrected version of one of these.
  if (d.resubmissionOf && screenedIds.has(d.resubmissionOf)) return "RESUBMISSION";
  const dlp = screeningDate(d.administrativeScreening?.submissionDetails.dlp);
  if (!dlp || !screenedDlp) return "PERIOD_UNCONFIRMED";
  if (sameDay(dlp, screenedDlp)) return "RESUBMISSION";
  return dlp > screenedDlp ? "NEXT" : "EARLIER_PERIOD";
}

/** An earlier report this one repeats or corrects, for the report's page. */
export interface SubmissionRelation {
  kind: "SAME_FILE" | "RESUBMISSION";
  /** True when the officer uploaded it as the corrected version of that
   *  report; false when it was recognised by product, MAH and DLP. */
  linked?: boolean;
  earlier: { id: string; filename: string; uploadedAt: string; dlp: string };
  /** The earlier report's screening decision, when it had one. */
  screened?: {
    decision: PsurScreeningOutcomeDecision;
    at: string;
    citedItems: { number: number; label: string }[];
  };
}

/**
 * Whether this report is the same file as an earlier one (by fingerprint,
 * whatever either is called), or a resubmission of an earlier screened
 * report for the same product, MAH and Data Lock Point. Null when neither.
 */
export function submissionRelation(
  doc: PsurDocumentSummary,
  docs: PsurDocumentSummary[],
): SubmissionRelation | null {
  const earlier = docs
    .filter((d) => d.id !== doc.id && d.uploadedAt < doc.uploadedAt)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const describe = (d: PsurDocumentSummary): SubmissionRelation["earlier"] => ({
    id: d.id,
    filename: d.filename,
    uploadedAt: d.uploadedAt,
    dlp: d.administrativeScreening?.submissionDetails.dlp ?? "",
  });
  const screenedOf = (d: PsurDocumentSummary): SubmissionRelation["screened"] => {
    const o = d.administrativeScreening?.outcome;
    if (!o) return undefined;
    return {
      decision: o.decision,
      at: o.at,
      citedItems: (o.citedItems ?? [])
        .map((n) => {
          const def = SCREENING_CHECKS.find((c) => c.number === n);
          return def ? { number: n, label: def.label } : null;
        })
        .filter((x): x is { number: number; label: string } => x !== null),
    };
  };
  if (doc.resubmissionOf) {
    const target = docs.find((d) => d.id === doc.resubmissionOf);
    if (target) {
      const screened = screenedOf(target);
      return {
        kind: "RESUBMISSION",
        linked: true,
        earlier: describe(target),
        ...(screened ? { screened } : {}),
      };
    }
  }
  if (doc.fileSha256) {
    const same = earlier.find((d) => d.fileSha256 === doc.fileSha256);
    if (same) {
      const screened = screenedOf(same);
      return { kind: "SAME_FILE", earlier: describe(same), ...(screened ? { screened } : {}) };
    }
  }
  if (!productOf(doc)) return null;
  const dlp = screeningDate(doc.administrativeScreening?.submissionDetails.dlp);
  if (!dlp) return null;
  const key = groupKey(doc);
  const prev = earlier.find((d) => {
    if (groupKey(d) !== key || !d.administrativeScreening?.outcome) return false;
    const other = screeningDate(d.administrativeScreening.submissionDetails.dlp);
    return !!other && sameDay(other, dlp);
  });
  if (!prev) return null;
  const screened = screenedOf(prev);
  return { kind: "RESUBMISSION", earlier: describe(prev), ...(screened ? { screened } : {}) };
}
