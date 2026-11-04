import { Link, createFileRoute } from "@tanstack/react-router";
import { PermissionGate } from "@/components/pv/permission-gate";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { signals as signalsApi } from "@/services/api/signals";
import { cases as casesApi } from "@/services/api/cases";
import { demoCases, demoSignals } from "@/services/demo/dataset";
import {
  branchPatternNote,
  caseClusters,
  type CaseForClusters,
} from "@/services/api/case-clusters";
import { QUALITY_SIGN_LABELS } from "@/services/api/linelist-clusters";
import { Checkbox } from "@/components/ui/checkbox";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
import {
  EmptyState,
  PageHeader,
  Pager,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
  paginate,
  type Tone,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermission } from "@/lib/auth";
import type { Signal } from "@/types/pv";

export const Route = createFileRoute("/_app/signals")({
  head: () => ({
    meta: [
      { title: "Signal review — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Potential, under-review, confirmed and refuted safety signals with statistical evidence and recorded rationale.",
      },
      { property: "og:title", content: "Signal review — MedNova PV Assist" },
      {
        property: "og:description",
        content: "Administrator signal workspace with auditable confirm/refute decisions.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="signal.view">
      <SignalsPage />
    </PermissionGate>
  ),
});

const statusTone: Record<Signal["status"], Tone> = {
  POTENTIAL: "warning",
  UNDER_REVIEW: "info",
  CONFIRMED: "critical",
  REFUTED: "neutral",
  MONITOR: "info",
};

function SignalCard({
  s,
  canDecide,
  canTriage,
  onChanged,
}: {
  s: Signal;
  canDecide: boolean;
  canTriage: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"CONFIRMED" | "REFUTED" | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function decide() {
    if (rationale.trim().length < 10) {
      toast.error("A documented rationale is required before a signal decision can be recorded.");
      return;
    }
    setBusy(true);
    try {
      await signalsApi.decide(s.id, mode!, rationale.trim());
      toast.success(`Signal ${mode!.toLowerCase()} and removed from the active review queue.`);
      setMode(null);
      setRationale("");
      onChanged();
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — no signal decision was recorded."
          : "The decision could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-border" data-e2e-signal={s.id}>
      <div
        className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 hover:bg-muted/40"
        onClick={() => setExpanded((v) => !v)}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} details for ${s.reference}`}
          className="flex size-6 items-center justify-center rounded hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          <ChevronRight
            className={"size-4 transition-transform " + (expanded ? "rotate-90" : "")}
          />
        </button>
        <span className="mono-num text-sm font-semibold">{s.reference}</span>
        <StatusPill tone={statusTone[s.status]}>
          {s.status.replaceAll("_", " ").toLowerCase()}
        </StatusPill>
        <span className="text-sm">
          {s.product} <span className="text-muted-foreground">/</span> {s.reaction}
        </span>
        <span className="mono-num ml-auto text-xs text-muted-foreground">{s.caseCount} cases</span>
      </div>

      {expanded ? (
        <div className="border-t border-border px-4 pt-1 pb-4">
          <dl className="mt-3 grid gap-3 sm:grid-cols-4">
            <div>
              <dt className="label-caps">Detection method</dt>
              <dd className="text-sm">{s.detectionMethod}</dd>
            </div>
            <div>
              <dt className="label-caps">Detection period</dt>
              <dd className="text-sm">{s.detectionPeriod}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="label-caps">Statistical evidence</dt>
              <dd className="mono-num text-sm">
                {s.statistic
                  .map((st) => `${st.name} ${st.value}${st.ci ? ` (${st.ci})` : ""}`)
                  .join(" · ")}
              </dd>
            </div>
          </dl>

          <div className="mt-3">
            <p className="label-caps">Supporting cases</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {s.supportingCaseIds.map((id) => (
                <Link
                  key={id}
                  to="/cases/$caseId"
                  params={{ caseId: id }}
                  className="mono-num text-sm text-primary hover:underline"
                >
                  {id}
                </Link>
              ))}
            </div>
          </div>

          {s.literature ? (
            <div className="mt-3 rounded-md border border-assist/30 bg-assist-soft px-3 py-2 text-sm">
              <p className="label-caps">Literature source</p>
              <p className="mono-num mt-1 text-xs">
                {s.literature.publication} · {s.literature.publicationDate} · {s.literature.author}
              </p>
              <p className="mt-0.5 text-xs">{s.literature.headline}</p>
              <p className="mt-1.5 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                {s.literature.contextSnippet}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {s.literature.keywords.map((k) => (
                  <StatusPill key={k} tone="neutral">
                    {k}
                  </StatusPill>
                ))}
              </div>
            </div>
          ) : null}

          {s.rationale ? (
            <div className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2">
              <p className="label-caps">Recorded rationale</p>
              <p className="mt-1 text-sm">{s.rationale}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {s.reviewer ?? "Reviewer"} · {s.decidedAt?.slice(0, 10)}
              </p>
            </div>
          ) : null}

          {canTriage && s.status === "POTENTIAL" ? (
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  try {
                    await signalsApi.startReview(s.id);
                    toast.success("Review started.");
                    onChanged();
                  } catch (err) {
                    toast.error(
                      isNotConfigured(err)
                        ? "Backend not connected — review not started."
                        : "Could not start review.",
                    );
                  }
                }}
              >
                Start review
              </Button>
            </div>
          ) : null}

          {canDecide && (s.status === "POTENTIAL" || s.status === "UNDER_REVIEW") ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={mode === "CONFIRMED" ? "default" : "outline"}
                  onClick={() => setMode("CONFIRMED")}
                >
                  Confirm signal
                </Button>
                <Button
                  size="sm"
                  variant={mode === "REFUTED" ? "default" : "outline"}
                  onClick={() => setMode("REFUTED")}
                >
                  Refute signal
                </Button>
              </div>
              {mode ? (
                <div className="space-y-2">
                  <label className="label-caps" htmlFor={`rationale-${s.id}`}>
                    Rationale (required, recorded in the audit trail)
                  </label>
                  <Textarea
                    id={`rationale-${s.id}`}
                    rows={3}
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    placeholder="Document the evidence and reasoning supporting this decision."
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={decide} disabled={busy}>
                      Record {mode.toLowerCase()} decision
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {!canDecide && (s.status === "POTENTIAL" || s.status === "UNDER_REVIEW") ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {s.status === "POTENTIAL" && canTriage
                ? "You can start the review; confirming or refuting this signal requires a PV Manager or Administrator."
                : "Confirming or refuting this signal requires a PV Manager or Administrator."}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Signals per page: short enough that the batch and branch clusters below
 *  are a short scroll away. */
const SIGNALS_PER_PAGE = 7;

/** A tab's signals, one line each (open one for its detail), 7 to a page. */
function PagedSignals({
  list,
  canDecide,
  canTriage,
  onChanged,
}: {
  list: Signal[];
  canDecide: boolean;
  canTriage: boolean;
  onChanged: () => void;
}) {
  const [page, setPage] = useState(1);
  const shownPage = Math.min(page, Math.max(1, Math.ceil(list.length / SIGNALS_PER_PAGE)));
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {paginate(list, shownPage, SIGNALS_PER_PAGE).map((s) => (
          <SignalCard
            key={s.id}
            s={s}
            canDecide={canDecide}
            canTriage={canTriage}
            onChanged={onChanged}
          />
        ))}
      </ul>
      <Pager page={shownPage} total={list.length} onPageChange={setPage} size={SIGNALS_PER_PAGE} />
    </div>
  );
}

function SignalsPage() {
  const canDecide = usePermission("signal.decide");
  const canTriage = usePermission("signal.view");
  const query = usePvQuery(
    ["signals"],
    () => signalsApi.list(),
    () => demoSignals,
  );
  const [detecting, setDetecting] = useState(false);

  async function runDetection() {
    setDetecting(true);
    try {
      const result = await signalsApi.runDetection();
      if (result.candidates === 0) {
        toast.success(
          `Scanned ${result.scanned} case(s) — no pair met the detection threshold (N≥3, PRR≥2, χ²≥4).`,
        );
      } else {
        toast.success(
          `Scanned ${result.scanned} case(s): ${result.candidates} candidate(s) found (${result.created} new, ${result.refreshed} refreshed).`,
        );
      }
      query.refetch();
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — detection did not run."
          : "Detection run failed.",
      );
    } finally {
      setDetecting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Signal review"
        description="Safety signals with statistical evidence, supporting cases and recorded review decisions."
        meta={query.data ? <SourceTag source={query.data.source} /> : null}
        actions={
          canDecide ? (
            <Button size="sm" variant="outline" disabled={detecting} onClick={runDetection}>
              <RefreshCw className={detecting ? "size-4 animate-spin" : "size-4"} />
              {detecting ? "Scanning cases…" : "Rerun signal detection"}
            </Button>
          ) : null
        }
      />
      <div className="p-6">
        <QueryBoundary query={query} loadingLabel="Loading signals">
          {(items) => {
            const buckets: [string, Signal[]][] = [
              ["Potential", items.filter((s) => s.status === "POTENTIAL")],
              ["Under review", items.filter((s) => s.status === "UNDER_REVIEW")],
              ["Confirmed", items.filter((s) => s.status === "CONFIRMED")],
              ["Refuted", items.filter((s) => s.status === "REFUTED")],
              [
                "Historical",
                items.filter((s) => s.status === "CONFIRMED" || s.status === "REFUTED"),
              ],
            ];
            return (
              <Tabs defaultValue="Potential">
                <TabsList>
                  {buckets.map(([label, list]) => (
                    <TabsTrigger key={label} value={label}>
                      {label} <span className="mono-num ml-1 text-xs">{list.length}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
                {buckets.map(([label, list]) => (
                  <TabsContent key={label} value={label} className="mt-4">
                    <Section title={`${label} signals`}>
                      {list.length === 0 ? (
                        <EmptyState title={`No ${label.toLowerCase()} signals`} />
                      ) : (
                        <PagedSignals
                          list={list}
                          canDecide={canDecide}
                          canTriage={canTriage}
                          onChanged={() => query.refetch()}
                        />
                      )}
                    </Section>
                  </TabsContent>
                ))}
              </Tabs>
            );
          }}
        </QueryBoundary>
        <BatchBranchClusters />
      </div>
    </>
  );
}

function BatchBranchClusters() {
  const [includeNonSerious, setIncludeNonSerious] = useState(false);
  const [page, setPage] = useState(1);
  const casesQuery = usePvQuery(
    ["cases"],
    () => casesApi.list(),
    () => demoCases,
  );
  return (
    <Section
      className="mt-4"
      title="Batch and branch clusters — for review"
      description="Two or more cases sharing a batch, or the same product at the same branch, within 30 days. Counting, not a conclusion."
      actions={
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={includeNonSerious}
            onCheckedChange={(v) => setIncludeNonSerious(v === true)}
          />
          Include non-serious cases
        </label>
      }
    >
      <QueryBoundary query={casesQuery} loadingLabel="Screening cases">
        {(cases) => {
          const flags = caseClusters(cases as CaseForClusters[], includeNonSerious);
          if (flags.length === 0)
            return (
              <EmptyState
                title="No clusters"
                description={
                  includeNonSerious
                    ? "No batch or branch has two or more cases within 30 days."
                    : "No batch or branch has two or more serious cases within 30 days."
                }
              />
            );
          const shownPage = Math.min(page, Math.max(1, Math.ceil(flags.length / 10)));
          return (
            <div className="space-y-3">
              <ul className="space-y-3">
                {paginate(flags, shownPage).map((f) => (
                  <li key={f.key} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={f.kind === "BATCH" ? "warning" : "info"}>
                        {f.kind === "BATCH" ? "Batch" : "Branch"}
                      </StatusPill>
                      <span className="font-medium">{f.label}</span>
                      <span className="text-sm text-muted-foreground">
                        {f.cases.length} case(s), {f.from} → {f.to}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{branchPatternNote(f)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Products: {f.products.join(", ") || "—"} · Branches:{" "}
                      {f.facilities.join(", ") || "not recorded"} · Batches:{" "}
                      {f.batches.join(", ") || "not recorded"}
                    </p>
                    {f.warningSigns.length > 0 ? (
                      <p className="mt-1 text-xs text-warning">
                        Quality warning signs:{" "}
                        {f.warningSigns
                          .map((w) => QUALITY_SIGN_LABELS[w.sign].replace(" / vaccine failure", ""))
                          .join(", ")}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {f.cases.map((c) =>
                        c.caseId ? (
                          <Link
                            key={c.caseId}
                            to="/cases/$caseId"
                            params={{ caseId: c.caseId }}
                            className="mono-num rounded border border-border px-1.5 py-0.5 text-xs text-primary hover:underline"
                          >
                            {c.caseId}
                          </Link>
                        ) : null,
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Pager page={shownPage} total={flags.length} onPageChange={setPage} />
            </div>
          );
        }}
      </QueryBoundary>
    </Section>
  );
}
