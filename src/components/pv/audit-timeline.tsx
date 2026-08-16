import type { AuditEvent } from "@/types/pv";
import { StatusPill } from "./primitives";
import { cn } from "@/lib/utils";

function formatTs(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** Reusable audit timeline. Every regulated action recorded by the backend
 *  audit module (pv_assist.audit) renders through this component. */
export function AuditTimeline({
  events,
  dense,
  className,
}: {
  events: AuditEvent[];
  dense?: boolean;
  className?: string;
}) {
  if (events.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No audit events recorded.
      </p>
    );
  }
  return (
    <ol className={cn("relative space-y-0", className)}>
      {events.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 pl-1">
          <div className="flex flex-col items-center">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
            {i < events.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
          </div>
          <div className={cn("min-w-0 flex-1", dense ? "pb-4" : "pb-5")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono-num text-xs text-muted-foreground">{formatTs(e.timestamp)}</span>
              <StatusPill tone="info">{e.action.replaceAll("_", " ").toLowerCase()}</StatusPill>
              <span className="text-xs text-muted-foreground">
                {e.entity} · <span className="mono-num">{e.entityId}</span>
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground">
              {e.user} <span className="text-muted-foreground">({e.role})</span>
            </p>
            {e.previousValue || e.newValue ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {e.previousValue ? (
                  <>
                    <span className="label-caps">from</span>{" "}
                    <span className="text-foreground">{e.previousValue}</span>{" "}
                  </>
                ) : null}
                {e.newValue ? (
                  <>
                    <span className="label-caps">to</span>{" "}
                    <span className="text-foreground">{e.newValue}</span>
                  </>
                ) : null}
              </p>
            ) : null}
            {e.reason ? (
              <p className="mt-1 text-xs text-muted-foreground">Reason: {e.reason}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
