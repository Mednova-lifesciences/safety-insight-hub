import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Flag } from "lucide-react";
import { toast } from "sonner";
import { linelist as linelistApi } from "@/services/api/linelist";
import { loadValidatedCases } from "@/services/api/linelist-cross-file";
import {
  DUPLICATE_FIELD_LABELS,
  duplicateDropNote,
  findCrossFileDuplicates,
  type CrossFileCase,
  type DuplicatePair,
} from "@/services/api/linelist-cross-duplicates";
import { CLUSTER_WINDOW_DAYS, findClusterFlags } from "@/services/api/linelist-clusters";
import { StaleJobError } from "@/services/api/linelist-job-store";
import { EmptyState, QueryBoundary, Section, StatusPill } from "@/components/pv/primitives";
import { Button } from "@/components/ui/button";

const QUERY_KEY = ["linelist", "validated-cases"];

/** The cross-file checks' shared read: only validated line lists, only when
 *  a panel is on screen. It reads every validated file's rows, so it is not
 *  re-read on every window focus; `refreshKey` (the light job list's ids,
 *  check times and versions) brings it up to date when a file changes. */
function useValidatedCases(refreshKey = "", enabled = true) {
  return useQuery({
    queryKey: [...QUERY_KEY, refreshKey],
    queryFn: async () => ({ data: await loadValidatedCases(), source: "live" as const }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
}

/** True once the element has come near the viewport — so the panels below
 *  the issues table read the other files' rows only when someone scrolls
 *  to them, and opening a line list costs nothing extra. */
function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: "300px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** What `refreshKey` is made of, from the job list the page already has. */
export function validatedJobsKey(
  jobs: {
    id: string;
    stage: string;
    checkedAt?: string | undefined;
    version?: number | undefined;
  }[],
): string {
  return jobs
    .filter((j) => j.stage === "VALIDATED" || j.stage === "E2B_GENERATED")
    .map((j) => `${j.id}:${j.checkedAt ?? ""}:${j.version ?? ""}`)
    .sort()
    .join("|");
}

const SIDE_FIELDS: { label: string; get: (c: CrossFileCase) => string | undefined }[] = [
  { label: "Case ID", get: (c) => c.caseId },
  { label: "Patient", get: (c) => c.patientIdentifier },
  { label: "Sex", get: (c) => c.sex },
  { label: "Age", get: (c) => [c.age, c.ageUnit].filter(Boolean).join(" ") },
  { label: "Vaccine", get: (c) => c.product },
  { label: "Batch", get: (c) => c.batch },
  { label: "Vaccinated", get: (c) => c.vaccinationDate },
  { label: "Onset", get: (c) => c.onsetDate },
  { label: "Reaction", get: (c) => c.reaction },
  { label: "Facility", get: (c) => c.facility },
];

function CaseColumn({ c, heading }: { c: CrossFileCase; heading: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-md border border-border p-3">
      <p className="label-caps mb-1">{heading}</p>
      <p className="mb-2 truncate text-sm font-medium" title={c.filename}>
        {c.filename} · row {c.row}
      </p>
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
        {SIDE_FIELDS.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="truncate">{f.get(c) || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * "Possible duplicates in other files" for the open line list. A person
 * decides every pair: Drop as duplicate (the ordinary Drop, reason
 * Duplicate, with a note naming the other report) or Not a duplicate
 * (remembered on the job and audited). Nothing is ever dropped on its own.
 */
export function CrossFileDuplicatesPanel({
  jobId,
  stage,
  refreshKey,
  onDecided,
}: {
  jobId: string;
  stage: string;
  refreshKey?: string;
  onDecided: () => void;
}) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const query = useValidatedCases(refreshKey, seen);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const validated = stage === "VALIDATED" || stage === "E2B_GENERATED";

  const pairs = useMemo((): DuplicatePair[] => {
    const jobs = query.data?.data ?? [];
    const open = jobs.find((j) => j.id === jobId);
    if (!open) return [];
    const dismissed = new Set(jobs.flatMap((j) => j.notDuplicatePairs));
    const others = jobs.filter((j) => j.id !== jobId).flatMap((j) => j.cases);
    return findCrossFileDuplicates(open.cases, others, dismissed);
  }, [query.data, jobId]);

  const act = async (pair: DuplicatePair, kind: "drop" | "keep") => {
    setBusy(pair.key);
    try {
      if (kind === "drop") {
        await linelistApi.decideCase(jobId, {
          row: pair.a.row,
          decision: "DROP",
          reason: "DUPLICATE",
          note: duplicateDropNote(pair.b),
        });
        toast.success(`Row ${pair.a.row} dropped as a duplicate — it will not be in the XML.`);
      } else {
        await linelistApi.markNotDuplicate(
          jobId,
          pair.key,
          `Row ${pair.a.row} is not a duplicate of row ${pair.b.row} in "${pair.b.filename}"`,
        );
        toast.success("Marked as not a duplicate — this pair will not be shown again.");
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      onDecided();
    } catch (err) {
      toast.error(
        err instanceof StaleJobError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not save the decision.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref}>
      <Section
        title="Possible duplicates in other files"
        description="Rows of this line list that look like the same case as a row in another validated file of your organisation — same vaccine, vaccinated within 3 days, and enough of sex, age, initials, batch, reaction, onset and facility agreeing. Rule-based; you decide each pair."
      >
        {!validated ? (
          <EmptyState
            title="Validate this file first"
            description="Only validated line lists are compared with each other."
          />
        ) : (
          <QueryBoundary query={query} loadingLabel="Comparing with your other line lists">
            {() =>
              pairs.length === 0 ? (
                <EmptyState
                  title="No possible duplicates found"
                  description="No row here closely matches a row in another validated line list."
                />
              ) : (
                <ul className="space-y-3">
                  {pairs.map((p) => (
                    <li key={p.key} className="rounded-md border border-border p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <Copy className="size-3.5 text-muted-foreground" />
                        <span className="font-medium">Matched on:</span>
                        <StatusPill tone="info">Vaccine</StatusPill>
                        <StatusPill tone="info">
                          Vaccination date
                          {p.vaccinationDaysApart
                            ? ` (${p.vaccinationDaysApart} day(s) apart)`
                            : ""}
                        </StatusPill>
                        {p.matched.map((f) => (
                          <StatusPill key={f} tone="info">
                            {DUPLICATE_FIELD_LABELS[f]}
                          </StatusPill>
                        ))}
                        {p.conflicting.map((f) => (
                          <StatusPill key={f} tone="warning">
                            Differs: {DUPLICATE_FIELD_LABELS[f]}
                          </StatusPill>
                        ))}
                        <span className="ml-auto text-muted-foreground">score {p.score}</span>
                      </div>
                      <div className="flex flex-col gap-2 md:flex-row">
                        <CaseColumn c={p.a} heading="This file" />
                        <CaseColumn c={p.b} heading="Other file" />
                      </div>
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void act(p, "keep")}
                        >
                          Not a duplicate
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void act(p, "drop")}
                        >
                          Drop row {p.a.row} as duplicate
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            }
          </QueryBoundary>
        )}
      </Section>
    </div>
  );
}

/**
 * "Batch and facility flags for review": two or more serious cases sharing
 * a real batch, or the same vaccine at the same facility, within 30 days,
 * across every validated line list. A flag for a person to look at — not a
 * signal and not a conclusion.
 */
export function ClusterFlagsCard({ refreshKey }: { refreshKey?: string }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const query = useValidatedCases(refreshKey, seen);
  return (
    <div ref={ref}>
      <Section
        title="Batch and facility flags for review"
        description={`Two or more serious cases sharing a vaccine batch, or the same vaccine at the same reporting facility, within ${CLUSTER_WINDOW_DAYS} days, across your validated line lists. Dropped and held cases (including confirmed duplicates) are left out. A flag for review — not a signal, and not a conclusion about the vaccine.`}
      >
        <QueryBoundary query={query} loadingLabel="Looking across your line lists">
          {(jobs) => {
            const flags = findClusterFlags(jobs.flatMap((j) => j.cases));
            if (flags.length === 0)
              return (
                <EmptyState
                  title="Nothing to flag"
                  description="No two serious cases share a batch, or a vaccine and facility, within 30 days."
                />
              );
            return (
              <ul className="space-y-3">
                {flags.map((f) => (
                  <li key={f.key} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                      <Flag className="size-3.5 text-warning" />
                      <StatusPill tone="warning">Flag for review</StatusPill>
                      <span className="font-medium">
                        {f.kind === "BATCH" ? `Batch ${f.label}` : f.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {f.cases.length} serious case(s), {f.from} to {f.to}
                      </span>
                    </div>
                    <ul className="space-y-1 text-xs">
                      {f.cases.map((c) => (
                        <li key={`${c.jobId}#${c.row}`} className="flex flex-wrap gap-x-2">
                          <Link
                            to="/line-list"
                            search={{ job: c.jobId }}
                            className="font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {c.filename} · row {c.row}
                          </Link>
                          <span>{c.caseId ?? ""}</span>
                          <span className="text-muted-foreground">
                            {[c.product, c.batch, c.facility, c.vaccinationDate]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            );
          }}
        </QueryBoundary>
      </Section>
    </div>
  );
}
