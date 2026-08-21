import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cases as casesApi } from "@/services/api/cases";
import { audit as auditApi } from "@/services/api/audit";
import { demoAudit, demoCaseDetails } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser, usePermission, useRole } from "@/lib/auth";
import {
  WORKFLOW_LABELS,
  WORKFLOW_STEPS,
  type CaseDetail,
  type CaseOutcome,
  type FollowUpRequest,
  type WorkflowStep,
} from "@/types/pv";

export const Route = createFileRoute("/_app/cases/$caseId")({
  head: () => ({
    meta: [
      { title: "Case detail — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Full safety case workspace: patient, reporter, product, narrative, seriousness, coding and audit trail.",
      },
      { property: "og:title", content: "Case detail — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Individual case safety report workspace with workflow state and audit history.",
      },
    ],
  }),
  component: CaseDetailPage,
});

const CHANNELS: FollowUpRequest["channel"][] = ["EMAIL", "PHONE", "WHATSAPP"];

function FollowUpItem({
  f,
  canRespond,
  onChanged,
}: {
  f: FollowUpRequest;
  canRespond: boolean;
  onChanged: () => void;
}) {
  const [responding, setResponding] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusPill
          tone={
            f.status === "OVERDUE"
              ? "critical"
              : f.status === "RESPONDED"
                ? "success"
                : f.status === "CLOSED"
                  ? "neutral"
                  : "warning"
          }
        >
          {f.status.toLowerCase()}
        </StatusPill>
        <span>{f.requestedInformation}</span>
        <span className="text-muted-foreground">via {f.channel.toLowerCase()}</span>
        <span className="mono-num ml-auto text-xs text-muted-foreground">
          requested {f.requestedAt.slice(0, 10)} · due {f.dueAt.slice(0, 10)}
        </span>
      </div>

      {f.responseNote ? (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
          <p>{f.responseNote}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {f.respondedBy ?? "Reviewer"} · {f.respondedAt?.slice(0, 10)}
          </p>
        </div>
      ) : null}

      {canRespond && (f.status === "OPEN" || f.status === "OVERDUE") ? (
        responding ? (
          <div className="space-y-2">
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did the reporter/associate confirm? e.g. patient age is 34, batch number BX-1029."
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || note.trim().length === 0}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await casesApi.respondToFollowUp(f.id, note.trim());
                    toast.success("Follow-up marked responded.");
                    setResponding(false);
                    setNote("");
                    onChanged();
                  } catch (err) {
                    toast.error(
                      isNotConfigured(err)
                        ? "Backend not connected — the follow-up was not updated."
                        : "Could not update the follow-up.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save response
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setResponding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setResponding(true)}>
            Mark responded
          </Button>
        )
      ) : null}
    </li>
  );
}

function FollowUpTab({
  caseId,
  requests,
  onChanged,
}: {
  caseId: string;
  requests: FollowUpRequest[];
  onChanged: () => void;
}) {
  const canCreate = usePermission("follow_up.create");
  const [info, setInfo] = useState("");
  const [channel, setChannel] = useState<FollowUpRequest["channel"]>("EMAIL");
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <Section title="Follow-up requests" description="Information requests linked to this case.">
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No follow-up requests recorded for this case.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {requests.map((f) => (
              <FollowUpItem key={f.id} f={f} canRespond={canCreate} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </Section>

      {canCreate ? (
        <Section title="Request information from the reporter">
          <div className="space-y-3">
            <Textarea
              rows={3}
              value={info}
              onChange={(e) => setInfo(e.target.value)}
              placeholder="What information is needed? e.g. patient age, event outcome, batch number…"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                value={channel}
                onChange={(e) => setChannel(e.target.value as FollowUpRequest["channel"])}
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={busy || info.trim().length === 0}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await casesApi.requestFollowUp(caseId, info.trim(), channel);
                    toast.success("Follow-up request recorded.");
                    setInfo("");
                    onChanged();
                  } catch (err) {
                    toast.error(
                      isNotConfigured(err)
                        ? "Backend not connected — no follow-up was recorded."
                        : "Could not record the follow-up request.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Send request
              </Button>
            </div>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

/**
 * Which case-detail tab is most relevant to work on at each workflow step —
 * mirrors how case-management tools like Argus/Vault Safety route a
 * reviewer's attention per stage (triage lands on the seriousness call,
 * coding lands on the coding workspace, QC/closed land on the audit trail
 * to verify what happened). There's no 1:1 tab per step since the tabs are
 * data-entity views, not stage views, so REVIEW and REGULATORY_READY fall
 * back to the full case-data overview.
 */
const WORKFLOW_STEP_TAB: Record<WorkflowStep, string> = {
  INTAKE: "overview",
  TRIAGE: "seriousness",
  CODING: "coding",
  REVIEW: "overview",
  QC: "audit",
  REGULATORY_READY: "overview",
  CLOSED: "audit",
};

function tabForStep(step: WorkflowStep, canCode: boolean): string {
  const tab = WORKFLOW_STEP_TAB[step];
  return tab === "coding" && !canCode ? "overview" : tab;
}

function AdvanceWorkflow({
  caseId,
  currentStep,
  onChanged,
}: {
  caseId: string;
  currentStep: WorkflowStep;
  onChanged: (nextStep: WorkflowStep) => void;
}) {
  const canEdit = usePermission("case.edit");
  const role = useRole();
  const [reason, setReason] = useState("");
  const [advancing, setAdvancing] = useState(false);

  if (!canEdit) return null;

  const idx = WORKFLOW_STEPS.indexOf(currentStep);
  // Field associates hand a case off at Coding — only a coordinator/admin
  // can move it into Review and beyond.
  const roleCapIdx =
    role === "FIELD_ASSOCIATE" ? WORKFLOW_STEPS.indexOf("CODING") : WORKFLOW_STEPS.length - 1;
  const nextStep = idx >= 0 && idx < roleCapIdx ? WORKFLOW_STEPS[idx + 1] : null;

  if (!nextStep) {
    if (role === "FIELD_ASSOCIATE" && idx >= roleCapIdx && idx < WORKFLOW_STEPS.length - 1) {
      return (
        <p className="mt-3 text-sm text-muted-foreground">
          This case is ready for review — a PV Coordinator or Administrator needs to advance it past
          Coding.
        </p>
      );
    }
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        This case has reached the end of the workflow.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <Textarea
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={`Why is this case moving to ${WORKFLOW_LABELS[nextStep]}? e.g. "Triage complete, assigning to coding."`}
      />
      <Button
        size="sm"
        disabled={advancing || reason.trim().length === 0}
        onClick={async () => {
          setAdvancing(true);
          try {
            await casesApi.advanceWorkflow(caseId, nextStep, reason.trim());
            toast.success(`Case moved to ${WORKFLOW_LABELS[nextStep]}.`);
            setReason("");
            onChanged(nextStep);
          } catch (err) {
            toast.error(
              isNotConfigured(err)
                ? "Backend not connected — the case was not moved."
                : "Could not advance the case.",
            );
          } finally {
            setAdvancing(false);
          }
        }}
      >
        Advance to {WORKFLOW_LABELS[nextStep]}
      </Button>
    </div>
  );
}

const SEX_OPTIONS: NonNullable<CaseDetail["patient"]["sex"]>[] = ["MALE", "FEMALE", "UNKNOWN"];
const OUTCOME_OPTIONS: CaseOutcome[] = [
  "RECOVERED",
  "RECOVERING",
  "NOT_RECOVERED",
  "RECOVERED_WITH_SEQUELAE",
  "FATAL",
  "UNKNOWN",
];

/**
 * Lets a field associate act on follow-up feedback without waiting on
 * anyone else: fix the details a reporter/follow-up flagged, then resubmit.
 * Only rendered when the case is still theirs to fix (see canEditThisCase
 * in CaseDetailPage) — coding and seriousness stay on their own tabs since
 * those are separate, already-audited workflows.
 */
function CaseEditForm({ c, onSubmitted }: { c: CaseDetail; onSubmitted: () => void }) {
  const [editing, setEditing] = useState(false);
  const product = c.suspectProducts[0];
  const reaction = c.reactions[0];

  const [patientIdentifier, setPatientIdentifier] = useState(c.patient.identifier);
  const [patientAge, setPatientAge] = useState(c.patient.age ?? "");
  const [patientSex, setPatientSex] = useState(c.patient.sex ?? "UNKNOWN");
  const [patientWeight, setPatientWeight] = useState(c.patient.weightKg ?? "");
  const [patientHistory, setPatientHistory] = useState(c.patient.medicalHistory ?? "");
  const [reporterName, setReporterName] = useState(c.reporter.name);
  const [reporterQualification, setReporterQualification] = useState(c.reporter.qualification);
  const [reporterCountry, setReporterCountry] = useState(c.reporter.country);
  const [reporterContact, setReporterContact] = useState(c.reporter.contact ?? "");
  const [productName, setProductName] = useState(product?.reportedName ?? "");
  const [productDose, setProductDose] = useState(product?.dose ?? "");
  const [productRoute, setProductRoute] = useState(product?.route ?? "");
  const [productIndication, setProductIndication] = useState(product?.indication ?? "");
  const [productTherapyStart, setProductTherapyStart] = useState(product?.therapyStart ?? "");
  const [productAction, setProductAction] = useState(product?.action ?? "");
  const [reactionTerm, setReactionTerm] = useState(reaction?.reportedTerm ?? "");
  const [reactionOnset, setReactionOnset] = useState(reaction?.onsetDate ?? "");
  const [reactionOutcome, setReactionOutcome] = useState<CaseOutcome>(
    reaction?.outcome ?? "UNKNOWN",
  );
  const [narrative, setNarrative] = useState(c.narrative);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        Edit case &amp; resubmit
      </Button>
    );
  }

  async function submit() {
    setSaving(true);
    try {
      await casesApi.updateAndResubmit(
        c.id,
        {
          patient: {
            identifier: patientIdentifier,
            age: patientAge,
            sex: patientSex,
            weightKg: patientWeight,
            medicalHistory: patientHistory,
          },
          reporter: {
            name: reporterName,
            qualification: reporterQualification,
            country: reporterCountry,
            contact: reporterContact,
          },
          product: {
            reportedName: productName,
            dose: productDose,
            route: productRoute,
            indication: productIndication,
            therapyStart: productTherapyStart,
            action: productAction,
          },
          reaction: {
            reportedTerm: reactionTerm,
            onsetDate: reactionOnset,
            outcome: reactionOutcome,
          },
          narrative,
        },
        reason.trim(),
      );
      toast.success("Case updated and resubmitted to Intake.");
      setEditing(false);
      setReason("");
      onSubmitted();
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — the case was not updated."
          : "Could not update the case.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section
      title="Edit case & resubmit"
      description="Update whatever the follow-up flagged, then resubmit — the case goes back to Intake for re-triage."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="label-caps">Patient identifier</label>
          <Input value={patientIdentifier} onChange={(e) => setPatientIdentifier(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Age</label>
          <Input value={patientAge} onChange={(e) => setPatientAge(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Sex</label>
          <select
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={patientSex}
            onChange={(e) => setPatientSex(e.target.value as CaseDetail["patient"]["sex"])}
          >
            {SEX_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="label-caps">Weight (kg)</label>
          <Input value={patientWeight} onChange={(e) => setPatientWeight(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="label-caps">Relevant medical history</label>
          <Textarea
            rows={2}
            value={patientHistory}
            onChange={(e) => setPatientHistory(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <label className="label-caps">Reporter name</label>
          <Input value={reporterName} onChange={(e) => setReporterName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Reporter qualification</label>
          <Input
            value={reporterQualification}
            onChange={(e) => setReporterQualification(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Reporter country</label>
          <Input value={reporterCountry} onChange={(e) => setReporterCountry(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Reporter contact</label>
          <Input value={reporterContact} onChange={(e) => setReporterContact(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label className="label-caps">Suspect product</label>
          <Input value={productName} onChange={(e) => setProductName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Dose</label>
          <Input value={productDose} onChange={(e) => setProductDose(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Route</label>
          <Input value={productRoute} onChange={(e) => setProductRoute(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Indication</label>
          <Input value={productIndication} onChange={(e) => setProductIndication(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Therapy start</label>
          <Input
            value={productTherapyStart}
            onChange={(e) => setProductTherapyStart(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Action taken</label>
          <Input value={productAction} onChange={(e) => setProductAction(e.target.value)} />
        </div>

        <div className="space-y-1">
          <label className="label-caps">Reaction / event term</label>
          <Input value={reactionTerm} onChange={(e) => setReactionTerm(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Onset date</label>
          <Input value={reactionOnset} onChange={(e) => setReactionOnset(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="label-caps">Outcome</label>
          <select
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            value={reactionOutcome}
            onChange={(e) => setReactionOutcome(e.target.value as CaseOutcome)}
          >
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <label className="label-caps">Narrative</label>
        <Textarea rows={4} value={narrative} onChange={(e) => setNarrative(e.target.value)} />
      </div>

      <div className="mt-4 space-y-1">
        <label className="label-caps">
          Reason for resubmission (required, recorded in the audit trail)
        </label>
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Follow-up confirmed patient age and exact onset date."
        />
      </div>

      <div className="mt-4 flex gap-2">
        <Button size="sm" disabled={saving || reason.trim().length === 0} onClick={submit}>
          Save & resubmit to Intake
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </Section>
  );
}

function CaseDetailPage() {
  const { caseId } = Route.useParams();
  const canCode = usePermission("coding.review");
  const currentUser = useCurrentUser();
  const role = useRole();
  const [activeTab, setActiveTab] = useState<string | null>(null);
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
      {(c, source) => {
        // Follows the case's current stage until the reviewer picks a tab
        // by hand; an "Advance" click always jumps it to the new stage's
        // tab regardless of whatever was manually selected before.
        const tab = activeTab ?? tabForStep(c.workflowStep, canCode);
        // A field associate can only fix and resubmit a case they own, and
        // only until review has actually been completed — editable through
        // Review itself, but locked the moment the case moves on to QC (or
        // any stage after), no matter who advanced it there.
        const canEditThisCase =
          role === "FIELD_ASSOCIATE" &&
          c.assignedTo === currentUser?.name &&
          WORKFLOW_STEPS.indexOf(c.workflowStep) < WORKFLOW_STEPS.indexOf("QC");
        return (
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
              <Section
                title="Workflow status"
                description="Each step must be completed by a human owner before the case advances."
              >
                <WorkflowProgress state={c.workflowState} />
                <AdvanceWorkflow
                  caseId={c.id}
                  currentStep={c.workflowStep}
                  onChanged={(nextStep) => {
                    query.refetch();
                    auditQuery.refetch();
                    setActiveTab(tabForStep(nextStep, canCode));
                  }}
                />
              </Section>

              <Tabs value={tab} onValueChange={setActiveTab}>
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
                  {canEditThisCase ? (
                    <CaseEditForm
                      c={c}
                      onSubmitted={() => {
                        query.refetch();
                        auditQuery.refetch();
                        setActiveTab("overview");
                      }}
                    />
                  ) : null}

                  <div className="grid gap-4 xl:grid-cols-2">
                    <Section title="Patient">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Patient identifier" value={c.patient.identifier} mono />
                        <Field label="Age" value={c.patient.age} />
                        <Field label="Sex" value={c.patient.sex?.toLowerCase()} />
                        <Field label="Weight (kg)" value={c.patient.weightKg} mono />
                        <Field
                          label="Relevant medical history"
                          value={c.patient.medicalHistory}
                          className="sm:col-span-2"
                        />
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

                    <Section
                      title={
                        c.suspectProducts.length > 1
                          ? `Suspect products (${c.suspectProducts.length})`
                          : "Suspect product"
                      }
                    >
                      <div className="space-y-4">
                        {c.suspectProducts.map((p, i) => (
                          <div
                            key={i}
                            className={
                              c.suspectProducts.length > 1
                                ? "grid gap-4 rounded-md border border-border p-3 sm:grid-cols-2"
                                : "grid gap-4 sm:grid-cols-2"
                            }
                          >
                            <Field label="Reported name" value={p.reportedName} />
                            <Field label="Active ingredient" value={p.activeIngredient} />
                            <Field label="Dose" value={p.dose} />
                            <Field label="Route" value={p.route} />
                            <Field label="Indication" value={p.indication} />
                            <Field label="Therapy start" value={p.therapyStart} mono />
                            <Field label="Action taken" value={p.action} />
                            <Field label="Batch / lot number" value={p.batchNumber} mono />
                            <Field label="Expiry date" value={p.expiryDate} mono />
                          </div>
                        ))}
                      </div>
                    </Section>

                    {c.concomitantMedicines && c.concomitantMedicines.length > 0 ? (
                      <Section title="Concomitant medications">
                        <div className="space-y-3">
                          {c.concomitantMedicines.map((m, i) => (
                            <div key={i} className="grid gap-4 sm:grid-cols-3">
                              <Field label="Medicine name" value={m.name} />
                              <Field label="Dose" value={m.dose} />
                              <Field label="Indication" value={m.indication} />
                            </div>
                          ))}
                        </div>
                      </Section>
                    ) : null}

                    <Section title="Reaction / event">
                      {c.reactions.map((r, i) => (
                        <div key={i} className="grid gap-4 sm:grid-cols-2">
                          <Field label="Reported term" value={r.reportedTerm} />
                          <Field label="Onset date" value={r.onsetDate} mono />
                          <Field
                            label="Outcome"
                            value={r.outcome.replaceAll("_", " ").toLowerCase()}
                          />
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
                          <StatusPill key={cr} tone="critical">
                            {cr}
                          </StatusPill>
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
                  <FollowUpTab
                    caseId={c.id}
                    requests={c.followUpRequests}
                    onChanged={() => query.refetch()}
                  />
                </TabsContent>

                <TabsContent value="audit" className="mt-4">
                  <Section
                    title="Audit trail"
                    description="Append-only record of regulated actions on this case."
                  >
                    <QueryBoundary query={auditQuery}>
                      {(events) => <AuditTimeline events={events} />}
                    </QueryBoundary>
                  </Section>
                </TabsContent>
              </Tabs>
            </div>
          </>
        );
      }}
    </QueryBoundary>
  );
}
