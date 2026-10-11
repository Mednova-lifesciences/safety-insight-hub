import { createFileRoute } from "@tanstack/react-router";
import { PermissionGate } from "@/components/pv/permission-gate";
import { useState } from "react";
import { ArrowRight, Download, FileText, Sparkles, Upload, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  linelist as linelistApi,
  DEFAULT_SOURCE_PROFILE_ID,
  describeRow,
} from "@/services/api/linelist";
import {
  E2bReadinessBanner,
  FixAction,
  ParsingOptionsPanel,
  ReactionTermsPanel,
} from "@/components/pv/linelist-e2b-panels";
import { CodeListPanel } from "@/components/pv/linelist-code-list-panel";
import { listSourceProfiles } from "@/services/e2b-r3/source-profiles/registry";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { demoLineListIssues, demoLineListJobs } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
import { AUTO_FIX_ENABLED, RULE_BASED_DETECTION_ENABLED } from "@/services/api/feature-flags";
import {
  EmptyState,
  Pager,
  PageHeader,
  paginate,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { LineListDecisionControl } from "@/components/pv/linelist-decision-control";
import { LineListChangesPanel } from "@/components/pv/linelist-changes-panel";
import { notHeld } from "@/services/api/linelist-change-log";
import {
  decidedRowsWithoutIssues,
  decisionCounts,
  issuesForFilter,
  keptOnly,
  type DecisionFilter,
} from "@/services/api/linelist-decisions";
import type { LineListIssue, LineListJob } from "@/types/pv";
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
  "VigiFlow preflight",
  "Download validated E2B(R3) XML",
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
  // Which SourceProfile decodes the next upload. This is a property of the
  // FORM the file came from — above all, whether its reaction column holds
  // local codes needing a codebook, or the reaction written out as words —
  // and only the person uploading knows. Deliberately not sniffed from the
  // data: "19" and "R19" are both plausible codes, and guessing wrong sends
  // a raw code to a regulator as if it were the reaction itself.
  const [sourceProfileId, setSourceProfileId] = useState(DEFAULT_SOURCE_PROFILE_ID);
  const [uploading, setUploading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("ALL");
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [jobsPage, setJobsPage] = useState(1);
  const [onlyE2bBlockers, setOnlyE2bBlockers] = useState(false);

  async function onFile(file: File) {
    setUploading(true);
    try {
      const created = await linelistApi.upload(file, sourceProfileId);
      // Show the file just uploaded, so Re-run validation acts on it and
      // not on whichever job happened to be on screen before.
      setSelected(created.id);
      toast.success("File uploaded.");
      setJobsPage(1);
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
          <div className="mb-3">
            <p className="label-caps mb-1">Source form</p>
            <Select value={sourceProfileId} onValueChange={setSourceProfileId}>
              <SelectTrigger className="w-full sm:w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {listSourceProfiles().map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Determines how this file's reaction column is read — as local codes needing that
              form's codebook, or as reactions already written out in words. Choosing wrongly blocks
              E2B(R3) export rather than producing a wrong answer.
            </p>
          </div>
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
                      {paginate(items, jobsPage).map((j) => (
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
                  <Pager page={jobsPage} total={items.length} onPageChange={setJobsPage} />
                </div>
              )
            }
          </QueryBoundary>
        </Section>

        {activeJob ? <ColumnMappingPanel job={activeJob} /> : null}
        {activeJob ? (
          <ParsingOptionsPanel
            job={activeJob}
            onSaved={() => {
              jobs.refetch();
              issues.refetch();
            }}
          />
        ) : null}
        {activeJob && activeJob.stage !== "FAILED" ? (
          <CodeListPanel
            key={activeJob.id}
            job={activeJob}
            onSaved={() => Promise.all([jobs.refetch(), issues.refetch()])}
          />
        ) : null}

        {activeJob ? (
          <Section
            title={`Validation issues — ${activeJob.filename}`}
            description="Every row-level error and warning, from both the AI analysis pass and deterministic rule checks."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  // Not while a file is uploading: until it lands, the job on
                  // screen is the previous one.
                  disabled={validating || uploading}
                  onClick={() => runValidate(activeJob.id)}
                >
                  {validating ? "Re-running…" : "Re-run validation"}
                </Button>
                <QueryBoundary query={issues}>
                  {(rows) => {
                    if (!AUTO_FIX_ENABLED) return null;
                    // Dropped and held cases are not fixed (spec 5.1), and
                    // neither is a cell a person took over with Undo.
                    const fixableCount = notHeld(
                      keptOnly(rows, activeJob.decisions).filter((i) => i.fixable),
                      activeJob.changeLog,
                    ).length;
                    if (fixableCount === 0) return null;
                    return (
                      <Button
                        size="sm"
                        disabled={fixing || uploading}
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
                                `${result.correctionsApplied} field(s) corrected — see Changes made below.${result.unresolved.length ? ` ${result.unresolved.length} left unresolved.` : ""}`,
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
                {/* Offered once the file is validated, whether or not Fix changed
                    anything: the fixed file also carries the onset date used
                    for E2B and what still needs review. */}
                {AUTO_FIX_ENABLED &&
                (activeJob.fixedAt ||
                  (activeJob.decisions ?? []).length > 0 ||
                  activeJob.stage === "VALIDATED" ||
                  activeJob.stage === "E2B_GENERATED") ? (
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
              {(allRows) => {
                const counted = keptOnly(allRows, activeJob.decisions);
                // The filter row is hidden when there are no decisions, so a stale filter must not apply.
                const effectiveFilter: DecisionFilter =
                  (activeJob.decisions ?? []).length > 0 ? decisionFilter : "ALL";
                const base = onlyE2bBlockers ? allRows.filter((i) => i.blocksE2b) : allRows;
                const { kept, decided } = issuesForFilter(
                  base,
                  activeJob.decisions,
                  effectiveFilter,
                );
                const rows = [...kept, ...decided];
                const { held } = decisionCounts(activeJob.decisions);
                const withoutIssues = decidedRowsWithoutIssues(
                  allRows,
                  activeJob.decisions,
                  effectiveFilter,
                );
                const refresh = () => {
                  issues.refetch();
                  jobs.refetch();
                };
                const renderIssueRow = (i: LineListIssue, idx: number, muted: boolean) => (
                  <tr
                    key={`${i.row}-${i.column}-${idx}`}
                    className={cn("border-b border-border last:border-0", muted && "opacity-60")}
                  >
                    <td className="mono-num px-3 py-2">
                      {i.row < 1 ? "—" : (describeRow(activeJob, i.row).fileRow ?? `#${i.row}`)}
                    </td>
                    <td className="mono-num whitespace-nowrap px-3 py-2">
                      {describeRow(activeJob, i.row).caseId ?? "—"}
                    </td>
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
                      {i.blocksE2b ? (
                        <StatusPill tone="critical">Blocks</StatusPill>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <p>{i.message}</p>
                      <FixAction fixIn={i.fixIn} />
                    </td>
                    <td className="mono-num px-3 py-2 text-muted-foreground">{i.value ?? "—"}</td>
                    <td className="px-3 py-2">
                      <StatusPill
                        tone={
                          i.sources && i.sources.length > 1
                            ? "success"
                            : i.source === "ai"
                              ? "assist"
                              : "neutral"
                        }
                      >
                        {i.sources && i.sources.length > 1
                          ? "rule + AI"
                          : i.source === "ai"
                            ? "AI"
                            : "rule"}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2">
                      <LineListDecisionControl job={activeJob} row={i.row} onChanged={refresh} />
                    </td>
                  </tr>
                );
                return (
                  <div className="space-y-3">
                    <E2bReadinessBanner job={activeJob} issues={counted} />
                    {allRows.some((i) => i.blocksE2b) ? (
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={onlyE2bBlockers}
                          onChange={(e) => setOnlyE2bBlockers(e.target.checked)}
                        />
                        Show only what blocks E2B(R3) / VigiFlow
                      </label>
                    ) : null}
                    {(activeJob.decisions ?? []).length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Show:</span>
                        {(
                          [
                            ["ALL", "All"],
                            ["KEPT", "Kept"],
                            ["DROPPED", "Dropped"],
                            ["HELD", `Held (${held})`],
                          ] as [DecisionFilter, string][]
                        ).map(([value, label]) => (
                          <Button
                            key={value}
                            size="sm"
                            variant={decisionFilter === value ? "default" : "outline"}
                            className="h-7 px-2.5 text-xs"
                            onClick={() => setDecisionFilter(value)}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    {rows.length === 0 && withoutIssues.length === 0 ? (
                      <EmptyState
                        title={
                          effectiveFilter !== "ALL"
                            ? "No cases match this filter."
                            : activeJob.stage === "VALIDATED" || activeJob.stage === "E2B_GENERATED"
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
                                "File row",
                                "Case ID",
                                "Column",
                                "Severity",
                                "E2B",
                                "Problem",
                                "Value",
                                "Source",
                                "Decision",
                              ].map((h) => (
                                <th key={h} className="label-caps px-3 py-2">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {kept.map((i, idx) => renderIssueRow(i, idx, false))}
                            {kept.length > 0 && decided.length + withoutIssues.length > 0 ? (
                              <tr className="border-b border-border bg-muted/30">
                                <td
                                  colSpan={9}
                                  className="px-3 py-1.5 text-xs text-muted-foreground"
                                >
                                  Dropped or held — not counted
                                </td>
                              </tr>
                            ) : null}
                            {decided.map((i, idx) => renderIssueRow(i, kept.length + idx, true))}
                            {withoutIssues.map((row) => (
                              <tr
                                key={`decided-${row}`}
                                className="border-b border-border last:border-0 opacity-60"
                              >
                                <td className="mono-num px-3 py-2">
                                  {describeRow(activeJob, row).fileRow ?? `#${row}`}
                                </td>
                                <td className="mono-num whitespace-nowrap px-3 py-2">
                                  {describeRow(activeJob, row).caseId ?? "—"}
                                </td>
                                <td colSpan={6} className="px-3 py-2 text-xs text-muted-foreground">
                                  No open issues
                                </td>
                                <td className="px-3 py-2">
                                  <LineListDecisionControl
                                    job={activeJob}
                                    row={row}
                                    onChanged={refresh}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <ReactionTermsPanel
                      job={activeJob}
                      issues={allRows}
                      onDecided={() => {
                        jobs.refetch();
                        issues.refetch();
                      }}
                    />
                    <LineListChangesPanel
                      job={activeJob}
                      onChanged={() => {
                        issues.refetch();
                        jobs.refetch();
                      }}
                    />
                  </div>
                );
              }}
            </QueryBoundary>
          </Section>
        ) : null}
      </div>
    </>
  );
}

/** How each of this file's columns was understood, and by what.
 *
 * The deterministic keyword matcher only knows the header spellings it has
 * been taught — measured against 33 plausible names for a reaction column
 * it matched 9 — so a model reads the headers too and wins where it is
 * confident. That makes "which column is the reaction?" an answer someone
 * should be able to see and disagree with, rather than an invisible
 * decision, so every AI-decided column is labelled as such and carries the
 * model's reason.
 */
function ColumnMappingPanel({ job }: { job: LineListJob }) {
  const mapping = (job as { mapping?: Record<string, string> }).mapping;
  const source = (job as { mappingSource?: Record<string, string> }).mappingSource ?? {};
  const notes = (job as { mappingNotes?: Record<string, string> }).mappingNotes ?? {};
  const columns = (job as { columns?: string[] }).columns ?? [];
  // Absent (rather than false) on jobs uploaded before the AI pass existed
  // — those are not claimed to have degraded, they simply predate it.
  const aiUsed = (job as { mappingAiUsed?: boolean }).mappingAiUsed;
  if (!mapping || columns.length === 0) return null;

  const unmapped = columns.filter((c) => !mapping[c]);

  return (
    <Section
      title="Column mapping"
      description="Which field each column of the uploaded file was read as. Columns decided by the AI pass are marked; everything else was matched by keyword."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="py-2 pr-4">Column in file</th>
              <th className="py-2 pr-4">Read as</th>
              <th className="py-2 pr-4">Decided by</th>
              <th className="py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => (
              <tr key={column} className="border-t border-border/60 align-top">
                <td className="py-2 pr-4 font-medium">{column}</td>
                <td className="py-2 pr-4">
                  {mapping[column] ? (
                    <code className="mono-num">{mapping[column]}</code>
                  ) : (
                    <span className="text-muted-foreground">not mapped</span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {mapping[column] ? (source[column] === "ai" ? "AI" : "Keyword") : "—"}
                </td>
                <td className="py-2 text-muted-foreground">{notes[column] ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {aiUsed === false ? (
        <p className="mt-3 text-xs text-muted-foreground">
          The AI reading of these headers was unavailable for this upload, so the columns were
          matched by keyword only. Keyword matching recognises the header spellings it has been
          taught and no others, so a column may be unmapped here that would otherwise have been
          understood — re-upload the file to try again.
        </p>
      ) : null}
      {unmapped.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {unmapped.length} column{unmapped.length === 1 ? "" : "s"} could not be matched to a
          field, so nothing in {unmapped.length === 1 ? "it" : "them"} is validated or exported. An
          unmapped column is reported rather than guessed at — tell us what it holds and it can be
          added.
        </p>
      ) : null}
    </Section>
  );
}
