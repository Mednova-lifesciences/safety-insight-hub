import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { toast } from "sonner";
import { recordAudit } from "@/services/api/db";
import {
  findCrossFileDuplicates,
  type DuplicatePair,
} from "@/services/api/linelist-cross-duplicates";
import {
  EXPECTED_RATES,
  STATUS_LABELS,
  describeCheck,
  observedVsExpected,
  type ObservedExpectedResult,
} from "@/services/api/observed-expected";
import type { LoadedJob } from "@/services/api/linelist-cross-file";
import { QueryBoundary, Section, StatusPill, type Tone } from "@/components/pv/primitives";
import { useSeen, useValidatedCases } from "@/components/pv/linelist-cross-file-panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TONE: Record<ObservedExpectedResult["status"], Tone> = {
  ABOVE_EXPECTED: "warning",
  HIGHER_WITHIN_CHANCE: "info",
  NOT_ABOVE: "neutral",
};

/** Every still-open cross-file pair in the organisation, so a case reported
 *  twice is counted once. */
function openPairs(jobs: LoadedJob[]): DuplicatePair[] {
  const dismissed = new Set(jobs.flatMap((j) => j.notDuplicatePairs));
  const seen = new Set<string>();
  const out: DuplicatePair[] = [];
  for (const job of jobs) {
    const others = jobs.filter((j) => j.id !== job.id).flatMap((j) => j.cases);
    for (const p of findCrossFileDuplicates(job.cases, others, dismissed)) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      out.push(p);
    }
  }
  return out;
}

const fmt = (x: number) => (x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(3));

/**
 * Observed vs expected — a screening check with a high false-positive rate,
 * not a signal. The evaluator chooses a vaccine and event and enters the
 * doses given; the expected count comes from a WHO background rate, the
 * observed count from the kept, de-duplicated validated line-list cases.
 * Each run is recorded in the audit trail with its whole calculation.
 */
export function ObservedExpectedCard() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const query = useValidatedCases("", seen);
  const [rateId, setRateId] = useState(EXPECTED_RATES[0]!.id);
  const [doses, setDoses] = useState("");
  const [result, setResult] = useState<ObservedExpectedResult | null>(null);
  const rate = EXPECTED_RATES.find((r) => r.id === rateId)!;
  const jobs = query.data?.data;
  const pairs = useMemo(() => (jobs ? openPairs(jobs) : []), [jobs]);

  const run = async () => {
    if (!jobs) return;
    try {
      const r = observedVsExpected(
        rate,
        Number(doses.replace(/[\s,]/g, "")),
        jobs.flatMap((j) => j.cases),
        pairs,
      );
      setResult(r);
      await recordAudit({
        action: "OBSERVED_EXPECTED_CHECK",
        entity: "LineListScreeningCheck",
        entityId: rate.id,
        newValue: describeCheck(r),
        reason: "Observed vs expected screening check (high false-positive rate; not a signal)",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run the check.");
    }
  };

  return (
    <div ref={ref}>
      <Section
        title="Observed vs expected (screening check)"
        description="Compares the cases in your kept, de-duplicated line lists with what WHO's published background rate predicts for the doses given. A screening check with a high false-positive rate — not a signal and not a conclusion. Every run is recorded in the audit trail."
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <label className="block">
            <span className="label-caps">Vaccine and event</span>
            <Select
              value={rateId}
              onValueChange={(v) => {
                setRateId(v);
                setResult(null);
              }}
            >
              <SelectTrigger className="mt-1" aria-label="Vaccine and event">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPECTED_RATES.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.vaccine} — {r.event}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="label-caps">Doses administered</span>
            <Input
              className="mt-1"
              inputMode="numeric"
              aria-label="Doses administered"
              placeholder="e.g. 250000"
              value={doses}
              onChange={(e) => setDoses(e.target.value)}
            />
          </label>
          <Button onClick={() => void run()} disabled={!jobs || !doses.trim()}>
            <Calculator className="size-4" /> Run check
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Expected rate: {rate.statedAs}. Source: {rate.source.title} ({rate.source.date}).{" "}
          <a className="underline" href={rate.source.url} target="_blank" rel="noreferrer">
            WHO
          </a>
        </p>

        <QueryBoundary query={query} loadingLabel="Reading your validated line lists">
          {() =>
            result ? (
              <div className="mt-3 space-y-2 rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={TONE[result.status]}>{STATUS_LABELS[result.status]}</StatusPill>
                  <span>
                    Observed <strong>{result.observed}</strong> · expected{" "}
                    <strong>{fmt(result.expected)}</strong> · exact 95% interval{" "}
                    {fmt(result.interval[0])}–{fmt(result.interval[1])}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Flagged only when the expected count falls below the interval — observed above
                  expected beyond chance. Many reasons other than the vaccine can do that (reporting
                  campaigns, duplicates not yet resolved, an incomplete dose count).
                </p>
                {result.counted.length ? (
                  <div>
                    <p className="label-caps">Counted</p>
                    <ul className="text-xs">
                      {result.counted.map((c) => (
                        <li key={`${c.jobId}#${c.row}`}>
                          {c.caseId ?? "—"} · {c.filename} row {c.row} · {c.reaction}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {result.excluded.length ? (
                  <div>
                    <p className="label-caps">Left out</p>
                    <ul className="text-xs text-muted-foreground">
                      {result.excluded.map((e) => (
                        <li key={`${e.c.jobId}#${e.c.row}`}>
                          {e.c.caseId ?? "—"} · {e.c.filename} row {e.c.row}: {e.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null
          }
        </QueryBoundary>
      </Section>
    </div>
  );
}
