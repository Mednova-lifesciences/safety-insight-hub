import { CalendarClock } from "lucide-react";
import { usePvQuery } from "@/lib/data-source";
import { psur as psurApi } from "@/services/api/psur";
import { demoPsurDocuments } from "@/services/demo/dataset";
import {
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

/**
 * "PSURs due and overdue" — when each product's next periodic report is
 * due, from what has already been screened. A compliance forecast worked
 * out by date arithmetic, not AI; overdue first.
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
  return (
    <Section
      title="PSURs due and overdue"
      description="Compliance forecast from screened reports: next Data Lock Point (the next-PSUR date the officer recorded, or the last DLP plus the same interval) plus 70 days for intervals up to 12 months, or 90 days beyond. Date arithmetic only — not AI. Where the interval cannot be read, nothing is guessed."
    >
      <QueryBoundary query={docs} loadingLabel="Working out due dates">
        {(items) => {
          const all = forecastPsurs(items);
          const shown = limit ? all.slice(0, limit) : all;
          if (all.length === 0)
            return (
              <EmptyState
                title="Nothing to forecast yet"
                description="Due dates appear once a report has been screened and its outcome recorded."
              />
            );
          return (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    {[
                      "Status",
                      "Product",
                      "MAH",
                      "Next DLP",
                      "Deadline",
                      "MAH record",
                      "Watch for",
                    ].map((h) => (
                      <th key={h} className="label-caps px-3 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr key={f.key} className="border-b border-border align-top last:border-0">
                      <td className="px-3 py-2">
                        <StatusPill
                          tone={TONE[f.status]}
                          icon={<CalendarClock className="size-3" />}
                        >
                          {statusText(f)}
                        </StatusPill>
                        <p className="mt-1 max-w-56 text-xs text-muted-foreground">{f.note}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{f.product}</p>
                        <p className="text-xs text-muted-foreground">
                          Last: DLP {f.basedOn.dlp || "not stated"}
                        </p>
                      </td>
                      <td className="px-3 py-2">{f.mah || "—"}</td>
                      <td className="mono-num px-3 py-2">
                        {f.nextDlp ? showDate(f.nextDlp) : "—"}
                        {f.nextDlpSource ? (
                          <p className="text-xs text-muted-foreground">
                            {f.nextDlpSource === "RECORDED" ? "as recorded" : "same interval"}
                          </p>
                        ) : null}
                      </td>
                      <td className="mono-num px-3 py-2">
                        {f.deadline ? showDate(f.deadline) : "—"}
                        {f.windowDays ? (
                          <p className="text-xs text-muted-foreground">DLP + {f.windowDays} days</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {describeMahHistory(f.mahHistory) || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {f.watchFor.length
                          ? f.watchFor.map((w) => `Item ${w.number}: ${w.label}`).join("; ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {limit && all.length > limit ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Showing {limit} of {all.length}. The full list is on Report screening.
                </p>
              ) : null}
            </div>
          );
        }}
      </QueryBoundary>
    </Section>
  );
}
