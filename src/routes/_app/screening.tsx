import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { FileText, Upload } from "lucide-react";
import { PermissionGate } from "@/components/pv/permission-gate";
import {
  PsurScreeningChecklist,
  ScreeningSummaryPill,
} from "@/components/pv/psur-screening-checklist";
import {
  AssistLabel,
  EmptyState,
  PageHeader,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePvQuery } from "@/lib/data-source";
import { psur as psurApi } from "@/services/api/psur";
import { demoPsurDocuments } from "@/services/demo/dataset";
import {
  WORKFLOW_STAGE_LABELS,
  deriveWorkflowStage,
  isAwaitingScreening,
  isPeerReviewed,
} from "@/services/psur/workflow";
import type { PsurDocument } from "@/types/pv";

/**
 * The Review Officer's desk — NAFDAC's PSUR Administrative Screening
 * Checklist, completed on receipt before a report is allocated for
 * scientific assessment.
 *
 * Three things live here and nowhere else: the incoming report is uploaded
 * here, the 16-item checklist is completed here, and the accept/return
 * decision is taken here. The evaluator's page (/psur) holds the scientific
 * review and never shows any of this.
 *
 * Uploading is on this page rather than /psur because upload IS receipt —
 * it is the moment a submission enters the process, which is the officer's
 * job. The AI screening runs at that moment too, because the PDF's bytes
 * are not retained afterwards.
 */
export const Route = createFileRoute("/_app/screening")({
  head: () => ({
    meta: [
      { title: "Report screening — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Complete NAFDAC's PSUR administrative screening checklist and decide whether a submission proceeds to scientific assessment.",
      },
      { property: "og:title", content: "Report screening — MedNova PV Assist" },
      {
        property: "og:description",
        content: "The Review Officer's queue for incoming periodic safety reports.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="psur.screen">
      <ScreeningPage />
    </PermissionGate>
  ),
});

function ScreeningPage() {
  const docs = usePvQuery(
    ["psur", "documents"],
    () => psurApi.documents(),
    () => demoPsurDocuments,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const all = docs.data?.data ?? [];
  const awaiting = all.filter(isAwaitingScreening);
  // Default to the first untriaged report, so the page opens on work rather
  // than on an empty pane.
  const active = all.find((d) => d.id === selectedId) ?? awaiting[0];

  return (
    <>
      <PageHeader
        title="Report screening"
        description="Complete the administrative screening checklist on receipt, before the report is allocated for scientific assessment."
        meta={
          <>
            <AssistLabel>AI completes the checklist — your confirmation is required</AssistLabel>
            {docs.data ? <SourceTag source={docs.data.source} /> : null}
          </>
        }
      />

      <div className="space-y-4 p-6">
        <Section
          title="Receive a report"
          description="Uploading records the submission as received and runs the screening checks. The date of receipt is taken from this moment."
        >
          <label
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-border px-4 py-3 text-sm transition-colors hover:bg-muted",
              uploading && "pointer-events-none opacity-60",
            )}
          >
            <Upload className="size-4" />
            <span>{uploading ? "Screening the submission…" : "Choose a PSUR/PBRER file"}</span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.xlsx,.xls,.csv"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                try {
                  const created = await psurApi.upload(file);
                  setSelectedId(created.id);
                  toast.success("Received. The screening checklist is ready for your review.");
                  docs.refetch();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not receive this file.");
                } finally {
                  setUploading(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
        </Section>

        <QueryBoundary query={docs} loadingLabel="Loading screening queue">
          {(items) => {
            const untriaged = items.filter(isAwaitingScreening);
            const triaged = items.filter((d) => !isAwaitingScreening(d));
            return (
              <>
                <Section
                  title="Awaiting screening"
                  description={
                    untriaged.length === 0
                      ? "Nothing is waiting on you right now."
                      : `${untriaged.length} report${untriaged.length === 1 ? "" : "s"} to screen.`
                  }
                >
                  {untriaged.length === 0 ? (
                    <EmptyState
                      title="Nothing to screen"
                      description="Reports appear here as soon as they are received."
                    />
                  ) : (
                    <div className="space-y-2">
                      {untriaged.map((doc) => (
                        <QueueRow
                          key={doc.id}
                          doc={doc}
                          selected={doc.id === active?.id}
                          onSelect={() => setSelectedId(doc.id)}
                        />
                      ))}
                    </div>
                  )}
                </Section>

                {active ? (
                  <Section
                    title={`Screening: ${active.filename}`}
                    description={`${active.product} · ${active.reportingPeriod}`}
                  >
                    <PsurScreeningChecklist
                      key={active.id}
                      doc={active}
                      onChanged={() => docs.refetch()}
                    />
                  </Section>
                ) : null}

                <Section
                  title="Already screened"
                  description="Reports you have accepted or returned. The compliance directive for a completed review is downloaded from here."
                >
                  {triaged.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing screened yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {triaged.map((doc) => (
                        <TriagedRow key={doc.id} doc={doc} onOpen={() => setSelectedId(doc.id)} />
                      ))}
                    </div>
                  )}
                </Section>
              </>
            );
          }}
        </QueryBoundary>
      </div>
    </>
  );
}

function DocumentSummary({ doc }: { doc: PsurDocument }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{doc.filename}</p>
      <p className="text-xs text-muted-foreground">
        {doc.product} · {doc.reportingPeriod} · received {doc.uploadedAt.slice(0, 10)}
      </p>
    </div>
  );
}

function QueueRow({
  doc,
  selected,
  onSelect,
}: {
  doc: PsurDocument;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors",
        selected ? "border-primary bg-accent" : "border-border hover:bg-muted",
      )}
    >
      <DocumentSummary doc={doc} />
      <ScreeningSummaryPill doc={doc} />
    </button>
  );
}

function TriagedRow({ doc, onOpen }: { doc: PsurDocument; onOpen: () => void }) {
  const [downloading, setDownloading] = useState(false);
  const stage = deriveWorkflowStage(doc);
  // The directive is built from the findings of the COMPLETED scientific
  // review, so it does not exist until a peer reviewer has signed off.
  const directiveReady = isPeerReviewed(doc) || stage === "RETURNED_TO_MAH";

  // Two different letters, and which one applies depends on how far the
  // report got. A submission returned at screening has no scientific review
  // to write a compliance directive from — the screening directive IS what
  // the MAH receives. A report that went all the way through gets the
  // directive built from the evaluator's findings.
  const returnedAtScreening = stage === "RETURNED_TO_MAH";

  async function download(kind: "docx" | "text") {
    setDownloading(true);
    try {
      if (returnedAtScreening) {
        if (kind === "docx") await psurApi.downloadScreeningDirective(doc.id);
        else await psurApi.downloadScreeningDirectiveText(doc.id);
      } else if (kind === "docx") {
        await psurApi.downloadComplianceDirective(doc.id);
      } else {
        await psurApi.downloadComplianceDirectiveText(doc.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not download the directive.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <DocumentSummary doc={doc} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={stage === "RETURNED_TO_MAH" ? "neutral" : "success"}>
          {WORKFLOW_STAGE_LABELS[stage]}
        </StatusPill>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          View checklist
        </Button>
        {directiveReady ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={downloading}
              onClick={() => download("docx")}
            >
              <FileText className="size-4" />{" "}
              {returnedAtScreening ? "Screening Directive (Word)" : "Compliance Directive (Word)"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={downloading}
              onClick={() => download("text")}
            >
              Plain text
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
