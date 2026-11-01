import { Fragment, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { usePvQuery } from "@/lib/data-source";
import { psur as psurApi } from "@/services/api/psur";
import { demoPsurDocuments } from "@/services/demo/dataset";
import {
  ARRIVAL_LABELS,
  FORECAST_STATUS_LABELS,
  describeMahHistory,
  forecastPsurs,
  type ForecastStatus,
  type PsurForecast,
} from "@/services/psur/psur-calendar";
import { showDate } from "@/services/psur/ibd-register";
import {
  EmptyState,
  QueryBoundary,
  Section,
  StatusPill,
  type Tone,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TONE: Record<ForecastStatus, Tone> = {
  OVERDUE: "critical",
  DUE_NOW: "warning",
  DUE_IN: "info",
  RECEIVED: "success",
  CANNOT_FORECAST: "neutral",
};

function statusText(f: PsurForecast): string {
  if (f.status === "DUE_IN") return `Due in ${f.daysToDeadline} day(s)`;
  if (f.status === "OVERDUE") return `Overdue by ${-(f.daysToDeadline ?? 0)} day(s)`;
  return FORECAST_STATUS_LABELS[f.status];
}

const COLUMNS = ["", "Status", "Product", "Next DLP", "Deadline", ""];

/** The latest report waiting that is NOT the next one (that one already
 *  shows as "Next report received"), to note under the status. */
const waiting = (f: PsurForecast) =>
  f.status === "RECEIVED" ? undefined : f.arrivals.filter((a) => a.kind !== "NEXT").at(-1);

const ARRIVAL_EXPLAINED: Record<PsurForecast["arrivals"][number]["kind"], string> = {
  NEXT: "the next report: its Data Lock Point is later than the one screened.",
  RESUBMISSION:
    "a corrected or repeated copy of the report already screened (same Data Lock Point), not the next one. The next report is still due.",
  SAME_FILE: "exactly the same file as one already uploaded, whatever it is called.",
  EARLIER_PERIOD: "for an earlier period than the report already screened, so not the next one.",
  PERIOD_UNCONFIRMED:
    "its Data Lock Point could not be read, so it is not counted as the next report until it is screened.",
};

/**
 * "PSURs due and overdue" — when each product's next periodic report is
 * due, from what has already been screened. A compliance forecast worked
 * out by date arithmetic, not AI; overdue first.
 *
 * Each reminder is one compact row (status, product, next DLP, deadline);
 * the rest opens when the row is expanded. A reminder can be dismissed for
 * the organisation — until its deadline changes or a newer report is
 * screened — and restored from "Show dismissed". Both are audited.
 *
 * Reads the same report list the dashboard and screening queue already
 * load (same query key), so it adds no request of its own.
 */
export function PsurForecastCard({ limit }: { limit?: number }) {
  const docs = usePvQuery(
    ["psur", "documents"],
    () => psurApi.documents(),
    () => demoPsurDocuments,
  );
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["psur", "documents"] });

  async function dismiss(f: PsurForecast) {
    setBusy(f.key);
    try {
      await psurApi.dismissForecast(
        f.basedOn.documentId,
        { product: f.product, status: f.status, deadline: f.deadline },
        reason,
      );
      toast.success(`Reminder for ${f.product} dismissed.`);
      setConfirming(null);
      setReason("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not dismiss the reminder.");
    } finally {
      setBusy(null);
    }
  }

  async function restore(f: PsurForecast) {
    setBusy(f.key);
    try {
      await psurApi.restoreForecast(f.basedOn.documentId, f.product);
      toast.success(`Reminder for ${f.product} restored.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not restore the reminder.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title="PSURs due and overdue"
      description="Compliance forecast from screened reports: next Data Lock Point (the next-PSUR date the officer recorded, or the last DLP plus the same interval) plus 70 days for intervals up to 12 months, or 90 days beyond. Date arithmetic only — not AI. Where the interval cannot be read, nothing is guessed."
    >
      <QueryBoundary query={docs} loadingLabel="Working out due dates">
        {(items) => {
          const all = forecastPsurs(items);
          const active = all.filter((f) => !f.dismissal);
          const dismissed = all.filter((f) => f.dismissal);
          const shown = limit ? active.slice(0, limit) : active;
          if (all.length === 0)
            return (
              <EmptyState
                title="Nothing to forecast yet"
                description="Due dates appear once a report has been screened and its outcome recorded."
              />
            );

          const row = (f: PsurForecast) => {
            const isOpen = open.has(f.key);
            const muted = !!f.dismissal;
            return (
              <Fragment key={f.key}>
                <tr
                  className={cn(
                    "cursor-pointer border-b border-border hover:bg-muted/40",
                    isOpen && "bg-muted/30",
                    muted && "text-muted-foreground",
                  )}
                  onClick={() => toggle(f.key)}
                >
                  <td className="w-8 px-2 py-2">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} details for ${f.product}`}
                      className="flex size-6 items-center justify-center rounded hover:bg-muted"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(f.key);
                      }}
                    >
                      <ChevronRight
                        className={cn("size-4 transition-transform", isOpen && "rotate-90")}
                      />
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill
                      tone={muted ? "neutral" : TONE[f.status]}
                      icon={<CalendarClock className="size-3" />}
                    >
                      {statusText(f)}
                    </StatusPill>
                    {waiting(f) ? (
                      <p className="mt-1 text-xs text-info" data-e2e-arrival={waiting(f)!.kind}>
                        {ARRIVAL_LABELS[waiting(f)!.kind]}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-medium">{f.product}</td>
                  <td className="mono-num px-3 py-2">{f.nextDlp ? showDate(f.nextDlp) : "—"}</td>
                  <td className="mono-num px-3 py-2">{f.deadline ? showDate(f.deadline) : "—"}</td>
                  <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {muted ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === f.key}
                        onClick={() => restore(f)}
                      >
                        <RotateCcw className="size-3.5" /> Restore
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Dismiss the reminder for ${f.product}`}
                        disabled={busy === f.key}
                        onClick={() => {
                          setConfirming(f.key);
                          setReason("");
                        }}
                      >
                        <X className="size-3.5" /> Dismiss
                      </Button>
                    )}
                  </td>
                </tr>
                {confirming === f.key ? (
                  <tr className="border-b border-border bg-warning-soft/40">
                    <td />
                    <td colSpan={COLUMNS.length - 1} className="space-y-2 px-3 py-3">
                      <p className="text-sm">
                        Dismiss the reminder for <span className="font-medium">{f.product}</span>{" "}
                        for everyone in your organisation? It comes back if the deadline changes or
                        a newer report is screened, and the dismissal is recorded in the audit
                        trail.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="max-w-md"
                          placeholder="Reason (optional), e.g. product withdrawn from the market"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void dismiss(f);
                            if (e.key === "Escape") setConfirming(null);
                          }}
                        />
                        <Button size="sm" disabled={busy === f.key} onClick={() => dismiss(f)}>
                          {busy === f.key ? "Dismissing…" : "Dismiss reminder"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {isOpen ? (
                  <tr className="border-b border-border bg-muted/20">
                    <td />
                    <td colSpan={COLUMNS.length - 1} className="px-3 py-3">
                      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                        <Detail label="Why">{f.note}</Detail>
                        {f.arrivals.length ? (
                          <Detail label="Waiting to be screened" wide>
                            <ul className="space-y-0.5">
                              {f.arrivals.map((a) => (
                                <li key={a.documentId}>
                                  {a.filename}
                                  {a.dlp ? ` (DLP ${a.dlp})` : ""} —{" "}
                                  <span className="text-muted-foreground">
                                    {ARRIVAL_EXPLAINED[a.kind]}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </Detail>
                        ) : null}
                        <Detail label="MAH">{f.mah || "—"}</Detail>
                        <Detail label="Based on">
                          {f.basedOn.filename}
                          <span className="block text-xs text-muted-foreground">
                            Last DLP {f.basedOn.dlp || "not stated"}
                          </span>
                        </Detail>
                        <Detail label="Next DLP">
                          {f.nextDlp ? showDate(f.nextDlp) : "—"}
                          {f.nextDlpSource ? (
                            <span className="block text-xs text-muted-foreground">
                              {f.nextDlpSource === "RECORDED"
                                ? "as recorded by the officer"
                                : "last DLP plus the same interval"}
                            </span>
                          ) : null}
                        </Detail>
                        <Detail label="Deadline">
                          {f.deadline ? showDate(f.deadline) : "—"}
                          {f.windowDays ? (
                            <span className="block text-xs text-muted-foreground">
                              DLP + {f.windowDays} days
                            </span>
                          ) : null}
                        </Detail>
                        <Detail label="MAH record">
                          {describeMahHistory(f.mahHistory) || "—"}
                        </Detail>
                        <Detail label="Watch for" wide>
                          {f.watchFor.length
                            ? f.watchFor.map((w) => `Item ${w.number}: ${w.label}`).join("; ")
                            : "—"}
                        </Detail>
                        {f.dismissal ? (
                          <Detail label="Dismissed" wide>
                            By {f.dismissal.by} on {showDate(f.dismissal.at.slice(0, 10))}
                            {f.dismissal.reason ? ` — ${f.dismissal.reason}` : ""}
                          </Detail>
                        ) : null}
                      </dl>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          };

          return (
            <div className="space-y-2">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-left">
                      {COLUMNS.map((h, i) => (
                        <th key={i} className="label-caps px-3 py-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(row)}
                    {active.length === 0 ? (
                      <tr>
                        <td colSpan={COLUMNS.length} className="px-3 py-4 text-muted-foreground">
                          Every reminder has been dismissed.
                        </td>
                      </tr>
                    ) : null}
                    {showDismissed ? dismissed.map(row) : null}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {limit && active.length > limit ? (
                  <span>
                    Showing {limit} of {active.length}. The full list is on Report screening.
                  </span>
                ) : null}
                {dismissed.length ? (
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => setShowDismissed((v) => !v)}
                  >
                    {showDismissed ? "Hide" : "Show"} dismissed ({dismissed.length})
                  </button>
                ) : null}
              </div>
            </div>
          );
        }}
      </QueryBoundary>
    </Section>
  );
}

function Detail({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn(wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="label-caps mb-0.5 text-[11px]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
