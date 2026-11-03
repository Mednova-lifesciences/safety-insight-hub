import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Download, FileText, Settings2 } from "lucide-react";
import { PermissionGate } from "@/components/pv/permission-gate";
import { PageHeader, QueryBoundary, Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePvQuery } from "@/lib/data-source";
import { usePermission } from "@/lib/auth";
import { products as productsApi, type CatalogDrug } from "@/services/api/products";
import { cases as casesApi } from "@/services/api/cases";
import { demoCases, demoProducts } from "@/services/demo/dataset";
import { todayIso } from "@/services/api/regulatory-clock";
import {
  PSUR_INTERVALS,
  buildCalendar,
  casesInPeriod,
  lineListingCsv,
  type CalendarEntry,
  type CalendarStatus,
} from "@/services/psur/own-brand-calendar";
import type { CaseSummary } from "@/types/pv";

export const Route = createFileRoute("/_app/psur-calendar")({
  head: () => ({
    meta: [
      { title: "PSUR calendar — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Data lock points and submission deadlines for the organisation's own-brand products.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="catalog.view">
      <PsurCalendarPage />
    </PermissionGate>
  ),
});

const STATUS_TONE: Record<CalendarStatus, "critical" | "warning" | "info" | "neutral"> = {
  OVERDUE: "critical",
  DUE_SOON: "warning",
  IN_PREPARATION: "info",
  UPCOMING: "neutral",
  NOT_SET_UP: "neutral",
};

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ScheduleDialog({ drug, onSaved }: { drug: CatalogDrug; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ibd, setIbd] = useState("");
  const [interval, setInterval] = useState("");
  const [lastDlp, setLastDlp] = useState("");

  async function save() {
    if (!interval) {
      toast.error("Choose the PSUR interval.");
      return;
    }
    if (!ibd && !lastDlp) {
      toast.error("Enter the birth date or the last data lock point.");
      return;
    }
    if (lastDlp && lastDlp > todayIso()) {
      toast.error("The last data lock point cannot be in the future.");
      return;
    }
    setSaving(true);
    const psur = {
      ...drug.psur,
      ibd: ibd || undefined,
      intervalMonths: Number(interval),
      lastDlp: lastDlp || undefined,
    };
    try {
      await productsApi.update(
        drug.id,
        { psur },
        {
          action: "PSUR_SCHEDULE_SET",
          previousValue: JSON.stringify(drug.psur ?? {}),
          newValue: `IBD ${psur.ibd ?? "—"}, every ${psur.intervalMonths} months, last DLP ${psur.lastDlp ?? "—"}`,
          reason: `PSUR schedule for ${drug.name} set`,
        },
      );
      toast.success(`Schedule saved for ${drug.name}.`);
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The schedule could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setIbd(drug.psur?.ibd ?? "");
          setInterval(drug.psur?.intervalMonths ? String(drug.psur.intervalMonths) : "");
          setLastDlp(drug.psur?.lastDlp ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Schedule for ${drug.name}`}>
          <Settings2 className="size-3.5" /> Schedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>PSUR schedule — {drug.name}</DialogTitle>
          <DialogDescription>
            The next data lock point follows the last one by the interval. Without a last data lock
            point, it is worked out from the international birth date.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="schedIbd">International birth date</Label>
            <Input id="schedIbd" type="date" value={ibd} onChange={(e) => setIbd(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="schedInterval">PSUR interval</Label>
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger id="schedInterval">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {PSUR_INTERVALS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m === 36 ? "3 years" : m === 12 ? "1 year" : "6 months"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="schedLastDlp">
              Last data lock point submitted{" "}
              <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="schedLastDlp"
              type="date"
              max={todayIso()}
              value={lastDlp}
              onChange={(e) => setLastDlp(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordSubmissionDialog({
  entry,
  onSaved,
}: {
  entry: CalendarEntry & { nextDlp: string };
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submittedOn, setSubmittedOn] = useState(todayIso());
  const { drug, nextDlp } = entry;

  async function save() {
    if (!submittedOn || submittedOn > todayIso() || submittedOn < nextDlp) {
      toast.error("The submission date must be between the data lock point and today.");
      return;
    }
    setSaving(true);
    try {
      await productsApi.update(
        drug.id,
        { psur: { ...drug.psur, lastDlp: nextDlp, lastSubmittedOn: submittedOn } },
        {
          action: "PSUR_SUBMISSION_RECORDED",
          previousValue: `last DLP ${drug.psur?.lastDlp ?? "—"}`,
          newValue: `PSUR with DLP ${nextDlp} submitted ${submittedOn}`,
          reason: `PSUR for ${drug.name} recorded as submitted`,
        },
      );
      toast.success(`Recorded: ${drug.name} PSUR (DLP ${nextDlp}) submitted.`);
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The submission could not be recorded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <CheckCircle2 className="size-3.5" /> Submitted
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record PSUR submission — {drug.name}</DialogTitle>
          <DialogDescription>
            Records the PSUR with data lock point {nextDlp} as submitted to NAFDAC. The calendar
            then moves on to the next period.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="submittedOn">Date submitted</Label>
          <Input
            id="submittedOn"
            type="date"
            min={nextDlp}
            max={todayIso()}
            value={submittedOn}
            onChange={(e) => setSubmittedOn(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Record submission"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CalendarTable({
  entries,
  cases,
  onSaved,
}: {
  entries: CalendarEntry[];
  cases: CaseSummary[];
  onSaved: () => void;
}) {
  const canManage = usePermission("catalog.manage");
  const canRecord = usePermission("psur.review");
  const today = todayIso();

  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left">
            {[
              "Product",
              "Interval",
              "Reporting period",
              "Data lock point",
              "Submission deadline",
              "Status",
              "Cases",
              "",
            ].map((h) => (
              <th key={h} className="label-caps px-3 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const inPeriod =
              e.periodStart && e.nextDlp
                ? casesInPeriod(cases, e.drug, e.periodStart, e.nextDlp)
                : [];
            return (
              <tr key={e.drug.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <p className="font-medium">{e.drug.name}</p>
                  {e.drug.psur?.lastSubmittedOn ? (
                    <p className="text-xs text-muted-foreground">
                      Last submitted {e.drug.psur.lastSubmittedOn}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {e.drug.psur?.intervalMonths ? `${e.drug.psur.intervalMonths} months` : "—"}
                </td>
                <td className="mono-num px-3 py-2 whitespace-nowrap">
                  {e.periodStart && e.nextDlp ? `${e.periodStart} → ${e.nextDlp}` : "—"}
                </td>
                <td className="mono-num px-3 py-2 whitespace-nowrap">
                  {e.nextDlp ?? "—"}
                  {e.fromBirthDate ? (
                    <span className="block text-xs text-muted-foreground">from birth date</span>
                  ) : null}
                </td>
                <td className="mono-num px-3 py-2 whitespace-nowrap">
                  {e.deadline ?? "—"}
                  {e.windowDays ? (
                    <span className="block text-xs text-muted-foreground">
                      DLP + {e.windowDays} days
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <StatusPill tone={STATUS_TONE[e.status]}>{e.label}</StatusPill>
                </td>
                <td className="mono-num px-3 py-2">{e.nextDlp ? inPeriod.length : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex min-w-36 flex-col items-start gap-0.5">
                    {e.periodStart && e.nextDlp ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          downloadCsv(
                            `line-listing-${e.drug.name.replace(/[^a-z0-9]+/gi, "-")}-DLP-${e.nextDlp}.csv`,
                            lineListingCsv(inPeriod),
                          )
                        }
                      >
                        <Download className="size-3.5" /> Line listing
                      </Button>
                    ) : null}
                    {canRecord && e.nextDlp && e.nextDlp <= today ? (
                      <RecordSubmissionDialog
                        entry={e as CalendarEntry & { nextDlp: string }}
                        onSaved={onSaved}
                      />
                    ) : null}
                    {canManage ? <ScheduleDialog drug={e.drug} onSaved={onSaved} /> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PsurCalendarPage() {
  const queryClient = useQueryClient();
  const productsQuery = usePvQuery(
    ["products"],
    () => productsApi.list(),
    () => demoProducts,
  );
  const casesQuery = usePvQuery(
    ["cases"],
    () => casesApi.list(),
    () => demoCases,
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["products"] });

  return (
    <>
      <PageHeader
        title="PSUR calendar"
        description="Data lock points and NAFDAC submission deadlines for the products you hold the registration for."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/psur">
              <FileText className="size-4" /> Draft & review PSURs
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <QueryBoundary query={productsQuery} loadingLabel="Loading products">
          {(catalog) => {
            const entries = buildCalendar(catalog, todayIso());
            if (entries.length === 0) {
              return (
                <Section title="No own-brand products yet">
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <CalendarClock className="size-5 text-muted-foreground" />
                    <p className="text-sm">
                      Tick <span className="font-medium">Own brand</span> on the products you hold
                      the registration for in the{" "}
                      <Link to="/drugs" className="text-primary hover:underline">
                        Drug Catalog
                      </Link>
                      , then set each one&apos;s PSUR schedule here.
                    </p>
                  </div>
                </Section>
              );
            }
            return (
              <>
                <CalendarTable
                  entries={entries}
                  cases={casesQuery.data?.data ?? []}
                  onSaved={refresh}
                />
                <p className="text-xs text-muted-foreground">
                  Deadline = data lock point + 70 days for intervals up to 12 months, + 90 days for
                  longer ones. The line listing holds this organisation&apos;s cases for the product
                  received in the reporting period.
                </p>
              </>
            );
          }}
        </QueryBoundary>
      </div>
    </>
  );
}
