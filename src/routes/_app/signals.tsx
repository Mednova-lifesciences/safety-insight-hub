import { Link, createFileRoute } from "@tanstack/react-router";
import { PermissionGate } from "@/components/pv/permission-gate";
import { useState } from "react";
import { toast } from "sonner";
import { signals as signalsApi } from "@/services/api/signals";
import { demoSignals } from "@/services/demo/dataset";
import { usePvQuery } from "@/lib/data-source";
import { isNotConfigured } from "@/services/api/client";
import {
  EmptyState,
  PageHeader,
  QueryBoundary,
  Section,
  SourceTag,
  StatusPill,
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
      { name: "description", content: "Potential, under-review, confirmed and refuted safety signals with statistical evidence and recorded rationale." },
      { property: "og:title", content: "Signal review — MedNova PV Assist" },
      { property: "og:description", content: "Manager signal workspace with auditable confirm/refute decisions." },
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
};

function SignalCard({
  s,
  canDecide,
  onChanged,
}: {
  s: Signal;
  canDecide: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"CONFIRMED" | "REFUTED" | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

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
    <li className="rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono-num text-sm font-semibold">{s.reference}</span>
        <StatusPill tone={statusTone[s.status]}>{s.status.replaceAll("_", " ").toLowerCase()}</StatusPill>
        <span className="text-sm">
          {s.product} <span className="text-muted-foreground">/</span> {s.reaction}
        </span>
        <span className="mono-num ml-auto text-xs text-muted-foreground">{s.caseCount} cases</span>
      </div>

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
            {s.statistic.map((st) => `${st.name} ${st.value}${st.ci ? ` (${st.ci})` : ""}`).join(" · ")}
          </dd>
        </div>
      </dl>

      <div className="mt-3">
        <p className="label-caps">Supporting cases</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {s.supportingCaseIds.map((id) => (
            <Link key={id} to="/cases/$caseId" params={{ caseId: id }} className="mono-num text-sm text-primary hover:underline">
              {id}
            </Link>
          ))}
        </div>
      </div>

      {s.rationale ? (
        <div className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2">
          <p className="label-caps">Recorded rationale</p>
          <p className="mt-1 text-sm">{s.rationale}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {s.reviewer ?? "Reviewer"} · {s.decidedAt?.slice(0, 10)}
          </p>
        </div>
      ) : null}

      {canDecide && (s.status === "POTENTIAL" || s.status === "UNDER_REVIEW") ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {s.status === "POTENTIAL" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await signalsApi.startReview(s.id);
                    toast.success("Review started.");
                    onChanged();
                  } catch (err) {
                    toast.error(isNotConfigured(err) ? "Backend not connected — review not started." : "Could not start review.");
                  }
                }}
              >
                Start review
              </Button>
            ) : null}
            <Button size="sm" variant={mode === "CONFIRMED" ? "default" : "outline"} onClick={() => setMode("CONFIRMED")}>
              Confirm signal
            </Button>
            <Button size="sm" variant={mode === "REFUTED" ? "default" : "outline"} onClick={() => setMode("REFUTED")}>
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
    </li>
  );
}

function SignalsPage() {
  const canDecide = usePermission("signal.decide");
  const query = usePvQuery(["signals"], () => signalsApi.list(), () => demoSignals);

  return (
    <>
      <PageHeader
        title="Signal review"
        description="Safety signals with statistical evidence, supporting cases and recorded review decisions."
        meta={query.data ? <SourceTag source={query.data.source} /> : null}
      />
      <div className="p-6">
        <QueryBoundary query={query} loadingLabel="Loading signals">
          {(items) => {
            const buckets: [string, Signal[]][] = [
              ["Potential", items.filter((s) => s.status === "POTENTIAL")],
              ["Under review", items.filter((s) => s.status === "UNDER_REVIEW")],
              ["Confirmed", items.filter((s) => s.status === "CONFIRMED")],
              ["Refuted", items.filter((s) => s.status === "REFUTED")],
              ["Historical", items.filter((s) => s.status === "CONFIRMED" || s.status === "REFUTED")],
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
                        <ul className="space-y-3">
                          {list.map((s) => (
                            <SignalCard key={s.id} s={s} canDecide={canDecide} onChanged={() => query.refetch()} />
                          ))}
                        </ul>
                      )}
                    </Section>
                  </TabsContent>
                ))}
              </Tabs>
            );
          }}
        </QueryBoundary>
      </div>
    </>
  );
}
