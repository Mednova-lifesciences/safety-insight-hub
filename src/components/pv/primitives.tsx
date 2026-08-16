import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Info,
  Loader2,
  PlugZap,
  Sparkles,
} from "lucide-react";
import type { Priority, Seriousness, WorkflowStep, WorkflowStepState } from "@/types/pv";
import { WORKFLOW_LABELS, WORKFLOW_STEPS } from "@/types/pv";
import { isNotConfigured } from "@/services/api/client";

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="border-b border-border bg-card px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
          ) : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="label-caps">{label}</div>
      <div className={cn("mt-1 text-sm text-foreground", mono && "mono-num")}>
        {value === null || value === undefined || value === "" ? (
          <span className="text-muted-foreground">Not provided</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ badges */

const toneStyles = {
  neutral: "bg-muted text-muted-foreground border-border",
  critical: "bg-critical-soft text-critical border-critical/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  success: "bg-success-soft text-success border-success/25",
  info: "bg-info-soft text-info border-info/25",
  assist: "bg-assist-soft text-assist border-assist/25",
} as const;

export type Tone = keyof typeof toneStyles;

export function StatusPill({
  tone = "neutral",
  children,
  className,
  icon,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneStyles[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function SeriousnessBadge({ value }: { value: Seriousness }) {
  if (value === "SERIOUS")
    return (
      <StatusPill tone="critical" icon={<AlertTriangle className="size-3" />}>
        Serious
      </StatusPill>
    );
  if (value === "NON_SERIOUS") return <StatusPill tone="neutral">Non-serious</StatusPill>;
  return <StatusPill tone="warning">Unassessed</StatusPill>;
}

export function PriorityBadge({ value }: { value: Priority }) {
  const tone: Tone = value === "HIGH" ? "critical" : value === "MEDIUM" ? "warning" : "neutral";
  return <StatusPill tone={tone}>{value[0] + value.slice(1).toLowerCase()}</StatusPill>;
}

export function WorkflowBadge({ value }: { value: WorkflowStep }) {
  const tone: Tone =
    value === "CLOSED" ? "neutral" : value === "REGULATORY_READY" ? "success" : "info";
  return <StatusPill tone={tone}>{WORKFLOW_LABELS[value]}</StatusPill>;
}

export function AssistLabel({ children = "AI assistance — requires human confirmation" }: { children?: ReactNode }) {
  return (
    <StatusPill tone="assist" icon={<Sparkles className="size-3" />}>
      {children}
    </StatusPill>
  );
}

/* ------------------------------------------------------- workflow progress */

const stepStateStyles: Record<WorkflowStepState, string> = {
  COMPLETED: "border-success/30 bg-success-soft text-success",
  CURRENT: "border-primary bg-primary text-primary-foreground",
  BLOCKED: "border-critical/30 bg-critical-soft text-critical",
  ACTION_REQUIRED: "border-warning/40 bg-warning-soft text-warning",
  PENDING: "border-border bg-muted text-muted-foreground",
};

const stepStateLabel: Record<WorkflowStepState, string> = {
  COMPLETED: "Completed",
  CURRENT: "Current",
  BLOCKED: "Blocked",
  ACTION_REQUIRED: "Action required",
  PENDING: "Pending",
};

export function WorkflowProgress({
  state,
  compact,
}: {
  state: Record<WorkflowStep, WorkflowStepState>;
  compact?: boolean;
}) {
  return (
    <ol className="flex flex-wrap items-stretch gap-1">
      {WORKFLOW_STEPS.map((step) => {
        const s = state[step] ?? "PENDING";
        return (
          <li
            key={step}
            className={cn(
              "flex min-w-0 flex-1 flex-col rounded-md border px-2.5 py-2",
              stepStateStyles[s],
            )}
          >
            <span className="truncate text-xs font-semibold">{WORKFLOW_LABELS[step]}</span>
            {!compact ? (
              <span className="truncate text-[11px] opacity-80">{stepStateLabel[s]}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------ query states */

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-4 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}…
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-10 text-center">
      <CircleDashed className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function BackendUnavailable({ error }: { error: Error }) {
  const notConfigured = isNotConfigured(error);
  return (
    <div className="rounded-md border border-warning/30 bg-warning-soft px-4 py-4">
      <div className="flex items-start gap-3">
        <PlugZap className="mt-0.5 size-4 text-warning" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {notConfigured ? "Backend not connected" : "Backend request failed"}
          </p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          {notConfigured ? (
            <p className="text-xs text-muted-foreground">
              Clone this project locally, run the FastAPI service that exposes the{" "}
              <code className="mono-num">pv_assist</code> modules, and set{" "}
              <code className="mono-num">VITE_PV_API_BASE_URL</code>. No results are shown until a
              real response is received.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SourceTag({ source }: { source: "live" | "demo" }) {
  return source === "live" ? (
    <StatusPill tone="success" icon={<CheckCircle2 className="size-3" />}>
      Backend result
    </StatusPill>
  ) : (
    <StatusPill tone="info" icon={<Info className="size-3" />}>
      Demo data
    </StatusPill>
  );
}

/** Renders loading / error / content for a usePvQuery result. */
export function QueryBoundary<T>({
  query,
  children,
  loadingLabel,
}: {
  query: { isPending: boolean; error: Error | null; data?: { data: T; source: "live" | "demo" } };
  children: (data: T, source: "live" | "demo") => ReactNode;
  loadingLabel?: string;
}) {
  if (query.isPending) return <LoadingState {...(loadingLabel ? { label: loadingLabel } : {})} />;
  if (query.error) return <BackendUnavailable error={query.error} />;
  if (!query.data) return <EmptyState title="No data returned" />;
  return <>{children(query.data.data, query.data.source)}</>;
}
