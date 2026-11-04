import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PermissionGate } from "@/components/pv/permission-gate";
import { PageHeader, Paged, QueryBoundary, Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePvQuery } from "@/lib/data-source";
import { useCurrentUser } from "@/lib/auth";
import { cases as casesApi } from "@/services/api/cases";
import { products as productsApi } from "@/services/api/products";
import { registrations as registrationsApi } from "@/services/api/registrations";
import { demoCases, demoProducts } from "@/services/demo/dataset";
import { todayIso } from "@/services/api/regulatory-clock";
import {
  buildActivityReport,
  monthPeriod,
  pct,
  quarterPeriod,
  type ActivityReport,
  type Count,
  type Period,
} from "@/services/reports/activity-report";
import { downloadActivityReport } from "@/services/reports/activity-report-docx";
import type { CaseSummary } from "@/types/pv";

export const Route = createFileRoute("/_app/reports")({
  head: () => ({
    meta: [
      { title: "Safety reports — MedNova PV Assist" },
      {
        name: "description",
        content: "Monthly activity report and quarterly safety dashboard.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="team.view">
      <ReportsPage />
    </PermissionGate>
  ),
});

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="label-caps">{label}</p>
      <p className="mono-num mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--foreground)",
};

/** One series of counts as horizontal bars, largest first. */
function CountBars({ data, empty }: { data: Count[]; empty: string }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const rows = data.slice(0, 8);
  return (
    <div style={{ height: Math.max(120, rows.length * 32 + 24) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="0" />
          <XAxis
            type="number"
            allowDecimals={false}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={150}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={tooltipStyle}
            formatter={(v: number) => [v, "Reports"]}
          />
          <Bar
            dataKey="count"
            isAnimationActive={false}
            fill="var(--primary)"
            radius={[0, 4, 4, 0]}
            barSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthBars({ data }: { data: Count[] }) {
  const rows = data.map((d) => ({
    ...d,
    label: new Date(`${d.name}-01T00:00:00Z`).toLocaleString("en-GB", {
      month: "short",
      timeZone: "UTC",
    }),
  }));
  return (
    <div style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={tooltipStyle}
            formatter={(v: number) => [v, "Reports received"]}
          />
          <Bar
            dataKey="count"
            isAnimationActive={false}
            fill="var(--primary)"
            radius={[4, 4, 0, 0]}
            barSize={36}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReportView({ report, quarterly }: { report: ActivityReport; quarterly: boolean }) {
  const user = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const psurDue = report.psur.filter((e) => e.status === "OVERDUE" || e.status === "DUE_SOON");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {report.period.label}: {report.period.from} to {report.period.to}
        </p>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await downloadActivityReport(report, user?.organisation ?? "");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "The report could not be built.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download className="size-4" />
          {busy
            ? "Preparing…"
            : quarterly
              ? "Download quarterly report (Word)"
              : "Download monthly report (Word)"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Reports received" value={report.received} />
        <Tile
          label="Serious"
          value={report.serious}
          sub={`${pct(report.serious, report.received)} of reports · ${report.fatal} fatal`}
        />
        <Tile
          label="Overdue for NAFDAC (today)"
          value={report.overdueNow}
          sub={`${report.dueSoonNow} due within 3 days`}
        />
        <Tile
          label="Forwarded to holders"
          value={report.forwardsInPeriod.length}
          sub={`${report.awaitingForward} still to forward`}
        />
      </div>

      {quarterly ? (
        <Section title="Reports received by month">
          <MonthBars data={report.byMonth} />
        </Section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="By channel">
          <CountBars data={report.byChannel} empty="No reports in this period." />
        </Section>
        <Section title="By branch">
          <CountBars data={report.byBranch} empty="No branch reports in this period." />
        </Section>
        <Section title="Top products">
          <CountBars data={report.topProducts} empty="No reports in this period." />
        </Section>
        <Section title="Top reactions (as reported)">
          <CountBars data={report.topReactions} empty="No reports in this period." />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Own-brand PSURs due">
          {psurDue.length === 0 ? (
            <p className="text-sm text-muted-foreground">None overdue or due within 30 days.</p>
          ) : (
            <Paged items={psurDue}>
              {(pageDue) => (
                <ul className="space-y-1.5 text-sm">
                  {pageDue.map((e) => (
                    <li key={e.drug.id} className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={e.status === "OVERDUE" ? "critical" : "warning"}>
                        {e.label}
                      </StatusPill>
                      {e.drug.name} — DLP {e.nextDlp}, deadline {e.deadline}
                    </li>
                  ))}
                </ul>
              )}
            </Paged>
          )}
        </Section>
        <Section title="Registrations and commitments">
          {report.registrationAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due.</p>
          ) : (
            <Paged items={report.registrationAlerts}>
              {(pageAlerts) => (
                <ul className="space-y-1.5 text-sm">
                  {pageAlerts.map((a) => (
                    <li key={a.key}>
                      <span className="font-medium">{a.productName}</span> — {a.title}
                    </li>
                  ))}
                </ul>
              )}
            </Paged>
          )}
        </Section>
      </div>
    </div>
  );
}

function currentQuarter(today: string) {
  return {
    year: Number(today.slice(0, 4)),
    q: Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1,
  };
}

function ReportsPage() {
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const cq = currentQuarter(today);
  const [quarter, setQuarter] = useState(`${cq.year}-Q${cq.q}`);
  const casesQuery = usePvQuery(
    ["cases"],
    () => casesApi.list(),
    () => demoCases,
  );
  const catalogQuery = usePvQuery(
    ["products"],
    () => productsApi.list(),
    () => demoProducts,
  );
  const regQuery = useQuery({
    queryKey: ["registrations"],
    queryFn: () => registrationsApi.list(),
    retry: false,
  });
  const quarters = Array.from({ length: 6 }, (_, i) => {
    let y = cq.year;
    let q = cq.q - i;
    while (q < 1) {
      q += 4;
      y--;
    }
    return `${y}-Q${q}`;
  });

  const build = (cases: CaseSummary[], period: Period) =>
    buildActivityReport({
      period,
      today,
      cases,
      catalog: catalogQuery.data?.data ?? [],
      registrations: regQuery.data ?? [],
    });

  return (
    <>
      <PageHeader
        title="Safety reports"
        description="The monthly activity report and the quarterly safety dashboard, from the safety database."
      />
      <div className="p-6">
        <QueryBoundary query={casesQuery} loadingLabel="Loading cases">
          {(cases) => (
            <Tabs defaultValue="monthly">
              <TabsList>
                <TabsTrigger value="monthly">Monthly activity</TabsTrigger>
                <TabsTrigger value="quarterly">Quarterly dashboard</TabsTrigger>
              </TabsList>
              <TabsContent value="monthly" className="mt-4 space-y-4">
                <div className="flex items-end gap-2">
                  <div>
                    <label className="label-caps" htmlFor="reportMonth">
                      Month
                    </label>
                    <Input
                      id="reportMonth"
                      type="month"
                      className="mt-1 w-48"
                      max={today.slice(0, 7)}
                      value={month}
                      onChange={(e) => e.target.value && setMonth(e.target.value)}
                    />
                  </div>
                </div>
                <ReportView report={build(cases, monthPeriod(month))} quarterly={false} />
              </TabsContent>
              <TabsContent value="quarterly" className="mt-4 space-y-4">
                <div>
                  <span className="label-caps">Quarter</span>
                  <Select value={quarter} onValueChange={setQuarter}>
                    <SelectTrigger className="mt-1 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {quarters.map((q) => (
                        <SelectItem key={q} value={q}>
                          {q.replace("-", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <ReportView
                  report={build(
                    cases,
                    quarterPeriod(Number(quarter.slice(0, 4)), Number(quarter.slice(-1))),
                  )}
                  quarterly
                />
              </TabsContent>
            </Tabs>
          )}
        </QueryBoundary>
      </div>
    </>
  );
}
