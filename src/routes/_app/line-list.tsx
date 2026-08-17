import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Upload } from "lucide-react";
import { toast } from "sonner";
import { linelist as linelistApi } from "@/services/api/linelist";
import { demoLineListIssues, demoLineListJobs } from "@/services/demo/dataset";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/line-list")({
  head: () => ({
    meta: [
      { title: "Line-list processing — MedNova PV Assist" },
      { name: "description", content: "Upload, map, normalise and validate messy line-lists before preparing E2B(R3) output." },
      { property: "og:title", content: "Line-list processing — MedNova PV Assist" },
      { property: "og:description", content: "Deterministic line-list cleaning and validation with full issue visibility." },
    ],
  }),
  component: LineListPage,
});

const STAGES = ["Upload", "Inspect columns", "Map columns", "Normalise", "Validate", "Review issues", "Generate E2B(R3)", "Download XML"];

function LineListPage() {
  const jobs = usePvQuery(["linelist", "jobs"], () => linelistApi.jobs(), () => demoLineListJobs);
  const [selected, setSelected] = useState<string | null>(null);
  const activeJob = (jobs.data?.data ?? []).find((j) => j.id === selected) ?? jobs.data?.data?.[0];
  const issues = usePvQuery(
    ["linelist", "issues", activeJob?.id ?? "none"],
    () => linelistApi.issues(activeJob!.id),
    () => demoLineListIssues,
  );
  const [uploading, setUploading] = useState(false);

  async function onFile(file: File) {
    setUploading(true);
    try {
      await linelistApi.upload(file);
      toast.success("File uploaded. Column inspection queued.");
      jobs.refetch();
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — the file was not uploaded or processed."
          : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Line-list processing"
        description="Messy CSV/XLSX line-lists are cleaned, normalised and validated by the backend processing engine. Validation problems are always shown in full."
        meta={jobs.data ? <SourceTag source={jobs.data.source} /> : null}
      />

      <div className="space-y-4 p-6">
        <Section title="Processing flow">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {STAGES.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-muted-foreground">{s}</span>
                {i < STAGES.length - 1 ? <ArrowRight className="size-3.5 text-muted-foreground" /> : null}
              </li>
            ))}
          </ol>
        </Section>

        <Section title="Upload a line-list" description="CSV or XLSX. Files are processed server-side; nothing is parsed in the browser.">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-8 text-center hover:bg-muted/50">
            <Upload className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">{uploading ? "Uploading…" : "Choose a CSV or XLSX file"}</span>
            <span className="text-xs text-muted-foreground">Maximum one file per processing job.</span>
            <input
              type="file"
              accept=".csv,.xlsx"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
        </Section>

        <Section title="Processing jobs">
          <QueryBoundary query={jobs}>
            {(items) =>
              items.length === 0 ? (
                <EmptyState title="No processing jobs" description="Upload a line-list to begin." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-left">
                        {["Job", "File", "Uploaded", "By", "Rows", "Stage", "Valid", "Invalid", "Warnings", ""].map((h) => (
                          <th key={h} className="label-caps px-3 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((j) => (
                        <tr key={j.id} className={cn("border-b border-border last:border-0", activeJob?.id === j.id && "bg-accent/50")}>
                          <td className="mono-num px-3 py-2">{j.id}</td>
                          <td className="px-3 py-2">{j.filename}</td>
                          <td className="mono-num px-3 py-2">{j.uploadedAt.slice(0, 10)}</td>
                          <td className="px-3 py-2">{j.uploadedBy}</td>
                          <td className="mono-num px-3 py-2">{j.rows}</td>
                          <td className="px-3 py-2">
                            <StatusPill tone={j.stage === "FAILED" ? "critical" : j.stage === "E2B_GENERATED" ? "success" : "info"}>
                              {j.stage.replaceAll("_", " ").toLowerCase()}
                            </StatusPill>
                          </td>
                          <td className="mono-num px-3 py-2 text-success">{j.validCases}</td>
                          <td className="mono-num px-3 py-2 text-critical">{j.invalidCases}</td>
                          <td className="mono-num px-3 py-2 text-warning">{j.warnings}</td>
                          <td className="px-3 py-2">
                            <Button size="sm" variant="outline" onClick={() => setSelected(j.id)}>
                              Review issues
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </QueryBoundary>
        </Section>

        {activeJob ? (
          <Section
            title={`Validation issues — ${activeJob.filename}`}
            description="Every row-level error and warning returned by the validation engine."
            actions={
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await linelistApi.validate(activeJob.id);
                    toast.success("Validation re-run.");
                    issues.refetch();
                  } catch (err) {
                    toast.error(isNotConfigured(err) ? "Backend not connected — validation was not run." : "Validation failed.");
                  }
                }}
              >
                Re-run validation
              </Button>
            }
          >
            <QueryBoundary query={issues}>
              {(rows) => (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50 text-left">
                        {["Row", "Column", "Severity", "Code", "Message", "Value"].map((h) => (
                          <th key={h} className="label-caps px-3 py-2">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((i, idx) => (
                        <tr key={`${i.row}-${idx}`} className="border-b border-border last:border-0">
                          <td className="mono-num px-3 py-2">{i.row}</td>
                          <td className="mono-num px-3 py-2">{i.column}</td>
                          <td className="px-3 py-2">
                            <StatusPill tone={i.severity === "ERROR" ? "critical" : "warning"}>{i.severity.toLowerCase()}</StatusPill>
                          </td>
                          <td className="mono-num px-3 py-2 text-xs">{i.code}</td>
                          <td className="px-3 py-2">{i.message}</td>
                          <td className="mono-num px-3 py-2 text-muted-foreground">{i.value ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </QueryBoundary>
          </Section>
        ) : null}
      </div>
    </>
  );
}
