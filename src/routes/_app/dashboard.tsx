import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, ClipboardPlus, Inbox, Timer } from "lucide-react";
import { cases as casesApi } from "@/services/api/cases";
import { audit as auditApi } from "@/services/api/audit";
import { demoAudit, demoCases, demoFollowUps } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import {
  PageHeader,
  PriorityBadge,
  QueryBoundary,
  Section,
  SeriousnessBadge,
  SourceTag,
  StatusPill,
  WorkflowBadge,
} from "@/components/pv/primitives";
import { AuditTimeline } from "@/components/pv/audit-timeline";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — MedNova PV Assist" },
      { name: "description", content: "Assigned cases, attention items, follow-ups and recent audited activity." },
      { property: "og:title", content: "Dashboard — MedNova PV Assist" },
      { property: "og:description", content: "Daily pharmacovigilance operations overview." },
    ],
  }),
  component: DashboardPage,
});

function Metric({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: number | string;
  tone?: "critical" | "warning" | "default";
  to?: string;
}) {
  const body = (
    <div className="panel px-4 py-3 transition-colors hover:border-primary/40">
      <p className="label-caps">{label}</p>
      <p
        className={
          "mono-num mt-1 text-2xl font-semibold " +
          (tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : "text-foreground")
        }
      >
        {value}
      </p>
    </div>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function DashboardPage() {
  const { user } = useAuth();
  const casesQuery = usePvQuery(["cases"], () => casesApi.list(), () => demoCases);
  const followUpQuery = usePvQuery(["follow-ups"], () => casesApi.followUps(), () => demoFollowUps);
  const auditQuery = usePvQuery(["audit", "recent"], () => auditApi.list({ limit: 6 }), () => demoAudit.slice(0, 5));

  return (
    <>
      <PageHeader
        title={`Good day, ${user?.name ?? "colleague"}`}
        description={`${ROLE_LABELS[user!.role]} workspace — cases assigned to you, items needing attention, and recent audited activity.`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/intake">
                <Inbox className="size-4" /> Inbound intake
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/icsr/new">
                <ClipboardPlus className="size-4" /> New ICSR
              </Link>
            </Button>
          </>
        }
      />

      <div className="space-y-4 p-6">
        <QueryBoundary query={casesQuery} loadingLabel="Loading cases">
          {(all, source) => {
            const mine = all.filter((c) => c.assignedTo === "A. Okafor" || user?.role !== "FIELD_ASSOCIATE");
            const open = mine.filter((c) => c.workflowStep !== "CLOSED");
            const serious = open.filter((c) => c.seriousness === "SERIOUS");
            const attention = open.filter((c) => c.flags.length > 0);
            const overdue = open.filter((c) => new Date(c.dueDate) < new Date("2026-08-15"));
            return (
              <>
                <div className="flex items-center justify-between">
                  <p className="label-caps">Workload</p>
                  <SourceTag source={source} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Metric label="Assigned cases" value={mine.length} to="/cases" />
                  <Metric label="Open" value={open.length} to="/cases" />
                  <Metric label="Serious" value={serious.length} tone="critical" to="/cases" />
                  <Metric label="Needs attention" value={attention.length} tone="warning" to="/cases" />
                  <Metric label="Overdue" value={overdue.length} tone="critical" to="/cases" />
                </div>

                <Section
                  title="Cases requiring attention"
                  description="Assistive flags and expedited items. No case value has been changed automatically."
                  actions={
                    <Button asChild variant="ghost" size="sm">
                      <Link to="/cases">
                        All cases <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  }
                >
                  <ul className="divide-y divide-border">
                    {attention.length === 0 ? (
                      <li className="py-4 text-sm text-muted-foreground">Nothing needs attention.</li>
                    ) : (
                      attention.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                          <Link
                            to="/cases/$caseId"
                            params={{ caseId: c.id }}
                            className="mono-num text-sm font-medium text-primary hover:underline"
                          >
                            {c.id}
                          </Link>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {c.product} · {c.reaction}
                          </span>
                          {c.flags.map((f) => (
                            <StatusPill
                              key={f}
                              tone={f === "OVERDUE" || f === "EXPEDITED" ? "critical" : "warning"}
                              icon={<AlertTriangle className="size-3" />}
                            >
                              {f.replaceAll("_", " ").toLowerCase()}
                            </StatusPill>
                          ))}
                          <SeriousnessBadge value={c.seriousness} />
                          <WorkflowBadge value={c.workflowStep} />
                          <PriorityBadge value={c.priority} />
                        </li>
                      ))
                    )}
                  </ul>
                </Section>
              </>
            );
          }}
        </QueryBoundary>

        <div className="grid gap-4 xl:grid-cols-2">
          <Section
            title="Follow-ups"
            description="Outstanding information requests to reporters."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/follow-ups">
                  Open <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            }
          >
            <QueryBoundary query={followUpQuery}>
              {(items) => (
                <ul className="divide-y divide-border">
                  {items.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-2 py-2.5">
                      <Timer className="size-4 text-muted-foreground" />
                      <Link
                        to="/cases/$caseId"
                        params={{ caseId: f.caseId }}
                        className="mono-num text-sm text-primary hover:underline"
                      >
                        {f.caseId}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {f.requestedInformation}
                      </span>
                      <StatusPill tone={f.status === "OVERDUE" ? "critical" : f.status === "RESPONDED" ? "success" : "warning"}>
                        {f.status.toLowerCase()}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
          </Section>

          <Section
            title="Recent activity"
            description="Audit events recorded for your organisation."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/audit">
                  Audit trail <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            }
          >
            <QueryBoundary query={auditQuery}>{(events) => <AuditTimeline events={events} dense />}</QueryBoundary>
          </Section>
        </div>
      </div>
    </>
  );
}
