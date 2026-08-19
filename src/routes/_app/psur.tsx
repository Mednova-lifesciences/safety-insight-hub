import { createFileRoute } from "@tanstack/react-router";
import { PermissionGate } from "@/components/pv/permission-gate";
import { useState } from "react";
import { ArrowRight, Upload } from "lucide-react";
import { toast } from "sonner";
import { psur as psurApi } from "@/services/api/psur";
import { demoPsurDocuments, demoPsurFindings } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
import {
  AssistLabel,
  EmptyState,
  Field,
  PageHeader,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
  type Tone,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import type { PsurFinding } from "@/types/pv";

export const Route = createFileRoute("/_app/psur")({
  head: () => ({
    meta: [
      { title: "PSUR / PBRER review — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Upload a PSUR/PBRER, extract its structure and review completeness, consistency and numerical findings.",
      },
      { property: "og:title", content: "PSUR / PBRER review — MedNova PV Assist" },
      {
        property: "og:description",
        content:
          "Review assistance for periodic safety reports, with the final assessment recorded by a human.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="psur.review">
      <PsurPage />
    </PermissionGate>
  ),
});

const FLOW = [
  "Upload PDF",
  "Extract document",
  "Identify sections",
  "Check completeness",
  "Check consistency",
  "Review findings",
  "Human assessment",
];

const categoryTone: Record<PsurFinding["category"], Tone> = {
  MISSING_SECTION: "critical",
  CONSISTENCY: "warning",
  NUMERICAL: "warning",
  SIGNAL: "info",
  BENEFIT_RISK: "assist",
};

function PsurPage() {
  const docs = usePvQuery(
    ["psur", "documents"],
    () => psurApi.documents(),
    () => demoPsurDocuments,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const activeDoc = (docs.data?.data ?? []).find((d) => d.id === selected) ?? docs.data?.data?.[0];
  const findings = usePvQuery(
    ["psur", "findings", activeDoc?.id ?? "none"],
    async () => (await psurApi.review(activeDoc!.id)).findings,
    () => demoPsurFindings,
  );
  const [uploading, setUploading] = useState(false);

  return (
    <>
      <PageHeader
        title="PSUR / PBRER review"
        description="Review assistance for periodic safety reports. Findings are generated to support a reviewer — they are not a regulatory assessment."
        meta={
          <>
            <AssistLabel>Review assistance — human assessment required</AssistLabel>
            {docs.data ? <SourceTag source={docs.data.source} /> : null}
          </>
        }
      />

      <div className="space-y-4 p-6">
        <Section title="Review flow">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            {FLOW.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="rounded-md border border-border bg-muted px-2.5 py-1 text-muted-foreground">
                  {s}
                </span>
                {i < FLOW.length - 1 ? (
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                ) : null}
              </li>
            ))}
          </ol>
        </Section>

        <Section
          title="Upload a periodic report"
          description="PDF narrative report, or an XLSX/CSV cumulative summary tabulation. Extraction and analysis run server-side."
        >
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border px-6 py-8 text-center hover:bg-muted/50">
            <Upload className="size-5 text-muted-foreground" />
            <span className="text-sm font-medium">
              {uploading ? "Uploading…" : "Choose a PDF, XLSX or CSV"}
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf,.xlsx,.xls,.csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                try {
                  await psurApi.upload(f);
                  toast.success("Document uploaded. Extraction queued.");
                  docs.refetch();
                } catch (err) {
                  toast.error(
                    isNotConfigured(err)
                      ? "Backend not connected — the document was not uploaded."
                      : "Upload failed.",
                  );
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
        </Section>

        <Section title="Documents">
          <QueryBoundary query={docs}>
            {(items) =>
              items.length === 0 ? (
                <EmptyState
                  title="No documents"
                  description="Upload a PSUR/PBRER to begin a review."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                      <span className="text-sm font-medium">{d.filename}</span>
                      <StatusPill tone="neutral">{d.product}</StatusPill>
                      <StatusPill tone="info">{d.reportingPeriod}</StatusPill>
                      <StatusPill
                        tone={
                          d.stage === "FAILED"
                            ? "critical"
                            : d.stage === "REVIEWED"
                              ? "success"
                              : "info"
                        }
                      >
                        {d.stage.toLowerCase()}
                      </StatusPill>
                      <span className="mono-num text-xs text-muted-foreground">
                        {d.pages} {d.sourceType === "SPREADSHEET" ? "case rows" : "pages"}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        onClick={() => setSelected(d.id)}
                      >
                        Open review
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryBoundary>
        </Section>

        {activeDoc ? (
          <>
            <Section title="Document metadata">
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="File" value={activeDoc.filename} />
                <Field label="Product" value={activeDoc.product} />
                <Field label="Reporting period" value={activeDoc.reportingPeriod} />
                <Field
                  label="Uploaded by"
                  value={`${activeDoc.uploadedBy} · ${activeDoc.uploadedAt.slice(0, 10)}`}
                />
              </div>
            </Section>

            <Section
              title="Review findings"
              description="Missing sections, consistency issues, numerical discrepancies, signal-related items and benefit-risk areas requiring attention."
              actions={findings.data ? <SourceTag source={findings.data.source} /> : null}
            >
              <QueryBoundary query={findings} loadingLabel="Analysing document">
                {(items) =>
                  items.length === 0 ? (
                    <EmptyState title="No findings returned" />
                  ) : (
                    <ul className="space-y-3">
                      {items.map((f) => (
                        <li key={f.id} className="rounded-md border border-border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill tone={categoryTone[f.category]}>
                              {f.category.replaceAll("_", " ").toLowerCase()}
                            </StatusPill>
                            <StatusPill
                              tone={
                                f.severity === "HIGH"
                                  ? "critical"
                                  : f.severity === "MEDIUM"
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              {f.severity.toLowerCase()} severity
                            </StatusPill>
                            <span className="text-sm font-medium">{f.section}</span>
                            {f.assistGenerated ? (
                              <AssistLabel>AI-generated review assistance</AssistLabel>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm">{f.description}</p>
                          <p className="mt-1 border-l-2 border-border pl-2 text-xs text-muted-foreground">
                            {f.evidence}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                try {
                                  await psurApi.recordAssessment(
                                    activeDoc.id,
                                    f.id,
                                    "ACCEPTED",
                                    "Confirmed by reviewer",
                                  );
                                  toast.success("Assessment recorded.");
                                } catch (err) {
                                  toast.error(
                                    isNotConfigured(err)
                                      ? "Backend not connected — the assessment was not recorded."
                                      : "Could not record the assessment.",
                                  );
                                }
                              }}
                            >
                              Accept finding
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                try {
                                  await psurApi.recordAssessment(
                                    activeDoc.id,
                                    f.id,
                                    "DISMISSED",
                                    "Not applicable",
                                  );
                                  toast.success("Assessment recorded.");
                                } catch (err) {
                                  toast.error(
                                    isNotConfigured(err)
                                      ? "Backend not connected — the assessment was not recorded."
                                      : "Could not record the assessment.",
                                  );
                                }
                              }}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </QueryBoundary>
            </Section>
          </>
        ) : null}
      </div>
    </>
  );
}
