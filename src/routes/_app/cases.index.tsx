import { Link, createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState } from "react";
import { ChevronRight, Download, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { cases as casesApi } from "@/services/api/cases";
import { demoCases } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
import { usePermission } from "@/lib/auth";
import {
  PageHeader,
  Pager,
  PriorityBadge,
  QueryBoundary,
  paginate,
  SeriousnessBadge,
  SourceTag,
  StatusPill,
  WorkflowBadge,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WORKFLOW_LABELS, WORKFLOW_STEPS } from "@/types/pv";
import {
  CHANNEL_NOT_RECORDED,
  INTAKE_CHANNELS,
  INTAKE_CHANNEL_LABELS,
  describeIntake,
  distinctBranches,
  matchesBranchFilter,
  matchesChannelFilter,
} from "@/services/api/intake-channel";
import {
  CLOCK_TONE,
  isPastDue,
  matchesClockFilter,
  reportingClock,
} from "@/services/api/regulatory-clock";
import { products as productsApi } from "@/services/api/products";
import {
  FORWARD_STATE_LABELS,
  needsForward,
  primaryForwardState,
} from "@/services/api/holder-forwarding";
import { demoProducts } from "@/services/demo/dataset";

export const Route = createFileRoute("/_app/cases/")({
  head: () => ({
    meta: [
      { title: "Case workbench — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Search, filter and open individual case safety reports across the safety database.",
      },
      { property: "og:title", content: "Case workbench — MedNova PV Assist" },
      {
        property: "og:description",
        content: "ICSR workbench with seriousness, workflow, assignment and due-date filters.",
      },
    ],
  }),
  component: CaseWorkbench,
});

function CaseWorkbench() {
  const query = usePvQuery(
    ["cases"],
    () => casesApi.list(),
    () => demoCases,
  );
  const canProcessLineList = usePermission("linelist.process");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [seriousness, setSeriousness] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [channel, setChannel] = useState("all");
  const [branch, setBranch] = useState("all");
  const [clockFilter, setClockFilter] = useState("all");
  const [holderFilter, setHolderFilter] = useState("all");
  const catalogQuery = usePvQuery(
    ["products"],
    () => productsApi.list(),
    () => demoProducts,
  );
  const catalog = catalogQuery.data?.data ?? [];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [moreFilters, setMoreFilters] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const all = query.data?.data ?? [];
  const assignees = useMemo(() => Array.from(new Set(all.map((c) => c.assignedTo))), [all]);
  const branches = useMemo(() => distinctBranches(all), [all]);

  const filtered = all.filter((c) => {
    const text =
      `${c.id} ${c.patientIdentifier} ${c.product} ${c.reaction} ${c.branch ?? ""}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    if (status !== "all" && c.workflowStep !== status) return false;
    if (seriousness !== "all" && c.seriousness !== seriousness) return false;
    if (assignee !== "all" && c.assignedTo !== assignee) return false;
    if (!matchesChannelFilter(c, channel)) return false;
    if (!matchesBranchFilter(c, branch)) return false;
    if (!matchesClockFilter(reportingClock(c), clockFilter)) return false;
    if (holderFilter !== "all" && primaryForwardState(c, catalog) !== holderFilter) return false;
    if (from && c.receivedDate < from) return false;
    if (to && c.receivedDate > to) return false;
    return true;
  });
  // A filter change can leave the page past the end; show the last page.
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const shownPage = Math.min(page, pageCount);
  const shown = paginate(filtered, shownPage);
  const extraFilters = [
    assignee !== "all",
    channel !== "all",
    clockFilter !== "all",
    holderFilter !== "all",
    branch !== "all",
    !!from,
    !!to,
  ].filter(Boolean).length;
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function exportLineList() {
    setExporting(true);
    try {
      const job = await casesApi.exportToLineList(filtered);
      toast.success(
        `Downloaded ${filtered.length} case(s) as a CSV and created line-list job ${job.id} for review.`,
      );
    } catch (err) {
      toast.error(
        isNotConfigured(err)
          ? "Backend not connected — nothing was exported."
          : err instanceof Error
            ? err.message
            : "Could not export these cases.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Case workbench"
        description="All individual case safety reports visible to your role."
        meta={query.data ? <SourceTag source={query.data.source} /> : null}
        actions={
          canProcessLineList ? (
            <Button
              size="sm"
              variant="outline"
              disabled={exporting || filtered.length === 0}
              onClick={exportLineList}
            >
              <Download className="size-4" />
              {exporting ? "Exporting…" : "Download line-list CSV"}
            </Button>
          ) : null
        }
      />

      <div className="space-y-4 p-6">
        <div className="panel flex flex-wrap items-end gap-3 p-3">
          <div className="min-w-56 flex-1">
            <label className="label-caps" htmlFor="case-search">
              Search
            </label>
            <div className="relative mt-1">
              <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                id="case-search"
                className="pl-8"
                placeholder="Case ID, patient, product, reaction, branch"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          <div>
            <span className="label-caps">Workflow status</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="mt-1 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {WORKFLOW_STEPS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {WORKFLOW_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <span className="label-caps">Seriousness</span>
            <Select value={seriousness} onValueChange={setSeriousness}>
              <SelectTrigger className="mt-1 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="SERIOUS">Serious</SelectItem>
                <SelectItem value="NON_SERIOUS">Non-serious</SelectItem>
                <SelectItem value="UNASSESSED">Unassessed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9"
            aria-expanded={moreFilters}
            onClick={() => setMoreFilters((v) => !v)}
          >
            <SlidersHorizontal className="size-4" />
            {moreFilters ? "Fewer filters" : "More filters"}
            {extraFilters ? (
              <StatusPill tone="info" className="ml-1">
                {extraFilters} on
              </StatusPill>
            ) : null}
          </Button>
        </div>

        {moreFilters ? (
          <div className="panel flex flex-wrap items-end gap-3 p-3">
            <div>
              <span className="label-caps">Assigned to</span>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="mt-1 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Anyone</SelectItem>
                  {assignees.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <span className="label-caps">Channel</span>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="mt-1 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  {INTAKE_CHANNELS.map((ch) => (
                    <SelectItem key={ch} value={ch}>
                      {INTAKE_CHANNEL_LABELS[ch]}
                    </SelectItem>
                  ))}
                  <SelectItem value={CHANNEL_NOT_RECORDED}>Not recorded</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <span className="label-caps">NAFDAC clock</span>
              <Select value={clockFilter} onValueChange={setClockFilter}>
                <SelectTrigger className="mt-1 w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="ATTENTION">Overdue or due soon</SelectItem>
                  <SelectItem value="OVERDUE">Overdue</SelectItem>
                  <SelectItem value="DUE_SOON">Due within 3 days</SelectItem>
                  <SelectItem value="ON_TRACK">On track</SelectItem>
                  <SelectItem value="STOPPED">Ready / closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <span className="label-caps">Product holder</span>
              <Select value={holderFilter} onValueChange={setHolderFilter}>
                <SelectTrigger className="mt-1 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(Object.keys(FORWARD_STATE_LABELS) as (keyof typeof FORWARD_STATE_LABELS)[]).map(
                    (k) => (
                      <SelectItem key={k} value={k}>
                        {FORWARD_STATE_LABELS[k]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            {branches.length > 0 ? (
              <div>
                <span className="label-caps">Branch</span>
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger className="mt-1 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div>
              <label className="label-caps" htmlFor="from">
                Received from
              </label>
              <Input
                id="from"
                type="date"
                className="mt-1 w-40"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="label-caps" htmlFor="to">
                to
              </label>
              <Input
                id="to"
                type="date"
                className="mt-1 w-40"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        <QueryBoundary query={query} loadingLabel="Loading cases">
          {() => (
            <div className="panel space-y-3 overflow-x-auto pb-3">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    {[
                      "",
                      "Case ID",
                      "Product",
                      "Reaction",
                      "Seriousness",
                      "Status",
                      "NAFDAC clock",
                      "Received",
                      "Priority",
                    ].map((h, i) => (
                      <th key={h || i} className="label-caps px-3 py-2 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <Fragment key={c.id}>
                      <tr
                        className="border-b border-border last:border-0 hover:bg-muted/40"
                        data-e2e-case-row={c.id}
                      >
                        <td className="w-8 px-2 py-2">
                          <button
                            type="button"
                            className="flex size-6 items-center justify-center rounded hover:bg-muted"
                            aria-expanded={open.has(c.id)}
                            aria-label={`${open.has(c.id) ? "Hide" : "Show"} details for ${c.id}`}
                            onClick={() => toggle(c.id)}
                          >
                            <ChevronRight
                              className={
                                "size-4 transition-transform " + (open.has(c.id) ? "rotate-90" : "")
                              }
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Link
                            to="/cases/$caseId"
                            params={{ caseId: c.id }}
                            className="mono-num font-medium text-primary hover:underline"
                          >
                            {c.id}
                          </Link>
                          {c.dynamicFieldsCount ? (
                            <StatusPill tone="neutral" className="ml-2">
                              {c.dynamicFieldsCount} additional
                            </StatusPill>
                          ) : null}
                        </td>
                        <td className="max-w-52 px-3 py-2">
                          <span className="block truncate">{c.product}</span>
                          {(() => {
                            const state = primaryForwardState(c, catalog);
                            return needsForward(state) ? (
                              <StatusPill tone="warning" className="mt-1">
                                {state === "UNLISTED" ? "Not in catalog" : "Forward to holder"}
                              </StatusPill>
                            ) : null;
                          })()}
                        </td>
                        <td className="max-w-52 truncate px-3 py-2">{c.reaction}</td>
                        <td className="px-3 py-2">
                          <SeriousnessBadge value={c.seriousness} />
                        </td>
                        <td className="px-3 py-2">
                          <WorkflowBadge value={c.workflowStep} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {(() => {
                            const clock = reportingClock(c);
                            return (
                              <span
                                title={
                                  clock.deadline
                                    ? `${clock.windowDays}-day window, due ${clock.deadline}`
                                    : undefined
                                }
                              >
                                <StatusPill tone={CLOCK_TONE[clock.status]}>
                                  {clock.label}
                                </StatusPill>
                              </span>
                            );
                          })()}
                        </td>
                        <td className="mono-num px-3 py-2 whitespace-nowrap">{c.receivedDate}</td>
                        <td className="px-3 py-2">
                          <PriorityBadge value={c.priority} />
                        </td>
                      </tr>
                      {open.has(c.id) ? (
                        <tr className="border-b border-border bg-muted/20">
                          <td />
                          <td colSpan={8} className="px-3 py-3">
                            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-5">
                              <div>
                                <dt className="label-caps">Patient</dt>
                                <dd className="mono-num mt-0.5">{c.patientIdentifier || "—"}</dd>
                              </div>
                              <div>
                                <dt className="label-caps">Channel</dt>
                                <dd className="mt-0.5">{describeIntake(c)}</dd>
                              </div>
                              <div>
                                <dt className="label-caps">Outcome</dt>
                                <dd className="mt-0.5">
                                  {c.outcome.replaceAll("_", " ").toLowerCase()}
                                </dd>
                              </div>
                              <div>
                                <dt className="label-caps">Assigned to</dt>
                                <dd className="mt-0.5">{c.assignedTo || "—"}</dd>
                              </div>
                              <div>
                                <dt className="label-caps">Due</dt>
                                <dd className="mono-num mt-0.5">
                                  {c.dueDate}
                                  {isPastDue(c) ? (
                                    <StatusPill tone="critical" className="ml-2">
                                      overdue
                                    </StatusPill>
                                  ) : null}
                                </dd>
                              </div>
                            </dl>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-3 py-10 text-center text-sm text-muted-foreground"
                      >
                        No cases match the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <div className="px-3">
                <Pager page={shownPage} total={filtered.length} onPageChange={setPage} />
              </div>
            </div>
          )}
        </QueryBoundary>
      </div>
    </>
  );
}
