import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardPlus,
  FileSpreadsheet,
  FileStack,
  FileText,
  Inbox,
  Sparkles,
  Timer,
} from "lucide-react";
import { cases as casesApi } from "@/services/api/cases";
import { audit as auditApi } from "@/services/api/audit";
import { linelist as linelistApi } from "@/services/api/linelist";
import { psur as psurApi } from "@/services/api/psur";
import {
  demoAudit,
  demoCases,
  demoFollowUps,
  demoLineListJobs,
  demoPsurDocuments,
} from "@/services/demo/dataset";
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
      {
        name: "description",
        content: "Assigned cases, attention items, follow-ups and recent audited activity.",
      },
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
          (tone === "critical"
            ? "text-critical"
            : tone === "warning"
              ? "text-warning"
              : "text-foreground")
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
  switch (user?.role) {
    case "FIELD_ASSOCIATE":
      return <FieldAssociateDashboard />;
    case "PV_COORDINATOR":
      return <CoordinatorDashboard />;
    case "PV_MANAGER":
      return <AdminDashboard />;
    case "ADMIN":
      return <AdministratorProcessingDashboard />;
    default:
      return <FieldAssociateDashboard />;
  }
}

function CoordinatorDashboard() {
  const { user } = useAuth();
  const casesQuery = usePvQuery(
    ["cases"],
    () => casesApi.list(),
    () => demoCases,
  );
  const auditQuery = usePvQuery(
    ["audit", "recent"],
    () => auditApi.list({ limit: 6 }),
    () => demoAudit.slice(0, 5),
  );
  return (
    <>
      <PageHeader
        title="Coordinator queue"
        description={`${user?.name ?? "Coordinator"} — process, code and validate the organisation's incoming cases.`}
      />
      <div className="space-y-4 p-6">
        <QueryBoundary query={casesQuery} loadingLabel="Loading coordinator queue">
          {(items, source) => {
            const coding = items.filter((item) => item.workflowStep === "CODING").length;
            const review = items.filter((item) => item.workflowStep === "REVIEW").length;
            return (
              <>
                <div className="flex items-center justify-between">
                  <p className="label-caps">Processing queue</p>
                  <SourceTag source={source} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Cases in queue" value={items.length} to="/cases" />
                  <Metric label="Coding backlog" value={coding} tone="warning" to="/cases" />
                  <Metric label="Awaiting review" value={review} to="/cases" />
                </div>
              </>
            );
          }}
        </QueryBoundary>
        <div className="grid gap-4 xl:grid-cols-2">
          <Section
            title="Coordinator actions"
            description="Workflows available to the processing team."
          >
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/line-list">Process line-list</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/e2b">Prepare E2B(R3)</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/psur">Review PSUR</Link>
              </Button>
            </div>
          </Section>
          <Section title="Recent activity">
            <QueryBoundary query={auditQuery}>
              {(events) => <AuditTimeline events={events} dense />}
            </QueryBoundary>
          </Section>
        </div>
      </div>
    </>
  );
}

function AdminDashboard() {
  const { user } = useAuth();
  const auditQuery = usePvQuery(
    ["audit", "recent"],
    () => auditApi.list({ limit: 8 }),
    () => demoAudit,
  );
  return (
    <>
      <PageHeader
        title="Administration dashboard"
        description={`${user?.name ?? "Administrator"} — system-wide access, audit and operational controls.`}
      />
      <div className="space-y-4 p-6">
        <Section
          title="Administrative controls"
          description="Review the complete operational surface with server-side authorization."
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/oversight">Operational overview</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/audit">Full audit trail</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/cases">All cases</Link>
            </Button>
          </div>
        </Section>
        <Section title="Recent audit activity">
          <QueryBoundary query={auditQuery}>
            {(events) => <AuditTimeline events={events} dense />}
          </QueryBoundary>
        </Section>
      </div>
    </>
  );
}

/**
 * The Administrator's dashboard — deliberately scoped to match the
 * Administrator's trimmed sidebar (Intelligent Intake + the three
 * processing tools, nothing else): a snapshot of what's moved through
 * line-list/E2B(R3) and PSUR processing, not the full operational
 * surface PV_MANAGER sees in AdminDashboard above.
 */
function AdministratorProcessingDashboard() {
  const { user } = useAuth();
  const jobsQuery = usePvQuery(
    ["linelist", "jobs"],
    () => linelistApi.jobs(),
    () => demoLineListJobs,
  );
  const docsQuery = usePvQuery(
    ["psur", "documents"],
    () => psurApi.documents(),
    () => demoPsurDocuments,
  );
  const auditQuery = usePvQuery(
    ["audit", "recent"],
    () => auditApi.list({ limit: 8 }),
    () => demoAudit,
  );

  return (
    <>
      <PageHeader
        title="Administration dashboard"
        description={`${user?.name ?? "Administrator"} — intelligent intake and processing overview.`}
        actions={
          <Button asChild size="sm">
            <Link to="/icsr/new">
              <Sparkles className="size-4" /> Intelligent Intake
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <QueryBoundary query={jobsQuery} loadingLabel="Loading processing overview">
          {(jobs, source) => {
            const e2bReady = jobs.filter((j) => j.stage === "E2B_GENERATED").length;
            const validated = jobs.filter((j) => j.stage === "VALIDATED").length;
            const inProgress = jobs.length - e2bReady - validated;
            const validCases = jobs.reduce((sum, j) => sum + j.validCases, 0);
            return (
              <>
                <div className="flex items-center justify-between">
                  <p className="label-caps">Line-list &amp; E2B(R3) processing</p>
                  <SourceTag source={source} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Line-lists uploaded" value={jobs.length} to="/line-list" />
                  <Metric
                    label="Awaiting validation"
                    value={inProgress}
                    tone={inProgress > 0 ? "warning" : "default"}
                    to="/line-list"
                  />
                  <Metric label="E2B(R3) ready" value={e2bReady} to="/e2b" />
                  <Metric label="Case records validated" value={validCases} to="/line-list" />
                </div>
              </>
            );
          }}
        </QueryBoundary>

        <QueryBoundary query={docsQuery} loadingLabel="Loading PSUR overview">
          {(docs, source) => {
            const reviewed = docs.filter((d) => d.stage === "REVIEWED").length;
            const pending = docs.length - reviewed;
            return (
              <>
                <div className="flex items-center justify-between">
                  <p className="label-caps">PSUR / PBRER review</p>
                  <SourceTag source={source} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="PSUR documents" value={docs.length} to="/psur" />
                  <Metric
                    label="Pending review"
                    value={pending}
                    tone={pending > 0 ? "warning" : "default"}
                    to="/psur"
                  />
                  <Metric label="Reviewed" value={reviewed} to="/psur" />
                </div>
              </>
            );
          }}
        </QueryBoundary>

        <div className="grid gap-4 xl:grid-cols-2">
          <Section
            title="Processing tools"
            description="The same tools available from the sidebar."
          >
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/line-list">
                  <FileSpreadsheet className="size-4" /> Line-list processing
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/e2b">
                  <FileStack className="size-4" /> E2B(R3) preparation
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/psur">
                  <FileText className="size-4" /> PSUR / PBRER review
                </Link>
              </Button>
            </div>
          </Section>
          <Section title="Recent processing activity">
            <QueryBoundary query={auditQuery}>
              {(events) => <AuditTimeline events={events} dense />}
            </QueryBoundary>
          </Section>
        </div>
      </div>
    </>
  );
}

function FieldAssociateDashboard() {
  const { user } = useAuth();
  const casesQuery = usePvQuery(
    ["cases"],
    () => casesApi.list(),
    () => demoCases,
  );
  const followUpQuery = usePvQuery(
    ["follow-ups"],
    () => casesApi.followUps(),
    () => demoFollowUps,
  );
  const auditQuery = usePvQuery(
    ["audit", "recent"],
    () => auditApi.list({ limit: 6 }),
    () => demoAudit.slice(0, 5),
  );

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
            const mine = all.filter(
              (c) => c.assignedTo === user?.name || user?.role !== "FIELD_ASSOCIATE",
            );
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
                  <Metric
                    label="Needs attention"
                    value={attention.length}
                    tone="warning"
                    to="/cases"
                  />
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
                      <li className="py-4 text-sm text-muted-foreground">
                        Nothing needs attention.
                      </li>
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
                      <StatusPill
                        tone={
                          f.status === "OVERDUE"
                            ? "critical"
                            : f.status === "RESPONDED"
                              ? "success"
                              : "warning"
                        }
                      >
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
            <QueryBoundary query={auditQuery}>
              {(events) => <AuditTimeline events={events} dense />}
            </QueryBoundary>
          </Section>
        </div>
      </div>
    </>
  );
}
