import { createFileRoute } from "@tanstack/react-router";
import { PermissionGate } from "@/components/pv/permission-gate";
import { useState } from "react";
import { Download, FileStack, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { e2b as e2bApi } from "@/services/api/e2b";
import {
  runValidatedPreflightForJob,
  generateValidatedExportForJob,
  downloadValidatedBatch,
  type ValidatedExportResult,
} from "@/services/e2b-r3/export";
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
  const [preflightResults, setPreflightResults] = useState<Record<string, ValidatedExportResult>>({});

  async function checkValidatedPreflight(jobId: string) {
    setPreflightBusy(jobId);
    try {
      const result = await runValidatedPreflightForJob(jobId);
      setPreflightResults((prev) => ({ ...prev, [jobId]: result }));
      if (result.readyForValidatedExport) {
        toast.success(`${result.totalCases} case(s) passed VigiFlow preflight — ready for real E2B(R3) export.`);
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
      const batches = await generateValidatedExportForJob(jobId, {}, "MEDNOVA", "NAFDAC");
      for (const b of batches) downloadValidatedBatch(b);
      toast.success(`Downloaded ${batches.length} real E2B(R3) batch file(s) — ${batches.reduce((n, b) => n + b.caseCount, 0)} case(s) total.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validated export failed.");
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
                            Runs the real normalize → validate → MedDRA/WHODrug preflight → batch
                            → serialize pipeline. Download is only offered when every case in this
                            job passes VigiFlow's validated-import requirements — today that
                            requires a licensed MedDRA/WHODrug provider, which is not yet
                            configured, so real datasets will currently show blocked.
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
                                  tone={preflightResults[j.id]!.readyForValidatedExport ? "success" : "critical"}
                                >
                                  {preflightResults[j.id]!.readyForValidatedExport
                                    ? "READY_FOR_VALIDATED_IMPORT"
                                    : `BLOCKED (${preflightResults[j.id]!.preflight.blockedCases}/${preflightResults[j.id]!.totalCases})`}
                                </StatusPill>
                                <Button
                                  size="sm"
                                  disabled={preflightBusy === j.id || !preflightResults[j.id]!.readyForValidatedExport}
                                  onClick={() => exportValidated(j.id)}
                                >
                                  <Download className="size-4" /> Download validated E2B(R3) XML
                                </Button>
                              </>
                            ) : null}
                          </div>
                          {preflightResults[j.id] && !preflightResults[j.id]!.readyForValidatedExport ? (
                            <ul className="mt-2 space-y-1 text-xs text-critical">
                              {Object.entries(preflightResults[j.id]!.preflight.counts)
                                .filter(([, count]) => count > 0)
                                .map(([code, count]) => (
                                  <li key={code}>
                                    {count}× {code}
                                  </li>
                                ))}
                            </ul>
                          ) : null}
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
