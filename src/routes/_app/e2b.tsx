import { createFileRoute } from "@tanstack/react-router";
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
import { regulatoryConfig } from "@/services/api/regulatory-config";
import {
  unconfiguredOrgRegulatoryConfig,
  type OrgRegulatoryConfig,
} from "@/services/e2b-r3/regulatory-config";
import { linelist as linelistApi } from "@/services/api/linelist";
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

function E2bPage() {
  const jobs = usePvQuery(
    ["linelist", "jobs"],
    () => linelistApi.jobs(),
    () => demoLineListJobs,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [preflightBusy, setPreflightBusy] = useState<string | null>(null);
  const [preflightResults, setPreflightResults] = useState<Record<string, ValidatedExportResult>>(
    {},
  );
  const [overridingJobId, setOverridingJobId] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
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
      const result = await runValidatedPreflightForJob(jobId, regConfig);
      setPreflightResults((prev) => ({ ...prev, [jobId]: result }));
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

  async function dismissErrors(jobId: string) {
    setBusy(jobId);
    try {
      await e2bApi.dismissErrors(jobId);
      toast.success("Outstanding errors dismissed. This job can now be exported.");
      jobs.refetch();
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — the override was not saved."
          : "Could not dismiss errors.",
      );
    } finally {
      setBusy(null);
      setConfirmingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="E2B(R3) preparation"
        description="Prepares E2B(R3)-shaped XML from validated cases."
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

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            disabled={busy === j.id || !exportable}
                            onClick={async () => {
                              setBusy(j.id);
                              try {
                                const artifact = await e2bApi.generate(j.id);
                                toast.success(
                                  `Generated ${artifact.filename} (${artifact.caseCount} cases). Not transmitted.`,
                                );
                                jobs.refetch();
                              } catch (err) {
                                toast.error(
                                  isNotConfigured(err)
                                    ? "Backend not connected — no E2B output was generated."
                                    : "Generation failed.",
                                );
                              } finally {
                                setBusy(null);
                              }
                            }}
                          >
                            Generate E2B(R3)
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={j.stage !== "E2B_GENERATED"}
                            onClick={async () => {
                              try {
                                await e2bApi.download(j.id);
                              } catch (err) {
                                toast.error(
                                  isNotConfigured(err)
                                    ? "Backend not connected — no artifact is available to download."
                                    : "Download unavailable.",
                                );
                              }
                            }}
                          >
                            <Download className="size-4" /> Download XML
                          </Button>
                          {j.invalidCases > 0 && !j.e2bOverride ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy === j.id}
                                onClick={() => setConfirmingId(j.id)}
                              >
                                <ShieldOff className="size-4" /> Dismiss Errors
                              </Button>
                              <AlertDialog
                                open={confirmingId === j.id}
                                onOpenChange={(open) => {
                                  if (!open) setConfirmingId(null);
                                }}
                              >
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Override outstanding errors?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This job has {j.invalidCases} outstanding line-listing
                                      issue(s). Dismissing them unlocks{" "}
                                      <strong>Generate E2B(R3)</strong> for this job without
                                      resolving them — use this only when those findings are
                                      intentional or incorrect for this dataset. The issues are not
                                      removed or resolved; they'll still show in full on the
                                      line-list page, and this override is recorded in the audit
                                      trail under your name.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => dismissErrors(j.id)}>
                                      Dismiss errors
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          ) : null}
                          {!exportable ? (
                            <span className="self-center text-xs text-muted-foreground">
                              {j.invalidCases} invalid case(s) must be resolved in line-list
                              processing first.
                            </span>
                          ) : null}
                        </div>

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
                              <div className="mt-1 max-h-48 space-y-2 overflow-y-auto text-xs">
                                {preflightResults[j.id]!.caseEligibility.filter(
                                  (c) => !c.includable,
                                )
                                  .slice(0, 10)
                                  .map((c) => (
                                    <div
                                      key={c.caseId}
                                      className="rounded border border-critical/30 bg-critical/5 p-2"
                                    >
                                      <p className="font-mono font-medium">{c.caseId} — EXCLUDED</p>
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
                              .length > 0 ||
                            preflightResults[j.id]!.caseLevelBlockers.unresolvedOutcomeCaseCount >
                              0) ? (
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
                                .unmappedReporterDesignations.length > 0 ||
                              preflightResults[j.id]!.caseLevelBlockers.unresolvedOutcomeCaseCount >
                                0 ? (
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
                                    {preflightResults[j.id]!.caseLevelBlockers
                                      .unresolvedOutcomeCaseCount > 0 ? (
                                      <li>
                                        {
                                          preflightResults[j.id]!.caseLevelBlockers
                                            .unresolvedOutcomeCaseCount
                                        }{" "}
                                        case(s) have unresolved outcome values (E.i.7 codelist gap)
                                      </li>
                                    ) : null}
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
                                Per-case detail (first 10 blocked cases):
                              </p>
                              <div className="mt-1 max-h-64 space-y-2 overflow-y-auto text-xs">
                                {preflightResults[j.id]!.preflight.results.filter((r) => r.blocked)
                                  .slice(0, 10)
                                  .map((r) => (
                                    <div
                                      key={r.caseId}
                                      className="rounded border border-critical/30 bg-critical/5 p-2"
                                    >
                                      <p className="font-mono font-medium">{r.caseId} — BLOCKED</p>
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
                                          </div>
                                        ))}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          ) : null}

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
