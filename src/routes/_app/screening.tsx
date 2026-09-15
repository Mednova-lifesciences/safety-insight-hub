import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, FileText, Info } from "lucide-react";
import { PermissionGate } from "@/components/pv/permission-gate";
import { PsurScreeningDecision } from "@/components/pv/psur-screening-decision";
import {
  PageHeader,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
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
 * The Review Officer's queue — the first of the three steps a periodic
 * report passes through at NAFDAC.
 *
 * What the officer's checks will actually BE is not settled yet: NAFDAC has
 * supplied the V4 template for the scientific review (which drives /psur)
 * but not the equivalent for screening. Rather than invent one, this page
 * gives the officer the two things that are certain — the queue of reports
 * nobody has triaged, and the forward/return decision — and says plainly
 * that the checks themselves are still to come. A placeholder that admits
 * what it is beats a fabricated checklist that looks authoritative.
 *
 * The Administrative Completeness Check the AI already performs stays on
 * /psur, where the officer can read it in full; only the DECISION is
 * duplicated here, through the same shared component, so the two surfaces
 * cannot disagree.
 */
export const Route = createFileRoute("/_app/screening")({
  head: () => ({
    meta: [
      { title: "Report screening — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Triage incoming periodic safety reports and decide whether they proceed to scientific review or return to the MAH.",
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

  return (
    <>
      <PageHeader
        title="Report screening"
        description="Incoming periodic safety reports awaiting triage. Decide whether each proceeds to scientific review or returns to the MAH."
      />

      <div className="space-y-4 p-6">
        <Section title="Screening checks">
          <div className="flex gap-3 rounded-md border border-dashed border-border bg-muted/40 p-4">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1 text-sm">
              <p className="font-medium">The officer&rsquo;s own checks are not built yet.</p>
              <p className="text-muted-foreground">
                NAFDAC has provided the V4 template for the scientific review, but not the
                equivalent for screening. Until it arrives, use the AI Administrative Completeness
                Check on the{" "}
                <Link to="/psur" className="underline">
                  PSUR / PBRER review
                </Link>{" "}
                page as your reference, and record the decision here or there — both write the same
                record.
              </p>
            </div>
          </div>
        </Section>

        <QueryBoundary query={docs} loadingLabel="Loading screening queue">
          {(items, source) => {
            const awaiting = items.filter(isAwaitingScreening);
            const decided = items.filter((d) => !isAwaitingScreening(d));
            return (
              <>
                <Section
                  title="Awaiting screening"
                  description={
                    awaiting.length === 0
                      ? "Nothing is waiting on you right now."
                      : `${awaiting.length} report${awaiting.length === 1 ? "" : "s"} to triage.`
                  }
                  actions={<SourceTag source={source} />}
                >
                  {awaiting.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Reports appear here as soon as they are uploaded.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {awaiting.map((doc) => (
                        <ScreeningQueueRow
                          key={doc.id}
                          doc={doc}
                          onChanged={() => docs.refetch()}
                        />
                      ))}
                    </div>
                  )}
                </Section>

                <Section
                  title="Already triaged"
                  description="Reports you have sent forward or returned. The compliance directive for a completed review is downloaded from here."
                >
                  {decided.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing triaged yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {decided.map((doc) => (
                        <TriagedRow key={doc.id} doc={doc} />
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
        {doc.product} · {doc.reportingPeriod} · uploaded by {doc.uploadedBy} on{" "}
        {doc.uploadedAt.slice(0, 10)}
      </p>
    </div>
  );
}

function ScreeningQueueRow({ doc, onChanged }: { doc: PsurDocument; onChanged: () => void }) {
  const checks = doc.screening?.administrativeChecks ?? [];
  const failed = checks.filter((c) => c.status === "NO");

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <DocumentSummary doc={doc} />
        <Button asChild size="sm" variant="outline">
          <Link to="/psur">
            Open full check <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      {/* A short read of what the AI check found, so the officer is not
          forced onto another page to make an obvious call. The detail
          stays on /psur rather than being duplicated here. */}
      {checks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No administrative completeness check has run on this report yet.
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <StatusPill tone={failed.length > 0 ? "critical" : "success"}>
            {failed.length > 0
              ? `${failed.length} of ${checks.length} checks failed`
              : `${checks.length} checks passed`}
          </StatusPill>
          {failed.length > 0 ? (
            <span className="text-muted-foreground">{failed.map((c) => c.label).join("; ")}</span>
          ) : null}
        </p>
      )}

      <PsurScreeningDecision doc={doc} onChanged={onChanged} />
    </div>
  );
}

function TriagedRow({ doc }: { doc: PsurDocument }) {
  const [downloading, setDownloading] = useState(false);
  const stage = deriveWorkflowStage(doc);

  // The directive is built from the findings of the COMPLETED scientific
  // review, so it does not exist until a peer reviewer has signed off.
  // Offering the button earlier would hand the officer an empty document.
  const directiveReady = isPeerReviewed(doc);

  async function download(kind: "docx" | "text") {
    setDownloading(true);
    try {
      if (kind === "docx") await psurApi.downloadComplianceDirective(doc.id);
      else await psurApi.downloadComplianceDirectiveText(doc.id);
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
        {directiveReady ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={downloading}
              onClick={() => download("docx")}
            >
              <FileText className="size-4" /> Compliance Directive (Word)
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
