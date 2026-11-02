import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, ExternalLink, Radar } from "lucide-react";
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
  SIGNAL_SCREEN_HOW_IT_WORKS,
  explainCandidate,
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
import { cn } from "@/lib/utils";

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

/** What each decision button says, and what choosing it means. */
const ACTION_LABELS: Record<ScreenDecision, string> = {
  CONFIRMED: "Accept as a signal",
  REFUTED: "Decline — not a signal",
  MONITOR: "Keep monitoring",
};
const ACTION_HELP: Record<ScreenDecision, string> = {
  CONFIRMED:
    "The cases point to a possible new safety concern. It goes forward for signal evaluation.",
  REFUTED: "The pattern is explained: a known reaction, duplicates, coding or chance.",
  MONITOR: "Not enough yet. Look at it again at the next screen.",
};

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
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<ScreenDecision | null>(null);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const decided = decision?.status as ScreenDecision | undefined;
  const explained = explainCandidate(pair, result);
  const title = `${pair.product} × ${pair.reaction}`;

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

  // The cases grouped by the line list they came from, largest first.
  const byFile = [
    ...pair.cases
      .reduce((m, c) => {
        const g = m.get(c.jobId) ?? {
          jobId: c.jobId,
          filename: c.filename,
          cases: [] as typeof pair.cases,
        };
        g.cases.push(c);
        return m.set(c.jobId, g);
      }, new Map<string, { jobId: string; filename: string; cases: typeof pair.cases }>())
      .values(),
  ].sort((x, y) => y.cases.length - x.cases.length || x.filename.localeCompare(y.filename));
  const times = pair.prr.value >= 10 ? Math.round(pair.prr.value) : pair.prr.value.toFixed(1);

  return (
    <li className="rounded-md border border-border" data-e2e-candidate={pair.key}>
      {/* The candidate in one line; the rest opens below it. */}
      <div
        className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2.5 hover:bg-muted/40"
        onClick={() => setExpanded((v) => !v)}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} details for ${title}`}
          className="flex size-6 items-center justify-center rounded hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
        </button>
        <span className="font-semibold text-foreground">{pair.product}</span>
        <span className="text-muted-foreground">×</span>
        <span className="font-semibold text-foreground">{pair.reaction}</span>
        <StatusPill tone={pair.reactionSource === "MEDDRA" ? "success" : "neutral"}>
          {pair.reactionSource === "MEDDRA" ? `MedDRA ${pair.meddraCode}` : "verbatim term"}
        </StatusPill>
        <span className="text-xs text-muted-foreground">{explained.summary}</span>
        <span className="ml-auto">
          {decided ? (
            <StatusPill tone={DECISION_TONE[decided]}>{SCREEN_DECISION_LABELS[decided]}</StatusPill>
          ) : (
            <StatusPill tone="warning">Awaiting your decision</StatusPill>
          )}
        </span>
      </div>

      {expanded ? (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <dl className="space-y-2 rounded-md border border-assist/30 bg-assist-soft px-3 py-2 text-sm">
            <div>
              <dt className="font-medium">Why it is a candidate</dt>
              <dd className="text-foreground">{explained.why}</dd>
            </div>
            <div>
              <dt className="font-medium">What it does not mean</dt>
              <dd className="text-foreground">{explained.notMeaning}</dd>
            </div>
          </dl>

          <div className="mt-3">
            <p className="label-caps">
              Where the reports come from — {byFile.length} line list
              {byFile.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-1 space-y-2">
              {byFile.map((g) => (
                <li key={g.jobId} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{g.filename}</span>
                    <span className="text-xs text-muted-foreground">
                      {g.cases.length} case{g.cases.length === 1 ? "" : "s"}
                    </span>
                    <Button asChild size="sm" variant="outline" className="ml-auto h-7">
                      <Link to="/line-list" search={{ job: g.jobId }}>
                        Open this line list
                      </Link>
                    </Button>
                  </div>
                  <p className="mono-num mt-1 text-xs text-muted-foreground">
                    {g.cases.map((c) => `${c.caseId ?? "no case ID"} (row ${c.row})`).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <details className="mt-3 rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">
              The numbers (for reviewers who want them)
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Stat label="Reports (N)" value={String(pair.a)} />
              <Stat label="PRR" value={num(pair.prr.value)} sub={`95% CI ${ci(pair.prr)}`} />
              <Stat label="ROR" value={num(pair.ror.value)} sub={`95% CI ${ci(pair.ror)}`} />
              <Stat label="χ² (Yates)" value={pair.chiSquare.toFixed(2)} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              2×2: a {pair.a} · b {pair.b} · c {pair.c} · d {pair.d}
              {pair.corrected
                ? " — a cell was zero, so 0.5 was added to every cell for the ratios"
                : ""}
              . PRR — how many times as often the reaction is reported with this product as with the
              others. ROR — the same comparison as odds. χ² — how unlikely the gap is to be chance
              alone.
            </p>
          </details>

          {decision?.rationale ? (
            <div className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2">
              <p className="label-caps">Decision recorded</p>
              <p className="mt-1 text-sm">{decision.rationale}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {decision.reviewer ?? "Reviewer"} · {decision.decidedAt?.slice(0, 10)} · pool of{" "}
                {decision.poolSize ?? "?"} reports
              </p>
            </div>
          ) : null}

          <div className="mt-3 rounded-md border border-border px-3 py-3">
            <p className="label-caps">{decided ? "Change the decision" : "Your decision"}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(Object.keys(ACTION_LABELS) as ScreenDecision[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMode(mode === d ? null : d)}
                  aria-pressed={mode === d}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    mode === d
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/40"
                  }`}
                >
                  <span className="block font-medium text-foreground">{ACTION_LABELS[d]}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {ACTION_HELP[d]}
                  </span>
                </button>
              ))}
            </div>
            {mode ? (
              <div className="mt-3 space-y-2">
                <label className="label-caps" htmlFor={`rationale-${pair.key}`}>
                  Your reason (required, recorded in the audit trail)
                </label>
                <Textarea
                  id={`rationale-${pair.key}`}
                  rows={3}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="What you found in the cases: plausibility, timing, known reactions, duplicates, coding, confounders."
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={record} disabled={busy}>
                    Record: {ACTION_LABELS[mode]}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
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
    // Decisions too: drawn before they load, a decided candidate would
    // briefly read "Awaiting your decision".
    isPending: cases.isPending || codings.isPending || decisions.isPending,
    error: (cases.error ?? codings.error ?? decisions.error) as Error | null,
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
              <details className="rounded-md border border-border bg-card px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  How the signal screen works
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {SIGNAL_SCREEN_HOW_IT_WORKS.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>

              <Section title="The pool">
                <PoolBanner result={result} />
              </Section>

              <Section
                title={`Candidates (${result.candidates.length})`}
                description="Product and reaction pairs reported together more often than the rest of your line lists predicts. Open one to see why, where its reports come from, and to record a decision."
              >
                {result.candidates.length === 0 ? (
                  <EmptyState
                    title="No pair meets the screening rule"
                    description="Nothing in the validated line lists is reported disproportionately often. This says nothing about signals the pool is too small to show."
                  />
                ) : (
                  <ul className="space-y-2">
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
