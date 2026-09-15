import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
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
import { countByStage } from "@/services/psur/workflow";
import type { PsurWorkflowStage } from "@/types/pv";

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
    case "REVIEW_OFFICER":
      return <ReviewOfficerDashboard />;
    case "EVALUATOR":
      return <EvaluatorDashboard />;
    case "PEER_REVIEWER":
      return <PeerReviewerDashboard />;
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
/**
 * NAFDAC's three assessor dashboards.
 *
 * One report passes through three people in sequence, so each of them needs
 * to see the same pipeline from a different position in it: the officer
 * cares about what has not been triaged yet, the evaluator about what has
 * been handed to them, the peer reviewer about what is waiting to be
 * countersigned. Three components rather than one parameterised component,
 * because the counts they show are not the same measurement with a filter
 * swapped — they answer different questions.
 *
 * Every count is derived in-memory from the one documents query, the way
 * every other dashboard here already works. Counts are QUEUE-wide, not
 * per-person: queues are shared, so "peer reviewed" means "reviewed by a
 * peer reviewer", not "reviewed by you". Attributing them to individuals
 * would mean trusting the typed-in name in Section 13, which is a
 * signature rather than an identity.
 */
function AssessorMetrics({
  children,
  label,
}: {
  children: (counts: Record<PsurWorkflowStage, number>, total: number) => ReactNode;
  label: string;
}) {
  const docsQuery = usePvQuery(
    ["psur", "documents"],
    () => psurApi.documents(),
    () => demoPsurDocuments,
  );
  return (
    <QueryBoundary query={docsQuery} loadingLabel={label}>
      {(docs, source) => (
        <>
          <div className="flex items-center justify-between">
            <p className="label-caps">PSUR / PBRER pipeline</p>
            <SourceTag source={source} />
          </div>
          {children(countByStage(docs), docs.length)}
        </>
      )}
    </QueryBoundary>
  );
}

/** Shared by all three: the same recent-activity panel, same query. */
function AssessorActivity() {
  const auditQuery = usePvQuery(
    ["audit", "recent"],
    () => auditApi.list({ limit: 8 }),
    () => demoAudit,
  );
  return (
    <Section title="Recent activity">
      <QueryBoundary query={auditQuery}>
        {(events) => <AuditTimeline events={events} dense />}
      </QueryBoundary>
    </Section>
  );
}

function ReviewOfficerDashboard() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        title="Screening queue"
        description={`${user?.name ?? "Review Officer"} — triage incoming periodic reports and decide what goes forward for scientific review.`}
        actions={
          <Button asChild size="sm">
            <Link to="/screening">
              <ClipboardCheck className="size-4" /> Open screening queue
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <AssessorMetrics label="Loading screening overview">
          {(counts, total) => (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Awaiting screening"
                value={counts.SCREENING}
                tone={counts.SCREENING > 0 ? "warning" : "default"}
                to="/screening"
              />
              <Metric
                label="Sent for scientific review"
                value={
                  counts.AWAITING_EVALUATION + counts.AWAITING_PEER_REVIEW + counts.PEER_REVIEWED
                }
                to="/psur"
              />
              <Metric label="Returned to MAH" value={counts.RETURNED_TO_MAH} to="/screening" />
              <Metric label="Reports received" value={total} to="/screening" />
            </div>
          )}
        </AssessorMetrics>
        <AssessorActivity />
      </div>
    </>
  );
}

function EvaluatorDashboard() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        title="Scientific review queue"
        description={`${user?.name ?? "Evaluator"} — assess periodic reports against the NAFDAC template and hand them on for peer review.`}
        actions={
          <Button asChild size="sm">
            <Link to="/psur">
              <FileText className="size-4" /> Open review queue
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <AssessorMetrics label="Loading review overview">
          {(counts) => (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Sent for evaluation"
                value={counts.AWAITING_EVALUATION}
                tone={counts.AWAITING_EVALUATION > 0 ? "warning" : "default"}
                to="/psur"
              />
              <Metric
                label="Evaluated, awaiting peer review"
                value={counts.AWAITING_PEER_REVIEW}
                to="/psur"
              />
              <Metric label="Peer reviewed" value={counts.PEER_REVIEWED} to="/psur" />
              <Metric label="Returned to MAH at screening" value={counts.RETURNED_TO_MAH} />
            </div>
          )}
        </AssessorMetrics>
        <AssessorActivity />
      </div>
    </>
  );
}

function PeerReviewerDashboard() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        title="Peer review queue"
        description={`${user?.name ?? "Peer Reviewer"} — check completed scientific reviews and countersign the final sign-off.`}
        actions={
          <Button asChild size="sm">
            <Link to="/psur">
              <FileText className="size-4" /> Open peer review queue
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <AssessorMetrics label="Loading peer review overview">
          {(counts) => (
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric
                label="Awaiting peer review"
                value={counts.AWAITING_PEER_REVIEW}
                tone={counts.AWAITING_PEER_REVIEW > 0 ? "warning" : "default"}
                to="/psur"
              />
              <Metric label="Peer reviewed" value={counts.PEER_REVIEWED} to="/psur" />
              <Metric
                label="In scientific review"
                value={counts.AWAITING_EVALUATION + counts.AWAITING_PEER_REVIEW}
                to="/psur"
              />
            </div>
          )}
        </AssessorMetrics>
        <AssessorActivity />
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
