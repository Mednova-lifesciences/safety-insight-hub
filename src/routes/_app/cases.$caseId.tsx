import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { cases as casesApi } from "@/services/api/cases";
import { audit as auditApi } from "@/services/api/audit";
import { demoAudit, demoCaseDetails } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import {
  Field,
  PageHeader,
  PriorityBadge,
  QueryBoundary,
  Section,
  SeriousnessBadge,
  SourceTag,
  StatusPill,
  WorkflowProgress,
} from "@/components/pv/primitives";
import { SeriousnessAssist } from "@/components/pv/seriousness-assist";
import { CodingWorkspace } from "@/components/pv/coding-workspace";
import { AuditTimeline } from "@/components/pv/audit-timeline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { usePermission } from "@/lib/auth";

export const Route = createFileRoute("/_app/cases/$caseId")({
  head: () => ({
    meta: [
      { title: "Case detail — MedNova PV Assist" },
      { name: "description", content: "Full safety case workspace: patient, reporter, product, narrative, seriousness, coding and audit trail." },
      { property: "og:title", content: "Case detail — MedNova PV Assist" },
      { property: "og:description", content: "Individual case safety report workspace with workflow state and audit history." },
    ],
  }),
  component: CaseDetailPage,
});

function CaseDetailPage() {
  const { caseId } = Route.useParams();
  const canCode = usePermission("coding.review");
  const query = usePvQuery(
    ["case", caseId],
    () => casesApi.get(caseId),
    () => demoCaseDetails[caseId] ?? Object.values(demoCaseDetails)[0]!,
  );
  const auditQuery = usePvQuery(
    ["audit", "case", caseId],
    () => auditApi.list({ entity: "Case", entityId: caseId }),
    () => demoAudit.filter((a) => a.entityId === caseId),
  );

  return (
    <QueryBoundary query={query} loadingLabel="Loading case">
      {(c, source) => (
        <>
          <PageHeader
            title={c.id}
            description={`${c.product} · ${c.reaction}`}
            meta={
              <>
                <SeriousnessBadge value={c.seriousness} />
                <PriorityBadge value={c.priority} />
                <StatusPill tone="neutral">Patient {c.patientIdentifier}</StatusPill>
                <StatusPill tone="neutral">Received {c.receivedDate}</StatusPill>
                <StatusPill tone={c.dueDate < "2026-08-15" ? "critical" : "neutral"}>
                  Due {c.dueDate}
                </StatusPill>
                <StatusPill tone="neutral">Assigned to {c.assignedTo}</StatusPill>
                <StatusPill tone="info">Source {c.source.toLowerCase()}</StatusPill>
                <SourceTag source={source} />
              </>
            }
            actions={
              <Button asChild variant="outline" size="sm">
                <Link to="/cases">
                  <ArrowLeft className="size-4" /> Back to workbench
                </Link>
              </Button>
            }
          />

          <div className="space-y-4 p-6">
            <Section title="Workflow status" description="Each step must be completed by a human owner before the case advances.">
              <WorkflowProgress state={c.workflowState} />
            </Section>

            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Case data</TabsTrigger>
                <TabsTrigger value="seriousness">Seriousness</TabsTrigger>
                <TabsTrigger value="coding" disabled={!canCode}>
                  Coding
                </TabsTrigger>
                <TabsTrigger value="followup">Follow-up</TabsTrigger>
                <TabsTrigger value="audit">Audit trail</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4 space-y-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <Section title="Patient">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Patient identifier" value={c.patient.identifier} mono />
                      <Field label="Age" value={c.patient.age} />
                      <Field label="Sex" value={c.patient.sex?.toLowerCase()} />
                      <Field label="Weight (kg)" value={c.patient.weightKg} mono />
                      <Field label="Relevant medical history" value={c.patient.medicalHistory} className="sm:col-span-2" />
                    </div>
                  </Section>

                  <Section title="Reporter">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Name" value={c.reporter.name} />
                      <Field label="Qualification" value={c.reporter.qualification} />
                      <Field label="Country" value={c.reporter.country} />
                      <Field label="Contact" value={c.reporter.contact} mono />
                      <Field
                        label="Consent to contact"
                        value={
                          <StatusPill tone={c.reporter.consentToContact ? "success" : "warning"}>
                            {c.reporter.consentToContact ? "Granted" : "Not recorded"}
                          </StatusPill>
                        }
                      />
                    </div>
                  </Section>

                  <Section title="Suspect product">
                    {c.suspectProducts.map((p, i) => (
                      <div key={i} className="grid gap-4 sm:grid-cols-2">
                        <Field label="Reported name" value={p.reportedName} />
                        <Field label="Active ingredient" value={p.activeIngredient} />
                        <Field label="Dose" value={p.dose} />
                        <Field label="Route" value={p.route} />
                        <Field label="Indication" value={p.indication} />
                        <Field label="Therapy start" value={p.therapyStart} mono />
                        <Field label="Action taken" value={p.action} />
                      </div>
                    ))}
                  </Section>

                  <Section title="Reaction / event">
                    {c.reactions.map((r, i) => (
                      <div key={i} className="grid gap-4 sm:grid-cols-2">
                        <Field label="Reported term" value={r.reportedTerm} />
                        <Field label="Onset date" value={r.onsetDate} mono />
                        <Field label="Outcome" value={r.outcome.replaceAll("_", " ").toLowerCase()} />
                        <Field
                          label="Coded term"
                          value={
                            r.codedTerm ? (
                              <span className="mono-num">
                                {r.codedTerm.term} · {r.codedTerm.dictionary} {r.codedTerm.code}
                              </span>
                            ) : (
                              <StatusPill tone="warning">Not yet coded</StatusPill>
                            )
                          }
                        />
                      </div>
                    ))}
                  </Section>
                </div>

                <Section title="Narrative">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{c.narrative}</p>
                </Section>

                <Section title="Seriousness (as reported)">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeriousnessBadge value={c.seriousness} />
                    {c.reportedSeriousnessCriteria.length ? (
                      c.reportedSeriousnessCriteria.map((cr) => (
                        <StatusPill key={cr} tone="critical">{cr}</StatusPill>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        No seriousness criteria recorded by the reporter.
                      </span>
                    )}
                  </div>
                </Section>
              </TabsContent>

              <TabsContent value="seriousness" className="mt-4">
                <SeriousnessAssist caseDetail={c} />
              </TabsContent>

              <TabsContent value="coding" className="mt-4">
                <CodingWorkspace caseId={c.id} />
              </TabsContent>

              <TabsContent value="followup" className="mt-4">
                <Section title="Follow-up" description="Information requests linked to this case.">
                  {c.followUpRequests.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No follow-up requests recorded for this case.{" "}
                      <Link to="/follow-ups" className="text-primary hover:underline">
                        Open the follow-up queue
                      </Link>
                      .
                    </p>
                  ) : null}
                </Section>
              </TabsContent>

              <TabsContent value="audit" className="mt-4">
                <Section title="Audit trail" description="Append-only record of regulated actions on this case.">
                  <QueryBoundary query={auditQuery}>
                    {(events) => <AuditTimeline events={events} />}
                  </QueryBoundary>
                </Section>
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}
    </QueryBoundary>
  );
}
