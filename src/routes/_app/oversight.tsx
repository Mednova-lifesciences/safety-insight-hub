import { Link, createFileRoute } from "@tanstack/react-router";
import { PermissionGate } from "@/components/pv/permission-gate";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cases as casesApi } from "@/services/api/cases";
import { signals as signalsApi } from "@/services/api/signals";
import { audit as auditApi } from "@/services/api/audit";
import { psur as psurApi } from "@/services/api/psur";
import {
  demoAudit,
  demoCases,
  demoPsurDocuments,
  demoSignals,
} from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import {
  PageHeader,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
} from "@/components/pv/primitives";
import { AuditTimeline } from "@/components/pv/audit-timeline";
import { WORKFLOW_LABELS, WORKFLOW_STEPS } from "@/types/pv";

export const Route = createFileRoute("/_app/oversight")({
  head: () => ({
    meta: [
      { title: "Operational overview — MedNova PV Assist" },
      { name: "description", content: "Manager view of case volume, serious and overdue cases, coding backlog, signals and audit activity." },
      { property: "og:title", content: "Operational overview — MedNova PV Assist" },
      { property: "og:description", content: "Pharmacovigilance operations oversight and drill-down." },
    ],
  }),
  component: () => (
    <PermissionGate permission="team.view">
      <OversightPage />
    </PermissionGate>
  ),
});

function Metric({ label, value, tone, to }: { label: string; value: number; tone?: string; to?: string }) {
  const inner = (
    <div className="panel px-4 py-3 transition-colors hover:border-primary/40">
      <p className="label-caps">{label}</p>
      <p className={`mono-num mt-1 text-2xl font-semibold ${tone ?? "text-foreground"}`}>{value}</p>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function OversightPage() {
  const casesQuery = usePvQuery(["cases"], () => casesApi.list(), () => demoCases);
  const signalsQuery = usePvQuery(["signals"], () => signalsApi.list(), () => demoSignals);
  const auditQuery = usePvQuery(["audit", "recent"], () => auditApi.list({ limit: 8 }), () => demoAudit);
  const psurQuery = usePvQuery(["psur", "documents"], () => psurApi.documents(), () => demoPsurDocuments);

  return (
    <>
      <PageHeader
        title="Operational overview"
        description="Portfolio-level view of safety operations. Every figure is drillable to the underlying records."
        meta={casesQuery.data ? <SourceTag source={casesQuery.data.source} /> : null}
      />

      <div className="space-y-4 p-6">
        <QueryBoundary query={casesQuery} loadingLabel="Loading operational data">
          {(all) => {
            const open = all.filter((c) => c.workflowStep !== "CLOSED");
            const byStep = WORKFLOW_STEPS.map((s) => ({
              step: WORKFLOW_LABELS[s],
              count: all.filter((c) => c.workflowStep === s).length,
            }));
            const seriousSplit = [
              { name: "Serious", value: all.filter((c) => c.seriousness === "SERIOUS").length },
              { name: "Non-serious", value: all.filter((c) => c.seriousness === "NON_SERIOUS").length },
              { name: "Unassessed", value: all.filter((c) => c.seriousness === "UNASSESSED").length },
            ];
            const colours = ["var(--critical)", "var(--chart-2)", "var(--warning)"];
            return (
              <>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  <Metric label="Total cases" value={all.length} to="/cases" />
                  <Metric label="Open" value={open.length} to="/cases" />
                  <Metric label="Serious" value={all.filter((c) => c.seriousness === "SERIOUS").length} tone="text-critical" to="/cases" />
                  <Metric
                    label="Overdue"
                    value={open.filter((c) => c.dueDate < "2026-08-15").length}
                    tone="text-critical"
                    to="/cases"
                  />
                  <Metric label="Awaiting review" value={all.filter((c) => c.workflowStep === "REVIEW").length} to="/cases" />
                  <Metric label="Coding backlog" value={all.filter((c) => c.workflowStep === "CODING").length} tone="text-warning" to="/cases" />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Section title="Cases by workflow step">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={byStep} margin={{ top: 8, right: 8, bottom: 8, left: -18 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                          <XAxis dataKey="step" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" interval={0} angle={-18} dy={8} height={48} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                          <Tooltip cursor={{ fill: "var(--muted)" }} />
                          <Bar dataKey="count" fill="var(--primary)" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Section>

                  <Section title="Seriousness distribution">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={seriousSplit} dataKey="value" nameKey="name" innerRadius={54} outerRadius={88} paddingAngle={2}>
                            {seriousSplit.map((_, i) => (
                              <Cell key={i} fill={colours[i]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {seriousSplit.map((s, i) => (
                        <span key={s.name} className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-sm" style={{ background: colours[i] }} /> {s.name} ({s.value})
                        </span>
                      ))}
                    </div>
                  </Section>
                </div>

                <Section title="Seriousness flags" description="Assistive mismatches awaiting human review.">
                  <ul className="divide-y divide-border">
                    {all
                      .filter((c) => c.flags.includes("SERIOUSNESS_MISMATCH"))
                      .map((c) => (
                        <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                          <Link to="/cases/$caseId" params={{ caseId: c.id }} className="mono-num text-sm text-primary hover:underline">
                            {c.id}
                          </Link>
                          <span className="min-w-0 flex-1 truncate text-sm">{c.product} · {c.reaction}</span>
                          <StatusPill tone="warning">Pending review</StatusPill>
                        </li>
                      ))}
                    {all.filter((c) => c.flags.includes("SERIOUSNESS_MISMATCH")).length === 0 ? (
                      <li className="py-3 text-sm text-muted-foreground">No open seriousness flags.</li>
                    ) : null}
                  </ul>
                </Section>
              </>
            );
          }}
        </QueryBoundary>

        <div className="grid gap-4 xl:grid-cols-2">
          <Section title="Signals" description="Drill into the signal workspace for evidence and decisions.">
            <QueryBoundary query={signalsQuery}>
              {(items) => (
                <ul className="divide-y divide-border">
                  {items.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
                      <span className="mono-num text-sm">{s.reference}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{s.product} / {s.reaction}</span>
                      <StatusPill tone={s.status === "CONFIRMED" ? "critical" : s.status === "POTENTIAL" ? "warning" : s.status === "UNDER_REVIEW" ? "info" : "neutral"}>
                        {s.status.replaceAll("_", " ").toLowerCase()}
                      </StatusPill>
                      <Link to="/signals" className="text-sm text-primary hover:underline">Open</Link>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
          </Section>

          <Section title="PSUR / PBRER reviews">
            <QueryBoundary query={psurQuery}>
              {(items) => (
                <ul className="divide-y divide-border">
                  {items.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 py-2.5">
                      <span className="text-sm">{d.product}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{d.reportingPeriod}</span>
                      <StatusPill tone={d.stage === "REVIEWED" ? "success" : "info"}>{d.stage.toLowerCase()}</StatusPill>
                      <Link to="/psur" className="text-sm text-primary hover:underline">Open</Link>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
          </Section>
        </div>

        <Section title="Recent audit activity">
          <QueryBoundary query={auditQuery}>{(events) => <AuditTimeline events={events} dense />}</QueryBoundary>
        </Section>
      </div>
    </>
  );
}
