import { createFileRoute } from "@tanstack/react-router";
import { PermissionGate } from "@/components/pv/permission-gate";
import { useState } from "react";
import { ArrowRight, Download, FileText, Sparkles, Upload, Wrench } from "lucide-react";
import { toast } from "sonner";
import { linelist as linelistApi } from "@/services/api/linelist";
import { demoLineListIssues, demoLineListJobs } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
import { AUTO_FIX_ENABLED, RULE_BASED_DETECTION_ENABLED } from "@/services/api/feature-flags";
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
      {
        name: "description",
        content:
          "Upload, map, normalise and validate messy line-lists before preparing E2B(R3) output.",
      },
      { property: "og:title", content: "Line-list processing — MedNova PV Assist" },
      {
        property: "og:description",
        content: "AI-assisted line-list cleaning and validation with full issue visibility.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="linelist.process">
      <LineListPage />
    </PermissionGate>
  ),
});

const STAGES = [
  "Upload",
  "Inspect columns",
  "Map columns",
  "Normalise",
  "Validate",
  "Review issues",
  "Generate E2B(R3)",
  "Download XML",
];

function LineListPage() {
  const jobs = usePvQuery(
    ["linelist", "jobs"],
    () => linelistApi.jobs(),
    () => demoLineListJobs,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const activeJob = (jobs.data?.data ?? []).find((j) => j.id === selected) ?? jobs.data?.data?.[0];
  const issues = usePvQuery(
    ["linelist", "issues", activeJob?.id ?? "none"],
    () => linelistApi.issues(activeJob!.id),
    () => demoLineListIssues,
  );
  const [uploading, setUploading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  async function onFile(file: File) {
    setUploading(true);
    try {
      await linelistApi.upload(file);
      toast.success("File uploaded.");
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

  async function runValidate(jobId: string) {
    setValidating(true);
    try {
      const result = await linelistApi.validate(jobId);
      setAiNotice(
        result.aiUsed
          ? null
          : (result.aiError ??
              (RULE_BASED_DETECTION_ENABLED
                ? "AI analysis unavailable — showing rule-based findings only."
                : "AI analysis unavailable — rule-based detection is currently disabled, so no issues were flagged.")),
      );
      toast.success(
        result.aiUsed
          ? RULE_BASED_DETECTION_ENABLED
            ? "Validated with AI + rule-based checks."
            : "Validated with AI (rule-based detection disabled)."
          : RULE_BASED_DETECTION_ENABLED
            ? "Validated with rule-based checks (AI unavailable)."
            : "Validated — no findings (AI unavailable, rule-based detection disabled).",
      );
      issues.refetch();
      jobs.refetch();
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — validation was not run."
          : "Validation failed.",
      );
    } finally {
      setValidating(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Line-list processing"
        description="Messy CSV/XLSX line-lists are parsed, validated and — where OpenAI is configured — reviewed by an AI analysis pass on top of deterministic rule checks. Validation problems are always shown in full."
        meta={jobs.data ? <SourceTag source={jobs.data.source} /> : null}
      />

      <div className="space-y-4 p-6">
        <Section title="Processing flow">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {STAGES.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-muted-foreground">
                  {s}
                </span>
                {i < STAGES.length - 1 ? (
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                ) : null}
              </li>
            ))}
          </ol>
        </Section>

        <Section
          title="Upload a line-list"
          description="CSV or XLSX. Files are parsed in the browser and analysed by the backend."
        >
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-8 text-center hover:bg-muted/50">
            <Upload className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">
              {uploading ? "Uploading…" : "Choose a CSV or XLSX file"}
            </span>
            <span className="text-xs text-muted-foreground">
              Maximum one file per processing job.
            </span>
            <input
              type="file"
              accept=".csv,.xlsx"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Clear the input immediately (before the async upload
                // even starts) so the browser never retains this File on
                // the element — otherwise a later stray event on the same
                // input can silently resubmit the same file as a second
                // upload, without the user choosing a file again.
                e.target.value = "";
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
                        {[
                          "Job",
                          "File",
                          "Uploaded",
                          "By",
                          "Rows",
                          "Stage",
                          "Valid",
                          "Invalid",
                          "Warnings",
                          "",
                        ].map((h) => (
                          <th key={h} className="label-caps px-3 py-2">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((j) => (
                        <tr
                          key={j.id}
                          className={cn(
                            "border-b border-border last:border-0",
                            activeJob?.id === j.id && "bg-accent/50",
                          )}
                        >
                          <td className="mono-num px-3 py-2">{j.id}</td>
                          <td className="px-3 py-2">{j.filename}</td>
                          <td className="mono-num px-3 py-2">{j.uploadedAt.slice(0, 10)}</td>
                          <td className="px-3 py-2">{j.uploadedBy}</td>
                          <td className="mono-num px-3 py-2">{j.rows}</td>
                          <td className="px-3 py-2">
                            <StatusPill
                              tone={
                                j.stage === "FAILED"
                                  ? "critical"
                                  : j.stage === "E2B_GENERATED"
                                    ? "success"
                                    : "info"
                              }
                            >
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
            description="Every row-level error and warning, from both the AI analysis pass and deterministic rule checks."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={validating}
                  onClick={() => runValidate(activeJob.id)}
                >
                  {validating ? "Re-running…" : "Re-run validation"}
                </Button>
                <QueryBoundary query={issues}>
                  {(rows) => {
                    if (!AUTO_FIX_ENABLED) return null;
                    const fixableCount = rows.filter((i) => i.fixable).length;
                    if (fixableCount === 0) return null;
                    return (
                      <Button
                        size="sm"
                        disabled={fixing}
                        onClick={async () => {
                          setFixing(true);
                          try {
                            const result = await linelistApi.fixIssues(activeJob.id);
                            if (!result.aiUsed) {
                              toast.error(
                                result.aiError ?? "AI fix unavailable — no changes were made.",
                              );
                            } else {
                              toast.success(
                                `${result.correctionsApplied} field(s) corrected.${result.unresolved.length ? ` ${result.unresolved.length} left unresolved.` : ""}`,
                              );
                            }
                            issues.refetch();
                            jobs.refetch();
                          } catch (err) {
                            toast.error(
                              isNotConfigured(err)
                                ? "Backend not connected — no fix was applied."
                                : "Fix failed. No changes were made.",
                            );
                          } finally {
                            setFixing(false);
                          }
                        }}
                      >
                        <Wrench className="size-4" />{" "}
                        {fixing ? "Fixing with AI…" : `Fix Issues (${fixableCount})`}
                      </Button>
                    );
                  }}
                </QueryBoundary>
                {AUTO_FIX_ENABLED && activeJob.fixedAt ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await linelistApi.downloadCsv(activeJob.id);
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Could not download this file.",
                        );
                      }
                    }}
                  >
                    <Download className="size-4" /> Download Fixed CSV
                  </Button>
                ) : null}
                {activeJob.stage === "VALIDATED" || activeJob.stage === "E2B_GENERATED" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await linelistApi.downloadExecutiveSummary(activeJob.id);
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Could not download the summary.",
                        );
                      }
                    }}
                  >
                    <FileText className="size-4" /> Download Executive Summary
                  </Button>
                ) : null}
              </div>
            }
          >
            {aiNotice ? (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>{aiNotice}</span>
              </div>
            ) : null}
            <QueryBoundary query={issues}>
              {(rows) =>
                rows.length === 0 ? (
                  <EmptyState
                    title={
                      activeJob.stage === "VALIDATED" || activeJob.stage === "E2B_GENERATED"
                        ? "Validation completed. No issues were detected in this file."
                        : activeJob.stage === "FAILED"
                          ? "This file could not be parsed — see the job's status above."
                          : 'This file has not been validated yet — click "Re-run validation" above to check it.'
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50 text-left">
                          {[
                            "Row",
                            "Column",
                            "Severity",
                            "Confidence",
                            "Source",
                            "Code",
                            "Message",
                            "Value",
                            "Fixable",
                          ].map((h) => (
                            <th key={h} className="label-caps px-3 py-2">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((i, idx) => (
                          <tr
                            key={`${i.row}-${i.column}-${idx}`}
                            className="border-b border-border last:border-0"
                          >
                            <td className="mono-num px-3 py-2">{i.row}</td>
                            <td className="mono-num px-3 py-2">{i.column}</td>
                            <td className="px-3 py-2">
                              <StatusPill
                                tone={
                                  i.severity === "CRITICAL"
                                    ? "critical"
                                    : i.severity === "HIGH"
                                      ? "warning"
                                      : i.severity === "MEDIUM"
                                        ? "info"
                                        : "neutral"
                                }
                              >
                                {i.severity.toLowerCase()}
                              </StatusPill>
                            </td>
                            <td className="px-3 py-2">
                              {i.confidence ? (
                                <StatusPill tone={i.confidence === "LOW" ? "warning" : "neutral"}>
                                  {i.confidence.toLowerCase()}
                                </StatusPill>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <StatusPill tone={i.source === "ai" ? "assist" : "neutral"}>
                                {i.source === "ai" ? "AI" : "rule"}
                              </StatusPill>
                            </td>
                            <td className="mono-num px-3 py-2 text-xs">{i.code}</td>
                            <td className="px-3 py-2">{i.message}</td>
                            <td className="mono-num px-3 py-2 text-muted-foreground">
                              {i.value ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {i.fixable ? "Yes" : "No"}
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
        ) : null}
      </div>
    </>
  );
}
