import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Radar } from "lucide-react";
import { toast } from "sonner";
import { PermissionGate } from "@/components/pv/permission-gate";
import { useValidatedCases } from "@/components/pv/linelist-cross-file-panels";
import {
  EmptyState,
  PageHeader,
  QueryBoundary,
  Section,
  StatusPill,
  type Tone,
} from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MIN_CASES,
  MIN_CHI_SQUARE,
  MIN_PRR,
  UMC_MIN_REPORTS,
  UMC_SOURCE,
  screenLineLists,
  type ScreenPair,
  type ScreenResult,
} from "@/services/api/linelist-signals";
import {
  SCREEN_DECISION_LABELS,
  loadReactionCodings,
  signalScreen,
  type ScreenDecision,
} from "@/services/api/signal-screen";
import type { Signal } from "@/types/pv";

/**
 * The administrator-side signal screen: disproportionality over every
 * validated line list in the organisation, for the Review Officer,
 * Evaluator and Peer Reviewer. Statistics only — a person decides what each
 * candidate means, and every decision is audited.
 */
export const Route = createFileRoute("/_app/signal-screen")({
  head: () => ({
    meta: [
      { title: "Signal screening — MedNova PV Assist" },
      {
        name: "description",
        content:
          "Disproportionality screen (PRR, ROR, chi-square) over validated line lists, with recorded reviewer decisions.",
      },
    ],
  }),
  component: () => (
    <PermissionGate permission="signal.screen">
      <SignalScreenPage />
    </PermissionGate>
  ),
});

const DECISION_TONE: Record<ScreenDecision, Tone> = {
  CONFIRMED: "critical",
  REFUTED: "neutral",
  MONITOR: "info",
};

const num = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(2));
const ci = (e: { lower: number; upper: number }) => `${num(e.lower)}–${num(e.upper)}`;

function whyNot(p: ScreenPair): string {
  const reasons: string[] = [];
  if (p.a < MIN_CASES) reasons.push(`N ${p.a} < ${MIN_CASES}`);
  if (p.prr.value < MIN_PRR) reasons.push(`PRR ${num(p.prr.value)} < ${MIN_PRR}`);
  if (p.chiSquare < MIN_CHI_SQUARE)
    reasons.push(`χ² ${p.chiSquare.toFixed(2)} < ${MIN_CHI_SQUARE}`);
  return reasons.length ? reasons.join(" · ") : "no comparison group";
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="label-caps">{label}</p>
      <p className="mono-num text-lg font-semibold text-foreground">{value}</p>
      {sub ? <p className="mono-num text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function PoolBanner({ result }: { result: ScreenResult }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Reports in the pool" value={String(result.totalReports)} />
        <Stat label="Validated line lists" value={String(result.files)} />
        <Stat label="Candidates" value={String(result.candidates.length)} />
        <Stat label="Pairs screened" value={String(result.pairs.length)} />
      </div>
      {result.smallPool ? (
        <div className="flex gap-3 rounded-md border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-semibold text-warning">Small numbers — interpret with caution</p>
            <p className="mt-1 text-foreground">
              The pool holds {result.totalReports} report
              {result.totalReports === 1 ? "" : "s"}. Researchers at the Uppsala Monitoring Centre
              (WHO Collaborating Centre) recommend at least {UMC_MIN_REPORTS} reports before
              disproportionality is used in a country database; below that, false-positive pairs are
              likely.{" "}
              <a
                href={UMC_SOURCE.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline"
              >
                Source <ExternalLink className="size-3" />
              </a>
            </p>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Rule: N ≥ {MIN_CASES}, PRR ≥ {MIN_PRR} and χ² ≥ {MIN_CHI_SQUARE} (Evans et al.). Counted per
        report from kept cases only — dropped, held and confirmed-duplicate cases are left out.
        {result.unusable
          ? ` ${result.unusable} case(s) name no product or reaction and are not counted.`
          : ""}
      </p>
    </div>
  );
}

function CandidateCard({
  pair,
  result,
  decision,
  onDecided,
}: {
  pair: ScreenPair;
  result: ScreenResult;
  decision?: Signal | undefined;
  onDecided: () => void;
}) {
  const [mode, setMode] = useState<ScreenDecision | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const decided = decision?.status as ScreenDecision | undefined;

  async function record() {
    if (!mode) return;
    if (rationale.trim().length < 10) {
      toast.error("Write a rationale (at least 10 characters) before recording the decision.");
      return;
    }
    setBusy(true);
    try {
      await signalScreen.decide(pair, result, mode, rationale, decision);
      toast.success(`Recorded: ${SCREEN_DECISION_LABELS[mode]}.`);
      setMode(null);
      setRationale("");
      onDecided();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-border p-4" data-e2e-candidate={pair.key}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-foreground">{pair.product}</span>
        <span className="text-muted-foreground">×</span>
        <span className="text-base font-semibold text-foreground">{pair.reaction}</span>
        <StatusPill tone={pair.reactionSource === "MEDDRA" ? "success" : "neutral"}>
          {pair.reactionSource === "MEDDRA" ? `MedDRA ${pair.meddraCode}` : "verbatim term"}
        </StatusPill>
        <span className="ml-auto">
          {decided ? (
            <StatusPill tone={DECISION_TONE[decided]}>{SCREEN_DECISION_LABELS[decided]}</StatusPill>
          ) : (
            <StatusPill tone="warning">Awaiting review</StatusPill>
          )}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Stat label="Reports (N)" value={String(pair.a)} />
        <Stat label="PRR" value={num(pair.prr.value)} sub={`95% CI ${ci(pair.prr)}`} />
        <Stat label="ROR" value={num(pair.ror.value)} sub={`95% CI ${ci(pair.ror)}`} />
        <Stat label="χ² (Yates)" value={pair.chiSquare.toFixed(2)} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        2×2: a {pair.a} · b {pair.b} · c {pair.c} · d {pair.d}
        {pair.corrected ? " — a cell was zero, so 0.5 was added to every cell for the ratios" : ""}
      </p>

      <div className="mt-3">
        <p className="label-caps">Cases behind this pair</p>
        <ul className="mt-1 divide-y divide-border rounded-md border border-border text-sm">
          {pair.cases.map((c) => (
            <li
              key={`${c.jobId}-${c.row}`}
              className="flex flex-wrap items-center gap-x-3 px-3 py-1.5"
            >
              <span className="mono-num font-medium">{c.caseId ?? "—"}</span>
              <span className="text-muted-foreground">
                {c.filename} · row {c.row}
              </span>
              <Link
                to="/line-list"
                search={{ job: c.jobId }}
                className="ml-auto text-xs text-primary hover:underline"
              >
                Open line list
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {decision?.rationale ? (
        <div className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2">
          <p className="label-caps">Recorded rationale</p>
          <p className="mt-1 text-sm">{decision.rationale}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {decision.reviewer ?? "Reviewer"} · {decision.decidedAt?.slice(0, 10)} · pool of{" "}
            {decision.poolSize ?? "?"} reports
          </p>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SCREEN_DECISION_LABELS) as ScreenDecision[]).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={mode === d ? "default" : "outline"}
              onClick={() => setMode(mode === d ? null : d)}
            >
              {decided ? "Change to: " : ""}
              {SCREEN_DECISION_LABELS[d]}
            </Button>
          ))}
        </div>
        {mode ? (
          <div className="space-y-2">
            <label className="label-caps" htmlFor={`rationale-${pair.key}`}>
              Rationale (required, recorded in the audit trail)
            </label>
            <Textarea
              id={`rationale-${pair.key}`}
              rows={3}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="The clinical reasoning behind this decision: case review, plausibility, confounders, known reactions."
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={record} disabled={busy}>
                Record “{SCREEN_DECISION_LABELS[mode]}”
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SignalScreenPage() {
  const queryClient = useQueryClient();
  const cases = useValidatedCases();
  const codings = useQuery({
    queryKey: ["signal-screen", "codings"],
    queryFn: loadReactionCodings,
    staleTime: 60_000,
  });
  const decisions = useQuery({
    queryKey: ["signal-screen", "decisions"],
    queryFn: signalScreen.decisions,
  });

  const screened = useMemo(() => {
    if (!cases.data || !codings.data) return undefined;
    const pool = cases.data.data.flatMap((job) =>
      job.cases.map((c) => ({
        jobId: c.jobId,
        filename: c.filename,
        row: c.row,
        caseId: c.caseId,
        product: c.product,
        reactions: c.reactions,
      })),
    );
    return screenLineLists(pool, codings.data);
  }, [cases.data, codings.data]);

  const query = {
    isPending: cases.isPending || codings.isPending,
    error: (cases.error ?? codings.error) as Error | null,
    data: screened ? { data: screened, source: "live" as const } : undefined,
  };

  return (
    <>
      <PageHeader
        title="Signal screening"
        description="A statistical screen of your organisation's validated line lists. It shows product–reaction pairs reported more often together than the rest of the pool predicts. It is not a confirmed signal: each candidate needs a person's review, and every decision is recorded."
        meta={
          <StatusPill tone="assist" icon={<Radar className="size-3" />}>
            Statistical screen, not a confirmed signal
          </StatusPill>
        }
      />
      <div className="space-y-6 p-6">
        <QueryBoundary query={query} loadingLabel="Screening your validated line lists">
          {(result) => (
            <>
              <Section title="The pool">
                <PoolBanner result={result} />
              </Section>

              <Section
                title={`Candidates (${result.candidates.length})`}
                description="Pairs meeting N ≥ 3, PRR ≥ 2 and χ² ≥ 4. Review the cases, then record a decision."
              >
                {result.candidates.length === 0 ? (
                  <EmptyState
                    title="No pair meets the screening rule"
                    description="Nothing in the validated line lists is reported disproportionately often. This says nothing about signals the pool is too small to show."
                  />
                ) : (
                  <ul className="space-y-4">
                    {result.candidates.map((p) => (
                      <CandidateCard
                        key={p.key}
                        pair={p}
                        result={result}
                        decision={decisions.data?.get(p.key)}
                        onDecided={() =>
                          queryClient.invalidateQueries({
                            queryKey: ["signal-screen", "decisions"],
                          })
                        }
                      />
                    ))}
                  </ul>
                )}
              </Section>

              <Section
                title="Other pairs"
                description="The most disproportionate pairs that did not meet the rule, and why."
              >
                {result.pairs.filter((p) => !p.candidate).length === 0 ? (
                  <EmptyState title="No other pairs" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Product × reaction</th>
                          <th className="py-1.5 pr-3 font-medium">N</th>
                          <th className="py-1.5 pr-3 font-medium">PRR (95% CI)</th>
                          <th className="py-1.5 pr-3 font-medium">χ²</th>
                          <th className="py-1.5 font-medium">Not a candidate because</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {result.pairs
                          .filter((p) => !p.candidate)
                          .slice(0, 12)
                          .map((p) => (
                            <tr key={p.key} data-e2e-other-pair={p.key}>
                              <td className="py-1.5 pr-3">
                                {p.product} × {p.reaction}
                              </td>
                              <td className="mono-num py-1.5 pr-3">{p.a}</td>
                              <td className="mono-num py-1.5 pr-3">
                                {num(p.prr.value)} ({ci(p.prr)})
                              </td>
                              <td className="mono-num py-1.5 pr-3">{p.chiSquare.toFixed(2)}</td>
                              <td className="py-1.5 text-muted-foreground">{whyNot(p)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </>
          )}
        </QueryBoundary>
      </div>
    </>
  );
}
