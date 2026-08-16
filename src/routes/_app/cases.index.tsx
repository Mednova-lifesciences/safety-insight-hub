import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cases as casesApi } from "@/services/api/cases";
import { demoCases } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import {
  PageHeader,
  PriorityBadge,
  QueryBoundary,
  SeriousnessBadge,
  SourceTag,
  StatusPill,
  WorkflowBadge,
} from "@/components/pv/primitives";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WORKFLOW_LABELS, WORKFLOW_STEPS } from "@/types/pv";

export const Route = createFileRoute("/_app/cases")({
  head: () => ({
    meta: [
      { title: "Case workbench — MedNova PV Assist" },
      { name: "description", content: "Search, filter and open individual case safety reports across the safety database." },
      { property: "og:title", content: "Case workbench — MedNova PV Assist" },
      { property: "og:description", content: "ICSR workbench with seriousness, workflow, assignment and due-date filters." },
    ],
  }),
  component: CaseWorkbench,
});

function CaseWorkbench() {
  const query = usePvQuery(["cases"], () => casesApi.list(), () => demoCases);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [seriousness, setSeriousness] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const all = query.data?.data ?? [];
  const assignees = useMemo(() => Array.from(new Set(all.map((c) => c.assignedTo))), [all]);

  const filtered = all.filter((c) => {
    const text = `${c.id} ${c.patientIdentifier} ${c.product} ${c.reaction}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    if (status !== "all" && c.workflowStep !== status) return false;
    if (seriousness !== "all" && c.seriousness !== seriousness) return false;
    if (assignee !== "all" && c.assignedTo !== assignee) return false;
    if (from && c.receivedDate < from) return false;
    if (to && c.receivedDate > to) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Case workbench"
        description="All individual case safety reports visible to your role."
        meta={query.data ? <SourceTag source={query.data.source} /> : null}
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
                placeholder="Case ID, patient, product, reaction"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          <div>
            <span className="label-caps">Workflow status</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {WORKFLOW_STEPS.map((s) => (
                  <SelectItem key={s} value={s}>{WORKFLOW_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <span className="label-caps">Seriousness</span>
            <Select value={seriousness} onValueChange={setSeriousness}>
              <SelectTrigger className="mt-1 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="SERIOUS">Serious</SelectItem>
                <SelectItem value="NON_SERIOUS">Non-serious</SelectItem>
                <SelectItem value="UNASSESSED">Unassessed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <span className="label-caps">Assigned to</span>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger className="mt-1 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Anyone</SelectItem>
                {assignees.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="label-caps" htmlFor="from">Received from</label>
            <Input id="from" type="date" className="mt-1 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label-caps" htmlFor="to">to</label>
            <Input id="to" type="date" className="mt-1 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <QueryBoundary query={query} loadingLabel="Loading cases">
          {() => (
            <div className="panel overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    {["Case ID", "Patient", "Product", "Reaction", "Seriousness", "Outcome", "Status", "Assigned", "Received", "Due", "Priority"].map((h) => (
                      <th key={h} className="label-caps px-3 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link to="/cases/$caseId" params={{ caseId: c.id }} className="mono-num font-medium text-primary hover:underline">
                          {c.id}
                        </Link>
                      </td>
                      <td className="mono-num px-3 py-2 whitespace-nowrap">{c.patientIdentifier}</td>
                      <td className="max-w-52 truncate px-3 py-2">{c.product}</td>
                      <td className="max-w-52 truncate px-3 py-2">{c.reaction}</td>
                      <td className="px-3 py-2"><SeriousnessBadge value={c.seriousness} /></td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                        {c.outcome.replaceAll("_", " ").toLowerCase()}
                      </td>
                      <td className="px-3 py-2"><WorkflowBadge value={c.workflowStep} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{c.assignedTo}</td>
                      <td className="mono-num px-3 py-2 whitespace-nowrap">{c.receivedDate}</td>
                      <td className="mono-num px-3 py-2 whitespace-nowrap">
                        {c.dueDate}
                        {c.dueDate < "2026-08-15" && c.workflowStep !== "CLOSED" ? (
                          <StatusPill tone="critical" className="ml-2">overdue</StatusPill>
                        ) : null}
                      </td>
                      <td className="px-3 py-2"><PriorityBadge value={c.priority} /></td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-10 text-center text-sm text-muted-foreground">
                        No cases match the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </QueryBoundary>
      </div>
    </>
  );
}
