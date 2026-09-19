import { Link, createFileRoute } from "@tanstack/react-router";
import { PermissionGate } from "@/components/pv/permission-gate";
import { useEffect, useState } from "react";
import { Download, FileStack, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { e2b as e2bApi } from "@/services/api/e2b";
import {
  runValidatedPreflightForJob,
  generateValidatedExportForJob,
  downloadValidatedBatch,
  type ValidatedExportResult,
} from "@/services/e2b-r3/export";
import {
  finalizeC17Assessment,
  finalizeC17AssessmentsBulk,
  latestC17AssessmentsByCase,
  listC17AiAssessments,
  listC17Assessments,
  pendingC17AssessmentIds,
} from "@/services/e2b-r3/assessment";
import type { E2bRegulatoryAssessment } from "@/services/e2b-r3/assessment-types";
import type { C17AiAssessmentRecord } from "@/services/e2b-r3/ai-assessment-types";
import { aiAssessmentCanApplyTo } from "@/services/e2b-r3/ai-assessment";
import { regulatoryConfig } from "@/services/api/regulatory-config";
import {
  unconfiguredOrgRegulatoryConfig,
  type OrgRegulatoryConfig,
} from "@/services/e2b-r3/regulatory-config";
import { linelist as linelistApi, rowLabel } from "@/services/api/linelist";
import { demoLineListJobs } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
import {
  EmptyState,
  PageHeader,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_app/e2b")({
  head: () => ({
    meta: [
      { title: "E2B(R3) preparation — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Review case readiness and generate E2B(R3)-shaped XML output from validated processing jobs.",
      },
      { property: "og:title", content: "E2B(R3) preparation — MedNova PV Assist" },
      {
        property: "og:description",
        content:
          "Prepare and export E2B(R3) files. Regulatory transmission is a separate integration.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="e2b.generate">
      <E2bPage />
    </PermissionGate>
  ),
});

/** "File row 29 (case OND-12)" for a case in a preflight result. */
function caseLocation(
  job: Parameters<typeof rowLabel>[0],
  result: ValidatedExportResult,
  sendersCaseId: string,
): string {
  const pvCase = result.cases.find((c) => c.sendersCaseId === sendersCaseId);
  const row = pvCase?.sourceInformation?.sourceRow;
  return row ? rowLabel(job, row) : "";
}

function E2bPage() {
  const jobs = usePvQuery(
    ["linelist", "jobs"],
    () => linelistApi.jobs(),
    () => demoLineListJobs,
  );
  const [preflightBusy, setPreflightBusy] = useState<string | null>(null);
  const [preflightResults, setPreflightResults] = useState<Record<string, ValidatedExportResult>>(
    {},
  );
  const [overridingJobId, setOverridingJobId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  // The line-list check each shown preflight result was computed against.
  // When the line list changes (a fix, a Settings decision, a new reading
  // of "/"), its preflight is re-run automatically.
  const [preflightBasis, setPreflightBasis] = useState<Record<string, string>>({});
  const [c17Assessments, setC17Assessments] = useState<Record<string, E2bRegulatoryAssessment[]>>(
    {},
  );
  const [c17Rationales, setC17Rationales] = useState<Record<string, string>>({});
  const [bulkC17JobId, setBulkC17JobId] = useState<string | null>(null);
  const [bulkC17Rationale, setBulkC17Rationale] = useState("");
  const [bulkC17Busy, setBulkC17Busy] = useState(false);
  const [c17AiAssessments, setC17AiAssessments] = useState<Record<string, C17AiAssessmentRecord[]>>(
    {},
  );
  // The org's persisted NAFDAC E2B(R3) regulatory configuration (sender/
  // receiver identifiers, C.1.3, the outcome codelist, and reporter-
  // qualification mappings — see Settings → Regulatory Profiles). Starts
  // honestly unconfigured and is replaced by the real persisted value
  // once loaded — preflight still runs against the unconfigured default
  // so data-quality gaps are visible even before those decisions land,
  // but export stays blocked separately on transmissionConfigConfirmed
  // regardless of preflight (see runValidatedPreflightForJob).
  const [regConfig, setRegConfig] = useState<OrgRegulatoryConfig>(
    unconfiguredOrgRegulatoryConfig(),
  );

  useEffect(() => {
    regulatoryConfig
      .get()
      .then(setRegConfig)
      .catch(() => {
        /* stays on the honest unconfigured default — export remains
         * correctly blocked either way. */
      });
  }, []);

  async function checkValidatedPreflight(jobId: string) {
    setPreflightBusy(jobId);
    try {
      // No explicit profile: the job's own saved reading (parsing options,
      // discovered codebook, organization outcome words and designations)
      // is exactly what line-list validation used.
      const result = await runValidatedPreflightForJob(jobId, regConfig);
      const job = (jobs.data?.data ?? []).find((item) => item.id === jobId);
      setPreflightBasis((prev) => ({ ...prev, [jobId]: job?.checkedAt ?? "" }));
      setPreflightResults((prev) => ({ ...prev, [jobId]: result }));
      // Only each case's newest assessment is actionable; superseded
      // versions are history and must never be decided in its place.
      const assessments = latestC17AssessmentsByCase(await listC17Assessments(jobId));
      setC17Assessments((prev) => ({ ...prev, [jobId]: assessments }));
      const aiAssessments = await listC17AiAssessments(assessments.map((a) => a.caseId));
      setC17AiAssessments((prev) => ({ ...prev, [jobId]: aiAssessments }));
      if (result.readyForValidatedExport && result.transmissionConfigConfirmed) {
        toast.success(
          `${result.totalCases} case(s) passed VigiFlow preflight — ready for real E2B(R3) export.`,
        );
      } else if (result.readyForValidatedExport) {
        toast.warning(
          "All cases passed VigiFlow preflight, but transmission configuration (sender/receiver identifiers) is not yet confirmed by NAFDAC/Ondo — export still blocked.",
        );
      } else {
        toast.warning(
          `${result.preflight.blockedCases}/${result.totalCases} case(s) blocked — see reasons below. Not ready for validated export.`,
        );
      }
    } catch (err) {
      toast.error(isNotConfigured(err) ? "Backend not connected." : "Preflight check failed.");
    } finally {
      setPreflightBusy(null);
    }
  }

  // Keep shown results in step with the line list: whenever a job was
  // rechecked since its preflight ran (data fixed, an outcome word or
  // designation decided in Settings, "/" reading changed), run it again.
  useEffect(() => {
    for (const job of jobs.data?.data ?? []) {
      const basis = preflightBasis[job.id];
      if (basis === undefined || preflightBusy === job.id) continue;
      if ((job.checkedAt ?? "") !== basis) void checkValidatedPreflight(job.id);
    }
    // checkValidatedPreflight is recreated each render; the job list and
    // what each result was based on are what matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.data, preflightBasis]);

  async function finalizeC17(
    jobId: string,
    assessment: E2bRegulatoryAssessment,
    decision: "YES" | "NO",
  ) {
    const rationale = c17Rationales[assessment.id ?? ""]?.trim() ?? "";
    if (!assessment.id) {
      toast.error("This assessment has not been persisted yet. Run preflight again.");
      return;
    }
    if (!rationale) {
      toast.error("Enter a rationale before finalizing the C.1.7 decision.");
      return;
    }
    try {
      const updated = await finalizeC17Assessment(assessment.id, decision, rationale);
      setC17Assessments((previous) => ({
        ...previous,
        [jobId]: (previous[jobId] ?? []).map((item) => (item.id === updated.id ? updated : item)),
      }));
      await checkValidatedPreflight(jobId);
      toast.success(`C.1.7 finalized as ${decision}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the C.1.7 decision.");
    }
  }

  async function finalizeC17Bulk(jobId: string, decision: "YES" | "NO") {
    const ids = pendingC17AssessmentIds(c17Assessments[jobId] ?? []);
    const rationale = bulkC17Rationale.trim();
    if (ids.length === 0) {
      toast.error("No C.1.7 decisions are pending for this line list.");
      return;
    }
    if (!rationale) {
      toast.error("Enter a rationale before finalizing the C.1.7 decisions.");
      return;
    }
    setBulkC17Busy(true);
    try {
      const updated = await finalizeC17AssessmentsBulk(ids, decision, rationale);
      setBulkC17JobId(null);
      setBulkC17Rationale("");
      await checkValidatedPreflight(jobId);
      toast.success(`C.1.7 finalized as ${decision} for ${updated.length} case(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the C.1.7 decisions.");
    } finally {
      setBulkC17Busy(false);
    }
  }

  async function exportValidated(jobId: string) {
    setPreflightBusy(jobId);
    try {
      const batches = await generateValidatedExportForJob(jobId, regConfig);
      for (const b of batches) await downloadValidatedBatch(jobId, b);
      toast.success(
        `Downloaded ${batches.length} real E2B(R3) batch file(s) — ${batches.reduce((n, b) => n + b.caseCount, 0)} case(s) total.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validated export failed.");
    } finally {
      setPreflightBusy(null);
    }
  }

  /**
   * Records the REAL validated pipeline's own override (structurally
   * separate from dismissErrors/e2bOverride below, which only ever
   * affects the legacy draft path) — then immediately re-runs preflight
   * so the UI reflects which cases the override actually rescues, per
   * E2B_NON_OVERRIDABLE_CODES. A case missing the ICH structural minimum
   * (patient/reporter/reaction/product) or a case-identity field stays
   * excluded from the export even after this.
   */
  async function recordOverride(jobId: string) {
    if (!overrideReason.trim()) {
      toast.error("A reason is required to override the validated E2B(R3) export gate.");
      return;
    }
    setPreflightBusy(jobId);
    try {
      await e2bApi.recordValidatedExportOverride(jobId, overrideReason.trim());
      setOverridingJobId(null);
      setOverrideReason("");
      await checkValidatedPreflight(jobId);
      toast.success("Override recorded — re-run preflight now reflects which cases it rescues.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the override.");
    } finally {
      setPreflightBusy(null);
    }
  }

  async function clearOverride(jobId: string) {
    setPreflightBusy(jobId);
    try {
      await e2bApi.clearValidatedExportOverride(jobId);
      await checkValidatedPreflight(jobId);
      toast.success("Override cleared.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not clear the override.");
    } finally {
      setPreflightBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="E2B(R3) preparation"
        description="Prepares real ICH E2B(R3) HL7 v3 XML for the VigiFlow/NAFDAC pipeline. Nothing is transmitted from here."
        meta={jobs.data ? <SourceTag source={jobs.data.source} /> : null}
      />

      <div className="space-y-4 p-6">
        <div className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-soft px-4 py-3">
          <ShieldAlert className="mt-0.5 size-4 text-warning" />
          <p className="text-sm text-foreground">
            This product <strong>prepares and generates</strong> E2B(R3) output. It does not
            transmit reports to any regulatory authority. Submission requires a separately validated
            gateway integration.
          </p>
        </div>

        <Section title="Jobs ready for preparation">
          <QueryBoundary query={jobs}>
            {(items) => {
              const ready = items.filter(
                (j) => j.stage === "VALIDATED" || j.stage === "E2B_GENERATED",
              );
              if (ready.length === 0)
                return (
                  <EmptyState
                    title="No validated jobs"
                    description="Complete line-list validation before preparing E2B(R3) output."
                  />
                );
              return (
                <ul className="space-y-3">
                  {ready.map((j) => {
                    const overridden = j.invalidCases > 0 && !!j.e2bOverride;
                    const exportable = j.invalidCases === 0 || overridden;
                    return (
                      <li key={j.id} className="rounded-md border border-border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <FileStack className="size-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{j.filename}</span>
                          <span className="mono-num text-xs text-muted-foreground">{j.id}</span>
                          <StatusPill tone="info">Prepared</StatusPill>
                          <StatusPill tone={j.invalidCases === 0 ? "success" : "warning"}>
                            {j.invalidCases === 0 ? "Validated" : "Validated with errors"}
                          </StatusPill>
                          <StatusPill tone={exportable ? "success" : "critical"}>
                            {exportable ? "Ready for export" : "Not ready for export"}
                          </StatusPill>
                          {overridden ? (
                            <StatusPill tone="warning">Errors overridden</StatusPill>
                          ) : null}
                        </div>

                        <p className="mt-2 text-xs text-muted-foreground">
                          {overridden
                            ? `${j.invalidCases} outstanding line-listing issue(s) remain, but ${j.e2bOverride?.by ?? "a reviewer"} dismissed them for export on ${new Date(j.e2bOverride!.at).toLocaleString()}. They are still shown in full on the line-list page.`
                            : exportable
                              ? "No outstanding line-listing issues. This dataset — including any AI-applied corrections — is what will be used to generate E2B(R3) output."
                              : `${j.invalidCases} outstanding line-listing issue(s) on this dataset must be resolved before it can be exported.`}
                        </p>

                        <dl className="mt-3 grid gap-3 sm:grid-cols-4">
                          {[
                            ["Case count", j.rows, ""],
                            ["Valid cases", j.validCases, "text-success"],
                            ["Invalid cases", j.invalidCases, "text-critical"],
                            ["Warnings", j.warnings, "text-warning"],
                          ].map(([label, value, cls]) => (
                            <div
                              key={label as string}
                              className="rounded-md border border-border px-3 py-2"
                            >
                              <dt className="label-caps">{label as string}</dt>
                              <dd className={`mono-num text-lg font-semibold ${cls as string}`}>
                                {value as number}
                              </dd>
                            </div>
                          ))}
                        </dl>

                        {/* The legacy "Generate E2B(R3)" / "Download XML" /
                            "Dismiss Errors" trio was removed here. Its generator
                            (buildE2bXml in services/api/e2b.ts) emits a flat
                            E2B(R2)-shaped <ichicsr> preparation draft whose own
                            header states it "must never be presented to NAFDAC,
                            loaded into VigiFlow, or described as
                            E2B(R3)-compliant" — while the button calling it was
                            labelled exactly that. Two adjacent downloads, one
                            conformant and one explicitly not, distinguishable
                            only by reading the XML comment, is not a safe thing
                            to put in a regulatory tool. The validated pipeline
                            below is the only export path. */}
                        {!exportable ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            {j.invalidCases} invalid case(s) outstanding in line-list processing.
                          </p>
                        ) : null}

                        <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
                          <p className="text-xs font-medium text-foreground">
                            Validated E2B(R3) export (real HL7 v3 XML — VigiFlow/NAFDAC pipeline)
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Runs the real normalize → validate → MedDRA/WHODrug preflight → batch →
                            serialize pipeline. "READY_FOR_VALIDATED_IMPORT" here means every case
                            passed VigiFlow's actual validated-import requirements — not merely that
                            the generated XML is schema-valid. Download additionally requires the
                            sender/receiver transmission identifiers to be confirmed by NAFDAC/Ondo
                            (see the configuration gaps below) — neither condition alone unlocks it.
                          </p>
                          <div className="mt-2 rounded border border-border bg-background/60 px-2 py-2 text-xs">
                            <p>
                              <span className="font-medium">How this line list is read: </span>
                              "/" in a reaction{" "}
                              {j.parsingOptions?.slashSeparatesReactions
                                ? "separates two reactions"
                                : "is kept as one reaction"}
                              ; the product cell{" "}
                              {j.parsingOptions?.productCellIsOneName
                                ? "is one product name"
                                : "may list several suspect products"}
                              .{" "}
                              <Link to="/line-list" className="text-primary hover:underline">
                                Change on the line-list page
                              </Link>
                            </p>
                            {(j.e2bBlockedCases ?? 0) > 0 ? (
                              <p className="mt-1 text-critical">
                                {j.e2bBlockedCases} case(s) have data that blocks VigiFlow.{" "}
                                <Link to="/line-list" className="font-medium hover:underline">
                                  Fix them on the line-list page
                                </Link>{" "}
                                — this page refreshes itself when they change.
                              </p>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={preflightBusy === j.id}
                              onClick={() => checkValidatedPreflight(j.id)}
                            >
                              <ShieldCheck className="size-4" /> Run VigiFlow preflight
                            </Button>
                            {preflightResults[j.id] ? (
                              <>
                                <StatusPill
                                  tone={
                                    preflightResults[j.id]!.readyForValidatedExport
                                      ? "success"
                                      : preflightResults[j.id]!.exportableWithOverride
                                        ? "warning"
                                        : "critical"
                                  }
                                >
                                  {preflightResults[j.id]!.readyForValidatedExport
                                    ? "READY_FOR_VALIDATED_IMPORT"
                                    : preflightResults[j.id]!.exportableWithOverride
                                      ? `EXPORTABLE WITH OVERRIDE (${preflightResults[j.id]!.caseEligibility.filter((c) => c.includable).length}/${preflightResults[j.id]!.totalCases} case(s))`
                                      : `BLOCKED (${preflightResults[j.id]!.preflight.blockedCases}/${preflightResults[j.id]!.totalCases} case(s))`}
                                </StatusPill>
                                <Button
                                  size="sm"
                                  disabled={
                                    preflightBusy === j.id ||
                                    !preflightResults[j.id]!.transmissionConfigConfirmed ||
                                    (!preflightResults[j.id]!.readyForValidatedExport &&
                                      !preflightResults[j.id]!.exportableWithOverride)
                                  }
                                  onClick={() => exportValidated(j.id)}
                                >
                                  <Download className="size-4" /> Download validated E2B(R3) XML
                                </Button>
                                {!preflightResults[j.id]!.readyForValidatedExport &&
                                !preflightResults[j.id]!.override ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={preflightBusy === j.id}
                                    onClick={() => setOverridingJobId(j.id)}
                                  >
                                    <ShieldOff className="size-4" /> Override & Export Anyway
                                  </Button>
                                ) : null}
                                {preflightResults[j.id]!.override ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={preflightBusy === j.id}
                                    onClick={() => clearOverride(j.id)}
                                  >
                                    Clear override
                                  </Button>
                                ) : null}
                              </>
                            ) : null}
                          </div>

                          {c17Assessments[j.id]?.length ? (
                            <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft/30 p-3">
                              <p className="font-medium">
                                C.1.7 — Local criteria for expedited report
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {c17Assessments[j.id]![0]!.rule.name} — v
                                {c17Assessments[j.id]![0]!.rule.version} (
                                {c17Assessments[j.id]![0]!.rule.status.toLowerCase()}). This
                                assessment is regulatory-review required and cannot be cleared by an
                                ordinary export override.
                              </p>
                              {pendingC17AssessmentIds(c17Assessments[j.id]!).length > 0 ? (
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                  <span>
                                    {pendingC17AssessmentIds(c17Assessments[j.id]!).length} of{" "}
                                    {c17Assessments[j.id]!.length} case(s) awaiting a decision.
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setBulkC17JobId(j.id);
                                      setBulkC17Rationale("");
                                    }}
                                  >
                                    Decide all pending…
                                  </Button>
                                </div>
                              ) : null}
                              <div className="mt-2 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                                {c17Assessments[j.id]!.map((assessment) => (
                                  <div
                                    key={assessment.id ?? assessment.caseId}
                                    className="rounded border bg-background p-2"
                                  >
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                      <span className="font-mono font-medium">
                                        {assessment.caseId}
                                      </span>
                                      <StatusPill
                                        tone={
                                          assessment.status === "FINALIZED" ? "success" : "warning"
                                        }
                                      >
                                        {assessment.status}
                                      </StatusPill>
                                      <span className="text-muted-foreground">
                                        Recommendation:{" "}
                                        {assessment.recommendation ?? "NEEDS_REVIEW"}
                                      </span>
                                    </div>
                                    {c17AiAssessments[j.id]
                                      ?.filter((item) => {
                                        const currentCase = preflightResults[j.id]?.cases.find(
                                          (itemCase) =>
                                            itemCase.internalCaseId === assessment.caseId,
                                        );
                                        return (
                                          item.caseId === assessment.caseId &&
                                          currentCase !== undefined &&
                                          aiAssessmentCanApplyTo(item, currentCase)
                                        );
                                      })
                                      .slice(0, 1)
                                      .map((aiAssessment) => (
                                        <div
                                          key={aiAssessment.id}
                                          className="mt-2 rounded border border-primary/20 bg-primary/5 p-2 text-xs"
                                        >
                                          <p className="font-medium">AI-ASSISTED ASSESSMENT</p>
                                          <p className="text-muted-foreground">
                                            NOT A REGULATORY DECISION
                                          </p>
                                          <p className="mt-1">
                                            Recommendation: {aiAssessment.recommendation}
                                          </p>
                                          <p>
                                            Confidence: {Math.round(aiAssessment.confidence * 100)}%
                                          </p>
                                          <p className="mt-1 text-muted-foreground">
                                            {aiAssessment.reasoningSummary}
                                          </p>
                                          {aiAssessment.missingInformation.length > 0 ? (
                                            <p className="mt-1 text-muted-foreground">
                                              Missing: {aiAssessment.missingInformation.join("; ")}
                                            </p>
                                          ) : null}
                                          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                                            Snapshot: {aiAssessment.inputSnapshotHash}
                                          </p>
                                        </div>
                                      ))}
                                    {assessment.status !== "FINALIZED" ? (
                                      <div className="mt-2 space-y-2">
                                        <p className="text-xs text-muted-foreground">
                                          {assessment.rationale}
                                        </p>
                                        <Textarea
                                          value={c17Rationales[assessment.id ?? ""] ?? ""}
                                          onChange={(event) =>
                                            setC17Rationales((previous) => ({
                                              ...previous,
                                              [assessment.id ?? ""]: event.target.value,
                                            }))
                                          }
                                          placeholder="Required rationale for the qualified reviewer decision"
                                          rows={2}
                                        />
                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => finalizeC17(j.id, assessment, "YES")}
                                          >
                                            Finalize YES
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => finalizeC17(j.id, assessment, "NO")}
                                          >
                                            Finalize NO
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        Final decision: {assessment.finalDecision} by{" "}
                                        {assessment.reviewerName ?? "a reviewer"}
                                        {assessment.reviewedAt
                                          ? ` on ${new Date(assessment.reviewedAt).toLocaleString()}`
                                          : ""}{" "}
                                        — {assessment.rationale}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {preflightResults[j.id]?.override ? (
                            <div className="mt-2 rounded-md border border-warning/30 bg-warning-soft px-2 py-1.5 text-xs text-foreground">
                              <p className="font-medium">
                                Validated-export override on record:{" "}
                                {preflightResults[j.id]!.override!.by} —{" "}
                                {preflightResults[j.id]!.override!.reason}
                              </p>
                              <p className="mt-1 text-muted-foreground">
                                This lets a case export despite administrative/mapping gaps
                                (unresolved outcome mapping, unconfirmed report type, etc.). It can
                                never export a case missing an identifiable patient/reporter, zero
                                reactions, zero suspect products, or its own case-identity fields —
                                those stay excluded below regardless.
                              </p>
                            </div>
                          ) : null}

                          {preflightResults[j.id]?.override &&
                          preflightResults[j.id]!.caseEligibility.some((c) => !c.includable) ? (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-critical">
                                {
                                  preflightResults[j.id]!.caseEligibility.filter(
                                    (c) => !c.includable,
                                  ).length
                                }{" "}
                                case(s) still excluded even with the override on record
                                (non-overridable):
                              </p>
                              <div className="mt-1 max-h-[32rem] space-y-2 overflow-y-auto pr-1 text-xs">
                                {preflightResults[j.id]!.caseEligibility.filter(
                                  (c) => !c.includable,
                                ).map((c) => (
                                  <div
                                    key={c.caseId}
                                    className="rounded border border-critical/30 bg-critical/5 p-2"
                                  >
                                    <p className="font-mono font-medium">
                                      {c.caseId} — EXCLUDED
                                      <span className="ml-2 font-sans font-normal text-muted-foreground">
                                        {caseLocation(j, preflightResults[j.id]!, c.caseId)}
                                      </span>
                                    </p>
                                    {c.nonOverridableErrors.map((e, i) => (
                                      <p key={i} className="mt-1 pl-2 text-muted-foreground">
                                        {e.code}: {e.message}
                                      </p>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {preflightResults[j.id] &&
                          (!preflightResults[j.id]!.transmissionConfigConfirmed ||
                            preflightResults[j.id]!.caseLevelBlockers.unmappedReporterDesignations
                              .length > 0) ? (
                            <div className="mt-2 rounded-md border border-warning/30 bg-warning-soft px-2 py-2 text-xs text-foreground">
                              <p className="font-medium">E2B(R3) generation blocked</p>
                              <p className="mt-2 label-caps">Organization configuration</p>
                              <ul className="mt-1 space-y-0.5">
                                {preflightResults[j.id]!.organizationReadiness.map((item) => (
                                  <li key={item.key}>
                                    {item.label}:{" "}
                                    <span
                                      className={
                                        item.status === "CONFIGURED"
                                          ? "text-success"
                                          : "text-critical"
                                      }
                                    >
                                      {item.status === "CONFIGURED"
                                        ? "Configured"
                                        : item.status === "MISSING"
                                          ? "Missing"
                                          : "Not verified"}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              {preflightResults[j.id]!.caseLevelBlockers
                                .unmappedReporterDesignations.length > 0 ? (
                                <>
                                  <p className="mt-2 label-caps">Case data</p>
                                  <ul className="mt-1 space-y-0.5">
                                    {preflightResults[
                                      j.id
                                    ]!.caseLevelBlockers.unmappedReporterDesignations.map((d) => (
                                      <li key={d.designation}>
                                        {d.caseCount} case(s) have unmapped reporter designation: "
                                        {d.designation}"
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              ) : null}
                              <p className="mt-2 text-muted-foreground">
                                Resolve these under Settings → Regulatory Profiles → NAFDAC E2B(R3)
                                before generating a production E2B(R3) submission.
                              </p>
                            </div>
                          ) : null}

                          {preflightResults[j.id] &&
                          preflightResults[j.id]!.preflight.counts.whodrugNotConfiguredInfo > 0 ? (
                            <p className="mt-2 rounded-md border border-info/30 bg-info-soft px-2 py-1.5 text-xs text-foreground">
                              WHODrug coding not configured — exporting reported product name using
                              Option A. This is informational only and does not block export.
                            </p>
                          ) : null}

                          {preflightResults[j.id] &&
                          !preflightResults[j.id]!.readyForValidatedExport ? (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-critical">
                                Blocking reasons (by rule):
                              </p>
                              <ul className="mt-1 space-y-1 text-xs text-critical">
                                {Object.entries(preflightResults[j.id]!.preflight.counts)
                                  .filter(
                                    ([code, count]) =>
                                      count > 0 && code !== "whodrugNotConfiguredInfo",
                                  )
                                  .map(([code, count]) => (
                                    <li key={code}>
                                      {count}× {code}
                                    </li>
                                  ))}
                              </ul>
                              <p className="mt-2 text-xs font-medium text-critical">
                                Per-case detail (all{" "}
                                {
                                  preflightResults[j.id]!.preflight.results.filter((r) => r.blocked)
                                    .length
                                }{" "}
                                blocked cases):
                              </p>
                              <div className="mt-1 max-h-[32rem] space-y-2 overflow-y-auto pr-1 text-xs">
                                {preflightResults[j.id]!.preflight.results.filter(
                                  (r) => r.blocked,
                                ).map((r) => (
                                  <div
                                    key={r.caseId}
                                    className="rounded border border-critical/30 bg-critical/5 p-2"
                                  >
                                    <p className="font-mono font-medium">
                                      {r.caseId} — BLOCKED
                                      <span className="ml-2 font-sans font-normal text-muted-foreground">
                                        {caseLocation(j, preflightResults[j.id]!, r.caseId)}
                                      </span>
                                    </p>
                                    {r.errors
                                      .filter((e) => e.severity === "BLOCKING")
                                      .map((e, i) => (
                                        <div key={i} className="mt-1 pl-2 text-muted-foreground">
                                          <p>
                                            Field: {e.e2bField ?? "—"} · Rule: {e.code}
                                          </p>
                                          <p>Reason: {e.message}</p>
                                          {e.sourceValue ? (
                                            <p>Source value: "{e.sourceValue}"</p>
                                          ) : null}
                                          <p>Remediation: {e.remediation}</p>
                                          {e.code === "VIGIFLOW-MEDDRA-MISSING" ? (
                                            <Link
                                              to="/line-list"
                                              className="mt-1 inline-block font-medium text-primary hover:underline"
                                            >
                                              Choose the MedDRA term on the line-list page →
                                            </Link>
                                          ) : null}
                                        </div>
                                      ))}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <AlertDialog
                            open={bulkC17JobId === j.id}
                            onOpenChange={(open) => {
                              if (!open && !bulkC17Busy) {
                                setBulkC17JobId(null);
                                setBulkC17Rationale("");
                              }
                            }}
                          >
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Finalize C.1.7 for every pending case in this line list?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Applies one YES or NO decision and one rationale to all{" "}
                                  {pendingC17AssessmentIds(c17Assessments[j.id] ?? []).length}{" "}
                                  pending case(s). Each case is recorded in the audit trail under
                                  your name and cannot be changed afterwards. If any case cannot be
                                  finalized, none are. Decide individual cases first if they differ.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <Textarea
                                placeholder="Rationale for the qualified reviewer decision (required)"
                                value={bulkC17Rationale}
                                onChange={(e) => setBulkC17Rationale(e.target.value)}
                                rows={3}
                              />
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={bulkC17Busy}>Cancel</AlertDialogCancel>
                                <Button
                                  variant="outline"
                                  disabled={bulkC17Busy || !bulkC17Rationale.trim()}
                                  onClick={() => finalizeC17Bulk(j.id, "NO")}
                                >
                                  Finalize all NO
                                </Button>
                                <Button
                                  disabled={bulkC17Busy || !bulkC17Rationale.trim()}
                                  onClick={() => finalizeC17Bulk(j.id, "YES")}
                                >
                                  Finalize all YES
                                </Button>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>

                          <AlertDialog
                            open={overridingJobId === j.id}
                            onOpenChange={(open) => {
                              if (!open) {
                                setOverridingJobId(null);
                                setOverrideReason("");
                              }
                            }}
                          >
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Override the validated E2B(R3) export gate?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This lets cases blocked only on administrative/mapping gaps
                                  (unresolved outcome mapping, unconfirmed report type, unresolved
                                  reporter qualification, missing MedDRA coding, etc.) export as
                                  real, schema-conformant E2B(R3) XML anyway. It can never export a
                                  case missing an identifiable patient/reporter, zero reactions,
                                  zero suspect products, or its own case-identity fields — those
                                  always stay excluded. Recorded to the audit trail under your name;
                                  you can clear it later.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <Textarea
                                placeholder="Reason for overriding (required)"
                                value={overrideReason}
                                onChange={(e) => setOverrideReason(e.target.value)}
                                rows={3}
                              />
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => recordOverride(j.id)}>
                                  Record override
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              );
            }}
          </QueryBoundary>
        </Section>
      </div>
    </>
  );
}
