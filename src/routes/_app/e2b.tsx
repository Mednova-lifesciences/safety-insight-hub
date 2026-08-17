import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, FileStack, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { e2b as e2bApi } from "@/services/api/e2b";
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

export const Route = createFileRoute("/_app/e2b")({
  head: () => ({
    meta: [
      { title: "E2B(R3) preparation — MedNova PV Assist" },
      { name: "description", content: "Review case readiness and generate E2B(R3)-shaped XML output from validated processing jobs." },
      { property: "og:title", content: "E2B(R3) preparation — MedNova PV Assist" },
      { property: "og:description", content: "Prepare and export E2B(R3) files. Regulatory transmission is a separate integration." },
    ],
  }),
  component: E2bPage,
});

function E2bPage() {
  const jobs = usePvQuery(["linelist", "jobs"], () => linelistApi.jobs(), () => demoLineListJobs);
  const [busy, setBusy] = useState<string | null>(null);

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
            This product <strong>prepares and generates</strong> E2B(R3) output. It does not transmit
            reports to any regulatory authority. Submission requires a separately validated gateway
            integration.
          </p>
        </div>

        <Section title="Jobs ready for preparation">
          <QueryBoundary query={jobs}>
            {(items) => {
              const ready = items.filter((j) => j.stage === "VALIDATED" || j.stage === "E2B_GENERATED");
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
                    const exportable = j.invalidCases === 0;
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
                        </div>

                        <dl className="mt-3 grid gap-3 sm:grid-cols-4">
                          {[
                            ["Case count", j.rows, ""],
                            ["Valid cases", j.validCases, "text-success"],
                            ["Invalid cases", j.invalidCases, "text-critical"],
                            ["Warnings", j.warnings, "text-warning"],
                          ].map(([label, value, cls]) => (
                            <div key={label as string} className="rounded-md border border-border px-3 py-2">
                              <dt className="label-caps">{label as string}</dt>
                              <dd className={`mono-num text-lg font-semibold ${cls as string}`}>{value as number}</dd>
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
                                toast.success(`Generated ${artifact.filename} (${artifact.caseCount} cases). Not transmitted.`);
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
                                const readiness = await e2bApi.readiness(j.id);
                                toast.info(`Schema ${readiness.schema}; ${readiness.validCases} exportable cases.`);
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
                          {!exportable ? (
                            <span className="self-center text-xs text-muted-foreground">
                              {j.invalidCases} invalid case(s) must be resolved in line-list processing first.
                            </span>
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
